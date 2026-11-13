'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Machine } = require('../js/machine.js');
const { Disk } = require('../js/devices/fdc.js');
const { buildDisk } = require('../js/shelf.js');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'apps/ledger');
const SHELF = path.join(ROOT, 'disks/shelf/ledger');
const haveApp = fs.existsSync(path.join(APP, 'docs/PLAYING.txt'));
const shelf = JSON.parse(fs.readFileSync(path.join(ROOT, 'disks/shelf.json'), 'utf8'));
const read = async p => new Uint8Array(fs.readFileSync(path.join(ROOT, p)));

// LEDGER.COM is not in the app's repository: the shelf holds the file of its GitHub release
// (https://github.com/cstroie/ledger/releases, the tag in apps/ledger), so only the guide is compared.
test('Ledger: the shelf has the release build and the app\'s guide', { skip: !haveApp && 'apps/ledger is not checked out' }, () => {
    assert.ok(fs.statSync(path.join(SHELF, 'LEDGER.COM')).size > 8000);
    assert.deepEqual(fs.readFileSync(path.join(SHELF, 'README.TXT')), fs.readFileSync(path.join(APP, 'docs/PLAYING.txt')));
});

test('Ledger: PLAY starts the book, a night is written, and a week later the relief hand has kept the log', async () => {
    const T0 = Date.UTC(2026, 10, 10, 8, 0);
    const disk = await buildDisk(shelf.find(e => e.id === 'ledger'), read);
    const visit = (when, cmd) => {
        const m = new Machine();
        m.out = '';
        m.clock.now = () => when;
        m.console.output = b => { m.out += String.fromCharCode(b); };
        m.fdc.mount(0, Disk.fromImage(new Uint8Array(fs.readFileSync(path.join(ROOT, 'disks/cpm22.dsk')))));
        m.fdc.mount(1, disk);
        m.reset();
        const settle = () => { for (let i = 0; i < 40000; i++) { m.run(200000); if (m.waiting) return; } };
        const until = (re, what) => { for (let i = 0; i < 600 && !re.test(m.out); i++) m.run(200000); assert.match(m.out, re, what); };
        settle();
        m.out = ''; m.console.paste('B:\r'); settle();
        m.out = ''; m.console.paste(cmd + '\r');
        return { m, until, settle };
    };
    let v = visit(T0, 'PLAY');
    v.until(/which terminal\?/, 'asks the terminal the first time');
    v.m.out = ''; v.m.console.type('1');
    v.until(/the lighthouse keeper's logbook/, 'the intro');
    v.m.out = ''; v.m.console.type(' ');
    v.until(/The page is blank[\s\S]*Q leave/, 'the book');
    v.m.out = ''; v.m.console.type('D');
    v.until(/Choose the words, 1 2 or 3/, 'the night passes and the words are asked for');
    for (const k of ['1', '1', '1']) { v.m.out = ''; v.m.console.type(k); v.m.run(400000); }
    v.until(/Night 1 is written\./, 'the night is written');
    v.m.out = ''; v.m.console.type('Q');
    v.until(/The relief hand has the lamp[\s\S]*B>/, 'Q leaves');
    v.m.out = ''; v.m.console.paste('DIR\r'); v.settle();
    assert.match(v.m.out, /LEDGER\s+SAV/);
    assert.match(v.m.out, /LEDGER\s+LOG/);

    v = visit(T0 + 7 * 86400e3, 'LEDGER');
    v.until(/You were away for 55 nights\./, 'the week');
    assert.doesNotMatch(v.m.out, /which terminal\?|lighthouse keeper's logbook/);
    v.m.out = ''; v.m.console.type(' ');
    v.until(/Night 56 \(relief hand\)|Night 55 \(relief hand\)/, 'the book, a week on');
});
