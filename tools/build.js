#!/usr/bin/env node
/*
 * build.js: assemble the system and write the boot disk.
 *
 *   node tools/build.js
 *
 * This tool builds DigitalRerun's CP/M 2.2 system from source code:
 *
 * Source files in `system/` are assembled with `js/asm8080.js`:
 *   - system/boot.asm → system/boot.bin (track 0, sector 1)
 *   - system/cpm22/ccp.asm → CCP at E400h
 *   - system/cpm22/bdos.asm → BDOS at EC00h
 *   - system/bios.asm → BIOS at FA00h
 *   - system/sysgen.asm and prtdemo.asm → SYSGEN.COM and PRTDEMO.COM
 *   - system/term.asm → TERM.COM (with TERM.DIR) on the boot disk; with system/irc.asm → IRC.COM (and IRC.DIR)
 *     it is also written to the shelf disk disks/shelf/online (the boot disk has no room for IRC)
 *
 * The system tracks (two 8" tracks, 256 sectors total) are written to:
 *   system/cpm22.bin (for the boot ROM) and disks/cpm22.dsk (the boot disk)
 *
 * The boot disk (`disks/cpm22.dsk`) contains:
 *   - The system tracks with the CCP, BDOS, and BIOS
 *   - All files from `disks/cpm22/`
 *   - System source files (converted to CP/M text format)
 *   - SYSGEN.COM and PRTDEMO.COM utilities
 *
 * A shelf disk whose disk.json has "play": "CMD" gets a PLAY.COM that runs
 * CMD (from system/play.asm). This enables the `PLAY` command for game disks.
 *
 * This tool is only needed after changing source code. The running app
 * loads the built results directly from memory.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { assemble, formatListing } = require('../js/asm8080.js');
const { Disk } = require('../js/devices/fdc.js');
const { CpmFs, toCpmText } = require('../js/cpmfs.js');
const { PHONEBOOK, IRCBOOK } = require('../js/devices/directory.js');
const { playCom } = require('./play.js');

const ROOT = path.join(__dirname, '..');
const MSIZE = 64;
const CCP = (MSIZE - 7) * 1024;      // 0E400h
const BDOS = CCP + 0x800;            // 0EC00h
const BIOS = CCP + 0x1600;           // 0FA00h
const SYSTEM_BYTES = 2 * 26 * 128;   // two 8" tracks

function build(file, origin, length) {
    const src = fs.readFileSync(path.join(ROOT, 'system', file), 'latin1');
    const r = assemble(src, origin === null ? {} : { defines: { origin } });
    fs.writeFileSync(path.join(ROOT, 'system', file.replace(/\.asm$/, '.lst').replace(/^cpm22\//, '')), formatListing(r) + '\n');
    const lo = origin === null ? 0 : origin;
    const hi = length ? lo + length - 1 : r.high;
    return { result: r, image: r.image(lo, hi) };
}

function main() {
    const boot = build('boot.asm', null, 128);
    const ccp = build('cpm22/ccp.asm', CCP, 0x800);
    const bdos = build('cpm22/bdos.asm', BDOS, 0xE00);
    const bios = build('bios.asm', null);
    const biosEnd = bios.result.symbols.get('BIOSEND');
    const biosLoaded = biosEnd - BIOS;
    const room = SYSTEM_BYTES - 128 - 0x800 - 0xE00;
    if (biosLoaded > room) throw new Error(`the BIOS code is ${biosLoaded} bytes; the system tracks hold ${room}`);
    if (bios.result.high > 0xFFFF) throw new Error('the BIOS runs past 0FFFFh');

    const system = new Uint8Array(SYSTEM_BYTES);
    system.set(boot.image, 0);
    system.set(ccp.image, 128);
    system.set(bdos.image, 128 + 0x800);
    system.set(bios.result.image(BIOS, BIOS + room - 1), 128 + 0x1600);
    const com = file => { const r = build(file, null).result; return r.image(0x100, r.high); };
    const sysgenCom = com('sysgen.asm');
    const prtdemoCom = com('prtdemo.asm');
    const termCom = com('term.asm');
    const ircCom = com('irc.asm');
    fs.writeFileSync(path.join(ROOT, 'system/boot.bin'), boot.image);
    fs.writeFileSync(path.join(ROOT, 'system/cpm22.bin'), system);

    const disk = new Disk('sssd8');
    const fsys = new CpmFs(disk);
    fsys.writeSystem(system);
    const dir = path.join(ROOT, 'disks/cpm22');
    const files = fs.readdirSync(dir).filter(f => /^[A-Z0-9$_-]{1,8}(\.[A-Z0-9$_-]{0,3})?$/.test(f)).sort();
    for (const f of files) fsys.write(f, fs.readFileSync(path.join(dir, f)));
    fsys.write('SYSGEN.COM', sysgenCom);
    fsys.write('PRTDEMO.COM', prtdemoCom);
    fsys.write('TERM.COM', termCom);
    // TERM.DIR: what TERM's D key offers, the board first, then the telnet hosts (one line each, edit it with any CP/M editor)
    const termDir = ['0100 Digital Rerun BBS', ...PHONEBOOK.map(e => `${e.n} ${e.host}${e.port === 23 ? '' : ':' + e.port}`)].join('\n') + '\n';
    fsys.write('TERM.DIR', toCpmText(Buffer.from(termDir)));
    for (const f of ['bios.asm', 'boot.asm', 'sysgen.asm', 'prtdemo.asm']) fsys.write(f.toUpperCase(), toCpmText(fs.readFileSync(path.join(ROOT, 'system', f))));
    fs.writeFileSync(path.join(ROOT, 'disks/cpm22.dsk'), disk.data);

    // the shelf disk of the modem programs: TERM and IRC, with their directories (the boot disk has no room for IRC)
    const onlineDir = path.join(ROOT, 'disks/shelf/online');
    const ircDir = IRCBOOK.map(e => `${e.host}:${e.port} ${e.text}`).join('\n') + '\n';   // IRC.DIR: what /connect offers, host[:port] and a name per line
    fs.writeFileSync(path.join(onlineDir, 'TERM.COM'), termCom);
    fs.writeFileSync(path.join(onlineDir, 'IRC.COM'), ircCom);
    fs.writeFileSync(path.join(onlineDir, 'TERM.DIR'), termDir);        // text: the page makes it CP/M text (disk.json lists it)
    fs.writeFileSync(path.join(onlineDir, 'IRC.DIR'), ircDir);

    buildShelf();

    const hex = v => v.toString(16).toUpperCase().padStart(4, '0') + 'h';
    console.log(`CCP ${hex(CCP)}, BDOS ${hex(BDOS)}, BIOS ${hex(BIOS)}-${hex(bios.result.high)} (${biosLoaded} of ${room} bytes on disk)`);
    console.log(`disks/cpm22.dsk: ${fsys.list().length} files, ${fsys.freeBytes() >> 10}K free`);
}

/* ---------- the shelf (disk collection) ---------- */

