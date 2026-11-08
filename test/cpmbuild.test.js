'use strict';
// TERM and IRC build on the CP/M machine itself: ASM, LOAD and SUBMIT of the boot disk, the
// sources and MAKE.SUB / MAKEALL.SUB of the Online disk (system/dialtone).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Machine } = require('../js/machine.js');
const { Disk } = require('../js/devices/fdc.js');
const { Hayes } = require('../js/devices/hayes.js');
const { CpmFs } = require('../js/cpmfs.js');
const { shelfDisk } = require('./shelfdisk.js');

function boot() {
    const m = new Machine();
    m.out = '';
    m.console.output = b => { m.out += String.fromCharCode(b); };
    m.fdc.mount(0, Disk.fromImage(new Uint8Array(fs.readFileSync(path.join(__dirname, '../disks/cpm22.dsk')))));
    m.fdc.mount(1, shelfDisk('online'));
    m.modem.attach(new Hayes({ dialTime: 1 }));
    assert.ok(m.reset());
    settle(m);
    return m;
}
function settle(m) {
    for (let i = 0; i < 60000; i++) {
        m.run(200000);
        if (m.waiting || m.state !== 'running') return;
    }
    throw new Error('did not settle');
}
function command(m, text) { m.out = ''; m.console.type(text + '\r'); settle(m); return m.out; }

/** Every byte the host assembler wrote is in the built file; the reserved buffers (ds) hold whatever memory had. */
function sameCode(built, reference, name) {
    assert.ok(built.length >= reference.length, `${name}: ${built.length} bytes, expected at least ${reference.length}`);
    for (let i = 0; i < reference.length; i++) if (reference[i] !== 0) assert.equal(built[i], reference[i], `${name} differs at ${i}`);
}

test('SUBMIT B:MAKEALL builds TERM.COM and IRC.COM on the machine, the same code the host assembler makes', () => {
    const m = boot();
    const online = name => new Uint8Array(fs.readFileSync(path.join(__dirname, '../disks/shelf/online', name)));
    const reference = { 'TERM.COM': online('TERM.COM'), 'IRC.COM': online('IRC.COM') };
    command(m, 'ERA B:*.COM');
    const out = command(m, 'SUBMIT B:MAKEALL');
    assert.equal((out.match(/END OF ASSEMBLY/g) || []).length, 2, out);
    assert.doesNotMatch(out, /^[A-Z] ?[0-9A-F]{4} /m, 'no assembler errors');
    const fsB = new CpmFs(m.fdc.drives[1]);
    for (const name of Object.keys(reference)) sameCode(new Uint8Array(fsB.read(name)), reference[name], name);
    assert.ok(!fsB.list().some(f => /\.HEX$/.test(f.name)), 'the .HEX files are erased');
});

test('SUBMIT B:MAKE with a name builds that one, and the new program runs', () => {
    const m = boot();
    command(m, 'ERA B:*.COM');
    const out = command(m, 'SUBMIT B:MAKE TERM');
    assert.equal((out.match(/END OF ASSEMBLY/g) || []).length, 1);
    const fsB = new CpmFs(m.fdc.drives[1]);
    assert.deepEqual(fsB.list().map(f => f.name).filter(n => /\.COM$/.test(n)), ['TERM.COM']);
    command(m, 'B:');
    assert.match(command(m, 'TERM'), /Try ATDT/);
});
