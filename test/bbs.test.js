'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { bbs, moon, moonArt, weatherPage, MemoryBoard, StoredBoard } = require('../js/bbs.js');

const NOW = new Date(2026, 10, 5, 14, 3);          // Thursday 5 November 2026, 14:03 local

function caller(extra = {}) {
    const memory = new Map();
    const services = {
        now: () => NOW,
        board: new MemoryBoard(),
        store: { get: k => memory.get(k) || null, set: (k, v) => memory.set(k, v) },
        online: () => false,
        fetchJson: () => Promise.reject(new Error('no network in a test')),
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
    assert.match(c.out, /ime .*oon .*ulletins .*eather .*oodbye/s);
    c.take();
    c.type('\r\n');
    assert.equal(c.out, '');
});

test('T: the date and time, from the host clock', () => {
    const c = caller();
    c.take();
    c.type('t');
    assert.match(c.out, /It is Thursday 5 November 2026, 14:03/);
});

test('M: the moon page', () => {
    const c = caller();
    c.take();
    c.type('M');
    assert.match(c.out, /% lit/);
    assert.match(c.out, /Full moon in \d+ days/);
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
    assert.match(c.out, /Posted\. Thank you\./);
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
    assert.match(c.out, /Nothing posted/);
    assert.equal((await c.services.board.list()).length, 1);
    c.take();
    c.type('b');
    await c.settle();
    c.type('q');
    assert.match(c.out, /ime .*oon/s);
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
    assert.match(c.out, /ime .*oon/s, 'the menu is back');
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
    assert.match(c.out, /WEATHER DESK.*Cluj-Napoca, RO/);
    assert.match(c.out, /Now {2}3\.2 C, Overcast, wind 2 km\/h, humidity 71%/);
    assert.match(c.out, /Sat 11-07 +-1 +8 +1\.2 .*Rain/);
    assert.equal(c.services.store.get('city'), 'Cluj-Napoca');
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
    assert.match(c.out, /No such place: Nowhereville/);
    c = caller({ online: () => true, fetchJson: () => Promise.reject(new Error('offline')) });
    c.type('wCluj\r');
    await c.settle(); await c.settle();
    assert.match(c.out, /The weather desk is not answering\./);
    assert.match(c.out, /ime .*oon/s);
});

test('weather page: the temperature range bars line up', () => {
    const page = weatherPage(GEO.results[0], FORECAST).join('\n');
    const bars = page.split('\n').filter(l => /^ (Thu|Fri|Sat|Sun) /.test(l)).map(l => l.match(/[=.]{30}/)[0]);
    assert.equal(bars.length, 4);
    assert.ok(bars[0].includes('=') && bars[0].endsWith('='), 'the warmest day reaches the top');
    assert.ok(bars[3].startsWith('=') || bars[2].startsWith('='), 'the coldest reaches the bottom');
});

test('G: goodbye hangs up; keys typed while it is busy are dropped', () => {
    const c = caller();
    c.type('g');
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
    assert.match(c.out, /ABOUT\.TXT .* bytes/);
    assert.match(c.out, /HELLO\.COM +\d+ bytes +1 blocks/);
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
    assert.match(c.out, /Transfer complete/);
    assert.match(c.out, /ime .*oon/s);
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
    assert.match(c.out, /Cancelled/);
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
    assert.match(c.out, /Nobody answered/);
});

test('download: no such file', async () => {
    const c = timed();
    c.type('f');
    await c.settle();
    c.take();
    c.type('dnothing\r');
    await c.settle();
    assert.match(c.out, /No such file/);
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
    assert.match(c.out, /MINE\.TXT received, 256 bytes/);
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
    assert.match(d.out, /Out of step/);
});

test('upload: nothing comes: it asks again, then gives up; a silence mid-block asks again; built-ins cannot be replaced', async () => {
    let c = timed();
    c.type('f'); await c.settle(); c.type('u'); c.type('z\r'); await c.settle();
    assert.deepEqual(wire(c), [21]);
    for (let i = 0; i < 5; i++) { c.fire(); assert.deepEqual(wire(c), [21]); }
    c.take();
    c.fire();
    assert.match(c.out, /Nothing came/);

    c = timed();
    c.type('f'); await c.settle(); c.type('u'); c.type('z\r'); await c.settle(); wire(c);
    c.session.send(1); c.session.send(1);
    c.fire();
    assert.deepEqual(wire(c), [21]);

    c = timed();
    c.type('f'); await c.settle(); c.take(); c.type('u'); c.type('hello.com\r'); await c.settle();
    assert.match(c.out, /Not a name I can use/);
});

test('the file area keeps uploads small: a file over the limit is refused', async () => {
    const files = new MemoryFiles();
    await assert.rejects(files.put('BIG', new Uint8Array(40000)));
    await assert.rejects(files.put('HELLO.COM', new Uint8Array(1)));
});
