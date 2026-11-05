'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Machine } = require('../js/machine.js');
const { Disk } = require('../js/devices/fdc.js');
const { Hayes } = require('../js/devices/hayes.js');
const { Directory } = require('../js/devices/directory.js');
const { bbs, MemoryBoard } = require('../js/bbs.js');

function boot({ modem = true } = {}) {
    const m = new Machine();
    m.out = '';
    m.console.output = b => { m.out += String.fromCharCode(b); };
    m.fdc.mount(0, Disk.fromImage(new Uint8Array(fs.readFileSync(path.join(__dirname, '../disks/cpm22.dsk')))));
    if (modem) m.modem.attach(new Hayes({ dial: new Directory().dial, dialTime: 1 }));
    assert.ok(m.reset());
    return m;
}

/** Run until `text` has been printed (since `from`), letting dials resolve; fails after a while. */
async function until(m, text, from = 0) {
    for (let i = 0; i < 4000; i++) {
        m.run(100000);
        if (m.out.indexOf(text, from) >= 0) return;
        if (i % 4 === 0) await new Promise(r => setImmediate(r));
    }
    throw new Error(`never saw ${JSON.stringify(text)} in ${JSON.stringify(m.out.slice(from))}`);
}
const say = (m, text) => { const at = m.out.length; m.console.type(text); return at; };

test('TERM without a modem says so and leaves', async () => {
    const m = boot({ modem: false });
    await until(m, 'A>');
    const at = say(m, 'TERM\r');
    await until(m, 'No modem on this machine.', at);
    await until(m, 'A>', at + 20);
});

test('TERM: AT commands reach the modem, the echo service answers, +++ and ATH leave', async () => {
    const m = boot();
    await until(m, 'A>');
    let at = say(m, 'TERM\r');
    await until(m, 'Try ATDT', at);
    assert.equal(m.modem.dtr, true);

    at = say(m, 'AT\r');
    await until(m, 'OK', at);

    at = say(m, 'ATDT0\r');
    await until(m, 'CONNECT 1200', at);
    await until(m, 'What you type comes back', at);
    assert.equal(m.modem.carrier, true);

    at = say(m, 'hello\r');
    await until(m, 'hello\r\n', at);                      // TERM does not echo: this is the service sending it back, the CR as CR LF

    for (let i = 0; i < 60; i++) m.run(200000);          // a second of silence first
    at = m.out.length;
    m.console.type('+++');
    for (let i = 0; i < 60; i++) { m.run(200000); await new Promise(r => setImmediate(r)); }
    await until(m, 'OK', at);
    at = say(m, 'ATH\r');
    await until(m, 'OK', at);
    assert.equal(m.modem.carrier, false);
});

test('TERM: Ctrl-] Q leaves the call up; Ctrl-] H hangs it up', async () => {
    const m = boot();
    await until(m, 'A>');
    let at = say(m, 'TERM\r');
    await until(m, 'Try ATDT', at);
    at = say(m, 'ATDT0\r');
    await until(m, 'CONNECT 1200', at);
    at = say(m, '\x1dq');
    await until(m, 'A>', at);
    assert.equal(m.modem.carrier, true);
    at = say(m, 'TERM\r');
    await until(m, 'Try ATDT', at);
    at = say(m, '\x1dh');
    await until(m, 'Hung up.', at);
    assert.equal(m.modem.carrier, false);
});

test('TERM is on the system disk with its source', () => {
    const { CpmFs } = require('../js/cpmfs.js');
    const files = new CpmFs(Disk.fromImage(new Uint8Array(fs.readFileSync(path.join(__dirname, '../disks/cpm22.dsk'))))).list().map(f => f.name);
    assert.ok(files.includes('TERM.COM'));
    assert.ok(files.includes('TERM.ASM'));
});

test('TERM: dial the bulletin board, read the time, leave a bulletin, say goodbye', async () => {
    const m = boot();
    const board = new MemoryBoard();
    const dir = new Directory().add('5550100', bbs({
        now: () => new Date(2026, 10, 5, 14, 3), board, store: { get: () => null, set() {} }, online: () => false, fetchJson: () => Promise.reject(new Error('x'))
    }));
    m.modem.attach(new Hayes({ dial: dir.dial, dialTime: 1 }));
    await until(m, 'A>');
    let at = say(m, 'TERM\r');
    await until(m, 'Try ATDT5550100', at);
    at = say(m, 'ATDT555-0100\r');
    await until(m, 'DIGITAL RERUN BBS', at);
    await until(m, 'oodbye', at);
    at = say(m, 't');
    await until(m, 'It is Thursday 5 November 2026, 14:03', at);
    await until(m, 'oodbye', at);
    at = say(m, 'b');
    await until(m, 'P', at + 5);
    await until(m, 'ost a message', at);
    at = say(m, 'p');
    await until(m, 'Your name?', at);
    at = say(m, 'Ana\r');
    await until(m, 'Your message', at);
    at = say(m, 'hello\r');
    await until(m, 'Posted. Thank you.', at);
    assert.deepEqual((await board.list()).map(p => [p.name, p.text]), [['Ana', 'hello']]);
    at = say(m, 'g');
    await until(m, 'NO CARRIER', at);
    assert.equal(m.modem.carrier, false);
});
