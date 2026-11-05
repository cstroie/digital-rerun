'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Machine } = require('../js/machine.js');
const { Disk } = require('../js/devices/fdc.js');
const { CpmFs } = require('../js/cpmfs.js');
const { buildDisk, resolveCatalog } = require('../js/shelf.js');

const ROOT = path.join(__dirname, '..');

test('CP/M 3: the modem is a character device, AUX: can be assigned to it, PIP reads and writes it', { timeout: 300000 }, async () => {
    const list = JSON.parse(fs.readFileSync(path.join(ROOT, 'disks/shelf.json'), 'utf8'));
    const entry = resolveCatalog(list, 'http://h/').find(e => e.id === 'cpm3');
    const disk = await buildDisk(entry, async p => new Uint8Array(fs.readFileSync(path.join(ROOT, p.slice('http://h/'.length)))));
    const m = new Machine();
    m.out = '';
    m.console.output = b => { m.out += String.fromCharCode(b); };
    m.fdc.mount(0, disk);
    m.fdc.mount(1, new Disk('sssd8'));
    const sent = [];
    m.modem.attach({ attached(modem) { modem.carrier = true; }, send: b => sent.push(b) });
    assert.ok(m.reset());
    const settle = () => { for (let i = 0; i < 4000; i++) { m.run(200000); if (m.waiting || m.state !== 'running') return; } throw new Error('did not settle'); };
    const cmd = text => { m.out = ''; m.console.paste(text + '\r'); settle(); return m.out; };
    // a program waiting on the modem looks idle: run on until the prompt is back
    const slow = text => { cmd(text); for (let i = 0; i < 4000 && !/[A-D]>$/.test(m.out); i++) m.run(200000); return m.out; };
    settle();

    assert.match(cmd('DEVICE'), /MODEM\s+1200\s+IOS/);
    cmd('');                                            // DEVICE alone waits for an assignment: RETURN leaves
    cmd('DEVICE AUX:=MODEM');
    assert.match(cmd('DEVICE AUX:'), /AUXIN:\s+= MODEM\s+AUXOUT: = MODEM/);

    // the line has no flow control: it speaks only once PIP is reading (bytes sent earlier would overrun)
    m.out = '';
    m.console.paste('PIP B:GOT.TXT=AUX:\r');
    for (let i = 0; i < 400 && !m.modem.dtr && !m.waiting; i++) m.run(200000);
    for (let i = 0; i < 40; i++) m.run(200000);
    m.modem.receive('HELLO FROM THE LINE\r\n\x1a');
    for (let i = 0; i < 4000 && !/[A-D]>$/.test(m.out); i++) m.run(200000);
    const got = new CpmFs(m.fdc.drives[1]);
    assert.match(Buffer.from(got.read('GOT.TXT')).toString('latin1'), /^HELLO FROM THE LINE\r\n/);

    cmd('PIP B:OUT.TXT=A:BOOT3.ASM');
    sent.length = 0;
    slow('PIP AUX:=B:OUT.TXT');
    assert.match(Buffer.from(sent).toString('latin1'), /boot/i);
});
