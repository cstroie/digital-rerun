'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Machine } = require('../js/machine.js');
const { Disk } = require('../js/devices/fdc.js');
const { CpmFs } = require('../js/cpmfs.js');
const { buildDisk } = require('../js/shelf.js');

const ROOT = path.join(__dirname, '..');
const shelf = JSON.parse(fs.readFileSync(path.join(ROOT, 'disks/shelf.json'), 'utf8'));
const read = async p => new Uint8Array(fs.readFileSync(path.join(ROOT, p)));
const entry = id => shelf.find(e => e.id === id);

/** A machine booted from the system disk with a shelf disk in `drive`. */
async function withDisk(id, drive, loose = false) {
    const m = new Machine();
    m.out = '';
    m.console.output = b => { m.out += String.fromCharCode(b); };
    m.fdc.mount(0, Disk.fromImage(await read('disks/cpm22.dsk')));
    m.fdc.mount(drive, await buildDisk(entry(id), read));
    m.reset();
    m.settle = () => { for (let i = 0; i < 40000; i++) { m.run(200000); if (loose ? m.idle : m.waiting) return; } };
    m.cmd = text => { m.out = ''; m.console.paste(text + '\r'); m.settle(); return m.out; };
    m.settle();
    return m;
}

test('every shelf entry is listed with what the page needs, and its files exist', () => {
    for (const e of shelf) {
        assert.ok(e.id && e.name && e.description && e.credit && e.licence && e.category, e.id);
        assert.ok(['sssd8', 'dsdd5', 'hd4mb'].includes(e.format), e.id);
        if (e.image) assert.ok(fs.existsSync(path.join(ROOT, e.image)), e.image);
        else for (const f of e.files) assert.ok(fs.existsSync(path.join(ROOT, f.path)), f.path);
    }
    assert.deepEqual(shelf.map(e => e.id).sort(), ['905', 'advent', 'aisle', 'bbcbasic', 'bdsc', 'catseye', 'coldstor', 'cpm22', 'cpm3', 'curses', 'fantasy', 'forth83', 'hitech', 'moonglow', 'online', 'photopia', 'shade', 'sigseek', 'spiderweb', 'subsab', 'suvehnux', 'z80ulm', 'zork1', 'zork2', 'zork3']);
});

test('each shelf disk builds as the page builds it, every file on it', async () => {
    for (const e of shelf.filter(x => x.files)) {
        const fsys = new CpmFs(await buildDisk(e, read));
        assert.deepEqual(fsys.list().map(f => f.name).sort(), e.files.map(f => f.name).sort(), e.id);
    }
});

test('BBC BASIC: the tokenized example runs', async () => {
    const m = await withDisk('bbcbasic', 1, true);           // it waits for keys between other work
    m.cmd('B:');
    assert.match(m.cmd('BBCBASIC'), /BBC BASIC \(Z80\)/);
    m.cmd('LOAD "MANDEL"');
    assert.match(m.cmd('LIST'), /Mandelbrot/);                   // (running it takes minutes, as it did)
    assert.match(m.cmd('LOAD "PRIMES"') + m.cmd('RUN'), /168 primes/);
});

test('BDS C compiles, links and runs HELLO.C', async () => {
    const m = await withDisk('bdsc', 1);
    m.cmd('B:');
    m.cmd('CC HELLO');
    m.cmd('CLINK HELLO');
    assert.match(m.cmd('HELLO'), /Hello from BDS C[\s\S]*5 squared is 25/);
});

test('HI-TECH C compiles and runs HELLO.C from the I: hard disk', async () => {
    const m = await withDisk('hitech', 8);
    m.cmd('I:');
    m.cmd('C HELLO.C');
    assert.match(m.cmd('HELLO'), /Hello from HI-TECH C[\s\S]*5 squared is 25/);
});

test('Zork II starts from its shelf disk', async () => {
    const m = await withDisk('zork2', 2);
    m.cmd('C:');
    assert.match(m.cmd('VEZZA ZORK2.Z3'), /ZORK II/i);
});

