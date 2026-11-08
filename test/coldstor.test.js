'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Machine } = require('../js/machine.js');
const { Disk } = require('../js/devices/fdc.js');
const { buildDisk } = require('../js/shelf.js');
const { pack } = require('../apps/coldstor/mkdat.js');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'apps/coldstor');
const SHELF = path.join(ROOT, 'disks/shelf/coldstor');
const shelf = JSON.parse(fs.readFileSync(path.join(ROOT, 'disks/shelf.json'), 'utf8'));
const read = async p => new Uint8Array(fs.readFileSync(path.join(ROOT, p)));

test('Cold Storage: the shelf copies are the app\'s build, and the DAT is what the text packs to', () => {
    for (const f of ['COLDSTOR.COM', 'COLDSTOR.DAT']) assert.deepEqual(fs.readFileSync(path.join(SHELF, f)), fs.readFileSync(path.join(APP, f)), f);
    assert.deepEqual(fs.readFileSync(path.join(SHELF, 'README.TXT')), fs.readFileSync(path.join(APP, 'docs/PLAYING.txt')));
    assert.deepEqual(fs.readFileSync(path.join(APP, 'COLDSTOR.DAT')), pack(fs.readFileSync(path.join(APP, 'coldstor.txt'), 'utf8')).dat);
});

test('Cold Storage: PLAY starts the voyage, Q saves it, the next run resumes it', async () => {
    const m = new Machine();
    m.out = '';
    m.console.output = b => { m.out += String.fromCharCode(b); };
    m.fdc.mount(0, Disk.fromImage(await read('disks/cpm22.dsk')));
    m.fdc.mount(1, await buildDisk(shelf.find(e => e.id === 'coldstor'), read));
    m.reset();
    const settle = () => { for (let i = 0; i < 40000; i++) { m.run(200000); if (m.waiting) return; } };
    const until = (re, what) => { for (let i = 0; i < 400 && !re.test(m.out); i++) m.run(200000); assert.match(m.out, re, what); };
    settle();
    m.out = ''; m.console.paste('B:\r'); settle();
    m.out = ''; m.console.paste('PLAY\r');
    until(/Your terminal\?/, 'asks the terminal the first time');
    m.out = ''; m.console.type('1');
    until(/C O L D   S T O R A G E[\s\S]*press a key/, 'the title');
    m.out = ''; m.console.type(' ');
    until(/ANSELM'S PATIENCE[\s\S]*YEAR 000\.0/, 'the hall');
    m.out = ''; m.console.type('Q');
    until(/sails on[\s\S]*B>/, 'Q ends the shift');
    m.out = ''; m.console.paste('DIR\r'); settle();
    assert.match(m.out, /COLDSTOR\s+SAV/);
    m.out = ''; m.console.paste('COLDSTOR\r');
    until(/YEAR 000\./, 'the saved voyage, on the saved terminal');
    assert.doesNotMatch(m.out, /press a key|Your terminal/);
});
