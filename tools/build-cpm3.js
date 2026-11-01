#!/usr/bin/env node
/*
 * build-cpm3.js: build a CP/M 3 (CP/M Plus) boot disk for this machine.
 *
 *   node tools/build-cpm3.js <cpm3.dsk | folder> <out> [--category=<name>]
 *
 * <cpm3.dsk> is the CP/M 3 disk of the AltairZ80 (SIMH) distribution, or a
 * folder holding its files. Digital Research's files are not in this
 * repository, so the disk is made here from your copy: the CP/M 3 tools
 * run inside the machine itself (CP/M 2.2 from disks/cpm22.dsk, a hard
 * disk with the tools and system/cpm3/*), as SYSGENNB.SUB does on the real
 * thing:
 *
 *   M80 =SCB/M, M80 =BIOS3/M, LINK BIOS3[OS]=BIOS3,SCB   the BIOS (system/cpm3/bios3.mac)
 *   GENCPM AUTO DISPLAY                                   CPM3.SYS (non-banked)
 *   M80 =LDRBIOS3/M, M80 =CPMLDR/M, L80 CPMLDR,LDRBIOS3,LDR/N/E   the loader
 *
 * The boot sector (system/cpm3/boot3.asm) and LDR.COM become the disk's
 * system tracks, SYSTEM.BIN. <out>/cpm3/ gets the files and <out>/shelf.json
 * the entry: a private catalog (docs/private-shelf.md) builds the disk when
 * it is inserted, as for its other disks. Nothing is written to the repository.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { Machine } = require('../js/machine.js');
const { Disk } = require('../js/devices/fdc.js');
const { CpmFs, toCpmText, fromCpmText, isTextFile } = require('../js/cpmfs.js');
const { ALTAIR_SIZE, altairFiles } = require('../js/altair.js');
const { assemble } = require('../js/asm8080.js');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'system/cpm3');
const FORMAT = 'dsdd5';

/** What the build takes from the distribution to run the tools. */
const TOOLS = ['M80.COM', 'L80.COM', 'LINK.COM', 'GENCPM.COM', 'BDOS3.SPR', 'CPMLDR.MAC', 'SCB.MAC', 'GENCPMNB.DAT'];
/** What goes on the disk beside CPM3.SYS: CP/M 3's own commands. */
const DISK = ['CCP.COM', 'DIR.COM', 'PIP.COM', 'SHOW.COM', 'DATE.COM', 'TYPE.COM', 'SET.COM', 'SETDEF.COM', 'ERASE.COM',
    'RENAME.COM', 'ED.COM', 'HELP.COM', 'HELP.HLP', 'DEVICE.COM', 'SUBMIT.COM', 'GET.COM', 'PUT.COM', 'SAVE.COM',
    'DUMP.COM', 'DDT.COM', 'SID.COM', 'LIB.COM', 'RMAC.COM', 'LINK.COM', 'GENCOM.COM', 'INITDIR.COM', 'XREF.COM',
    'PATCH.COM', 'HEXCOM.CPM', 'LOAD.COM', 'ASM.COM'];

/** The files of the CP/M 3 disk: a Map of name -> bytes. */
function readSource(source) {
    const files = new Map();
    if (fs.statSync(source).isDirectory()) {
        for (const f of fs.readdirSync(source)) if (fs.statSync(path.join(source, f)).isFile()) files.set(f.toUpperCase(), new Uint8Array(fs.readFileSync(path.join(source, f))));
        return files;
    }
    const image = new Uint8Array(fs.readFileSync(source));
    if (image.length !== ALTAIR_SIZE) throw new Error(`${source} is no AltairZ80 disk image (${ALTAIR_SIZE} bytes)`);
    for (const f of altairFiles(image)) if (f.user === 0) files.set(f.name.toUpperCase(), f.data);
    return files;
}

/** A machine booted from CP/M 2.2 with `files` on a hard disk (I:). */
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

/** CP/M text (CR LF, ^Z) with `from` replaced by `to` on lines beginning with it. */
function patchText(bytes, re, to) {
    const text = String.fromCharCode(...bytes).replace(re, to);
    return Uint8Array.from(text, c => c.charCodeAt(0));
}

