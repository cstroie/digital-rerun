# CP/M 3 on DigitalRerun

DigitalRerun runs CP/M 3 (CP/M Plus), non-banked: 64K flat memory, about 53K for
programs, the same drives as CP/M 2.2 (A: to D: and the hard disk I:), `CCP.COM`
loaded from A: at each warm start, and CP/M 3's own commands (`DIR`, `PIP`, `SHOW`,
`SET`, `DEVICE`, `HELP`, `ED` …). Nothing in the emulator changed for it.

**Digital Research's files are not in this repository.** What is here is new
(MIT): the BIOS, the loader's BIOS, the boot sector and the tool that builds the disk.
The disk is made from your own copy of the CP/M 3 distribution.

## Build the disk

You need the CP/M 3 disk of the AltairZ80 (SIMH) distribution, `cpm3.dsk` in
`cpm3.zip` (1,113,536 bytes), or a folder with its files:

```
node tools/build-cpm3.js <cpm3.dsk | folder> <out> [--category=<name>]
```

The CP/M 3 tools run inside the machine itself, as `SYSGENNB.SUB` does on the real thing:
`M80`, `LINK` build the BIOS (`system/cpm3/bios3.mac`), `GENCPM` makes `CPM3.SYS`
(top page of memory `FF`, no banking), `M80` and `L80` build the loader (`CPMLDR` with
`system/cpm3/ldrbios3.mac`). The boot sector (`system/cpm3/boot3.asm`) and the loader
are the disk's system tracks, `SYSTEM.BIN`.

The result is a private catalog (`docs/private-shelf.md`): `<out>/cpm3/` holds the files,
`<out>/shelf.json` the entry (merged into the catalog already there). Serve `<out>`,
connect the SHELF tab's *Private shelf* to it and insert *CP/M 3* in A:. The page builds
the 400K disk (5¼" DSDD) when you insert it; press `^C`, or reset, and the loader starts.

To try it without a server: `CPM3_DSK=<cpm3.dsk> node --test test/cpm3.test.js` builds the
disk, boots it and runs `DIR`, `PIP`, `TYPE`, `DEVICE` and a warm start.

## What the BIOS does

- Console, printer and paper tape on the CP/M 3 character devices `CRT`, `LPT`, `PTR` and
  `PTP`, with the usual `DEVICE` assignments. The disk controller moves 128-byte records,
  so the BDOS does no sector blocking; the 5¼" formats and the hard disk need no more.
- The disk's format decides its parameter block, as in the CP/M 2.2 BIOS
  (`system/bios.asm`): 8" SSSD and three 5¼" formats on A: to D:, the 4 MB hard disk on I:.
- No clock: `DATE` shows the BDOS's default date and `TIME` does nothing. The BIOS has no
  bank switching (`SELMEMORY`, `XMOVE` do nothing), so a banked `CPM3.SYS` cannot run.

## Notes for changing it

- `GENCPM` rewrites every reference to the System Control Block, so the stock
  `SCB.MAC` (`scb$base` `0FE00h`) is used unchanged, whatever the real place of the SCB
  (`F59Ch` here, just under the BIOS).
- The loader reads `LDR.COM` from sector 2 on, up to 25 records; the boot sector knows 26
  records a track for the 8" format and 40 for the 5¼" ones.
- A shelf entry may carry `system`, a file with the bytes of the system tracks
  (`Shelf.buildDisk` writes them before the files).