test('F83 runs Forth, and its source blocks are on the disk byte for byte', async () => {
    const m = await withDisk('forth83', 1, true);
    const fsys = new CpmFs(await buildDisk(entry('forth83'), read));
    for (const n of ['KERNEL80.BLK', 'UTILITY.BLK', 'EXTEND80.BLK', 'F83.COM']) {
        const want = fs.readFileSync(path.join(ROOT, 'disks/shelf/forth83', n));
        assert.deepEqual(Buffer.from(fsys.read(n)).subarray(0, want.length), want, n);
    }
    m.cmd('B:');
    assert.match(m.cmd('F83'), /FORTH/i);
    assert.match(m.cmd('2 3 + .'), /5/);
    assert.match(m.cmd('BYE'), /B>/);
});

test('PLAY starts the game of each Z3 disk, as typing the command would', async () => {
    const games = [['advent', /Colossal Cave|Adventure/i], ['catseye', /Cat'?s Eye|Catseye/i], ['fantasy', /small airlock/i],
        ['moonglow', /Moonglow/i], ['subsab', /Submarine Sabotage/i], ['zork2', /ZORK II/i], ['zork3', /ZORK III/i]];
    for (const [id, title] of games) {
        const m = await withDisk(id, 2);
        m.cmd('C:');
        const out = m.cmd('PLAY');
        assert.match(out, /Vezza - Release/, id);
        assert.match(out, title, id);
    }
});

test('PLAY on the Zork I disk', async () => {
    const m = new Machine();
    m.out = '';
    m.console.output = b => { m.out += String.fromCharCode(b); };
    m.fdc.mount(0, Disk.fromImage(await read('disks/cpm22.dsk')));
    m.fdc.mount(3, await buildDisk(entry('zork1'), read));
    m.reset();
    const settle = () => { for (let i = 0; i < 40000; i++) { m.run(200000); if (m.waiting) return; } };
    settle();
    const cmd = text => { m.out = ''; m.console.paste(text + '\r'); settle(); return m.out; };
    cmd('D:');
    assert.match(cmd('PLAY'), /ZORK I/i);
});

test('Signal Seeker: PLAY starts a shift, Q saves it, the next run is shift 02', async () => {
    const m = await withDisk('sigseek', 1, true);
    m.cmd('B:');
    // The game never goes idle, so settle() would run to its limit: run until what is wanted is out
    const until = (re, what) => {
        for (let i = 0; i < 4000 && !re.test(m.out); i++) m.run(200000);
        assert.match(m.out, re, what);
    };
    const send = (keys, re, what) => { m.out = ''; m.console.paste(keys); until(re, what); };
    send('SIGSEEK /100\r', /S I G N A L   S E E K E R[\s\S]*Shift 1/, 'the title, until a key');
    m.out = ''; m.console.type(' ');
    until(/\x1b\[1;58H\x1b\[0;7m01/, 'the frame, shift 01');
    m.out = ''; m.console.type('Q');
    until(/Kettle-7 signing off[\s\S]*B>/, 'Q ends the shift');
    assert.match(m.cmd('DIR'), /SIGSEEK\s+SAV/);
    send('PLAY\r', /Shift 2/, 'the title says shift 2');
    m.out = ''; m.console.type(' ');
    until(/\x1b\[1;58H\x1b\[0;7m02[\s\S]*Another shift/, 'shift 02, a returning operator');
});

test('Z80-μLM: CHAT answers a line, and PLAY starts GUESS', async () => {
    const m = await withDisk('z80ulm', 1);
    m.cmd('B:');
    m.cmd('CHAT');
    assert.match(m.cmd('hello'), /\r\nHI\r\n/);
    const g = await withDisk('z80ulm', 1);
    g.cmd('B:');
    assert.match(g.cmd('PLAY'), /> $/);
    assert.match(g.cmd('does it have a trunk'), /\r\n(YES|NO|MAYBE)\r\n/);
});
