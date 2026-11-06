# CP/M 3 on DigitalRerun

DigitalRerun runs CP/M 3 (CP/M Plus), non-banked: 64K flat memory, about 53K for
programs, the same drives as CP/M 2.2 (A: to D: and the hard disk I:), `CCP.COM`
loaded from A: at each warm start, and CP/M 3's own commands (`DIR`, `PIP`, `SHOW`,
`SET`, `DEVICE`, `HELP`, `ED` …). Nothing in the emulator changed for it.

**It is a disk of the public shelf**: SHELF in DRIVES, *CP/M 3*, insert it in A: and press
`^C` (or reset). The loader starts and reads `CPM3.SYS`.

Digital Research's CP/M 3 is free to distribute under the same DRDOS, Inc. grant as
CP/M 2.2 (`LICENSE-DRI`). It comes from The Unofficial CP/M Web Site
(<http://www.cpm.z80.de/source.html>):

- `system/cpm3/dri/`: the developers' build directory (`cpm3src.zip`), the sources of the
  CCP, BDOS, BIOS samples and the commands, with `MAKING.DOC`. Reference; it is not built here
  (the BDOS and the commands are PL/M, whose compiler is not part of this project).
- `disks/shelf/cpm3/`: the binaries (`cpm3bin.zip`, the build with the year 2000 fixes, and
  `RMAC`, `LINK`, `LIB`, `SID`, `XREF`, `SCB.REL` from `cpm3on2.zip`).

What is DigitalRerun's (MIT): `system/cpm3/bios3.asm` (the BIOS), `ldrbios3.asm` (the loader's
BIOS), `boot3.asm` (the boot sector), `disks/shelf/cpm3/GEN.SUB`.

## Build

```
node tools/build-cpm3.js [--check]
node tools/build.js            # lists the folder in disks/shelf.json
```

The CP/M 3 tools run inside the machine itself, as `GEN.SUB` does on the finished disk:
`RMAC` and `LINK` build the BIOS (`BIOS3.SPR`), `GENCPM` makes `CPM3.SYS` (top page of memory
`FF`, no banking), `RMAC` and `LINK` build the loader (`CPMLDR.COM`). The boot sector and the
loader are the disk's system tracks, `SYSTEM.BIN`. Written into `disks/shelf/cpm3/`: `CPM3.SYS`,
`SYSTEM.BIN`, `GENCPM.DAT` (the answers GENCPM was given) and a copy of the BIOS sources;
`--check` only compares. The test fails when they are stale.

On the disk itself, `SUBMIT GEN` rebuilds `CPM3.SYS` from `BIOS3.ASM` (change the BIOS, run it,
press `^C`), `SUBMIT GENLDR` the loader (`CPMLDR.COM`; the system tracks need `SYSTEM.BIN`'s
boot sector in front, so that is the tool's).

## What the BIOS does

The DigitalRerun implementation of CP/M 3 provides:

- **Console, printer and paper tape**: CP/M 3 character devices `CRT`, `LPT`, `PTR` and `PTP`, with the usual `DEVICE` assignments. The disk controller moves 128-byte records, so the BDOS does no sector blocking; the 5¼" formats and the hard disk need no more.

- **Disk formatting**: The disk's format decides its parameter block, as in the CP/M 2.2 BIOS (`system/bios.asm`). Supports:
  - 8" single-sided, single-density (SSSD) on drives A: through D:
  - Three 5¼" formats on A: through D: (SSSD 200K, DSDD 400K with 512-byte sectors, SSDD 200K with 1K sectors)
  - 4 MB hard disk on I: (z80pack geometry)

- **Host clock integration**: The BIOS's `TIME` reads the machine's clock port (below), so `DATE` and `DATE CONTINUOUS` show the host's date and time, moving with the machine. The clock is the host's: `DATE SET` is accepted and ignored (the host time cannot be changed through the emulator). The BIOS has no bank switching (`SELMEMORY`, `XMOVE` do nothing), so a banked `CPM3.SYS` cannot run.

- **Assembler compatibility**: Written in 8080 code, because RMAC (Digital Research's own assembler) takes nothing else. DigitalRerun uses `js/asm8080.js`, a two-pass 8080 assembler that reads both the ASM.COM and the Macro Assembler AS dialects.

## Notes for changing the CP/M 3 implementation

- **System Control Block**: `GENCPM` rewrites every reference to the System Control Block, so the stock `SCB.REL` (`scb$base` `0FE00h`) is used unchanged, whatever the real place of the SCB.

- **Loader limitations**: The loader reads `CPMLDR.COM` from sector 2 on, up to 25 records; the boot sector knows 26 records a track for the 8" format and 40 for the 5¼" ones.

- **Shelf disk system tracks**: A shelf disk's `disk.json` may name `system`, a file with the bytes of the system tracks (kept beside the files, not on the disk). The `text` field lists names to convert as CP/M text (`GENCPM.DAT`). `Shelf.buildDisk` writes the tracks before the files.

- **Missing INITDIR**: `INITDIR.COM` is missing from the distribution (it is PL/I); `SET [...]` and everything else works.

## The clock port (js/devices/clock.js)

The clock port provides a read-only interface for any program (a CP/M 2.2 program or a game as well):

```
OUT 20,n    latch the date and time and rewind the record
IN  20      the next byte of the latched record (0FFh before a latch and after the record)
```

The record is 15 bytes total:
- Byte 0: `1` (a clock is here) - records presence
- Bytes 1-2: Days since 31 Dec 1977 (1 Jan 1978 is 1), low byte first (CP/M 3's date format)
- Bytes 3-4: Hour, minute, second (BCD encoding)
- Bytes 5-6: Year (2 bytes, low first), month, day, weekday (0 = Sunday)
- Bytes 7-10: Milliseconds since reset, 4 bytes, low first, wrapping at 2^32, for timing

The record is latched whole, so the minute and the second are of one moment. A machine without the port answers `0FFh` to the first read.

The time is the host's local time at reset, moved on by the machine's own time: its T-states at the speed setting (4 MHz is one second per 4,000,000), so:
- A paused or stepped machine stands still
- A faster machine's seconds are shorter
- A snapshot keeps the counter

There is no interrupt: a program polls the counter (a timed wait is a loop on it). Speed *Max* counts as 4 MHz.
