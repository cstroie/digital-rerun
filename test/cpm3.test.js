'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
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

/* The rest needs Digital Research's CP/M 3 disk, which is not in the repository:
   CPM3_DSK=/path/to/cpm3.dsk node --test test/cpm3.test.js */
const SOURCE = process.env.CPM3_DSK;

test('CP/M 3 is built from the distribution disk, boots and runs', { skip: !SOURCE && 'set CPM3_DSK to the AltairZ80 cpm3.dsk', timeout: 300000 }, async () => {
    const { build } = require('../tools/build-cpm3.js');
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'drr-cpm3-'));
    try {
        build(SOURCE, out);
        const entry = resolveCatalog(JSON.parse(fs.readFileSync(path.join(out, 'shelf.json'), 'utf8')), 'http://h/').find(e => e.id === 'cpm3');
        const disk = await buildDisk(entry, async p => new Uint8Array(fs.readFileSync(path.join(out, p.slice('http://h/'.length)))));
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
        assert.match(cmd('DIR BIOS3.MAC'), /BIOS3\s+MAC/);
        assert.match(cmd('TYPE BOOT3.ASM [NOPAGE]'), /cold-start loader for CP\/M 3/);
        assert.match(cmd('DEVICE'), /CONOUT: = CRT/);
        cmd('');                                                // leave DEVICE's question
        assert.match(cmd('SHOW'), /A: RW, Space:/);
        // ^C is a warm start: the CCP is loaded again from CCP.COM
        m.console.type('\x03');
        settle();
        assert.match(m.out, /A>$/);
        assert.match(cmd('SHOW B:'), /B: RW/);
    } finally { fs.rmSync(out, { recursive: true, force: true }); }
});
