'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { bbs, moon, moonArt, weatherPage, MemoryBoard, StoredBoard } = require('../js/bbs.js');
const { wopr } = require('../js/wopr.js');
const fortunes = require('../js/fortune.js');

const NOW = new Date(2026, 10, 5, 14, 3);
/** The text of a screen: the sequences gone, a cursor move a line break. */
const plain = t => t.replace(/\x1b\[\d+;\d+H/g, '\n').replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b[78]/g, '');          // Thursday 5 November 2026, 14:03 local

function caller(extra = {}) {
    const memory = new Map();
    const services = {
        now: () => NOW,
        board: new MemoryBoard(),
        store: { get: k => memory.get(k) || null, set: (k, v) => memory.set(k, v) },
        online: () => false,
        fetchJson: () => Promise.reject(new Error('no network in a test')),
        wopr,
        fortunes,
        ...extra
    };
    const c = { out: '', hung: false, services };
    const link = { receive: t => { c.out += typeof t === 'string' ? t : String.fromCharCode(...t); }, hangup: () => { c.hung = true; } };
    c.session = bbs(services)(link);
    c.type = text => { for (const ch of text) c.session.send(ch.charCodeAt(0)); };
    c.take = () => { const o = c.out; c.out = ''; return o; };
    c.settle = () => new Promise(r => setImmediate(r));
    return c;
}

test('the moon: the 2000 reference is new, a known full moon is full', () => {
    assert.equal(moon(new Date(Date.UTC(2000, 0, 6, 18, 14))).name, 'New moon');
    const full = moon(new Date(Date.UTC(2024, 0, 25, 17, 54)));
    assert.equal(full.name, 'Full moon');
    assert.ok(full.lit > 0.99);
    const first = moon(new Date(Date.UTC(2024, 0, 18, 3, 52)));          // first quarter
    assert.equal(first.name, 'First quarter');
    assert.ok(Math.abs(first.lit - 0.5) < 0.1);
    assert.ok(full.toNew > 14 && full.toNew < 16);
});

test('the moon drawn: new is dark, full is lit, a waxing quarter is lit on the right', () => {
    const lit = rows => rows.join('').split('#').length - 1;
    assert.equal(lit(moonArt(0)), 0);
    assert.equal(moonArt(0.5).join('').includes('.'), false);
    const q = moonArt(0.25);
    assert.equal(q.length, 11);
    const mid = q[5];
    assert.ok(mid.indexOf('#') > mid.indexOf('.'), 'dark on the left, lit on the right');
    const w = moonArt(0.75)[5];
    assert.ok(w.indexOf('#') < w.indexOf('.'), 'waning: lit on the left');
});

test('it greets, shows the menu, and answers a bare RETURN with nothing', () => {
    const c = caller();
    assert.match(c.out, /DIGITAL RERUN BBS/);
    for (const key of ['[T] time', '[M] moon', '[B] bulletins', '[F] files', '[C] chat', '[W] weather', '[G] games', '[O] fortune', '[S] services', '[Q] quit']) assert.ok(plain(c.out).includes(key), key);
    c.take();
    c.type('\r\n');
    assert.equal(c.out, '');
});

