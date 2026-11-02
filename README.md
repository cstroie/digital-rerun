<div align="center">

# DigitalRerun

### CP/M 2.2, running again: a whole 1980s computer in your browser

[![test](https://github.com/cstroie/digital-rerun/actions/workflows/test.yml/badge.svg)](https://github.com/cstroie/digital-rerun/actions/workflows/test.yml)
[![live demo](https://img.shields.io/badge/live-cstroie.github.io%2Fdigital-rerun-9dff8a?labelColor=0d0f0c)](https://cstroie.github.io/digital-rerun/)
[![licence: MIT](https://img.shields.io/badge/licence-MIT-ffcf5c?labelColor=0d0f0c)](LICENSE)
![no dependencies](https://img.shields.io/badge/dependencies-none-c9d6c4?labelColor=0d0f0c)
![offline PWA](https://img.shields.io/badge/PWA-works%20offline-c9d6c4?labelColor=0d0f0c)

**[▶ Boot it now](https://cstroie.github.io/digital-rerun/)**: no install, no sign-up, no download.

![DigitalRerun: the CP/M prompt, the drives and a page from the dot matrix printer](docs/screenshot.png)

</div>

DigitalRerun is a complete CP/M 2.2 machine that runs in a web page:
- a **Z80 with 64K** of RAM;
- **8" floppy drives** and a 4 MB hard disk;
- a **VT100**, **VT52** or **ADM-3A** console with a glowing phosphor screen;
- an **FX-80 dot matrix printer** that strikes its dots onto fanfold paper, tractor holes and all.

It is not a CP/M look-alike. The machine boots the **original CP/M 2.2 CCP and BDOS**, byte for byte as they shipped, read by a real BIOS from the system tracks of an 8" disk. Everything CP/M did then, it does here: `PIP`, `ED`, `ASM`, `DDT`, `SUBMIT`. You can even rebuild the BIOS inside CP/M with the 1980 recipe and boot the result.

It is a single web page with no dependencies, no build step and no server. It installs as an app, works offline, and keeps your disks and your place between visits.

## Why you'll like it

- **The real thing.** The original CP/M 2.2 system, assembled from source by the project's own assembler into exactly the binaries on the 1979 distribution disk. A test checks every byte.
- **A shelf of software.** Zork I, II and III, twelve more free text adventures, BBC BASIC with example programs, a public domain Forth-83 and two C compilers (BDS C and HI-TECH C), every one free to share and ready to insert into a drive. Your own disks (WordStar, MBASIC …) go on *My disks* and stay in your browser.
- **A printer you can watch.** PRTDEMO shows off pica, elite, condensed, bold, italic, underlined, enlarged, super- and subscript text and bit-image graphics. Save the pages as PNG or PDF.
- **Snapshots.** Freeze the whole machine (CPU, memory, screen and disks) and come back to that exact moment later, even mid-game. Leave the page and it resumes where you were.
- **Bring your own software.** Drop files onto the DRIVES panel to copy them to the selected drive, or LOAD a whole `.dsk` image into a drive. Make a disk from a folder on your device (FROM FOLDER), or point the SHELF tab at a private catalog on your own server: software you may not share stays on your machines. Disks use the standard 8" format of cpmtools and z80pack, plus the 5¼" ones below.
- **Hackable to the bone.** The BIOS, the boot loader and SYSGEN are short, commented 8080 sources on the boot disk. Change them with `ED`, assemble them with `ASM`, install them with `SYSGEN`.
- **It sounds right.** The bell, the clunk of an 8" drive loading its head, the clicks of the head stepping across tracks, and the rasp of the print head. All are synthesized, and a SETUP switch turns them off.
- **Screenshots.** SHOT saves the screen as a PNG, phosphor glow and scan lines included.
- **A debugger.** Registers and flags, a Z80 disassembly that follows the program, breakpoints, step and step over, and a memory view.
- **Phone friendly.** A key row adds what phone keyboards lack (CTRL, ESC, TAB, arrows, ^C), ADD FILES replaces drag and drop, the printed paper gets its own tab, and the 80 columns stay readable.
- **Paste a whole listing.** PASTE types at a careful typist's pace, waiting for the program to ask for each key, so nothing is lost, not even in programs that read the keyboard ahead.

<div align="center">

<img src="docs/zork.png" alt="Zork I running in DigitalRerun" width="640">
&nbsp;
<img src="docs/phone.png" alt="DigitalRerun on a phone" width="200">

</div>

## Try it

Open **https://cstroie.github.io/digital-rerun/**, click the screen and type:

```
A>DIR                        what is on the disk
A>STAT B:                    room on the empty disk in B:
A>PIP B:=A:*.COM             copy the programs to B:
A>PRTDEMO                    print a page (see PAPER)
A>D:                         to a shelf disk, Zork I here
D>VEZZA ZORK1.Z3             and you are standing west of a white house
```

A: holds the CP/M 2.2 tools (PIP, STAT, ED, ASM, LOAD, DDT, SUBMIT, XSUB, DUMP), SYSGEN, PRTDEMO, and the sources of the BIOS, the loader and SYSGEN. B: holds an empty disk. Games and tools are on the shelf (SHELF tab): put Zork I in D: and `D:` `PLAY` starts it.

`^C` warm-starts the system, `^S` pauses the output and `^P` echoes the console to the printer. In Zork, `SAVE` and `RESTORE` keep your progress on the disk.

## What's inside

### The machine

| | |
|---|---|
| CPU | Z80, at 2, 4 or 8 MHz or as fast as the browser goes. It costs nothing while CP/M waits for a key. It passes all of ZEXDOC and 66 of the 67 ZEXALL tests. The one left checks the undocumented X and Y flags of `BIT n,(HL)`, which a real Z80 takes from its hidden MEMPTR register; no CP/M program depends on them |
| Memory | 64K RAM. CCP at `E400h`, BDOS at `EC00h`, BIOS at `FA00h` |
| A: to D: | 8" single-sided, single-density: 77 tracks of 26 × 128-byte sectors, skew 6, 2 system tracks, 241K (boots). Also three 5¼" double-density data formats: SSDD 200K and DSDD 400K with 512-byte sectors, and SSDD 200K with 1K sectors. All are raw images, compatible with cpmtools (`ibm-3740`, `kpii`, `kpiv`, `osborne1`: the Kaypro II, Kaypro 4 and Osborne 1 formats) and z80pack |
| I: | 4 MB hard disk, z80pack geometry |
| Console | VT100 (subset), VT52 or ADM-3A, chosen in SETUP; exactly 80 × 24 at any window size, green, amber or white phosphor; WordStar, VT100 or ADM-3A arrow keys. Typing reaches the machine wherever the focus is on the page (except form fields) |
| Printer | FX-80 compatible, on `LST:` |
| Lights | POWER, RUN (bright while working, dim while waiting), one per drive, PRN |

At reset, the "boot ROM" loads sector 1 of track 0 into `0000h` and jumps there. That sector is [`system/boot.asm`](system/boot.asm), which reads CCP, BDOS and BIOS from the system tracks and starts the BIOS. Nothing about CP/M is built into the emulator: the system is whatever the boot disk holds. That includes CP/M 3, a bootable disk of the public shelf ([docs/cpm3.md](docs/cpm3.md)).

The I/O ports follow z80pack for the disk controller:

| Port | In | Out |
|---|---|---|
| 0 | console status: `0FFh` when a key waits | |
| 1 | console data | console data |
| 2 | printer status: `0FFh` when on line | |
| 3 | | printer data |
| 4 | paper tape reader: the next byte, `1Ah` when the tape has run out | |
| 5 | | paper tape punch |
| 10 | `0FFh` when the drive holds a disk | drive |
| 11, 12, 17 | | track; sector (low, high) |
| 15, 16 | | DMA address (low, high) |
| 13 | | command: 0 read, 1 write |
| 14 | status of the last command (0 = ok) | |
| 18 | the format of the disk in the selected drive (0 8", 1–3 the 5¼" ones, 4 hard disk) | |
| 20 | the next byte of the latched date and time record (`0FFh` before a latch) | latch the date and time and rewind the record ([docs/cpm3.md](docs/cpm3.md)) |

### The shelf

The SHELF tab is the disk collection. INSERT puts a fresh copy into a drive: floppies into the one you choose, hard disks into I:. Then press `^C` so CP/M sees it.

| Disk | What it is | Try |
|---|---|---|
| CP/M 2.2 | the system disk | `DIR` |
| Zork I, II, III | the Infocom trilogy (MIT licence) and the Vezza interpreter | `PLAY` (or `VEZZA ZORK2.Z3`) |
| Colossal Cave, Moonglow, Cat's Eye, The Fantasy Dimension, Submarine Sabotage | five freeware Z3 adventures, one disk each | `PLAY` |
| Curses, Aisle, 9:05, Photopia, Shade, Spider and Web, Suveh Nux | seven freeware Z5 games from the IF Archive, one disk each | `PLAY` |
| Forth-83 (F83) | Laxen and Perry's Forth-83 (public domain), on a 400K disk with the kernel, extension and utility sources | `F83`, then `2 3 + .` |
| BBC BASIC (Z80) | R.T. Russell's BASIC (zlib licence), with MANDEL, PRIMES, GUESS and BANNER | `BBCBASIC`, `LOAD "PRIMES"`, `RUN` |
| BDS C 1.60 | the first C compiler for CP/M (public domain) | `CC HELLO`, `CLINK HELLO`, `HELLO` |
| HI-TECH C 3.09 | an ANSI C compiler, on a 4 MB hard disk for I: (free for any use) | `C -V HELLO.C`, `HELLO` |

Every game disk has a `PLAY` command that types the `VEZZA game.Z3` line for you. (CP/M 2.2 has no `.CMD` programs; `PLAY.COM` puts the command in the CCP's buffer and lets it run, as if you had typed it.) Each shelf disk is built from its files when you insert it (`disks/shelf/`, listed in `disks/shelf.json` by `tools/build.js`), and the app keeps the files for offline use.

Only software that may be shared is on the shipped shelf. For your own, there are three ways, none of which puts it in the app:

- **My disks** (in the SHELF tab) holds your own disks, kept in this browser only, so software you own but may not share (WordStar, MBASIC, Turbo Pascal) never leaves your devices:
  - **KEEP A DISK** copies a drive's disk there;
  - **IMPORT .DSK** adds an image from your device;
  - **FROM FOLDER** makes a disk from a folder on your device. The files in the folder go to user 0 and subfolders named `1` to `15` to those user areas; names CP/M cannot hold are shortened, text files get CP/M line ends, and the smallest of the 8", 400K 5¼" and hard disk formats that holds it is used. (A desktop browser is needed: phones mostly lack the folder picker.)
- **Private shelf** (also in the SHELF tab) is a catalog on your own web server, for a collection too big for one browser or shared by several devices. Its disks are fetched when you insert them and are never kept by the app. Build the catalog from your files with `node tools/private-shelf.js`: Z-machine story files (Z1 to Z8 and the DOS `.DAT` files) become game disks with Vezza and `PLAY`, and every folder under `disks/` becomes a disk as FROM FOLDER makes it. See [docs/private-shelf.md](docs/private-shelf.md) for the catalog format, serving it over https and CORS, and the optional token.
- **Drives**: ADD FILES, LOAD and drag and drop work on any disk, as before.

### The panels

On a desktop the window is the machine, with no page to scroll:
- **Top right:** the front strip, above the side panels: the lights and the speed readout, then the clock, PASTE, PAPER, SHOT (a PNG of the screen), SNAP and RESET.
- **Left:** the screen, as large as the window allows at 80 × 24 and in its proportions.
- **Right:** tabs for DRIVES, SHELF, PRINTER, SETUP and DEBUG. Only the panel under them scrolls.

**The paper** is a drawer over the screen. While something prints it stays shut: the PRN led lights. PAPER opens the drawer, at the top of the paper (a clean sheet if nothing was printed yet), with FF, TEAR OFF, PNG, PRINT and ✕ to go back. The machine keeps running underneath.

On a phone the page scrolls instead, and the paper is the PAPER tab.

### The console

SETUP chooses the terminal: **VT100** (the default), **VT52** or **ADM-3A**. Install your programs for the same one; WordStar, Turbo Pascal and most CP/M software list both. You can switch at any time, and the screen is kept.

- **VT100:** cursor moves and addressing, erasing, bold, dim, underline, blink and reverse video, scroll regions, inserting and deleting lines and characters, and cursor and status reports.
- **VT52:** `ESC A B C D` moves (stopping at the edges), `ESC H` home, `ESC I` reverse line feed, `ESC J` / `ESC K` erase to the end of the screen or line, `ESC Y` row column addressing and `ESC Z` identify. The 80th column is overwritten, not wrapped. `ESC <` makes it a VT100, as on the real one; the graphics set and keypad modes are ignored.
- **ADM-3A:** `ESC =` cursor addressing, `^Z` clear, `^^` home, and `^H ^J ^K ^L` moves. The 80th character wraps at once, as on the real terminal. It also accepts the extensions that later ADM-compatible terminals added and many CP/M programs send:
  - `ESC T` / `ESC Y` erase to the end of the line or the screen;
  - `ESC *` clears the screen;
  - `ESC E` / `ESC R` insert or delete a line;
  - `ESC Q` / `ESC W` insert or delete a character;
  - `ESC )` / `ESC (` half intensity;
  - `ESC G n` and `ESC B n` / `ESC C n` attributes.

The arrow keys send WordStar's `^E ^X ^S ^D`, VT100's `ESC [ A …`, VT52's `ESC A …` or ADM-3A's `^K ^J ^H ^L`. Terminal arrow keys follow the terminal when you switch.

### The debugger

The DEBUG tab shows the registers and flags, a disassembly from the program counter (or any address you type), and memory as hex and ASCII.

- **Breakpoints:** click a line of code to set or clear one. The machine pauses when it gets there.
- **Controls:**
  - PAUSE stops the CPU anywhere, and CONTINUE lets it go on;
  - STEP runs one instruction;
  - OVER runs a CALL or RST through to the instruction after it.

The disassembler ([`js/disz80.js`](js/disz80.js)) knows every Z80 opcode, the undocumented ones included, in Zilog mnemonics. While the machine runs, the panel follows it four times a second.

### Drives and files

- **ADD FILES** (or dropping files on the DRIVES panel) copies them to the selected drive. Then press `^C`, so CP/M logs the disk in again.
- Click a file to download it. Text files (`.ASM`, `.TXT`, `.SUB` …) are converted between LF and CP/M's CR LF on the way in and out.
- Each drive has these buttons:
  - **LOAD** inserts a `.dsk` image of any of the formats. The two 200K formats share a size, so LOAD reads the directory to tell which it is;
  - **SAVE** downloads one;
  - An **AltairZ80** image (1,113,536 bytes: 254 tracks of 32 × 137-byte sectors) is no disk of this machine, so LOAD copies its files onto the disk in that drive, or onto a new blank disk (4 MB on I:, 400K on a floppy drive) if it is empty. Load it on I: when it holds more than a floppy does;
  - **NEW** asks for a label and a format, and inserts a blank disk (an 8" one is bootable);
  - **SYS** writes a system tracks image onto a disk.
- Disks are kept in the browser (IndexedDB), and they are still there tomorrow.
- **Paper tape.** LOAD TAPE puts a file from your device in the reader, and `PIP FILE.TXT=RDR:` reads it in. `PIP PUN:=FILE.TXT` punches a file, and SAVE TAPE downloads it, with PIP's leader nulls and closing `^Z` trimmed. Text gets CP/M's line ends on the way in and yours on the way out.

### Changing the system, the 1980 way

The BIOS ([`system/bios.asm`](system/bios.asm)) is 8080 code in the syntax of CP/M's own `ASM.COM`. Change it inside CP/M:

```
A>ED BIOS.ASM                 change it
A>SYSGEN                      source A, RETURN; destination RETURN (the image stays in memory)
A>SAVE 34 CPM64.COM
A>ASM BIOS
A>DDT CPM64.COM
-IBIOS.HEX
-R2580                        the BIOS runs at FA00h; in the image it sits at 1F80h
-G0
A>SYSGEN                      source RETURN (use memory), destination A
```

Then press RESET and your BIOS boots. In the SYSGEN image the loader sits at `0900h`, the CCP at `0980h`, the BDOS at `1180h` and the BIOS at `1F80h`, so the same recipe also swaps in another CCP or BDOS (ZCPR, ZSDOS …).

On the host, `node tools/build.js` assembles everything with [`js/asm8080.js`](js/asm8080.js), a two-pass 8080 assembler that reads both the ASM.COM and the Macro Assembler AS dialects. It writes `system/cpm22.bin` (the system tracks), and `disks/cpm22.dsk`, then the shelf list.

### The printer

The FX-80 strikes dots from its own 9-pin font onto 9½" fanfold sheets. From the PRINTER panel you can download the sheets as PNG or print them (or save as PDF), and TEAR OFF starts a fresh sheet. It understands:

- CR, LF, FF, BS, HT;
- SO/DC4 (enlarged for one line), SI/DC2 (condensed);
- `ESC E/F` emphasized, `ESC G/H` double-strike, `ESC 4/5` italic, `ESC -` underline;
- `ESC W` enlarged, `ESC S/T` super- and subscript, `ESC M/P` elite and pica, `ESC !` master select;
- `ESC 0 1 2 3 A J` line spacing;
- `ESC C N O` form length and skipping the perforation;
- `ESC D` tabs, `ESC l Q` margins;
- `ESC K L Y Z *` bit images;
- `ESC @` reset;
- codes `80h`–`FFh`, which print in italics.

Other sequences are skipped together with their parameters.

### Snapshots

A snapshot is the whole machine at one moment: CPU, memory, screen, printer head, and a copy of every disk, so memory and disks always agree.

- **SNAP** (next to RESET) or **SAVE SNAPSHOT** (in SETUP) keeps one, up to twelve. Each shows its time and the last line on the screen.
- **RESTORE** goes back to that moment, even in the middle of a program or a game.
- With *Save when I leave, and resume there* on (the default), an automatic snapshot is also kept. It is saved when the page is hidden or closed, when the window loses focus, and once a minute while the machine works. The next visit continues where you left off.

The printed paper is not part of a snapshot.

### As an app

DigitalRerun is a progressive web app:

- **Install.** Where the browser can install apps, a banner offers INSTALL. On an iPhone or iPad it explains *Share, then Add to Home Screen*.
- **Offline.** After the first visit everything is kept, the disks included, and the app starts with no network.
- **Updates.** A new version downloads in the background. A banner names it and offers RELOAD; your disks are saved first. SETUP shows the running version and has CHECK FOR UPDATES.

## For developers

```
git clone https://github.com/cstroie/digital-rerun.git
cd DigitalRerun
python3 -m http.server 8000         # any static server; then open http://localhost:8000
node --test                         # 87 tests: assembler, file system, Altair images, terminal, printer, CP/M, shelf disks, folder and private shelf, snapshots, PWA
ZEX=1 node --test test/zex.test.js  # ZEXDOC on the Z80 core (a few minutes; ZEX=all adds ZEXALL, CI runs both)
```

The machine tests boot the real disk and type at the CCP. They cover:
- `DIR`, `STAT`, `PIP`, `ASM`, printing and `SYSGEN`;
- the whole change-the-BIOS recipe above;
- every shelf disk: Zork, the Z3 games and `PLAY`, F83, the C compilers, BBC BASIC;
- the private shelf: a catalog built by the tool and served with a token, and a disk of it played;
- disks made from a folder;
- restoring snapshots.

Releasing a change: raise `VERSION` in [`js/version.js`](js/version.js) and run `node tools/stamp.js`. The build stamp is a hash of every file the app keeps offline, and a test fails when it is stale.

```
index.html, css/, js/app.js       the page
js/z80.js                         the Z80 core (vendored)
js/machine.js                     RAM, ports, run loop, boot ROM, machine state
js/devices/fdc.js, serial.js, clock.js   disk controller, console and printer ports, the date and time port (docs/cpm3.md)
js/terminal.js                    VT100, VT52 and ADM-3A terminal and its view
js/fx80.js, js/font9.js           printer, paper view, dot matrix font
js/cpmfs.js                       CP/M file system on a disk image, from outside the machine
js/altair.js                      the files of an AltairZ80 disk image (LOAD copies them onto a disk)
js/shelf.js                       the shelf: a disk made from an entry, private catalog addresses
js/folderdisk.js                  a disk made from a folder (FROM FOLDER, and the catalog tool)
js/asm8080.js                     8080 assembler
js/disz80.js                      Z80 disassembler (the debugger's)
js/storage.js                     disks, settings and snapshots in IndexedDB
js/snapshot.js                    take and restore a snapshot
js/sound.js                       bell, drive and printer sounds (Web Audio, synthesized)
js/version.js, js/pwa.js, sw.js   version and build stamp; install, updates, offline
system/                           loader, BIOS, SYSGEN, PRTDEMO, PLAY; cpm22/: the original CCP and BDOS sources; cpm3/: the CP/M 3 BIOS, loader and boot sector (dri/: Digital Research's CP/M 3 sources)
disks/cpm22/                     the files of the boot disk, and its image
disks/shelf/, disks/shelf.json    the other shelf disks, as files, and their list
tools/build.js                    assemble the system, make the disks
tools/build-cpm3.js               build the CP/M 3 shelf disk's CPM3.SYS and system tracks (docs/cpm3.md)
tools/play.js                     PLAY.COM for a disk (system/play.asm with its command)
tools/private-shelf.js            build a private catalog from story files and folders
tools/private-serve.js            serve a private catalog for a trial (CORS, token)
tools/stamp.js                    write the build stamp
tools/font9.txt, font9.js         the printer font as dot pictures, and its generator
docs/private-shelf.md             the private shelf: catalog, serving, connecting
```

## Credits

DigitalRerun stands on the work of many people, with thanks to all of them.

**CP/M**
- **Gary Kildall** created CP/M at **Digital Research, Inc.** in Pacific Grove, California. This project is named in its honour: Digital Research's system, running again.
- **DRDOS, Inc.** and its president **Bryan Sparks** granted everyone the right to use, distribute and modify CP/M and its derivatives (2022, at **Scott Chapman**'s request). See [LICENSE-DRI](LICENSE-DRI).
- **Eric Smith** reformatted the CCP and BDOS sources for cross-assembly ([brouhaha/cpm22](https://github.com/brouhaha/cpm22)); they are in `system/cpm22/`.
- **Gaby Chaudry**'s [Unofficial CP/M Web Site](http://www.cpm.z80.de/) keeps CP/M's history, its sources and the licence. It is where the CP/M 2.2 distribution files on A: come from.

**Emulation**
- **Molly Howell** and contributors wrote [Z80.js](https://github.com/DrGoldfire/Z80.js), the Z80 core (MIT).
- **Frank Cringle** wrote the ZEXDOC/ZEXALL instruction exercisers (GPL). **Tony Nicholson** keeps them at [agn453/ZEXALL](https://github.com/agn453/ZEXALL). They are downloaded by the test and not shipped.
- **Udo Munk**'s [z80pack](https://github.com/udo-munk/z80pack) set the I/O port layout and the disk formats. **Michael Haardt**'s [cpmtools](http://www.moria.de/~michael/cpmtools/) `diskdefs` give the geometry of every format here.
- The 5¼" formats are those of the Kaypro II, the Kaypro 4 and the Osborne 1, read as cpmtools reads their images.
- The 8" format is the IBM 3740 single-sided, single-density layout.
- The printer follows the published command set of the **Epson FX-80**. Its 9-pin font was drawn for this project, not copied from Epson's character ROM.

**Zork I**
- *Zork I: The Great Underground Empire* is by **Marc Blank** and **Dave Lebling** at **Infocom, Inc.**, from the original MIT *Zork* by **Tim Anderson, Marc Blank, Bruce Daniels and Dave Lebling**.
- In 2025 **Microsoft**'s Open Source Programs Office, **Team Xbox** and **Activision**, working with **Jason Scott** of the Internet Archive, released it under the MIT licence ([historicalsource/zork1](https://github.com/historicalsource/zork1)). `disks/shelf/zork1/ZORK1.Z3` is that repository's compiled story file.
- **Shawn Sijnstra** wrote [Vezza](https://gitlab.com/sijnstra1/vezza), the Z-machine interpreter for CP/M that plays it (GPL-2.0-or-later). `disks/shelf/zork1/VEZZA.COM` is its `vezza-C2` build, unchanged.

**The shelf**
- **Dave Bernazzani** (Moonglow, Cat's Eye), **Johan Berntsson** (The Fantasy Dimension) and **Garry Francis** (Submarine Sabotage) wrote the Z3 games on their own disks. **Will Crowther** and **Don Woods** wrote Colossal Cave Adventure; **Tara McGrew** ported it to ZIL (Graham Nelson and Dave Baggett's earlier work, with elements of the Fortran original restored). They are freeware in the [IF Database](https://ifdb.org) and come unchanged from the [IF Archive](https://ifarchive.org/if-archive/games/zcode/); their authors keep their rights, so they may be shared, not sold.
- **Graham Nelson** (Curses), **Sam Barlow** (Aisle), **Adam Cadre** (9:05, Photopia), **Andrew Plotkin** (Shade, Spider and Web) and **David Fisher** (Suveh Nux) wrote the Z5 games on their own disks. They are freeware in the [IF Database](https://ifdb.org) and come unchanged from the [IF Archive](https://ifarchive.org/if-archive/games/zcode/); their authors keep their rights, so they may be shared, not sold. The story file of Spider and Web is the archive's `Tangle.z5`.
- **Henry Laxen** and **Michael Perry** wrote F83 and placed it in the public domain; the copy is the [Forth Interest Group](http://www.forth.org/eforth.html)'s F83V2-80 archive, as mirrored at [janaite/forth83-80](https://github.com/janaite/forth83-80).
- **R.T. Russell** wrote [BBC BASIC (Z80)](https://github.com/rtrussell/BBCZ80) and shares it under the zlib licence. The example programs were written for DigitalRerun.
- **Leor Zolman** (BD Software) wrote [BDS C](https://www.bdsoft.com/resources/bdsc.html) and placed it in the public domain in 2002.
- **HI-TECH Software** made its Z80 C compiler free for any use; **Tony Nicholson** keeps it updated at [agn453/HI-TECH-Z80-C](https://github.com/agn453/HI-TECH-Z80-C).

**Fonts**
- [VT323](https://fonts.google.com/specimen/VT323) by **Peter Hull**, and [IBM Plex Sans Condensed](https://github.com/IBM/plex) by **Mike Abbink** and **Bold Monday**, both under the SIL Open Font License.

## Licence

DigitalRerun's own code is under the [MIT licence](LICENSE). The parts that come from elsewhere keep their own licences, listed in [LICENSE](LICENSE):
- CP/M under the DRDOS, Inc. grant ([LICENSE-DRI](LICENSE-DRI));
- Z80.js under MIT;
- Zork I under MIT;
- Vezza under GPL-2.0-or-later (its licence is in `disks/shelf/zork1/`);
- F83 in the public domain, and twelve Z-machine games as freeware (`disks/shelf/forth83/`, `advent/`, `catseye/`, `fantasy/`, `moonglow/`, `subsab/`, `curses/`, `aisle/`, `905/`, `photopia/`, `shade/`, `spiderweb/`, `suvehnux/` under `disks/shelf/`).

**Trademarks.** CP/M was created by Gary Kildall at Digital Research, Inc.; the rights now belong to DRDOS, Inc. Epson and FX-80 are trademarks of Seiko Epson Corporation. Z80 is a trademark of Zilog, Inc. IBM and IBM Plex are trademarks of International Business Machines Corporation. Kaypro and Osborne are the names of their makers. VT100 and VT52 were terminals by Digital Equipment Corporation, and ADM-3A one by Lear Siegler, Inc. ZORK is a trademark of its owner. Names are used only to say what DigitalRerun emulates or contains. DigitalRerun is not affiliated with, or endorsed by, any of these companies.
