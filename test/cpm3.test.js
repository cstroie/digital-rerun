'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Machine } = require('../js/machine.js');
const { Disk } = require('../js/devices/fdc.js');
const { CpmFs } = require('../js/cpmfs.js');
const { buildDisk, resolveCatalog } = require('../js/shelf.js');
const { assemble } = require('../js/asm8080.js');

const ROOT = path.join(__dirname, '..');

test('the CP/M 3 boot sector fits one record', () => {
    const r = assemble(fs.readFileSync(path.join(ROOT, 'system/cpm3/boot3.asm'), 'utf8'), { defines: { nsects: 24 } });
    const image = r.image(0, 127);
    assert.equal(image.length, 128);
    assert.ok(image.some(b => b !== 0));
});

test('a shelf entry with `system` puts those bytes on the system tracks', async () => {
    const system = new Uint8Array(300).fill(0x5A);
    const entry = { id: 'x', name: 'X', format: 'sssd8', system: 'sys.bin', files: [{ name: 'A.TXT', path: 'a.txt' }] };
    const disk = await buildDisk(entry, async p => (p === 'sys.bin' ? system : new TextEncoder().encode('hi\n')));
    assert.deepEqual([...disk.data.slice(0, 300)], [...system]);
    assert.equal(new CpmFs(disk).list().length, 1);
    assert.equal(resolveCatalog([{ id: 'x', name: 'X', format: 'sssd8', system: 'cpm3/SYSTEM.BIN', files: [] }], 'https://h/g/shelf.json')[0].system, 'https://h/g/cpm3/SYSTEM.BIN');
});

test('the shelf disk is current: the committed CPM3.SYS, loader and sources are what the tools build', { timeout: 120000 }, () => {
    const { outputs } = require('../tools/build-cpm3.js');
    for (const [name, data] of outputs()) {
        assert.deepEqual(new Uint8Array(fs.readFileSync(path.join(ROOT, 'disks/shelf/cpm3', name))), new Uint8Array(data), `${name} is stale: node tools/build-cpm3.js`);
    }
});

test('the CP/M 3 shelf disk boots, and runs its commands', { timeout: 300000 }, async () => {
    const list = JSON.parse(fs.readFileSync(path.join(ROOT, 'disks/shelf.json'), 'utf8'));
    const entry = resolveCatalog(list, 'http://h/').find(e => e.id === 'cpm3');
    assert.equal(entry.licence, 'DRDOS, Inc. grant; MIT');
    const disk = await buildDisk(entry, async p => new Uint8Array(fs.readFileSync(path.join(ROOT, p.slice('http://h/'.length)))));
    const m = new Machine();
    m.out = '';
    m.console.output = b => { m.out += String.fromCharCode(b); };
    m.fdc.mount(0, disk);
    m.fdc.mount(1, new Disk('sssd8'));
    assert.ok(m.reset());
    const settle = () => { for (let i = 0; i < 4000; i++) { m.run(200000); if (m.waiting || m.state !== 'running') return; } throw new Error('did not settle'); };
    const cmd = text => { m.out = ''; m.console.paste(text + '\r'); settle(); return m.out; };
    settle();
    assert.match(m.out, /CP\/M V3\.0 Loader/);
    assert.match(m.out, /DigitalRerun 64K CP\/M 3\.0\r\nA>$/);
    assert.match(cmd('DIR'), /CPM3\s+SYS/);
    assert.match(cmd('PIP B:=A:SHOW.COM'), /B>|A>/);
    assert.match(cmd('DIR B:'), /SHOW\s+COM/);
    assert.match(cmd('TYPE BIOS3.ASM [NOPAGE]'), /DigitalRerun BIOS for CP\/M 3/);
    assert.match(cmd('DEVICE'), /CONOUT: = CRT/);
    cmd('');                                                // leave DEVICE's question
    assert.match(cmd('SHOW'), /A: RW, Space:/);
    // ^C is a warm start: the CCP is loaded again from CCP.COM
    m.console.type('\x03');
    settle();
    assert.match(m.out, /A>$/);
    assert.match(cmd('SHOW B:'), /B: RW/);
});

test('the disk builds itself: GEN.SUB on the CP/M 3 disk makes the same CPM3.SYS', { timeout: 300000 }, async () => {
    const list = JSON.parse(fs.readFileSync(path.join(ROOT, 'disks/shelf.json'), 'utf8'));
    const entry = resolveCatalog(list, 'http://h/').find(e => e.id === 'cpm3');
    const disk = await buildDisk(entry, async p => new Uint8Array(fs.readFileSync(path.join(ROOT, p.slice('http://h/'.length)))));
    const m = new Machine();
    m.out = '';
    m.console.output = b => { m.out += String.fromCharCode(b); };
    m.fdc.mount(0, disk);
    m.fdc.mount(1, new Disk('sssd8'));
    assert.ok(m.reset());
    const settle = () => { for (let i = 0; i < 6000; i++) { m.run(200000); if (m.waiting || m.state !== 'running') return; } throw new Error('did not settle'); };
    const cmd = text => { m.out = ''; m.console.paste(text + '\r'); settle(); return m.out; };
    settle();
    cmd('ERASE CPM3.SYS');
    assert.match(cmd('SUBMIT GEN'), /SYSTEM GENERATION DONE/);
    const built = new CpmFs(disk).read('CPM3.SYS');
    assert.deepEqual([...built], [...fs.readFileSync(path.join(ROOT, 'disks/shelf/cpm3/CPM3.SYS'))]);
});