/** The system tracks image and CPM3.SYS: the BIOS and loader built inside the machine. */
function buildSystem(files) {
    for (const name of TOOLS) if (!files.has(name)) throw new Error(`${name} is not on the CP/M 3 disk`);
    const stage = new Map();
    for (const name of TOOLS) stage.set(name, files.get(name));
    stage.delete('GENCPMNB.DAT');
    // the top page of memory is FF here (the machine has no ROM), not the sample's FE
    stage.set('GENCPM.DAT', patchText(files.get('GENCPMNB.DAT'), /^MEMTOP   = FE/m, 'MEMTOP   = FF'));
    for (const name of ['bios3.mac', 'ldrbios3.mac']) stage.set(name.toUpperCase(), toCpmText(fs.readFileSync(path.join(SRC, name))));
    const m = labMachine(stage);
    m.run1('I:', /I>/);
    m.run1('M80 =SCB/M', /No Fatal error/);
    m.run1('M80 =BIOS3/M', /No Fatal error/);
    m.run1('LINK BIOS3[OS]=BIOS3,SCB', /CODE SIZE/);
    m.run1('GENCPM AUTO DISPLAY', /SYSTEM GENERATION DONE/);
    m.run1('M80 =LDRBIOS3/M', /No Fatal error/);
    m.run1('M80 =CPMLDR/M', /No Fatal error/);
    m.run1('L80 CPMLDR,LDRBIOS3,LDR/N/E');
    if (!m.fs.find('LDR.COM') || !m.fs.find('CPM3.SYS')) throw new Error('the build made no LDR.COM or CPM3.SYS');
    const sys = m.fs.read('CPM3.SYS'), ldr = m.fs.read('LDR.COM');
    const nsects = Math.ceil(ldr.length / 128);
    if (nsects > 25) throw new Error(`the loader is ${nsects} records; the boot sector reads 25`);
    const boot = assemble(fs.readFileSync(path.join(SRC, 'boot3.asm'), 'utf8'), { defines: { nsects } }).image(0, 127);
    const system = new Uint8Array(128 + nsects * 128);
    system.set(boot, 0);
    system.set(ldr, 128);
    return { sys, system };
}

/** Host text for a CP/M text file (so the page converts it again as it does for any shelf disk). */
const hostFile = (name, data) => (isTextFile(name, data) ? fromCpmText(data) : data);

function build(source, out, { category = 'System' } = {}) {
    const files = readSource(source);
    const { sys, system } = buildSystem(files);
    const dir = path.join(out, 'cpm3');
    fs.mkdirSync(dir, { recursive: true });
    const put = (name, data) => fs.writeFileSync(path.join(dir, name), data);
    put('SYSTEM.BIN', system);
    put('CPM3.SYS', sys);
    const list = [['CPM3.SYS', sys]];
    for (const name of DISK) {
        if (!files.has(name)) continue;
        list.push([name, hostFile(name, files.get(name))]);
    }
    for (const name of ['bios3.mac', 'ldrbios3.mac', 'boot3.asm']) list.push([name.toUpperCase(), fs.readFileSync(path.join(SRC, name))]);
    for (const [name, data] of list) if (name !== 'CPM3.SYS') put(name, data);
    // does it all fit? Build the disk as the page will
    const disk = new Disk(FORMAT);
    const fsys = new CpmFs(disk);
    fsys.writeSystem(system);
    for (const [name, data] of list) fsys.write(name, isTextFile(name, data) ? toCpmText(data) : data);
    const entry = {
        id: 'cpm3', name: 'CP/M 3', format: FORMAT, category,
        description: 'CP/M Plus, non-banked: about 53K for programs, drives A: to D: and I:. Boots from this disk in A:. The BIOS is DigitalRerun\'s (BIOS3.MAC, on the disk).',
        credit: 'CP/M 3 by Digital Research; the BIOS, loader and boot sector are DigitalRerun\'s, MIT.', licence: 'private',
        system: 'cpm3/SYSTEM.BIN', size: list.reduce((t, [, d]) => t + d.length, 0),
        files: list.map(([name]) => ({ name, path: `cpm3/${name}` }))
    };
    const catalog = path.join(out, 'shelf.json');
    const all = fs.existsSync(catalog) ? JSON.parse(fs.readFileSync(catalog, 'utf8')).filter(e => e.id !== 'cpm3') : [];
    all.push(entry);
    fs.writeFileSync(catalog, JSON.stringify(all, null, 1) + '\n');
    return { entry, free: fsys.freeBytes(), sys, system };
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const opt = k => (args.find(a => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || undefined;
    const [source, out] = args.filter(a => !a.startsWith('--'));
    if (!source || !out || args.includes('--help')) {
        console.error('usage: node tools/build-cpm3.js <cpm3.dsk | folder> <out> [--category=<name>]');
        process.exit(args.includes('--help') ? 0 : 2);
    }
    console.log(`cpm3: reading ${source}, writing ${out}/cpm3 and shelf.json`);
    try {
        const r = build(source, out, { category: opt('category') });
        console.log(`CPM3.SYS ${r.sys.length} bytes, system tracks ${r.system.length} bytes, ${r.entry.files.length} files on the disk, ${r.free >> 10}K free (${r.entry.format})`);
    } catch (e) {
        console.error(`cpm3: ${e.message}`);
        process.exit(1);
    }
}

module.exports = { build, buildSystem, readSource };
