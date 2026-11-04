'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Terminal, ATTR } = require('../js/terminal.js');

const term = s => { const t = new Terminal(); t.writeString(s); return t; };

test('text, CR LF, backspace and tabs', () => {
    const t = term('abc\r\nxy\bz\tq');
    assert.equal(t.text().split('\n').slice(0, 2).join('|'), 'abc|xz      q');
    assert.deepEqual([t.x, t.y], [9, 1]);
});

test('cursor addressing and erasing', () => {
    const t = term('hello world\x1b[1;7H\x1b[K\x1b[3;5HX\x1b[2A\x1b[1D!');
    assert.equal(t.text().split('\n')[0], 'hell!');      // back to row 1, column 5
    assert.equal(t.text().split('\n')[2], '    X');
    t.writeString('\x1b[2J');
    assert.equal(t.text().trim(), '');
});

test('wraps at column 80 and scrolls at the bottom', () => {
    const t = new Terminal();
    t.writeString('x'.repeat(81));
    assert.deepEqual([t.x, t.y], [1, 1]);
    for (let i = 0; i < 30; i++) t.writeString(`line ${i}\r\n`);
    assert.equal(t.text().split('\n')[22], 'line 29');
});

test('scroll region, insert and delete lines', () => {
    const t = new Terminal();
    for (let i = 0; i < 5; i++) t.writeString(`\x1b[${i + 1};1Hrow${i}`);
    t.writeString('\x1b[2;4r\x1b[4;1H\n');           // scroll rows 2-4 only
    assert.deepEqual(t.text().split('\n').slice(0, 5), ['row0', 'row2', 'row3', '', 'row4']);
    t.writeString('\x1b[1;1H\x1b[r\x1b[1L');
    assert.equal(t.text().split('\n')[1], 'row0');
});

test('attributes and status replies', () => {
    const t = term('\x1b[1;7mA\x1b[0mB');
    assert.equal(t.attrs[0][0], ATTR.BOLD | ATTR.REVERSE);
    assert.equal(t.attrs[0][1], 0);
    const replies = [];
    t.reply = b => replies.push(String.fromCharCode(...b));
    t.writeString('\x1b[6n');
    assert.deepEqual(replies, ['\x1b[1;3R']);
});

const adm = s => { const t = new Terminal(80, 24, 'adm3a'); t.writeString(s); return t; };
const row = (t, r) => t.text().split('\n')[r];

test('ADM-3A: cursor address, clear, home and the control-key moves', () => {
    const t = adm('junk\x1a\x1b=%(X');                       // clear, then row 5 col 8 (32+5, 32+8)
    assert.equal(row(t, 0), '');
    assert.equal(row(t, 5), '        X');
    t.writeString('\x1eA');                                   // home
    assert.equal(row(t, 0), 'A');
    t.writeString('\n\x0c\x0cB\x0bC\x08\x08D');               // down, right twice, up, left
    assert.equal(row(t, 0), 'A  DC');                        // LF keeps the column
    assert.equal(row(t, 1), '   B');
});

test('ADM-3A: wraps at once at column 80 and scrolls at the bottom', () => {
    const t = adm('\x1b=7 ' + 'x'.repeat(80));                // last row, then 80 characters
    assert.deepEqual([t.x, t.y], [0, 23]);
    assert.equal(row(t, 22), 'x'.repeat(80));                 // the screen scrolled up a line
});

test('ADM-3A: erase, insert and delete, and attributes', () => {
    const t = adm('abcdef\r\nline2\r\nline3');
    t.writeString('\x1e\x0c\x0c\x1bT');                       // erase from column 3 of row 1
    assert.equal(row(t, 0), 'ab');
    t.writeString('\x1b=! \x1bE');                            // row 2: insert a line
    assert.deepEqual([row(t, 1), row(t, 2)], ['', 'line2']);
    t.writeString('\x1bR');                                   // and delete it again
    assert.equal(row(t, 1), 'line2');
    t.writeString('\x1e\x1bWZ');                              // delete a character, then type
    assert.equal(row(t, 0), 'Z');
    t.writeString('\x1bG4R\x1bG0N\x1b)H\x1b(\x1bB3U\x1bC3');
    assert.equal(t.attrs[0][1], ATTR.REVERSE);
    assert.equal(t.attrs[0][2], 0);
    assert.equal(t.attrs[0][3], ATTR.DIM);
    assert.equal(t.attrs[0][4], ATTR.UNDERLINE);
    assert.equal(t.attr, 0);
});

