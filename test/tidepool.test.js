'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Machine } = require('../js/machine.js');
const { Disk } = require('../js/devices/fdc.js');
const { buildDisk } = require('../js/shelf.js');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'apps/tidepool');
const SHELF = path.join(ROOT, 'disks/shelf/tidepool');
const shelf = JSON.parse(fs.readFileSync(path.join(ROOT, 'disks/shelf.json'), 'utf8'));
const read = async p => new Uint8Array(fs.readFileSync(path.join(ROOT, p)));

test('Tidepool: the shelf copies are the app\'s build', () => {
    assert.deepEqual(fs.readFileSync(path.join(SHELF, 'TIDEPOOL.COM')), fs.readFileSync(path.join(APP, 'TIDEPOOL.COM')));
    assert.deepEqual(fs.readFileSync(path.join(SHELF, 'README.TXT')), fs.readFileSync(path.join(APP, 'docs/PLAYING.txt')));
});

test('Tidepool: PLAY starts the pool, Q saves it, and a week later the next run says what happened', async () => {
    const T0 = Date.UTC(2026, 10, 10, 8, 0);
    const disk = await buildDisk(shelf.find(e => e.id === 'tidepool'), read);
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
    v.until(/Your terminal\?/, 'asks the terminal the first time');
    v.m.out = ''; v.m.console.type('1');
    v.until(/a very slow garden/, 'the intro');
    v.m.out = ''; v.m.console.type(' ');
    v.until(/Cairn stones:[\s\S]*Q quit/, 'the pool');
    v.m.out = ''; v.m.console.type('Q');
    v.until(/carries on without you[\s\S]*B>/, 'Q leaves');
    v.m.out = ''; v.m.console.paste('DIR\r'); v.settle();
    assert.match(v.m.out, /TIDEPOOL\s+SAV/);

    v = visit(T0 + 7 * 86400e3 + 3 * 3600e3, 'TIDEPOOL');
    v.until(/You were away for 7 days and 3 hours\.\s+1[34] tides came and went/, 'the week');
    assert.doesNotMatch(v.m.out, /Your terminal\?|a very slow garden/);
    v.m.out = ''; v.m.console.type(' ');
    v.until(/day 8, /, 'the pool, a week on');
});
