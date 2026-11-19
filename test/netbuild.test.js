'use strict';
// FINGER, NETTIME, GOPHER and MUD build on the CP/M machine itself: SUBMIT B:NETALL on the Online disk runs
// ASM and LOAD over their sources, and makes the code the host assembler made (the sources keep to what ASM.COM takes).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Machine } = require('../js/machine.js');
const { Disk } = require('../js/devices/fdc.js');
const { CpmFs } = require('../js/cpmfs.js');
const { shelfDisk } = require('./shelfdisk.js');
const { com } = require('./net.js');

const ROOT = path.join(__dirname, '..');
const NAMES = ['FINGER', 'NETTIME', 'GOPHER', 'MUD'];

function settle(m) {
    for (let i = 0; i < 60000; i++) {
        m.run(200000);
        if (m.waiting || m.state !== 'running') return;
    }
    throw new Error('did not settle');
}

test('the Online disk carries the four programs, their sources and directories, as the sources assemble now', () => {
    const files = new CpmFs(shelfDisk('online')).list().map(f => f.name);
    for (const n of NAMES) for (const t of ['COM', 'ASM']) assert.ok(files.includes(`${n}.${t}`), `${n}.${t}`);
    for (const n of ['GOPHER.DIR', 'MUD.DIR', 'NETALL.SUB']) assert.ok(files.includes(n), n);
    for (const n of NAMES) {
        const shipped = new Uint8Array(fs.readFileSync(path.join(ROOT, 'disks/shelf/online', `${n}.COM`)));
        assert.deepEqual(shipped, new Uint8Array(com(n.toLowerCase()).image), `${n}.COM is out of date: node tools/build.js`);
    }
});

test('SUBMIT B:NETALL builds the four with ASM.COM on the machine, byte for byte the host\'s code', { timeout: 600000 }, () => {
    const m = new Machine();
    m.out = '';
    m.console.output = b => { m.out += String.fromCharCode(b); };
    m.fdc.mount(0, Disk.fromImage(new Uint8Array(fs.readFileSync(path.join(ROOT, 'disks/cpm22.dsk')))));
    m.fdc.mount(1, shelfDisk('online'));
    assert.ok(m.reset());
    settle(m);
    for (const n of NAMES) { m.console.type(`ERA B:${n}.COM\r`); settle(m); }
    m.out = '';
    m.console.type('SUBMIT B:NETALL\r');
    settle(m);
    assert.equal((m.out.match(/END OF ASSEMBLY/g) || []).length, 4, m.out);
    assert.doesNotMatch(m.out, /^[A-Z] ?[0-9A-F]{4} /m, `no assembler errors\n${m.out}`);
    const fsB = new CpmFs(m.fdc.drives[1]);
    for (const n of NAMES) {
        const built = new Uint8Array(fsB.read(`${n}.COM`));
        const ref = com(n.toLowerCase()).image;
        assert.ok(built.length >= ref.length, `${n}: ${built.length} < ${ref.length}`);
        for (let i = 0; i < ref.length; i++) if (ref[i] !== 0) assert.equal(built[i], ref[i], `${n} differs at ${(i + 0x100).toString(16)}h`);
    }
    assert.ok(!fsB.list().some(f => /\.HEX$/.test(f.name)), 'the .HEX files are erased');
});