test('switching modes keeps the screen; VT100 codes are text to an ADM-3A', () => {
    const t = new Terminal();
    t.writeString('kept');
    t.mode = 'adm3a';
    t.writeString('\x1b[2J');                                 // not a VT100 now: ESC [ is ignored, "2J" printed
    assert.equal(row(t, 0), 'kept2J');
    t.mode = 'vt100';
    t.writeString('\x1b[2J');
    assert.equal(t.text().trim(), '');
    assert.equal(structuredClone(t.getState()).mode, 'vt100');
});

test('VT52: moves stop at the edges, addressing, erase, identify, no wrap', () => {
    const t = new Terminal(80, 24, 'vt52');
    const replies = [];
    t.reply = b => replies.push(String.fromCharCode(...b));
    t.writeString('\x1bYS!ab');                               // 'S' is row 51: clamped to 23
    assert.deepEqual([t.x, t.y], [3, 23]);
    t.writeString('\x1bH\x1bA\x1bD');                         // home; up and left do nothing
    assert.deepEqual([t.x, t.y], [0, 0]);
    t.writeString('\x1bY#%X\x1bB\x1bC');                      // row 3, column 5
    assert.equal(row(t, 3), '     X');
    assert.deepEqual([t.x, t.y], [7, 4]);
    t.writeString('\x1bK\x1bH\x1bJ');
    assert.equal(t.text().trim(), '');
    t.writeString('\x1bY ' + String.fromCharCode(32 + 79) + 'abc');   // last column is overwritten
    assert.deepEqual([t.x, t.y], [79, 0]);
    assert.equal(t.chars[0][79], 99);
    t.writeString('\x1bZ');
    assert.deepEqual(replies, ['\x1b/Z']);
});

test('VT52: reverse line feed scrolls down, LF scrolls up, ESC < becomes a VT100', () => {
    const t = new Terminal(80, 24, 'vt52');
    t.writeString('top\x1bH\x1bI');
    assert.deepEqual([row(t, 0), row(t, 1)], ['', 'top']);
    t.writeString('\x1bY7 \n');                               // last row, then LF: the screen scrolls up
    assert.equal(t.y, 23);
    assert.equal(row(t, 0), 'top');
    t.writeString('\x1b<\x1b[2J');
    assert.equal(t.mode, 'vt100');
    assert.equal(t.text().trim(), '');
});

test('erase to end of line keeps reverse video (a status bar), other erases do not', () => {
    const t = term('\x1b[7m Room\x1b[1;10H\x1b[K\x1b[0m');
    assert.equal(t.attrs[0][0], ATTR.REVERSE);
    assert.equal(t.attrs[0][20], ATTR.REVERSE);
    assert.equal(t.attrs[0][79], ATTR.REVERSE);
    t.writeString('\x1b[2;1H\x1b[7m\x1b[J\x1b[0m');
    assert.equal(t.attrs[1][0], 0);
    t.writeString('\x1b[1;1H\x1b[0m\x1b[K');
    assert.equal(t.attrs[0][0], 0);
});

test('ADM-3A: erase to end of line keeps reverse video, erase to end of screen does not', () => {
    const t = adm('\x1bB0 Room\x1b=  \x1bT\x1bC0\x1b=!!\x1bB0\x1bY\x1bC0');
    assert.equal(t.attrs[0][0], ATTR.REVERSE);
    assert.equal(t.attrs[0][79], ATTR.REVERSE);
    assert.equal(t.attrs[1][0], 0);
});

test('cursor hiding: VT100 ?25, ADM B4/C4 and TeleVideo . n, VT52 Atari f/e and H19 x5/y5', () => {
    const seen = (mode, codes) => {
        const t = new Terminal(80, 24, mode);
        return codes.map(c => { t.writeString(c); return t.cursorVisible; });
    };
    assert.deepEqual(seen('vt100', ['\x1b[?25l', 'A', '\x1b[?25h']), [false, false, true]);
    assert.deepEqual(seen('adm3a', ['\x1bC4', '\x1bB4', '\x1b.0', '\x1b.2', '\x1b.9']), [false, true, false, true, true]);
    assert.deepEqual(seen('vt52', ['\x1bf', '\x1be', '\x1bx5', '\x1by5', '\x1bx1']), [false, true, false, true, true]);
    const t = new Terminal(80, 24, 'vt52');                     // a mode byte that isn't 5 is taken, not printed
    t.writeString('\x1bx1ok');
    assert.equal(t.text().split('\n')[0].trim(), 'ok');
    const r = new Terminal(80, 24, 'vt52');                     // and reset shows it again
    r.writeString('\x1bf');
    r.reset();
    assert.equal(r.cursorVisible, true);
});
