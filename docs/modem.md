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
after 64 idle polls. The T-states it did not run pass as machine time (a waiting loop would have spent them:
`Modem.idle` adds them to `machine.cycles`, so the clock, the modem and TERM's timeouts all keep real time),
otherwise 1200 baud would crawl at an idle prompt.

## Build order

1. The UART (`js/devices/modem.js`), a loopback line, idle time, snapshots. `test/modem.test.js`.
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

Steps 1–3 are built. `TERM.COM` is on the CP/M 2.2 disk (its source is `system/term.asm`; it is not on the disk, which needs the room for rebuilding the BIOS): `TERM`, then `AT`,
`ATDT0` (the echo service), `+++` and `ATH`; Ctrl-] Q leaves with the call up, Ctrl-] H hangs up. Under CP/M 3
the modem is the character device `MDM` (`DEVICE AUXOUT:=MDM`, then `PIP AUX:=file`); copy `TERM.COM`
over from the 2.2 disk (the CP/M 3 disk has no room left to carry it). The numbers dialed are in
`js/devices/directory.js`; the built-in BBS (step 4) adds its own.

A program that polls the modem is "waiting": the run loop spends the T-states up to the next byte, answer or
timer on the modem's clock (`Machine.skipIdle`), so 1200 baud is exact at an idle prompt too. The line has no
flow control: a byte nobody reads before the next arrives is lost (overrun), as on a real serial port.

## The BBS (step 4)

`ATDT0100` (or `ATDT5550100`; dashes are ignored) reaches the Digital Rerun BBS (`js/bbs.js`):

- **T** time and date (the host clock); **M** the moon (phase, age, lit fraction, a drawing; computed, offline).
- **B** bulletins: the last 8 of 50, kept in the browser (localStorage); a post is a name and one line.
- **F** files: `ABOUT.TXT`, `HELLO.COM` (a nine-byte CP/M program) and what callers uploaded (32K each, 256K in
  all, in the browser). **D**ownload and **U**pload by XMODEM; the board sends checksum or CRC, and asks for
  checksum. In TERM: `Ctrl-] R` receives (file name, then the board sends), `Ctrl-] S` sends; Ctrl-X stops.
  TERM times out through the machine's clock (port 20), so a transfer that gets no answer stops on its own.
- **W** the weather desk, needs SETUP → *Online services* (off by default): the city name goes to open-meteo.com
  (geocoding, then a 4-day forecast), nothing else. Off or unreachable: "the weather desk is not answering".
- **C** chat with the sysop (below).
- **G** games: WOPR (below). **O** a fortune. **S** services (below). **Q** quit (hangs up).

The CP/M 3 device is `MDM` (three letters, like CRT, LPT, PTR, PTP). Not built: a built-in terminal for CP/M 3's own `TERM`.

## A real modem (Web Serial, step 6)

SETUP → MODEM → *REAL MODEM…* opens the browser's port chooser (Chrome, Edge or another browser with Web Serial;
https or localhost; a click is needed) and puts the chosen USB serial port in place of the built-in Hayes
modem (`js/devices/webserial.js`). A WiFi modem (Zimodem, WiModem232 …) speaks Hayes itself, so bytes go
through both ways: `TERM`, `ATDT host:port`. Set the speed in SETUP to the modem's (300–19200; changing it reopens
the port). The UART still spaces what comes in at that speed, so a fast modem is heard at 1200 baud if you like.
Carrier is read from the modem's `CONNECT` and `NO CARRIER` lines; *Use the DTR and DCD lines* reads DCD and drives
DTR instead (off by default: a USB board with an ESP chip resets when DTR changes). Unplugging the port, or
*BUILT-IN MODEM*, goes back to the BBS. The BBS and the echo service are not reachable while a real modem is on.

## A telnet host (the bridge, step 5)

A browser cannot open a TCP connection, so `ATDT host:port` goes through a small program you run yourself:

```
tools/bridge.sh                      # the board's directory allowed, port 1984
tools/bridge.sh telehack.com,bbs.fozztexx.com     # or name your own hosts
tools/bridge.sh --show-token         # just print the token
```

It prints its address (`ws://127.0.0.1:1984`) and a token. The token is not random: it is worked out from this machine's name, your
user name and the port (three words and four hex digits, e.g. `valve-yonder-dynamo-8829`), so it is the same every run and can be
typed into SETUP once (`BRIDGE_SEED=salt` adds a salt; `BRIDGE_PORT` changes the port). It keeps stray web pages out; it is not a
secret from someone who knows the machine name, the user and the port. Then SETUP → MODEM: *Bridge* `ws://localhost:1984` and
*Bridge token*, and in TERM `ATDT bbs.example.org` (port 23) or `ATDT bbs.example.org:2323` (use `ATDT`: Hayes takes a lone `T` or
`P` after `D` as a dial modifier). Anything that is not a number of the built-in directory (letters or dots) goes to the bridge.

