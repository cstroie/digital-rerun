'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Machine } = require('../js/machine.js');
const { Disk } = require('../js/devices/fdc.js');
const { CpmFs, toCpmText, fromCpmText } = require('../js/cpmfs.js');
const { shelfDisk } = require('./shelfdisk.js');

/** A machine booted from disks/cpm22.dsk, with a blank B:. */
function boot() {
    const m = new Machine();
    m.out = '';
    m.console.output = b => { m.out += String.fromCharCode(b); };
    m.fdc.mount(0, Disk.fromImage(new Uint8Array(fs.readFileSync(path.join(__dirname, '../disks/cpm22.dsk')))));
    m.fdc.mount(1, new Disk('sssd8'));
    assert.ok(m.reset());
    settle(m);
    return m;
}

/** Run until the program waits for a key. */
function settle(m) {
    for (let i = 0; i < 2000; i++) {
        m.run(200000);
        if (m.waiting || m.state !== 'running') return;
    }
    throw new Error('did not settle');
}

function command(m, text) {
    m.out = '';
    m.console.type(text + '\r');
    settle(m);
    return m.out;
}

test('cold start from the system tracks to the A> prompt', () => {
    const m = boot();
    assert.match(m.out, /DigitalRerun 64K CP\/M 2\.2/);
    assert.match(m.out, /A>$/);
});

test('DIR, STAT and the original CCP built-ins', () => {
    const m = boot();
    assert.match(command(m, 'DIR'), /PIP {6}COM/);
    assert.match(command(m, 'STAT B:'), /Bytes Remaining On B: 241k/);
    assert.match(command(m, 'TYPE NOFILE.TXT'), /NOFILE\.TXT\?/);
});

test('PIP writes to B:, and the file reads back from outside', () => {
    const m = boot();
    command(m, 'PIP B:COPY.COM=A:PIP.COM');
    assert.match(command(m, 'DIR B:'), /COPY {5}COM/);
    const fsA = new CpmFs(m.fdc.drives[0]), fsB = new CpmFs(m.fdc.drives[1]);
    assert.deepEqual([...fsB.read('COPY.COM')], [...fsA.read('PIP.COM')]);
});

test('a missing drive is a select error, then ^C warm starts', () => {
    const m = boot();
    assert.match(command(m, 'DIR C:'), /Bdos Err On C: Select/);
    m.out = '';
    m.console.type([3]);
    settle(m);
    assert.match(m.out, /A>$/);
});

test('the printer port receives LST: output', () => {
    const m = boot();
    let printed = '';
    m.printer.output = b => { printed += String.fromCharCode(b); };
    command(m, 'PIP LST:=BOOT.ASM');
    assert.match(printed, /DigitalRerun cold-start loader/);
});

test('ASM assembles inside CP/M', () => {
    const m = boot();
    const out = command(m, 'ASM BOOT');
    assert.match(out, /END OF ASSEMBLY/);
    assert.match(out, /005A/);
});

test('SYSGEN copies the system tracks to another disk', () => {
    const m = boot();
    command(m, 'SYSGEN');
    m.console.type('A\r');                         // source A:, then RETURN
    settle(m);
    m.console.type('B\r');                         // destination B:, then RETURN
    settle(m);
    assert.match(m.out, /FUNCTION COMPLETE[\s\S]*FUNCTION COMPLETE/);
    m.console.type('\r');                          // no more: reboot
    settle(m);
    assert.deepEqual([...new CpmFs(m.fdc.drives[1]).readSystem()], [...new CpmFs(m.fdc.drives[0]).readSystem()]);
    assert.match(command(m, 'SYSGEN'), /DIGITALRERUN SYSGEN/);
    m.console.type('I');
    settle(m);
    m.console.type('\r');
    settle(m);
    assert.match(m.out, /NO SUCH DRIVE|NO SYSTEM TRACKS/);
});

test('a changed BIOS, assembled and installed inside CP/M, boots', () => {
    const m = boot();
    // The owner edits BIOS.ASM (here from outside, as with ED).
    const fsys = new CpmFs(m.fdc.drives[0]);
    const src = Buffer.from(fromCpmText(fsys.read('BIOS.ASM'))).toString('latin1');
    assert.match(src, /DigitalRerun 64K CP\/M 2\.2/);
    fsys.write('BIOS.ASM', toCpmText(Buffer.from(src.replace('DigitalRerun 64K CP/M 2.2', 'My own BIOS, 1980 style'), 'latin1')));
    command(m, '');                                // ^C would do; the CCP logs in again at each command

    command(m, 'SYSGEN');
    m.console.type('A\r');
    settle(m);
    m.console.type('\r');                          // reboot: the image stays at 0900h
    settle(m);
    command(m, 'SAVE 34 CPM64.COM');
    assert.match(command(m, 'ASM BIOS'), /END OF ASSEMBLY/);
    command(m, 'DDT CPM64.COM');
    command(m, 'IBIOS.HEX');
    command(m, 'R2580');                           // BIOS 0FA00h -> image 1F80h
    command(m, 'G0');
    command(m, 'SYSGEN');
    m.console.type('\r');                          // skip source: the image in memory
    settle(m);
    m.console.type('A\r');
    settle(m);
    assert.match(m.out, /FUNCTION COMPLETE/);
    m.console.type('\r');
    settle(m);

    m.out = '';
    assert.ok(m.reset());                          // cold start from the new system tracks
    settle(m);
    assert.match(m.out, /My own BIOS, 1980 style/);
    assert.match(command(m, 'DIR'), /PIP {6}COM/);
});