test('T: the date and time, from the host clock', () => {
    const c = caller();
    c.take();
    c.type('t');
    assert.match(c.out, /Thursday 5 November 2026/);
    assert.match(c.out, /###/, 'the clock in big digits');
});

test('M: the moon page', () => {
    const c = caller();
    c.take();
    c.type('M');
    assert.match(c.out, /% lit/);
    assert.match(c.out, /full moon in \d+ days/);
});

test('B: an empty board; posting; reading it back; backspace and limits', async () => {
    const c = caller();
    c.take();
    c.type('b');
    await c.settle();
    assert.match(c.out, /0 on the board/);
    assert.match(c.out, /Nothing yet/);
    c.take();
    c.type('p');
    assert.match(c.out, /Your name\?/);
    c.take();
    c.type('Rosa\x08\x08sa');
    assert.equal(c.take(), 'Rosa\b \b\b \bsa');                 // echoed, backspace erases on the screen
    c.type('\r');
    c.type('Anyone on the night shift? \x01\x1b[2J<script>' + 'x'.repeat(100) + '\r');
    await c.settle();
    assert.match(c.out, /bulletin posted/);
    const posts = await c.services.board.list();
    assert.equal(posts.length, 1);
    assert.equal(posts[0].name, 'Rosa');
    assert.equal(posts[0].when, NOW.getTime());
    assert.ok(posts[0].text.length <= 70);
    assert.ok(!/[\x00-\x1f]/.test(posts[0].text), 'control characters are not kept');
    c.take();
    c.type('b');
    await c.settle();
    assert.match(c.out, /1 on the board/);
    assert.match(c.out, /Rosa/);
    assert.match(c.out, /Anyone on the night shift/);
});

test('B: a post with no name is ANON, one with no text is not posted, Q goes back', async () => {
    const c = caller();
    c.type('b');
    await c.settle();
    c.type('p\r' + 'hello\r');
    await c.settle();
    assert.equal((await c.services.board.list())[0].name, 'ANON');
    c.take();
    c.type('b');
    await c.settle();
    c.type('p\r\r');
    await c.settle();
    assert.match(c.out, /nothing posted/);
    assert.equal((await c.services.board.list()).length, 1);
    c.take();
    c.type('b');
    await c.settle();
    c.type('q');
    assert.match(plain(c.out), /\[T\] time/);
});

test('the board keeps the last 50 and shows the last 8', async () => {
    const c = caller();
    for (let i = 0; i < 60; i++) await c.services.board.add({ when: 0, name: 'N', text: `message ${i}` });
    assert.equal((await c.services.board.list()).length, 50);
    c.take();
    c.type('b');
    await c.settle();
    assert.match(c.out, /message 59/);
    assert.match(c.out, /message 52/);
    assert.doesNotMatch(c.out, /message 51\b/);
});

test('the stored board survives a new caller and a bad store', async () => {
    const data = new Map();
    const storage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
    const a = new StoredBoard(storage);
    await a.add({ when: 1, name: 'A', text: 'one' });
    assert.deepEqual((await new StoredBoard(storage).list()).map(p => p.text), ['one']);
    storage.setItem('digitalrerun.bbs.board', '{not json');
    assert.deepEqual(await new StoredBoard(storage).list(), []);
});

test('W: off by default: the desk does not answer, and nothing is asked', () => {
    let asked = 0;
    const c = caller({ fetchJson: () => { asked++; return Promise.resolve({}); } });
    c.take();
    c.type('w');
    assert.match(c.out, /weather desk is not answering/);
    assert.match(c.out, /Online services/);
    assert.equal(asked, 0);
    assert.match(plain(c.out), /\[T\] time/, 'the menu is back');
});

const GEO = { results: [{ name: 'Cluj-Napoca', country_code: 'RO', latitude: 46.77, longitude: 23.6 }] };
const FORECAST = {
    current: { temperature_2m: 3.2, relative_humidity_2m: 71, wind_speed_10m: 2.3, weather_code: 3 },
    daily: {
        time: ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'],
        temperature_2m_max: [10, 9.5, 8.3, 8.1], temperature_2m_min: [2.7, 0.6, -1.4, -1.9],
        precipitation_sum: [0, 0, 1.2, 0], weather_code: [3, 3, 61, 45]
    }
};

test('W: online: asks only for the city, shows the forecast, remembers the city', async () => {
    const urls = [];
    const c = caller({ online: () => true, fetchJson: url => { urls.push(url); return Promise.resolve(url.includes('geocoding') ? GEO : FORECAST); } });
    c.take();
    c.type('w');
    assert.match(c.out, /sent to open-meteo\.com, nothing else/);
    c.type('Cluj\r');
    await c.settle(); await c.settle();
    assert.equal(urls.length, 2);
    assert.match(urls[0], /^https:\/\/geocoding-api\.open-meteo\.com\/v1\/search\?name=Cluj&count=1$/);
    assert.match(urls[1], /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=46\.77&longitude=23\.6&/);
    assert.match(c.out, /WEATHER DESK.*Cluj-Napoca, RO/s);
    assert.match(c.out, /Now {2}3\.2 C, Overcast, wind 2 km\/h, humidity 71%/);
    assert.match(c.out, /Sat 11-07 +-1 +8 +1\.2 .*Rain/);
    assert.equal(c.services.store.get('city'), 'Cluj-Napoca');
    c.type(' ');                                              // a key leaves the forecast
    c.take();
    c.type('w');
    assert.match(c.out, /RETURN for Cluj-Napoca/);
    c.type('\r');
    await c.settle(); await c.settle();
    assert.equal(urls.length, 4);
    assert.match(urls[2], /name=Cluj-Napoca/);
});

test('W: an unknown place, and a desk that does not answer', async () => {
    let c = caller({ online: () => true, fetchJson: () => Promise.resolve({}) });
    c.type('wNowhereville\r');
    await c.settle(); await c.settle();
    assert.match(c.out, /no such place, Nowhereville/);
    c = caller({ online: () => true, fetchJson: () => Promise.reject(new Error('offline')) });
    c.type('wCluj\r');
    await c.settle(); await c.settle();
    assert.match(c.out, /weather desk is not answering/);
    assert.match(plain(c.out), /\[T\] time/);
});

test('weather page: the temperature range bars line up', () => {
    const page = weatherPage(GEO.results[0], FORECAST).join('\n');
    const bars = page.split('\n').filter(l => /^ (Thu|Fri|Sat|Sun) /.test(l)).map(l => l.match(/[=.]{30}/)[0]);
    assert.equal(bars.length, 4);
    assert.ok(bars[0].includes('=') && bars[0].endsWith('='), 'the warmest day reaches the top');
    assert.ok(bars[3].startsWith('=') || bars[2].startsWith('='), 'the coldest reaches the bottom');
});

test('Q: quit says goodbye and hangs up; keys typed while it is busy are dropped', () => {
    const c = caller();
    c.type('q');
    assert.match(c.out, /Thank you for calling/);
    assert.equal(c.hung, true);
    c.take();
    c.type('t');
    assert.equal(c.out, '');
});

test('a closed session says nothing more', () => {
    const c = caller();
    c.session.close();
    c.take();
    c.type('t');
    assert.equal(c.out, '');
});

/* ---------- the file area and XMODEM ---------- */

const { MemoryFiles, BUILTIN_FILES, xmodemBlock, crc16, cpmName } = require('../js/bbs.js');

/** A caller whose timers are ours: advance them by hand. */
function timed(extra = {}) {
    const timers = [];
    let id = 0;
    const c = caller({
        files: new MemoryFiles(),
        after: (fn, ms) => { timers.push({ id: ++id, fn, ms }); return id; },
        cancel: h => { const i = timers.findIndex(t => t.id === h); if (i >= 0) timers.splice(i, 1); },
        ...extra
    });
    c.timers = timers;
    c.fire = () => { const t = timers.shift(); if (t) t.fn(); return !!t; };
    c.bytes = [];
    const receive = c.session.link.receive;
    c.session.link.receive = t => { if (typeof t === 'string') receive(t); else c.bytes.push(...t); };
    return c;
}
const wire = c => c.bytes.splice(0);

test('cpmName: 8.3, upper case, nothing odd', () => {
    assert.equal(cpmName('hello.com'), 'HELLO.COM');
    assert.equal(cpmName(' term '), 'TERM');
    assert.equal(cpmName('toolongname.txt'), null);
    assert.equal(cpmName('a/b.txt'), null);
    assert.equal(cpmName('x.abcd'), null);
});

test('crc16 is the XMODEM one', () => {
    assert.equal(crc16(Buffer.from('123456789')), 0x31C3);
});

test('F: lists the built-in files', async () => {
    const c = timed();
    c.take();
    c.type('f');
    await c.settle();
    assert.match(c.out, /ABOUT\.TXT +\d+ +\d+/);
    assert.match(c.out, /HELLO\.COM +\d+ +1\r\n/);
});

test('download: waits for NAK, sends blocks, ACK moves on, EOT ends it (checksum)', async () => {
    const c = timed();
    c.type('f');
    await c.settle();
    c.type('d');
    c.type('hello.com\r');
    await c.settle();
    assert.match(c.out, /Start your XMODEM receive now/);
    assert.deepEqual(wire(c), []);
    c.session.send(21);                                       // NAK
    const b1 = wire(c);
    assert.equal(b1.length, 132);
    assert.deepEqual(b1, xmodemBlock(BUILTIN_FILES['HELLO.COM'], 1, false));
    assert.equal(b1[0], 1);
    assert.equal(b1[1] + b1[2], 255);
    assert.deepEqual(b1.slice(3, 12), [0x11, 0x09, 0x01, 0x0E, 0x09, 0xCD, 0x05, 0x00, 0xC9]);
    assert.equal(b1[3 + 128 - 1], 26, 'the last block is padded with ^Z');
    c.session.send(6);                                        // ACK: that was the only block
    assert.deepEqual(wire(c), [4]);                           // EOT
    c.take();
    c.session.send(6);
    assert.match(c.out, /HELLO\.COM: sent/);
    assert.match(plain(c.out), /\[T\] time/);
});

test('download: a CRC receiver asking with C gets a CRC block; a NAK repeats the block; CAN stops it', async () => {
    const c = timed();
    c.type('f');
    await c.settle();
    c.type('dabout.txt\r');
    await c.settle();
    c.session.send(67);
    const b = wire(c);
    assert.equal(b.length, 133);
    assert.equal((b[131] << 8) | b[132], crc16(b.slice(3, 131)));
    c.session.send(21);
    assert.deepEqual(wire(c), b, 'resent');
    c.take();
    c.session.send(24);
    assert.match(c.out, /cancelled/);
    assert.deepEqual(wire(c), [24, 24]);
});

test('download: a file of three blocks; the receiver that never answers is given up on', async () => {
    const files = new MemoryFiles();
    await files.put('BIG.DAT', Uint8Array.from({ length: 300 }, (_, i) => i & 0xFF));
    let c = timed({ files });
    c.type('f');
    await c.settle();
    c.type('dbig.dat\r');
    await c.settle();
    c.session.send(21);
    for (let n = 1; n <= 3; n++) { const b = wire(c); assert.equal(b[1], n); c.session.send(6); }
    assert.deepEqual(wire(c), [4]);

    c = timed({ files });
    c.type('f');
    await c.settle();
    c.type('dbig.dat\r');
    await c.settle();
    c.take();
    assert.ok(c.fire());                                      // nobody answered
    assert.match(c.out, /nobody answered/);
});

test('download: no such file', async () => {
    const c = timed();
    c.type('f');
    await c.settle();
    c.take();
    c.type('dnothing\r');
    await c.settle();
    assert.match(c.out, /no such file/);
});

/** What a checksum XMODEM sender puts on the wire for `data`. */
const sendFile = (c, data) => {
    for (let n = 1; n <= Math.ceil(data.length / 128); n++) for (const b of xmodemBlock(Uint8Array.from(data), n, false)) c.session.send(b);
};

test('upload: NAK asks, blocks are ACKed, EOT stores the file', async () => {
    const c = timed();
    c.type('f');
    await c.settle();
    c.type('u');
    c.type('mine.txt\r');
    await c.settle();
    assert.deepEqual(wire(c), [21], 'the first NAK');
    const data = Array.from({ length: 200 }, (_, i) => 65 + (i % 26));
    sendFile(c, data);
    assert.deepEqual(wire(c), [6, 6]);
    c.session.send(4);
    await c.settle();
    assert.deepEqual(wire(c), [6]);
    const got = await c.services.files.get('MINE.TXT');
    assert.equal(got.length, 256);
    assert.deepEqual([...got.slice(0, 200)], data);
    assert.equal(got[200], 26);
    assert.match(c.out, /MINE\.TXT: received, 256 bytes/);
});

test('upload: a bad checksum is NAKed, a repeated block is ACKed and kept once, a gap aborts', async () => {
    const c = timed();
    c.type('f');
    await c.settle();
    c.type('u');
    c.type('x\r');
    await c.settle();
    wire(c);
    const b1 = xmodemBlock(Uint8Array.from([1, 2, 3]), 1, false);
    const bad = b1.slice(); bad[bad.length - 1] ^= 0xFF;
    for (const b of bad) c.session.send(b);
    assert.deepEqual(wire(c), [21]);
    for (const b of b1) c.session.send(b);
    assert.deepEqual(wire(c), [6]);
    for (const b of b1) c.session.send(b);                    // the sender missed the ACK
    assert.deepEqual(wire(c), [6]);
    c.session.send(4);
    await c.settle();
    assert.equal((await c.services.files.get('X')).length, 128, 'kept once');

    const d = timed();
    d.type('f'); await d.settle(); d.type('u'); d.type('y\r'); await d.settle(); wire(d);
    for (const b of xmodemBlock(Uint8Array.from([1]), 3, false)) d.session.send(b);
    assert.match(d.out, /out of step/);
});

test('upload: nothing comes: it asks again, then gives up; a silence mid-block asks again; built-ins cannot be replaced', async () => {
    let c = timed();
    c.type('f'); await c.settle(); c.type('u'); c.type('z\r'); await c.settle();
    assert.deepEqual(wire(c), [21]);
    for (let i = 0; i < 5; i++) { c.fire(); assert.deepEqual(wire(c), [21]); }
    c.take();
    c.fire();
    assert.match(c.out, /nothing came/);

    c = timed();
    c.type('f'); await c.settle(); c.type('u'); c.type('z\r'); await c.settle(); wire(c);
    c.session.send(1); c.session.send(1);
    c.fire();
    assert.deepEqual(wire(c), [21]);

    c = timed();
    c.type('f'); await c.settle(); c.take(); c.type('u'); c.type('hello.com\r'); await c.settle();
    assert.match(c.out, /not a name I can use/);
});

test('the file area keeps uploads small: a file over the limit is refused', async () => {
    const files = new MemoryFiles();
    await assert.rejects(files.put('BIG', new Uint8Array(40000)));
    await assert.rejects(files.put('HELLO.COM', new Uint8Array(1)));
});

/* ---------- the sysop ---------- */

test('C: without a sysop service he is away', () => {
    const c = caller();
    c.take();
    c.type('c');
    assert.match(c.out, /stepped away/);
    assert.match(plain(c.out), /\[T\] time/);
});

test('C: a chat, with the history passed on, and /BYE back to the menu', async () => {
    const asked = [];
    const c = caller({ sysop: { reply: async (history, text) => { asked.push([history.length, text]); return `Heard: ${text}.\nSecond line.`; } } });
    c.take();
    c.type('c');
    assert.match(c.out, /talking to the sysop, a program/);
    assert.match(c.out, /you>\x1b\[0m /);
    c.take();
    c.type('hello there\r');
    assert.match(c.out, /sysop>\x1b\[0m \(typing\)/);
    await c.settle();
    assert.match(c.out, /\r\x1b\[K\x1b\[1msysop>\x1b\[0m Heard: hello there\./);
    assert.match(c.out, /Heard: hello there\. Second line\./, 'the reply is set in lines of its own');
    assert.match(c.out, /you>\x1b\[0m $/);
    c.type('and again\r');
    await c.settle();
    assert.deepEqual(asked, [[0, 'hello there'], [2, 'and again']]);
    c.take();
    c.type('/bye\r');
    assert.match(plain(c.out), /chat with the sysop ended/);
    assert.match(plain(c.out), /\[T\] time/);
});

test('C: an empty line asks again, control characters are not sent, a failing sysop does not break the chat', async () => {
    const asked = [];
    const c = caller({ sysop: { reply: async (h, text) => { asked.push(text); if (text === 'boom') throw new Error('x'); return text === 'blank' ? '' : 'ok'; } } });
    c.type('c');
    c.take();
    c.type('\r');
    assert.match(c.out, /you>\x1b\[0m $/);
    c.type('a\x01b\x1b[2J\r');
    await c.settle();
    assert.equal(asked[0], 'ab[2J');
    c.take();
    c.type('boom\r');
    await c.settle();
    assert.match(c.out, /The line crackled/);
    c.take();
    c.type('blank\r');
    await c.settle();
    assert.match(c.out, /The line crackled/);
});

test('C: a reply that comes after the caller has gone is dropped', async () => {
    let release;
    const c = caller({ sysop: { reply: () => new Promise(r => { release = r; }) } });
    c.type('c');
    c.type('hello\r');
    c.session.close();
    c.take();
    release('late');
    await c.settle();
    assert.equal(c.out, '');
});

/* ---------- WOPR and the fortunes ---------- */

test('G: the games room is WOPR; leaving it comes back to the menu', () => {
    const c = caller();
    c.take();
    c.type('g');
    assert.match(c.out, /W\.O\.P\.R\./);
    assert.match(c.out, /LOGON: $/);
    c.type('ann\r');
    assert.match(c.out, /SHALL WE PLAY A GAME\?/);
    c.take();
    c.type('list games\r');
    assert.match(c.out, /TIC-TAC-TOE/);
    c.take();
    c.type('logoff\r');
    assert.match(c.out, /CONNECTION TERMINATED/);
    assert.match(plain(c.out), /\[G\] games/);
    c.take();
    c.type('t');
    assert.match(c.out, /Thursday 5 November/, 'the menu works again');
});

test('G: a game of tic-tac-toe through the BBS', () => {
    const c = caller();
    c.type('g\rx\r');
    c.type('tic\r');
    c.type('1');
    c.take();
    c.type('5');
    assert.match(c.out, /WOPR PLAYS/);
});

test('G: without the games room module it is locked', () => {
    const c = caller({ wopr: undefined });
    c.take();
    c.type('g');
    assert.match(c.out, /games room is locked/);
});

test('O: a fortune, numbered; Y another, a different one; anything else back to the menu', () => {
    const c = caller({ random: () => 0 });
    c.take();
    c.type('o');
    assert.match(c.out, /fortune 1 of \d+/);
    const first = c.take();
    c.type('y');
    assert.match(c.out, /fortune 2 of \d+/, 'not the same one again');
    assert.notEqual(plain(c.out), plain(first), 'a different fortune');
    c.take();
    c.type('n');
    assert.match(plain(c.out), /\[T\] time/);
});

test('O: a fortune is wrapped to the screen', () => {
    const c = caller({ fortunes: { FORTUNES: ['word '.repeat(40).trim()], pick: () => 0 } });
    c.take();
    c.type('o');
    for (const line of plain(c.out).split(/\r?\n/)) assert.ok(line.length <= 80, line);
    assert.match(plain(c.out), /\|  word word/, 'in a box');
});

test('O: without the cookie jar it says so', () => {
    const c = caller({ fortunes: undefined });
    c.take();
    c.type('o');
    assert.match(c.out, /cookie jar is empty/);
});

test('G: the games of js/games.js join WOPR\'s list, and a game plays through the BBS with scores kept', () => {
    const { GAMES } = require('../js/games.js');
    const { Scores } = require('../js/scores.js');
    const memory = new Map();
    const scores = new Scores({ get: k => memory.get(k) || null, set: (k, v) => memory.set(k, v) });
    const c = caller({ games: GAMES, scores });
    c.type('g');
    c.type('ann\r');
    c.take();
    c.type('list\r');
    for (const name of ['BLACK JACK', 'HANGMAN', 'CODEBREAKER', 'NIM', 'BATTLESHIP', 'HUNT THE WUMPUS', 'LUNAR LANDER', "FALKEN'S MAZE"]) assert.ok(c.out.includes(name), name);
    c.take();
    c.type('codebreaker\r');
    assert.match(c.out, /CODEBREAKER\. I HOLD A CODE/);
    c.type('q\r');
    assert.match(c.out, /THE CODE WAS/);
    c.type(' ');                                              // a key, then WOPR's page again
    assert.match(c.out, /SHALL WE PLAY ANOTHER GAME/);
});

/* ---------- the services ---------- */

test('S: the services menu runs a door and comes back to it; Q returns to the main menu', () => {
    const D = require('../js/doors.js');
    const { Wall, Callers, Mail, Poll } = require('../js/records.js');
    const memory = new Map();
    const store = { get: k => memory.get(k) ?? null, set: (k, v) => memory.set(k, v) };
    const c = caller({ doors: D.DOORS, wall: new Wall(store), callers: new Callers(store), mail: new Mail(store), poll: new Poll(store), store });
    c.take();
    c.type('s');
    assert.match(plain(c.out), /SERVICES/);
    assert.match(plain(c.out), /\[R\] Reference desk/);
    assert.match(plain(c.out), /\[D\] Dial directory/);
    c.take();
    c.type('d');
    assert.match(plain(c.out), /DIAL DIRECTORY/);
    assert.match(plain(c.out), /ATDT 0101 {2}telehack\.com/);
    c.take();
    c.type(' ');                                              // a key at the end of the directory...
    c.type(' ');                                              // ...and one at the end of its page
    assert.match(plain(c.out), /\[R\] Reference desk/, 'back at the services menu');
    c.take();
    c.type('q');
    assert.match(plain(c.out), /\[T\] time/);
});

test('S: without the doors module the desk is closed', () => {
    const c = caller();
    c.take();
    c.type('s');
    assert.match(c.out, /services desk is closed/);
});

test('sign-on: the caller number and the last call; mail from the sysop is announced; the call length is kept at goodbye', () => {
    const { Callers, Mail } = require('../js/records.js');
    const memory = new Map();
    const store = { get: k => memory.get(k) ?? null, set: (k, v) => memory.set(k, v) };
    const callers = new Callers(store), mail = new Mail(store);
    const first = caller({ callers, mail });
    assert.match(plain(first.out), /caller #1, welcome/);
    assert.doesNotMatch(plain(first.out), /last call was/);
    first.type('q');
    assert.equal(callers.list()[0].minutes, 1);
    const id = mail.send('hi'); mail.setReply(id, 'hello');
    const second = caller({ callers, mail });
    assert.match(plain(second.out), /caller #2, the last call was \d+ \w{3} \d\d:\d\d/);
    assert.match(plain(second.out), /mail: a reply from the sysop/);
    assert.match(plain(second.out), /MAIL/.source ? /new reply/ : /x/, 'the main page tells of it too');
});

test('a dropped call still counts: closing the session ends it', () => {
    const { Callers } = require('../js/records.js');
    const memory = new Map();
    const store = { get: k => memory.get(k) ?? null, set: (k, v) => memory.set(k, v) };
    const callers = new Callers(store);
    const c = caller({ callers });
    c.session.close();
    assert.equal(callers.list()[0].minutes, 1);
});

test('F, L: the software library lists the shelf, names a disk\'s files, and sends one by XMODEM', async () => {
    const { MemoryFiles, xmodemBlock } = require('../js/bbs.js');
    const asked = [];
    const library = {
        list: async () => [{ id: 'z', name: 'A GAME', files: ['PLAY.COM', 'GAME.DAT'] }],
        get: async (id, name) => { asked.push([id, name]); return Uint8Array.from({ length: 200 }, (_, i) => i); }
    };
    const timers = [];
    const c = caller({ files: new MemoryFiles(), library, after: fn => timers.push(fn), cancel() {} });
    const plain = t => t.replace(/\x1b\[[0-9;]*m/g, '');
    c.type('f');
    await c.settle();
    assert.match(plain(c.out), /Library, /);
    c.take();
    c.type('l');
    await c.settle();
    assert.match(plain(c.out), /FILES {2}> {2}LIBRARY/);
    assert.match(plain(c.out), / 1 {2}A GAME +2 files/);
    c.take();
    c.type('1\r');
    await c.settle();
    assert.match(plain(c.out), /PLAY\.COM *GAME\.DAT/);
    c.take();
    c.type('play.com\r');
    await c.settle();
    assert.deepEqual(asked, [['z', 'PLAY.COM']]);
    assert.match(c.out, /PLAY\.COM: 2 blocks/);
    const bytes = [];
    c.session.link.receive = t => { if (typeof t !== 'string') bytes.push(...t); };
    c.session.send(21);
    assert.deepEqual(bytes, xmodemBlock(Uint8Array.from({ length: 200 }, (_, i) => i), 1, false));
});

test('F, L: no library service, no L; a missing file or an unreachable shelf is said so', async () => {
    const { MemoryFiles } = require('../js/bbs.js');
    let c = caller({ files: new MemoryFiles() });
    c.type('f');
    await c.settle();
    assert.doesNotMatch(c.out, /ibrary/);
    c = caller({ files: new MemoryFiles(), library: { list: async () => [{ id: 'z', name: 'D', files: ['A.COM'] }], get: async () => { throw new Error('offline'); } } });
    c.type('f'); await c.settle(); c.type('l'); await c.settle(); c.type('1\r'); await c.settle();
    c.take();
    c.type('nope\r'); await c.settle();
    assert.match(plain(c.out), /no such file/);
    c = caller({ files: new MemoryFiles(), library: { list: async () => [{ id: 'z', name: 'D', files: ['A.COM'] }], get: async () => { throw new Error('offline'); } } });
    c.type('f'); await c.settle(); c.type('l'); await c.settle(); c.type('1\r'); await c.settle(); c.take();
    c.type('a.com\r'); await c.settle();
    assert.match(plain(c.out), /would not give it up/);
});

test('the main page follows the line: lean at 300 baud, the whole console the first time at 1200, always on a fast line', () => {
    const slow = caller({ baud: () => 300 });
    assert.doesNotMatch(plain(slow.out), /SYSTEM/);
    assert.match(plain(slow.out), /\[T\] time/, 'the menu is there');
    const mid = caller({ baud: () => 1200 });
    assert.match(plain(mid.out), /SYSTEM/);
    assert.match(plain(mid.out), /line +1200 baud, 8N1/);
    assert.match(plain(mid.out), /LOG/);
    mid.take();
    mid.session.menu();
    assert.doesNotMatch(plain(mid.out), /SYSTEM/, 'coming back on a slow line: only the menu');
    assert.ok(mid.out.length < 700, `a lean menu: ${mid.out.length} characters`);
    const fast = caller({ baud: () => 9600 });
    fast.take();
    fast.session.menu();
    assert.match(plain(fast.out), /SYSTEM/);
    assert.match(plain(fast.out), /9600 baud/);
});

test('the main page: a title bar, a status bar, a region between, nothing wider than 79 columns', () => {
    const c = caller();
    assert.match(c.out, /^\x1b\[r.*\x1b\[1;1H.*DIGITAL RERUN BBS {2}> {2}MAIN/s);
    assert.match(c.out, /\x1b\[2;23r/);
    for (const part of c.out.split(/\x1b\[\d+;\d+H/).slice(3)) assert.ok(plain(part).length <= 79, plain(part));
    c.take();
    c.type('t');
    assert.match(plain(c.out), /TIME/);
    assert.match(c.out, /\x1b\[24;1H.*press any key/);
});

test('every page has its bars; goodbye puts the terminal right again', () => {
    const c = caller();
    for (const key of ['t', ' ', 'm', ' ']) { c.take(); c.type(key); assert.match(c.out, /\x1b\[2;23r/, key); }
    c.take();
    c.type('q');
    assert.ok(c.out.includes('\x1b[r\x1b[0m\x1b[?25h'), 'the scroll region is reset');
    assert.equal(c.hung, true);
});

test('C: a long reply never runs past column 79: the lines are set after the "sysop> " prompt, a continuation indented under it', async () => {
    const long = 'Kettle-7 is the relay station. Signals drift, I tune them, the letters get delivered. Pixel sits on the keyboard. ' + 'Words and more words. '.repeat(6);
    const c = caller({ sysop: { reply: async () => long } });
    c.type('c');
    c.take();
    c.type('how is your cat doing?\r');
    await c.settle();
    const lines = plain(c.out.replace(/[^\n]*\r\x1b\[K/, '')).split(/\r?\n/).filter(l => l.trim());     // the "(typing)" is written over
    assert.ok(lines.length >= 4, 'wrapped to several lines');
    for (const line of lines) assert.ok(line.length <= 79, `${line.length}: ${line}`);
    assert.ok(lines.some(l => /^ {7}\S/.test(l)), 'a continuation is indented under the first line');
    assert.ok(!lines.some(l => /^\S{1,3}$/.test(l)), 'no stray one-word line like a word broken at the margin');
});
