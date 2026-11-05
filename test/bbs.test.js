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