const SHIPPED = [
    { id: 'cpm22', name: 'CP/M 2.2', format: 'sssd8', image: 'disks/cpm22.dsk', category: 'System',
      description: 'The system disk: the CP/M 2.2 tools, SYSGEN, PRTDEMO and the sources of this machine\'s BIOS.',
      credit: 'Digital Research; free under the DRDOS, Inc. licence.', licence: 'DRDOS, Inc. grant' }
];

/** Type each NAME.BAS into BBC BASIC on the emulated machine and SAVE it as NAME.BBC. */
function tokenizeBbc(dir) {
    const { Machine } = require('../js/machine.js');
    const bas = fs.readdirSync(dir).filter(f => /\.BAS$/.test(f)).sort();
    if (!bas.length) return;
    const m = new Machine();
    let out = '';
    m.console.output = b => { out += String.fromCharCode(b); };
    m.fdc.mount(0, Disk.fromImage(new Uint8Array(fs.readFileSync(path.join(ROOT, 'disks/cpm22.dsk')))));
    const work = new Disk('sssd8');
    const wfs = new CpmFs(work);
    wfs.write('BBCBASIC.COM', fs.readFileSync(path.join(dir, 'BBCBASIC.COM')));
    m.fdc.mount(1, work);
    m.reset();
    const settle = () => { for (let i = 0; i < 20000; i++) { m.run(200000); if (m.idle) return; } };
    const type = text => { m.console.paste(text); settle(); };
    settle();
    type('B:\rBBCBASIC\r');
    for (const f of bas) {
        const listing = fs.readFileSync(path.join(dir, f), 'latin1').replace(/\r?\n/g, '\r');
        type('NEW\r' + listing + `SAVE "${f.replace(/\.BAS$/, '')}"\r`);
    }
    type('*BYE\r');
    if (/Mistake|Syntax error|Bad /.test(out)) throw new Error('BBC BASIC did not take an example:\n' + out);
    for (const f of bas) {
        const name = f.replace(/\.BAS$/, '.BBC');
        fs.writeFileSync(path.join(dir, name), new CpmFs(work).read(name).subarray(0, new CpmFs(work).find(name).size));
    }
}

/** PLAY.COM for a disk: types `command` at the CCP (system/play.asm). */
function writePlay(dir, command) {
    fs.writeFileSync(path.join(dir, 'PLAY.COM'), playCom(command));
}

function buildShelf() {
    const { isText } = require('../js/shelf.js');
    const shelfDir = path.join(ROOT, 'disks/shelf');
    const entries = SHIPPED.map(e => ({ ...e, size: fs.statSync(path.join(ROOT, e.image)).size }));
    for (const id of fs.readdirSync(shelfDir).sort()) {
        const dir = path.join(shelfDir, id);
        const meta = JSON.parse(fs.readFileSync(path.join(dir, 'disk.json'), 'utf8'));
        if (meta.bbcbasic) tokenizeBbc(dir);
        if (meta.play) writePlay(dir, meta.play);
        // a bootable disk keeps the bytes of its system tracks in a file beside its files (not on the disk)
        const names = fs.readdirSync(dir).filter(f => f !== 'disk.json' && f !== meta.system).sort();
        const entry = { id, ...meta, files: names.map(n => ({ name: n, path: `disks/shelf/${id}/${n}` })) };
        if (meta.system) entry.system = `disks/shelf/${id}/${meta.system}`;
        delete entry.bbcbasic;
        delete entry.play;
        // It must fit: build it as the page will.
        const disk = new Disk(entry.format);
        const fsys = new CpmFs(disk);
        if (meta.system) fsys.writeSystem(new Uint8Array(fs.readFileSync(path.join(dir, meta.system))));
        for (const n of names) {
            const data = fs.readFileSync(path.join(dir, n));
            fsys.write(n, isText(entry, n, data) ? toCpmText(data) : data);
        }
        entry.size = names.reduce((t, n) => t + fs.statSync(path.join(dir, n)).size, 0);
        entry.free = fsys.freeBytes();
        entries.push(entry);
        console.log(`shelf: ${entry.name}: ${names.length} files, ${entry.free >> 10}K free`);
    }
    fs.writeFileSync(path.join(ROOT, 'disks/shelf.json'), JSON.stringify(entries, null, 1) + '\n');
}

main();