- **The bridge** (`tools/modem-bridge.js`, no dependencies) is a WebSocket to TCP pipe. `--allow` is required and
  names what may be dialed (`host`, `host:port`, `*.domain`, `*` for any public host; `--allow-private` lets `*`
  reach private and loopback addresses, which can always be named). A token (worked out from the host, user and port by default, or `--token`)
  must come with every connection; `--origin` limits the pages; `--max` connections at once. It logs the host
  dialed and nothing of what is said. It speaks `ws:`: an https page reaches it only on localhost, or through a
  TLS reverse proxy (`wss:`).
- **Telnet** is the page's (`js/devices/telnet.js`): it agrees to ECHO and SUPPRESS-GO-AHEAD, announces itself
  as a VT100 (TERMINAL-TYPE) of 80x24 (NAWS), refuses the rest, doubles 255 and sends CR as CR NUL. The bridge
  passes bytes untouched, so a raw TCP service works too if it never sends 255.
- **The modem answers as a phone would** (`js/devices/gateway.js`): no bridge at the URL `NO DIALTONE`, not
  allowed or unreachable `NO CARRIER`, connection refused `BUSY`, no answer in time `NO ANSWER`; the far end
  hanging up `NO CARRIER`.
- The line is the UART's: 1200 baud (or what SETUP says) however fast the host is, and the same XMODEM in TERM.
  Colour BBSes send ANSI colour and CP437 line drawing, which the VT100 screen does not draw (ASCII only, by
  decision); most say VT100 and send plain text.

## The sysop (chat)

`C` at the BBS menu talks to the sysop, a night-shift program of the board (dry, warm, a little tired; Relay Station
Kettle-7 is his day job, with a cat named Pixel). He runs on the host, in the page (`js/sysop.js`), not on the
emulated machine, and says he is a program when sincerely asked.

- **Built in:** a small rule-based sysop (the old ELIZA trick in the board's voice: reflects "I am ...", knows
  the menu, TERM, XMODEM, AT commands, CP/M). It needs nothing and answers whenever the endpoint cannot.
- **A language model:** SETUP → SYSOP CHAT: *Endpoint* (an OpenAI-compatible base URL such as
  `http://localhost:11434/v1` for Ollama, or llama.cpp, LM Studio, a hosted API), *Model*, *API key*. Used only when
  *Online services* is on and an endpoint and a model are named. It is sent `POST {endpoint}/chat/completions`
  with the sysop's instructions, the last ten exchanges of that chat and the line just typed: nothing else leaves
  the page. A local server must allow the page's origin (CORS; for Ollama, `OLLAMA_ORIGINS`). The key stays in this
  browser (settings). A failing endpoint falls back to the built-in sysop.
- **What the caller sees:** plain ASCII, a few lines of at most 74 characters (replies are cut down to that:
  smart quotes straightened, markdown and non-ASCII dropped, at most 480 characters), an indented second line,
  `/BYE` to leave. The chat starts with a request not to type names, numbers or medical details.

## WOPR and the fortunes

