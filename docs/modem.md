# The modem and the terminal (plan)

A serial terminal for the CP/M machine: what is typed goes out of a modem port, what comes in goes to the
80x24 VT100 screen. What answers on the other end is chosen at run time. Decided 2026-11-05.

```
Z80 program ⇄ UART (ports 6/7, 1200 baud) ⇄ Hayes AT layer ⇄ line
                                                              ├─ the built-in BBS (JavaScript)
                                                              ├─ a WebSocket bridge → a telnet host
                                                              └─ Web Serial → a real WiFi modem
```

## Decisions

- **Reached by ports first**, and as the CP/M 3 AUX device. The CP/M 2.2 BIOS is not changed (its bytes are
  tested against the 1979 disk). CP/M 2.2 programs (a terminal program, MEX, Kermit-80) use the ports.
- **Terminal unchanged**: ASCII only. The BBS uses boxes of `+-|`, bold and reverse. No DEC graphics, no
  colour. A bridge announces `TERM=vt100`.
- **Online services are off by default**: one SETUP switch; the text says what is sent (a city name goes to
  the weather service). Off or offline, the desk is "not answering".
- **All three lines**: the built-in BBS, the telnet bridge, Web Serial.
- **1200 baud for the feel**, 300/2400/9600 selectable. Timing is counted in the machine's T-states, so it
  is the same at any emulator speed, paused, stepped or restored from a snapshot.

## The ports

| Port | In | Out |
|---|---|---|
| 6 | status | control |
| 7 | the received byte | the byte to send |

Status: bit 0 a received byte waits (RDA), bit 1 the transmitter is empty (TBE), bit 2 carrier detect (DCD),
bit 3 overrun (a byte arrived before the last was read; lost, cleared by reading the data). Bits 4–7 are 0,
so a status of `0FFh` means no modem (an unused port reads `0FFh`).
Control: bit 0 DTR. Dropping DTR hangs up. Bytes written while the transmitter is busy are lost.

A character takes 10 bit times: 120 a second at 1200 baud, about 33 000 T-states at 4 MHz.

## Idle machine

A program polling the modem at an empty prompt is idle, like one polling the console: `Machine.run()` stops
after 64 idle polls. The T-states it did not run are credited to the modem's clock (a waiting loop would
have spent them), otherwise 1200 baud would crawl at an idle prompt.

## Build order

1. The UART (`js/devices/modem.js`), a loopback line, the idle credit, snapshots. `test/modem.test.js`.
2. The Hayes layer: `AT`, `ATZ`, `ATE`, `ATV`, `ATDT`, `ATH`, `ATA`, `+++`, S-registers, `CONNECT 1200`,
   `NO CARRIER`, `BUSY`.
3. A terminal program in 8080 assembly on a shelf disk; the CP/M 3 BIOS AUX device.
4. The built-in BBS: menu, clock, moon phase, bulletin board (IndexedDB), XMODEM file area (the shelf),
   SYSOP chat (Z80-μLM). Then the weather desk (Open-Meteo, behind the setting).
5. `tools/modem-bridge.js`: a dependency-free Node WebSocket-to-TCP gateway (host allowlist, token); telnet
   negotiation in the page. A gateway URL in SETUP. A page served over https reaches only `wss://` or
   `ws://localhost`.
6. Web Serial (Chromium only; needs a modem to test).

## Lines

A line is any object with `send(byte)` (from the Z80), `dtr(on)` and `reset()`; it calls `modem.receive(bytes)`
and sets `modem.carrier`. A snapshot does not keep a connection: restoring drops carrier.

## Status (2026-11-05)

Steps 1–3 are built. `TERM.COM` is on the CP/M 2.2 disk (with its source, `TERM.ASM`): `TERM`, then `AT`,
`ATDT0` (the echo service), `+++` and `ATH`; Ctrl-] Q leaves with the call up, Ctrl-] H hangs up. Under CP/M 3
the modem is the character device `MDM` (`DEVICE AUXOUT:=MDM`, then `PIP AUX:=file`); copy `TERM.COM`
over from the 2.2 disk (the CP/M 3 disk has no room left to carry it). The numbers dialed are in
`js/devices/directory.js`; the built-in BBS (step 4) adds its own.

A program that polls the modem is "waiting": the run loop spends the T-states up to the next byte, answer or
timer on the modem's clock (`Machine.skipIdle`), so 1200 baud is exact at an idle prompt too. The line has no
flow control: a byte nobody reads before the next arrives is lost (overrun), as on a real serial port.

## The BBS (step 4, in progress)

`ATDT5550100` (dashes are ignored) reaches the Digital Rerun BBS (`js/bbs.js`): **T** time and date (the host
clock), **M** the moon (phase, age, lit fraction, a drawing; computed, offline), **B** bulletins (the last 8 of
50, kept in the browser's localStorage; a post is a name and one line), **W** the weather desk, **G** goodbye
(hangs up). Weather needs SETUP → *Online services*, off by default: the city name goes to open-meteo.com
(geocoding, then a 4-day forecast), nothing else; off or unreachable, "the weather desk is not answering".
The CP/M 3 device is `MDM` (three letters, like CRT, LPT, PTR, PTP). To do: XMODEM file area, SYSOP chat.
