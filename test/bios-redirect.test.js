'use strict';
// The BIOS's I/O byte redirects, end to end on the machine: STAT RDR:=UR1: and PIP reads a file from the modem,
// STAT PUN:=UP1: and STAT LST:=UL1: send one back over it, STAT CON:=UC1: runs the CCP over it, STAT CON:=TTY: returns.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const DR = path.join(__dirname, '..');
const { Machine } = require('../js/machine.js');
const { Disk } = require('../js/devices/fdc.js');
const { Hayes } = require('../js/devices/hayes.js');
const { Directory } = require('../js/devices/directory.js');

function boot(dir) {
    const m = new Machine();
    m.out = '';
    m.console.output = b => { m.out += String.fromCharCode(b); };
    m.fdc.mount(0, Disk.fromImage(new Uint8Array(fs.readFileSync(path.join(DR, 'disks/cpm22.dsk')))));
    m.modem.attach(new Hayes({ dial: dir.dial, dialTime: 0.2 }));
    assert.ok(m.reset());
    return m;
}
async function until(m, text, from = 0) {
    for (let i = 0; i < 8000; i++) { m.run(100000); if (m.out.indexOf(text, from) >= 0) return; if (i % 4 === 0) await new Promise(r => setImmediate(r)); }
    throw new Error(`never saw ${JSON.stringify(text)} in ${JSON.stringify(m.out.slice(from).slice(-400))}`);
}
const say = (m, text) => { const at = m.out.length; m.console.type(text); return at; };

test('BIOS redirects: RDR:=UR1:, PUN:=UP1:, LST:=UL1: move a file over the modem; CON:=UC1: runs the console over it', async () => {
    const host = { got: '', link: null };
    const dir = new Directory();
    dir.add('5550150', link => {
        host.link = link;
        return { send(b) { host.got += String.fromCharCode(b); }, close() {} };
    });
    const m = boot(dir);
    await until(m, 'A>');
    let at = say(m, 'TERM\r');
    await until(m, 'Try ATDT', at);
    at = say(m, 'ATDT5550150\r');
    await until(m, 'CONNECT', at);
    at = say(m, '\x1d');
    await until(m, 'Q', at);
    at = say(m, 'Q');
    await until(m, 'A>', at);
    const run = async (cmd) => { const a = say(m, cmd + '\r'); await until(m, 'A>', a + cmd.length); return a; };
    // reader and punch on the modem; the console stays here
    await run('STAT RDR:=UR1:');
    await run('STAT PUN:=UP1:');
    const a = say(m, 'PIP ZZ.TXT=RDR:\r');
    for (let i = 0; i < 200; i++) { m.run(100000); await new Promise(r => setImmediate(r)); }
    host.link.receive('HELLO FROM THE HOST\r\n\x1a');
    await until(m, 'A>', a + 10);
    const b = say(m, 'PIP PUN:=ZZ.TXT\r');
    await until(m, 'A>', b + 10);
    for (let i = 0; i < 100; i++) { m.run(100000); await new Promise(r => setImmediate(r)); }
    assert.match(host.got, /HELLO FROM THE HOST/, 'the file read from the modem is punched back over the modem');

    // the printer on the modem (LST: UL1:): PIP copies the file to the list device
    const lst0 = host.got.length;
    await run('STAT LST:=UL1:');
    const l = say(m, 'PIP LST:=ZZ.TXT\r');
    await until(m, 'A>', l + 10);
    for (let i = 0; i < 100; i++) { m.run(100000); await new Promise(r => setImmediate(r)); }
    assert.match(host.got.slice(lst0), /HELLO FROM THE HOST/, 'the list output goes to the modem');

    // the console on the modem: the CCP's prompt and the directory come over the line
    const before = host.got.length;
    say(m, 'STAT CON:=UC1:\r');
    for (let i = 0; i < 200; i++) { m.run(100000); await new Promise(r => setImmediate(r)); }
    const waitFor = async (text, from) => { for (let i = 0; i < 8000; i++) { m.run(100000); if (host.got.indexOf(text, from) >= 0) return; if (i % 4 === 0) await new Promise(r => setImmediate(r)); } throw new Error('host never saw ' + text + ' in ' + JSON.stringify(host.got.slice(from).slice(-200))); };
    await waitFor('A>', before);
    host.link.receive('DIR ZZ.TXT\r');
    await waitFor('ZZ', host.got.length - 5);
    await waitFor('A>', host.got.indexOf('ZZ', before));
    for (let i = 0; i < 100; i++) { m.run(100000); await new Promise(r => setImmediate(r)); }
    // back to the physical console: the program's warm boot restores it; here STAT says so from the line
    const after = host.got.length;
    host.link.receive('STAT CON:=TTY:\r');
    for (let i = 0; i < 200; i++) { m.run(100000); await new Promise(r => setImmediate(r)); }
    const c = say(m, 'DIR\r');
    await until(m, 'ZZ', c);
});