test('Zork I plays from the D: game disk under Vezza', () => {
    const m = boot();
    m.fdc.mount(3, shelfDisk('zork1'));
    command(m, 'D:');
    assert.match(command(m, 'VEZZA ZORK1.Z3'), /West of House/);
    // Keys at typing pace: a whole line at once can lose one, as on a real machine.
    const play = line => {
        m.out = '';
        for (const ch of line + '\r') {
            m.console.type(ch);
            for (let i = 0; i < 4; i++) m.run(66000);
        }
        settle(m);
        return m.out;
    };
    assert.match(play('open mailbox'), /leaflet/);
    assert.match(play('read leaflet'), /WELCOME TO ZORK/);
});

test('pasted text arrives whole, even in a program that reads ahead', () => {
    const m = boot();
    m.fdc.mount(3, shelfDisk('zork1'));
    command(m, 'D:');
    command(m, 'VEZZA ZORK1.Z3');
    m.out = '';
    m.console.paste('open mailbox\rread leaflet\r');           // all at once, as a paste
    settle(m);
    assert.match(m.out, /Opening the small mailbox reveals a leaflet/);
    assert.match(m.out, /WELCOME TO ZORK/);
    assert.doesNotMatch(m.out, /I don't know the word/);
});

test('a pasted batch of commands runs one after another at the CCP', () => {
    const m = boot();
    m.out = '';
    m.console.paste('DIR B:\rSTAT B:\rTYPE NOFILE.TXT\r');
    settle(m);
    assert.match(m.out, /^DIR B:[\s\S]*NO FILE[\s\S]*A>STAT B:[\s\S]*Bytes Remaining On B: 241k[\s\S]*A>TYPE NOFILE\.TXT/);
});

test('paper tape: PIP reads a file from RDR: and punches one to PUN:', () => {
    const m = boot();
    m.reader.load(Uint8Array.from(Buffer.from('first line\r\nsecond line\r\n\x1a')), 'notes.txt');
    command(m, 'PIP B:NOTES.TXT=RDR:');
    const got = Buffer.from(fromCpmText(new CpmFs(m.fdc.drives[1]).read('NOTES.TXT'))).toString();
    assert.equal(got, 'first line\r\nsecond line\r\n'.replace(/\r\n/g, '\n'));
    command(m, 'PIP PUN:=BOOT.ASM');
    const punched = Buffer.from(m.punch.bytes).toString('latin1');
    assert.match(punched, /cold-start loader/);
    assert.match(punched, /\x1a/);                              // PIP ends a text with ^Z
});

test('debugger: a breakpoint stops the machine, step runs one instruction, resume goes on', () => {
    const m = boot();
    const BDOS = 0xEC06;                                      // the BDOS entry: every DIR passes here
    let hit = null;
    m.onBreak = pc => { hit = pc; };
    m.breakpoints.add(BDOS);
    m.console.paste('DIR\r');
    for (let i = 0; i < 200 && m.state === 'running'; i++) m.run(200000);
    assert.equal(m.state, 'paused');
    assert.equal(hit, BDOS);
    assert.equal(m.pc, BDOS);
    const before = m.cycles;
    assert.ok(m.step() > 0);
    assert.notEqual(m.pc, BDOS);
    assert.ok(m.cycles > before);
    m.breakpoints.clear();
    m.resume();
    m.out = '';
    for (let i = 0; i < 200 && !m.waiting; i++) m.run(200000);
    assert.match(m.out, /PIP {6}COM/);                         // DIR finished
});

test('a paste reaches a program that is never quiet (it redraws between polls), and only one asking again and again', () => {
    const { Console } = require('../js/devices/serial.js');
    const c = new Console();
    let t = 0;
    c.now = () => t;
    c.paste('ab');
    const got = [];
    const tick = chars => {                       // print a burst, then poll once, as a game's tick does
        for (let i = 0; i < chars; i++) c.write(0x2E);
        if (c.status()) got.push(c.read());
        t += 400000;                              // a tenth of a second at 4 MHz
    };
    for (let i = 0; i < 3; i++) tick(100);
    assert.deepEqual(got, [], 'not after a few redraws: that could be a program busy printing');
    for (let i = 0; i < 30; i++) tick(100);
    assert.deepEqual(got, [0x61, 0x62]);
    const d = new Console();                      // the BDOS: a poll after every character, never 'asking'
    let u = 0;
    d.now = () => u;
    d.paste('x');
    for (let i = 0; i < 1000; i++) { d.write(0x2E); assert.equal(d.status(), 0); u += 4000; }
});