- **G** enters WOPR (`js/wopr.js`), the board's game computer, in the manner of an old war-games film: `LOGON:`
  with any name, `SHALL WE PLAY A GAME?`, then a game by name or number, `LIST GAMES`, `LOGOFF`. Playable:
  **TIC-TAC-TOE** (against WOPR, which cannot lose: a test walks every line of play; or 0 players, WOPR against
  itself ten times, all drawn) and **GLOBAL THERMONUCLEAR WAR** (a simulation between two fictional blocs: pick a
  side and three of eight made-up targets; the exchange runs, assets fall, winner none, "a strange game, the only
  winning move is not to play", and a polite offer of chess). The other names on the list are not loaded on this line.
- **O** is the fortune cookie jar (`js/fortune.js`): 97 messages written for this board (hacker koans, science
  fiction, retro computing, cyberpunk, cold-war computing), plain ASCII, never repeating one of the last twenty;
  **Y** another.
- **Q** at the menu quits the board (it was G, Goodbye).

## The games of WOPR

`G` enters WOPR; its list (`LIST GAMES`) holds, by name or number: TIC-TAC-TOE, BLACK JACK (bankroll, double down,
3 to 2), HANGMAN (tech words, the streak is the score), CODEBREAKER (four letters A to F, ten tries), NIM (3-5-7,
last object wins, WOPR plays the nim-sum), BATTLESHIP (8 by 8, ships of 4, 3, 3 and 2), HUNT THE WUMPUS (the
classic twenty-room cave), LUNAR LANDER (fuel left is the score; the constants are tuned so a soft landing with fuel
to spare exists, and a test lands it), FALKEN'S MAZE (a new 6 by 6 maze each time; fewer moves is better), HACK THE
GIBSON (a daily cipher puzzle in a pretend terminal: LS, CAT, ROT, LOGIN, HINT), TWENTY QUESTIONS and KETTLE-7 (a text
adventure of the relay station), then GLOBAL THERMONUCLEAR WAR. CHESS, CHECKERS, POKER and the like are listed
as not loaded on this line. The games are `js/games.js`, `js/gibson.js`, `js/twentyq.js`, `js/adventure.js`; each
is `{ name, play(h, done) }` (see the header of `js/wopr.js`), so a new one is one object in the list. High scores
(`js/scores.js`): one table per game, kept in the browser, the best ten.

**TWENTY QUESTIONS** has two minds: offline, you think of an animal and WOPR guesses it with yes/no questions, and
*learns* a new animal and a question that tells it apart when it is wrong (kept in the browser). With the sysop's
language model connected you can also choose to ask: the program keeps the secret and checks guesses itself, the
model only answers Yes, No or Sometimes. **KETTLE-7** and **HACK THE GIBSON** ask the model for hints when it is
connected (`Sysop.converse`), with their own hints as the fallback.

## The services

`S` at the menu opens the services (`js/doors.js`): **R** the reference desk (ASCII chart, a number converter,
BDOS functions, the BIOS jump table, AT commands, 8080 and Z80 opcodes, VT100 codes: `js/reference.js`), **N** the
news desk (Hacker News, Wikipedia on this day), **K** the sky desk (the space station now; sunrise and sunset of a
city: the name goes to open-meteo.com), **L** the wall (one-liners, the last 30), **U** last callers (also counted at
every call: "you are caller #N"), **H** high scores, **V** this week's vote (one of 26 questions a week; the regulars'
votes are a fixed made-up tally, yours is added), **A** the art gallery, **E** mail to the sysop (he answers, a
program, by the next call: "you have mail from the sysop"), **D** the dial directory (real telnet hosts, checked on
5 Nov 2026, to dial through the bridge). News and sky are online desks: they need *Online services*, like the weather.

**F, L** in the file area is the software library: the shelf's programs (disks made of files), sent by XMODEM
(text files as CP/M text); at 1200 baud a big one takes minutes, as it should.

## Line manners

The board is one line, so now and then it is **busy** (8% of calls to `5550100`: dial again). Its sign-on follows
the line's speed (SETUP → MODEM): short at 300 baud, the usual at 1200, with a banner from 2400.

## The console (VT100 furniture)

The board draws like a console, in ASCII (`js/vt.js`; no line-drawing set, no colour; it assumes a VT100): a **title bar** on
row 1 (`DIGITAL RERUN BBS > GAMES > WOPR`, the line speed and the caller number on the right), a **status bar** on row 24 (a hint,
the progress of a transfer, `MAIL` and the clock on the right), and rows 2 to 23 as a **scroll region**, so that what scrolls never
touches the bars. Every screen is a page (`Session.page(crumb, hint)`: clear, bars, region); a door or a game is handed `page`,
`pause` (a key, then on) and `more` (a long text, a page at a time) beside `out` and `ask`.

The **main page** is a vertical menu with a one-line description of each key, a **system** panel (the line, the date, the moon, your
caller number and the last call, mail, the games), a small picture of the day, and a **log** of what has happened this call
(carrier, your uploads, a bulletin posted). The prompt is `bbs>`. Drawing the whole page takes 1.5 KB, ten seconds at 1200 baud: it
is drawn whole the first time and on a line of 2400 baud or more; coming back on a slow line only the menu is redrawn, and at
300 baud it is always the menu alone. Nothing is written to the screen while an XMODEM block is on the wire. Leaving the board (`Q`)
resets the terminal (no region, plain, cursor shown); so does `TERM`'s `Ctrl-] Q` and `H`.

## Numbers

Every place has a number, 555-nnnn, which may be dialed in full, without the dash, or by its last four digits: the board is `ATDT0100`
(also `ATDT 555-0100`), the echo service `ATDT0`, and the ten telnet hosts of the dial directory `0101` to `0110` (telehack.com is
`ATDT0101`). The directory shows the last four digits only. The hosts need the bridge; without one the modem answers `NO DIALTONE`.
A host can still be dialed by name: `ATDT telehack.com`. The table is `PHONEBOOK` in `js/devices/directory.js`.

Lines are drawn the cheap way (`js/vt.js`): a bar is reverse video on, the text, *erase to end of line* (the blanks it leaves are
reverse too, so it fills the row), and a short right-hand text positioned over the end; a rule is the same with labels at columns.
The main page writes the left text of a row once and reaches the right-hand panel with a four-byte cursor-forward, not a second
absolute move. A frame went from 219 to 154 bytes, the whole main page from 1405 to 1115, the menu alone from 484 to 431; the
fortune is two bars and the cookie, and the Gibson's banner two reverse lines, not 120 characters.
