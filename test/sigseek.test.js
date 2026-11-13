'use strict';
// Signal Seeker (apps/sigseek): the shelf's SIGSEEK.DAT is current with sigseek.txt, and its guide
// is the app's. SIGSEEK.COM and SIGSEEK.DAT are not in the app's repository: the shelf holds the
// files of its GitHub release (https://github.com/cstroie/signal-seeker/releases, the tag in apps/sigseek).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse, pack } = require('../apps/sigseek/mkdat.js');

const APP = path.join(__dirname, '../apps/sigseek');
const SHELF = path.join(__dirname, '../disks/shelf/sigseek');

test('SIGSEEK.DAT is packed from sigseek.txt as it stands', () => {
    const want = pack(parse(fs.readFileSync(path.join(APP, 'sigseek.txt'), 'latin1')));
    assert.deepEqual(new Uint8Array(fs.readFileSync(path.join(SHELF, 'SIGSEEK.DAT'))), want);
});

test('the shelf disk has the release build and the app\'s guide', () => {
    assert.ok(fs.statSync(path.join(SHELF, 'SIGSEEK.COM')).size > 30000);
    assert.deepEqual(fs.readFileSync(path.join(SHELF, 'README.TXT')), fs.readFileSync(path.join(APP, 'docs/PLAYING.txt')));
});

test('mkdat refuses a line too long for the screen', () => {
    const src = fs.readFileSync(path.join(APP, 'sigseek.txt'), 'latin1').replace('Hello Kettle-7!', 'Hello Kettle-7, how are you tonight?');
    assert.throws(() => parse(src), /at most 20/);
});
