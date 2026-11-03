#!/usr/bin/env node
/*
 * build-cpm3.js: build the CP/M 3 boot disk of the shelf (disks/shelf/cpm3/).
 *
 *   node tools/build-cpm3.js [--check]
 *
 * This tool builds DigitalRerun's implementation of CP/M 3 (CP/M Plus) from
 * Digital Research's sources. DigitalRerun extends CP/M 3 by adding its own
 * BIOS that emulates the Z80 computer, terminal, printer, and disk controller.
 *
 * Source files in `system/cpm3/` are assembled with `js/asm8080.js`:
 *   - system/cpm3/bios3.asm → DigitalRerun's custom BIOS
 *   - system/cpm3/ldrbios3.asm → Loader's BIOS (runs CP/M 3)
 *   - system/cpm3/boot3.asm → Boot sector (reads the loader)
 *
 * The build runs inside a CP/M 2.2 machine (from disks/cpm22.dsk) with
 * Digital Research's CP/M 3 tools on a hard disk (I:). These tools are:
 *   - RMAC.COM, LINK.COM - 8080 assemblers and linker
 *   - GENCPM.COM - System generator (creates CPM3.SYS)
 *   - BDOS3.SPR - CP/M 3 BDOS (system call handler)
 *   - CPMLDR.REL, SCB.REL - Object files (loader and System Control Block)
 *
 * The build process runs these commands inside the emulated CP/M 2.2 machine:
 *   1. RMAC BIOS3, LINK BIOS3[OS]=BIOS3,SCB          → BIOS3.SPR (our BIOS)
 *   2. GENCPM                                        → CPM3.SYS (non-banked)
 *   3. RMAC LDRBIOS3, LINK CPMLDR=CPMLDR,SCB,LDRBIOS3 → CPMLDR.COM (the loader)
 *
 * Results written to `disks/shelf/cpm3/`:
 *   - CPM3.SYS - CP/M 3 operating system
 *   - SYSTEM.BIN - Boot sector + loader (system tracks)
 *   - GENCPM.DAT - Answers GENCPM was given during build
 *   - BIOS sources (as CP/M text) - For reference and modification
 *
 * tools/build.js lists the `disks/shelf/cpm3/` folder in `disks/shelf.json`
 * so that it's included in the public shelf. With --check, nothing is written
 * and the exit status indicates whether the folder is current.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { Machine } = require('../js/machine.js');
const { Disk } = require('../js/devices/fdc.js');
const { CpmFs, toCpmText, fromCpmText } = require('../js/cpmfs.js');
const { assemble } = require('../js/asm8080.js');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'system/cpm3');
const DIR = path.join(ROOT, 'disks/shelf/cpm3');
/** What the build runs or reads in the machine. */
const TOOLS = ['RMAC.COM', 'LINK.COM', 'GENCPM.COM', 'BDOS3.SPR', 'CPMLDR.REL', 'SCB.REL'];
/** Our sources, copied beside the tools so the disk can build itself. */
const SOURCES = ['bios3.asm', 'ldrbios3.asm', 'boot3.asm'];

/** A machine booted from CP/M 2.2 with `files` (name -> bytes) on a hard disk (I:). */
function labMachine(files) {
    const m = new Machine();
    m.out = '';
    m.console.output = b => { m.out += String.fromCharCode(b); };
    m.fdc.mount(0, Disk.fromImage(new Uint8Array(fs.readFileSync(path.join(ROOT, 'disks/cpm22.dsk')))));
    m.fdc.mount(1, new Disk('sssd8'));
    const hd = new Disk('hd4mb');
    const fsys = new CpmFs(hd);
    for (const [name, data] of files) fsys.write(name, data);
    m.fdc.mount(8, hd);
    if (!m.reset()) throw new Error('the machine does not boot CP/M 2.2');
    const settle = () => { for (let i = 0; i < 6000; i++) { m.run(200000); if (m.waiting || m.state !== 'running') return true; } return false; };
    m.run1 = (line, ok) => {
        m.out = '';
        m.console.paste(line + '\r');
        if (!settle()) throw new Error(`${line}: did not finish`);
        if (ok && !ok.test(m.out)) throw new Error(`${line} failed:\n${m.out}`);
        return m.out;
    };
    settle();
    m.fs = fsys;
    return m;
}

