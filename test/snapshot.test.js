'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Machine } = require('../js/machine.js');
const { Disk } = require('../js/devices/fdc.js');
const { Terminal } = require('../js/terminal.js');
const { FX80 } = require('../js/fx80.js');
const Snapshot = require('../js/snapshot.js');

const { shelfDisk } = require('./shelfdisk.js');
const disk = name => Disk.fromImage(new Uint8Array(fs.readFileSync(path.join(__dirname, '../disks', name))));

/** A booted machine wired to a terminal and a printer, as in the page. */
function computer() {
    const machine = new Machine(), terminal = new Terminal(), printer = new FX80();
    machine.console.output = b => terminal.write(b);
    machine.printer.output = b => printer.write(b);
    machine.fdc.mount(0, disk('cpm22.dsk'));
    machine.fdc.mount(1, new Disk('sssd8'));
    machine.fdc.mount(3, shelfDisk('zork1'));
    machine.reset();
    const pc = { machine, terminal, printer };
    pc.settle = () => {
        for (let i = 0; i < 3000; i++) {
            machine.run(200000);
            if (machine.waiting || machine.state !== 'running') return;
        }
    };
    pc.type = line => {
        for (const ch of line + '\r') { machine.console.type(ch); for (let i = 0; i < 4; i++) machine.run(66000); }
        pc.settle();
    };
    pc.settle();
    return pc;
}

test('restore brings back screen, RAM, disks and printer exactly', () => {
    const pc = computer();
    pc.type('DIR');
    pc.type('PIP LST:=BOOT.ASM');
    const screen = pc.terminal.text();
    const snap = structuredClone(Snapshot.take(pc, { version: 'test' }));    // as IndexedDB stores it
    assert.equal(snap.preview, 'A>');
    assert.ok(Snapshot.size(snap) > 64 * 1024 + 3 * 250000);
    const head = pc.printer.y;

    pc.type('PIP B:NEW.COM=PIP.COM');
    pc.type('ERA A:DUMP.ASM');
    pc.type('PIP LST:=BOOT.ASM');
    assert.match((pc.type('DIR B:'), pc.terminal.text()), /NEW {6}COM/);
    assert.notEqual(pc.printer.y, head);

    Snapshot.restore(snap, pc);
    assert.equal(pc.terminal.text(), screen);
    assert.equal(pc.printer.y, head);
    pc.type('DIR B:');
    assert.match(pc.terminal.text(), /NO FILE/);                       // B: is as it was
    pc.type('DIR A:DUMP.ASM');
    assert.match(pc.terminal.text(), /DUMP {5}ASM/);                   // A: too
});

test('a game in progress continues from the snapshot', () => {
    const pc = computer();
    pc.type('D:');
    pc.type('VEZZA ZORK1.Z3');
    pc.type('open mailbox');
    const snap = structuredClone(Snapshot.take(pc));
    pc.type('go north');
    pc.type('go north');
    assert.match(pc.terminal.text(), /Forest|Clearing|North of House|Path/);

    Snapshot.restore(snap, pc);
    assert.match(pc.terminal.text(), /Opening the small mailbox reveals a leaflet/);
    pc.type('read leaflet');
    assert.match(pc.terminal.text(), /WELCOME TO ZORK/);
});

test('a snapshot of another format is refused', () => {
    const pc = computer();
    assert.throws(() => Snapshot.restore({ format: 99 }, pc), /another version/);
});

test('a disk keeps where it came from across a snapshot', () => {
    const pc = computer();
    pc.machine.fdc.drives[3].origin = 'shelf:zork1';
    const snap = structuredClone(Snapshot.take(pc));
    pc.machine.fdc.eject(3);
    Snapshot.restore(snap, pc);
    assert.equal(pc.machine.fdc.drives[3].origin, 'shelf:zork1');
});
