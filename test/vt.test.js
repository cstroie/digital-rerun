'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vt = require('../js/vt.js');
const { Terminal } = require('../js/terminal.js');

const feed = (term, text) => { for (const c of text) term.write(c.charCodeAt(0)); };
const row = (term, n) => term.text().split('\n')[n - 1];

test('bar: reverse, the left text, erase to end of line, the right text put at the end: a few dozen bytes, not eighty spaces', () => {
    const b = vt.bar(1, ' TITLE', 'RIGHT ');
    assert.equal(b, '\x1b[1;1H\x1b[7m TITLE\x1b[K\x1b[1;75HRIGHT \x1b[0m');
    assert.ok(b.length < 40);
    assert.equal(vt.bar(24, ' hint'), '\x1b[24;1H\x1b[7m hint\x1b[K\x1b[0m', 'no right text, no move');
    assert.equal(vt.bar(2, ''), '\x1b[2;1H\x1b[7m\x1b[K\x1b[0m', 'an empty bar is a handful of bytes');
    assert.ok(vt.bar(1, 'x'.repeat(100), 'R').length < 130, 'clipped');
});

test('rule: a bar with texts at columns', () => {
    assert.equal(vt.rule(3, [[3, 'MAIN'], [47, 'SYSTEM']]), '\x1b[3;1H\x1b[7m\x1b[K\x1b[3;3HMAIN\x1b[3;47HSYSTEM\x1b[0m');
});

test('forward: a short move right; nothing for zero', () => {
    assert.equal(vt.forward(8), '\x1b[8C');
    assert.equal(vt.forward(0), '');
    assert.equal(vt.forward(-3), '');
});

test('big: five rows, digits three wide, joined by a space', () => {
    const b = vt.big('14:03');
    assert.equal(b.length, 5);
    assert.ok(b.every(l => l.length === b[0].length));
    assert.equal(vt.big('8')[2], '###');
    assert.equal(vt.big('1')[0], ' ##');
    assert.equal(vt.big('?')[0], '  ', 'an unknown character is a blank');
});

test('on the terminal: a frame has the bars, and what scrolls stays between them', () => {
    const term = new Terminal(80, 24);
    feed(term, vt.frame({ title: ' TITLE', titleRight: 'RIGHT ', status: ' STATUS', statusRight: '14:03 ' }));
    assert.match(row(term, 1), /^ TITLE +RIGHT\s*$/);
    assert.match(row(term, 24), /^ STATUS +14:03\s*$/);
    assert.equal(term.attrs[0][0] & 8, 8, 'the title bar is reverse video');
    assert.equal(term.attrs[23][5] & 8, 8, 'so is the status bar');
    for (let i = 1; i <= 60; i++) feed(term, `line ${i}\r\n`);
    assert.match(row(term, 1), /^ TITLE/, 'the title bar did not scroll');
    assert.match(row(term, 24), /^ STATUS/, 'the status bar did not scroll');
    assert.match(row(term, 23), /line 60|^$/);
    assert.match(row(term, 22), /line 5\d|line 60/);
    assert.equal(term.cursorVisible !== false, true);
});

test('the status bar redraws without moving the cursor', () => {
    const term = new Terminal(80, 24);
    feed(term, vt.frame({ title: 'T', status: 'one' }));
    feed(term, 'hello');
    const { x, y } = term;
    feed(term, vt.statusBar('two', '15:00'));
    assert.match(row(term, 24), /^two +15:00$/);
    assert.equal(term.x, x);
    assert.equal(term.y, y);
});

test('reset: the region is gone, attributes off, the cursor shown at the bottom', () => {
    const term = new Terminal(80, 24);
    feed(term, vt.frame({ title: 'T', status: 'S' }) + '\x1b[7m\x1b[?25l');
    feed(term, vt.RESET);
    assert.equal(term.attr, 0);
    assert.equal(term.y, 23);
    assert.equal(term.top, 0);
    assert.equal(term.bottom, 23);
    assert.notEqual(term.cursorVisible, false);
});

test('every furniture line stays inside 80 columns, and a frame is lean', () => {
    const f = vt.frame({ title: ' DIGITAL RERUN BBS  >  GAMES', titleRight: '1200 BAUD  CALLER #42 ', status: ' press a key', statusRight: 'MAIL  14:03 ' });
    for (const part of f.split(/\x1b\[\d+;\d+H/)) assert.ok(part.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b[78]/g, '').length <= 80);
    assert.ok(f.length < 160, `a frame is ${f.length} bytes`);       // it was 220 with the bars padded out in spaces
});