/** The tools and our two BIOS sources as CP/M holds them (text with CR LF and ^Z). */
function stage(dir) {
    const files = new Map();
    for (const name of TOOLS) {
        if (!fs.existsSync(path.join(dir, name))) throw new Error(`${name} is not in ${dir}`);
        files.set(name, new Uint8Array(fs.readFileSync(path.join(dir, name))));
    }
    for (const name of SOURCES.slice(0, 2)) files.set(name.toUpperCase(), toCpmText(fs.readFileSync(path.join(SRC, name))));
    return files;
}

/** CPM3.SYS, the system tracks image and GENCPM.DAT: built in the machine. */
function buildSystem(dir = DIR) {
    const m = labMachine(stage(dir));
    m.run1('I:', /I>/);
    m.run1('RMAC BIOS3', /END OF ASSEMBLY/);
    m.run1('LINK BIOS3[OS]=BIOS3,SCB', /CODE SIZE/);
    // GENCPM asks everything with an answer in (parens): a new GENCPM.DAT, then no banking
    m.run1('GENCPM', /Create a new GENCPM.DAT/);
    m.run1('Y', /Display Load Map/);
    for (let i = 0; i < 7; i++) m.run1('', /\?/);
    let out = m.run1('N');
    for (let i = 0; i < 30 && !/SYSTEM GENERATION DONE/.test(out); i++) out = m.run1('');
    if (!/SYSTEM GENERATION DONE/.test(out)) throw new Error(`GENCPM did not finish:\n${out}`);
    m.run1('RMAC LDRBIOS3', /END OF ASSEMBLY/);
    m.run1('LINK CPMLDR=CPMLDR,SCB,LDRBIOS3', /CODE SIZE/);
    for (const n of ['CPM3.SYS', 'CPMLDR.COM', 'GENCPM.DAT']) if (!m.fs.find(n)) throw new Error(`the build made no ${n}`);
    const sys = m.fs.read('CPM3.SYS'), ldr = m.fs.read('CPMLDR.COM');
    const nsects = Math.ceil(ldr.length / 128);
    if (nsects > 25) throw new Error(`the loader is ${nsects} records; the boot sector reads 25`);
    const boot = assemble(fs.readFileSync(path.join(SRC, 'boot3.asm'), 'utf8'), { defines: { nsects } }).image(0, 127);
    const system = new Uint8Array(128 + nsects * 128);
    system.set(boot, 0);
    system.set(ldr, 128);
    return { sys, system, dat: m.fs.read('GENCPM.DAT') };
}

/** The built files, by name, as the folder holds them (text as host text). */
function outputs(dir = DIR) {
    const { sys, system, dat } = buildSystem(dir);
    const o = new Map([['CPM3.SYS', sys], ['SYSTEM.BIN', system], ['GENCPM.DAT', fromCpmText(dat)]]);
    for (const n of SOURCES) o.set(n.toUpperCase(), new Uint8Array(fs.readFileSync(path.join(SRC, n))));
    return o;
}

if (require.main === module) {
    const check = process.argv.includes('--check');
    console.log(`cpm3: ${check ? 'checking' : 'building'} ${path.relative(ROOT, DIR)} (CPM3.SYS, SYSTEM.BIN, GENCPM.DAT, sources)`);
    try {
        let stale = 0;
        for (const [name, data] of outputs()) {
            const file = path.join(DIR, name);
            const same = fs.existsSync(file) && Buffer.compare(fs.readFileSync(file), Buffer.from(data)) === 0;
            if (!same) stale++;
            if (!check && !same) fs.writeFileSync(file, data);
            console.log(`${name.padEnd(12)} ${String(data.length).padStart(6)} bytes ${same ? 'unchanged' : check ? 'STALE' : 'written'}`);
        }
        if (check && stale) process.exit(1);
    } catch (e) {
        console.error(`cpm3: ${e.message}`);
        process.exit(1);
    }
}

module.exports = { buildSystem, outputs, TOOLS };
