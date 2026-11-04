'use strict';
// Signal Seeker (apps/sigseek): its SIGSEEK.DAT is current with sigseek.txt,
// and the shelf disk carries the files as built.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse, pack } = require('../apps/sigseek/mkdat.js');

const APP = path.join(__dirname, '../apps/sigseek');
const SHELF = path.join(__dirname, '../disks/shelf/sigseek');

test('SIGSEEK.DAT is packed from sigseek.txt as it stands', () => {
    const want = pack(parse(fs.readFileSync(path.join(APP, 'sigseek.txt'), 'latin1')));
    assert.deepEqual(new Uint8Array(fs.readFileSync(path.join(APP, 'SIGSEEK.DAT'))), want);
});

test('the shelf disk has SIGSEEK.COM and SIGSEEK.DAT as built', () => {
    for (const f of ['SIGSEEK.COM', 'SIGSEEK.DAT'])
        assert.deepEqual(fs.readFileSync(path.join(SHELF, f)), fs.readFileSync(path.join(APP, f)), f);
});

test('mkdat refuses a line too long for the screen', () => {
    const src = fs.readFileSync(path.join(APP, 'sigseek.txt'), 'latin1').replace('Hello Kettle-7!', 'Hello Kettle-7, how are you tonight?');
    assert.throws(() => parse(src), /at most 20/);
});
