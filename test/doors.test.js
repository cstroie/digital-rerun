'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../js/doors.js');
const ref = require('../js/reference.js');
const { Wall, Callers, Mail, Poll, QUESTIONS } = require('../js/records.js');
const { Scores } = require('../js/scores.js');

const NOW = new Date(2026, 10, 5, 14, 3);
const plain = t => t.replace(/\x1b\[[0-9;]*m/g, '');
const mem = () => { const m = new Map(); return { get: k => m.get(k) ?? null, set: (k, v) => m.set(k, v), m }; };

/** A host for one door. */
function rig(door, extra = {}) {
    const store = mem();
    let clock = NOW.getTime();
    const s = {
        store, now: () => new Date(clock), online: () => false, fetchJson: () => Promise.reject(new Error('no network')),
        wall: new Wall(store, () => clock), callers: new Callers(store, () => clock), mail: new Mail(store, () => clock), poll: new Poll(store, () => clock),
        scores: new Scores(store, () => clock), sysop: { reply: async (h, t) => `Heard you: ${t}` }, ...extra
    };
    const r = { text: '', asks: [], left: false, s, advance: ms => { clock += ms; } };
    const h = { out: t => { r.text += t; }, ask: (mode, fn, max, escape) => r.asks.push({ mode, fn, escape }), leave: () => { r.left = true; }, random: () => 0.3, s };
    r.take = () => { const t = r.text; r.text = ''; return t; };
    r.say = v => { const a = r.asks.pop(); assert.ok(a, 'a prompt was waiting'); return a.fn(a.mode === 'key' ? String(v).toUpperCase() : String(v)); };
    r.wait = () => new Promise(res => setImmediate(res));
    r.esc = () => { const a = r.asks.pop(); assert.ok(a && a.escape, 'a prompt with an Esc was waiting'); a.escape(); };
    D[door](h);
    return r;
}

/* ---- the reference tables ---- */

test('ascii chart: control names, SP, DEL; 16 rows by 8 columns', () => {
    const c = ref.asciiChart();
    assert.equal(c.length, 17);
    assert.match(c[1], /NUL +DLE +SP +0 +@ +P +` +p/);
    assert.match(c[14], /CR .*M .*m/);
    assert.match(c[16], /US .*\/ .*\? .*DEL/);
    assert.equal(ref.charName(27), 'ESC');
    assert.equal(ref.charName(65), 'A');
    assert.equal(ref.charName(127), 'DEL');
});

test('number parsing: decimal, hex in four spellings, binary, octal, a character', () => {
    for (const [text, n] of [['255', 255], ['0xFF', 255], ['$ff', 255], ['0FFh', 255], ['ffh', 255], ['0b1111', 15], ['%1010', 10], ['0o17', 15], ['@17', 15], ["'A'", 65], [' 42 ', 42]]) assert.equal(ref.parseNumber(text), n, text);
    for (const text of ['', 'hello', '12abc', '0xZZ', '1.5', '-3']) assert.equal(ref.parseNumber(text), null, text);
});

test('showing a number: dec, hex, bin grouped by 4, oct, the character, signed', () => {
    assert.deepEqual(ref.showNumber(65), ['DEC 65', 'HEX 41h  (0x41)', 'BIN 0100 0001', 'OCT 101', 'CHR A']);
    const a = ref.showNumber(200);
    assert.ok(a.includes('SIGNED -200'.replace('200', '56') + ' (8-bit)'));
    assert.ok(ref.showNumber(0x1234)[1].startsWith('HEX 1234h'));
    assert.ok(ref.showNumber(70000)[2].slice(3).replace(/ /g, '').length === 32);
});

test('the tables: BDOS functions, the BIOS jump table, opcodes', () => {
    assert.ok(ref.BDOS.find(([n, name]) => n === 9 && /PRINT STRING/.test(name)));
    assert.equal(ref.BIOS.length, 17);
    assert.equal(ref.BIOS[0][0], 'BOOT');
    assert.ok(ref.OPCODES.find(([b, a, z]) => b === 'C3 nn nn' && a === 'JMP nn' && z === 'JP nn'));
    assert.ok(ref.OPCODES.find(([b, a, z]) => b === 'DB n' && z === 'IN A,(n)'));
});

/* ---- the reference door ---- */

test('reference desk: the chart, BDOS, the converter, and out', () => {
    const r = rig('reference');
    assert.match(r.text, /REFERENCE DESK/);
    r.take();
    r.say('a');
    assert.match(r.text, /NUL.*DLE.*SP/);
    r.take(); r.say('b');
    assert.match(r.text, /9 +PRINT STRING/);
    r.take(); r.say('c');
    assert.match(r.text, /NUMBER/);
    r.take(); r.say('$FF');
    assert.match(r.text, /DEC 255/);
    r.take(); r.say('"Hi"');
    assert.match(r.text, /48 69/);
    r.take(); r.say('hello');
    assert.match(r.text, /NOT A NUMBER/);
    r.say('');
    r.say('q');
    assert.equal(r.left, true);
});

/* ---- records ---- */

test('wall: kept, newest last, 30 at most, names and lines clipped', () => {
    const store = mem();
    let t = 0;
    const w = new Wall(store, () => ++t);
    for (let i = 0; i < 35; i++) w.add('A'.repeat(20), `line ${i} ` + 'x'.repeat(100));
    const all = w.list();
    assert.equal(all.length, 30);
    assert.equal(all[0].name.length, 12);
    assert.equal(all.at(-1).text.length, 70);
    assert.match(all.at(-1).text, /^line 34/);
    assert.deepEqual(new Wall(mem()).list(), []);
});

test('callers: numbered, the length of a call kept', () => {
    const store = mem();
    let t = 1000000;
    const c = new Callers(store, () => t);
    assert.equal(c.start(), 1);
    t += 5 * 60000;
    c.end(1);
    assert.equal(c.start(), 2);
    const [a, b] = c.list();
    assert.equal(a.minutes, 5);
    assert.equal(b.minutes, null);
    for (let i = 0; i < 30; i++) c.start();
    assert.equal(c.list().length, 20);
    assert.equal(c.list().at(-1).n, 32);
});

test('mail: a note, a reply later, unread until read', () => {
    const m = new Mail(mem(), () => 5);
    const id = m.send('hello');
    assert.equal(m.unread(), 0, 'no reply yet');
    m.setReply(id, 'Hello yourself.');
    assert.equal(m.unread(), 1);
    m.markRead();
    assert.equal(m.unread(), 0);
    assert.equal(m.send('again'), 2);
    assert.deepEqual(m.list().map(x => x.id), [1, 2]);
});

test('poll: a question a week from 26, one vote a week, the tally has yours in it', () => {
    assert.equal(QUESTIONS.length, 26);
    for (const [q, o] of QUESTIONS) { assert.ok(q.length < 60); assert.equal(o.length, 4); }
    let now = Date.UTC(2026, 10, 5);
    const p = new Poll(mem(), () => now);
    const q1 = p.question();
    assert.equal(p.mine(), undefined);
    const before = p.tally();
    assert.equal(p.vote(2), true);
    assert.equal(p.vote(1), false, 'once a week');
    assert.equal(p.mine(), 2);
    assert.equal(p.tally()[2], before[2] + 1);
    now += 7 * 86400000;
    assert.notEqual(p.question().q, q1.q);
    assert.equal(p.mine(), undefined, 'a new week, a new vote');
    assert.deepEqual(p.tally(), new Poll(mem(), () => now).tally(), 'the made-up regulars are the same for everyone');
});

/* ---- the doors ---- */

test('wall door: shows the wall, writes on it with a name', () => {
    const r = rig('wall');
    assert.match(r.text, /Blank brick/);
    r.take();
    r.say('w');
    r.say('Rosa');
    r.say('Anyone on the night shift?');
    assert.match(r.text, /Chalked up/);
    assert.match(plain(r.text), /Rosa.*5 Nov 14:03\n {2}Anyone on the night shift\?/s);
    r.say('q');
    assert.equal(r.left, true);
    assert.equal(r.s.wall.list().length, 1);
});

test('wall door: control characters and empty lines are not kept', () => {
    const r = rig('wall');
    r.say('w'); r.say('\x1b[2J'); r.say('');
    assert.match(r.text, /Nothing written/);
    assert.equal(r.s.wall.list().length, 0);
});

test('callers door: the last ten, newest first, minutes or "on the line"', () => {
    const r0 = rig('callers');
    assert.match(r0.text, /No one yet/);
    const store = mem();
    let t = NOW.getTime();
    const callers = new Callers(store, () => t);
    callers.start(); t += 12 * 60000; callers.end(1); callers.start();
    const r = rig('callers', { callers });
    assert.match(plain(r.text), /#2 .*on the line\n#1 .*12 min/s);
    assert.equal(r.left, true);
});

test('scores door: each game with its top three', () => {
    const r0 = rig('scores');
    assert.match(r0.text, /tables are empty/);
    const store = mem();
    const scores = new Scores(store);
    scores.add('NIM', 'ANN', 3); scores.add('NIM', 'BOB', 5); scores.add('HANGMAN', 'CY', 2);
    const r = rig('scores', { scores });
    assert.match(plain(r.text), /HANGMAN\n {2}1\. CY +2/);
    assert.match(plain(r.text), /NIM\n {2}1\. BOB +5 .*\n {2}2\. ANN +3/);
});

test('poll door: vote once, see the bars with your choice marked, then only the results', () => {
    const r = rig('poll');
    assert.match(r.text, /THIS WEEK'S VOTE/);
    assert.match(r.text, / A {2}PIP/);
    r.take();
    r.say('B');
    assert.match(r.text, /Voted: ED/);
    assert.match(r.text, /#+ +\d+%  <- you/);
    assert.equal(r.left, true);
    const again = rig('poll', { poll: r.s.poll });
    assert.doesNotMatch(again.text, /Your vote/);
    assert.match(again.text, /<- you/);
});

test('art door: pick a picture, get it, come back to the list', () => {
    const r = rig('art');
    assert.match(r.text, / A {2}PIXEL/);
    r.take();
    r.say('A');
    assert.match(r.text, /PIXEL, NIGHT SHIFT/);
    assert.match(r.text, /ART GALLERY/);
    r.say('q');
    assert.equal(r.left, true);
    for (const [, lines] of D.ART) for (const l of lines) { assert.ok(l.length <= 60); assert.equal(/[^\x20-\x7e]/.test(l), false); }
});

test('mail door: write a note, the reply arrives, read it; the unread count goes down', async () => {
    const r = rig('mail');
    r.take();
    r.say('w');
    r.say('Is anybody there?');
    assert.match(r.text, /Sent\. The sysop answers on his next shift\. \(He is a program\.\)/);
    await r.wait();
    assert.equal(r.s.mail.unread(), 1);
    r.take();
    r.say('r');
    assert.match(plain(r.text), /you .*Is anybody there\?\nsysop {2}Heard you: Is anybody there\?/);
    assert.equal(r.s.mail.unread(), 0);
    r.say('q');
    assert.equal(r.left, true);
});

test('mail door: no replies yet is said kindly; an empty note is not sent', () => {
    const r = rig('mail');
    r.say('r');
    assert.match(r.text, /No replies yet/);
    r.say('w'); r.say('');
    assert.equal(r.s.mail.list().length, 0);
});

test('dial directory: real hosts, how to dial them, a word on the bridge', () => {
    const r = rig('directory');
    assert.match(plain(r.text), /ATDT 0101 {2}telehack\.com\n/);
    assert.match(plain(r.text), /ATDT 0107 {2}particlesbbs\.dyndns\.org:6400/);
    assert.doesNotMatch(plain(r.text), /555-0101 {2}/, 'the number is shown by its last four digits');
    assert.match(r.text, /bridge/);
    assert.equal(r.left, true);
    for (const { n, host, port } of D.DIRECTORY) { assert.match(n, /^01\d\d$/); assert.match(host, /^[a-z0-9.-]+$/); assert.ok(port > 0 && port < 65536); }
    assert.equal(new Set(D.DIRECTORY.map(e => e.n)).size, D.DIRECTORY.length, 'every number once');
});

test('news desk: off without Online services; a menu of six sources; a number shows one, and the menu waits for the next key', async () => {
    let r = rig('news');
    assert.match(r.text, /needs the internet/);
    const urls = [];
    const fetchJson = async url => {
        urls.push(url);
        if (/topstories/.test(url)) return [11, 12, 13];
        if (/item\/(\d+)/.test(url)) return { title: `Story “${RegExp.$1}” café`, url: 'https://www.example.org/a', score: 99 };
        if (/dev\.to/.test(url)) return [{ title: 'A post', user: { name: 'Ann' } }];
        return { events: [{ year: 1969, text: 'Something happened.' }, { year: 1066, text: 'Another thing.' }, { year: 1900, text: 'A third.' }] };
    };
    const fetchText = async () => '<rss><item><title>Launch</title><pubDate>Fri, 06 Nov 2026 05:05:00 +0000</pubDate></item></rss>';
    r = rig('news', { online: () => true, fetchJson, fetchText });
    const menu = plain(r.take());
    for (const name of ['Hacker News', 'Dev.to', 'Wired', 'The New York Times', 'NASA', 'On This Day']) assert.match(menu, new RegExp(name));
    assert.equal(r.asks.length, 1, 'waiting for a key');
    r.say('H');
    await r.wait(); await r.wait();
    assert.match(plain(r.text), /1\. Story "11" cafe \(example\.org\)\n {3}99 points/);
    assert.equal(urls.length, 4, 'the front page and its three stories (the mock lists three)');
    assert.equal(r.left, false, 'no exit after a source: the menu is back');
    assert.equal(r.asks.length, 1, 'and it waits for the next key');
    r.say('O');
    await r.wait();
    assert.match(urls.at(-1), /onthisday\/events\/11\/05$/);
    assert.match(plain(r.text), /1066: Another thing\.\n/);
    assert.equal(r.left, false);
    r.say('D');
    await r.wait();
    assert.match(plain(r.text), /1\. A post\n {3}by Ann/);
    assert.equal(urls.at(-1), 'https://dev.to/api/articles?top=1&per_page=8');
    r.say('N');
    await r.wait();
    assert.match(plain(r.text), /1\. Launch\n {3}Fri, 06 Nov 2026 05:05:00 UTC/);
    assert.equal(r.left, false);
    r.say('Q');
    assert.equal(r.left, true, 'Q goes back to the services');
});

test('news desk: two Esc keys go back; a key that is no source shows the menu again', async () => {
    const r = rig('news', { online: () => true, fetchJson: async () => [] });
    r.take();
    r.say('Z');
    assert.equal(r.asks.length, 1, 'no such source: the menu again');
    assert.equal(r.left, false);
    r.esc();
    assert.equal(r.left, true, 'two Esc keys leave');
});

test('news desk: a source that does not answer is said so, and the menu waits; only the intended addresses are called', async () => {
    const urls = [];
    const r = rig('news', { online: () => true, fetchJson: async u => { urls.push(u); throw new Error('down'); }, fetchText: async u => { urls.push(u); throw new Error('down'); } });
    r.take();
    r.say('H');
    await r.wait();
    assert.match(r.text, /desk is not answering/);
    assert.equal(r.asks.length, 1);
    r.say('W');
    await r.wait();
    for (const u of urls) assert.match(u, /^https:\/\/(hacker-news\.firebaseio\.com|dev\.to|www\.wired\.com|rss\.nytimes\.com|www\.nasa\.gov|en\.wikipedia\.org)\//);
    assert.equal(urls.at(-1), 'https://www.wired.com/feed/rss');
});

test('the list: fifteen doors; the keys are distinct within each menu (the S menu and the sky)', () => {
    assert.equal(D.DOORS.length, 15);
    for (const group of ['sky', 'other']) {
        const keys = D.DOORS.filter(d => (d.group === 'sky') === (group === 'sky')).map(d => d.key);
        assert.equal(new Set(keys).size, keys.length, group);
    }
    for (const d of D.DOORS) { assert.equal(typeof d.run, 'function'); assert.ok(d.title); }
});

test('earthquakes: off by default; the largest of the last day, and only the USGS feed is called', async () => {
    let r = rig('quakes');
    assert.match(r.text, /needs the internet/);
    const urls = [];
    const feed = { features: [
        { properties: { mag: 3.1, place: '12 km S of Somewhere', time: NOW.getTime() }, geometry: { coordinates: [1, 2, 10] } },
        { properties: { mag: 4.6, place: 'Off the coast', time: NOW.getTime() }, geometry: { coordinates: [1, 2, 33.4] } },
        { properties: { mag: null, place: 'no size', time: 0 }, geometry: { coordinates: [0, 0, 0] } }
    ] };
    r = rig('quakes', { online: () => true, fetchJson: async u => { urls.push(u); return feed; } });
    await r.wait();
    assert.match(r.text, /M4\.6  Off the coast  .* 33 km deep/);
    assert.ok(r.text.indexOf('M4.6') < r.text.indexOf('M3.1'), 'largest first');
    assert.ok(!/no size/.test(r.text), 'a quake with no size is left out');
    assert.deepEqual(urls, ['https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson']);
});

test('aurora: the Kp index of the last hours and the storm scale it means', async () => {
    const rows = [{ time_tag: '2026-11-06T00:00:00', Kp: 2.33 }, { time_tag: '2026-11-06T03:00:00', Kp: 5.67 }];
    const r = rig('aurora', { online: () => true, fetchJson: async () => rows });
    await r.wait();
    assert.match(plain(r.text), /Kp 5\.7  G1 minor storm   at 03:00 UTC/);
    assert.match(plain(r.text), /last hours  2\.3  5\.7/);
    assert.equal(D.gScale(2), 'G0 quiet');
    assert.equal(D.gScale(9), 'G5 extreme storm');
});

test('wikipedia: the word is the only thing sent; each answer is followed by the next prompt; Esc leaves', async () => {
    const urls = [];
    let r = rig('wiki', { online: () => true, fetchJson: async u => { urls.push(u); return { title: 'Moon', extract: 'The Moon is Earth\u2019s only natural satellite.' }; } });
    assert.match(r.text, /sent to en\.wikipedia\.org, nothing else/);
    r.take();
    r.say('Moon');
    await r.wait();
    assert.match(plain(r.text), /Moon\nThe Moon is Earth's only natural satellite\./);
    assert.equal(urls[0], 'https://en.wikipedia.org/api/rest_v1/page/summary/Moon');
    assert.equal(r.left, false, 'no key to press: the next prompt is waiting');
    assert.equal(r.asks.length, 1);
    r.say('Mars');
    await r.wait();
    assert.equal(urls[1], 'https://en.wikipedia.org/api/rest_v1/page/summary/Mars');
    assert.equal(r.left, false);
    r.esc();
    assert.equal(r.left, true, 'Esc goes back to the services');
    r = rig('wiki', { online: () => true, fetchJson: async u => { urls.push(u); return { title: 'Mercury', type: 'disambiguation' }; } });
    r.say('Mercury');
    await r.wait();
    assert.match(r.text, /Mercury can mean several things/);
    assert.equal(r.left, false);
    r = rig('wiki', { online: () => true, fetchJson: async () => { throw new Error('404'); } });
    r.say('Nothingness Xyz');
    await r.wait();
    assert.match(r.text, /No such article/);
    assert.equal(r.asks.length, 1, 'asked again after the miss');
    r.esc();
    assert.equal(r.left, true);
});

test('planets tonight: off without Online services; for a city, the planets with the time they are best in the dark; only the city goes out', async () => {
    let r = rig('tonight');
    assert.match(r.text, /needs the internet/);
    const urls = [];
    const fetchJson = async u => { urls.push(u); return { results: [{ name: 'Bucharest', latitude: 44.43, longitude: 26.10 }] }; };
    r = rig('tonight', { online: () => true, fetchJson });
    assert.match(plain(r.text), /sent to open-meteo\.com, nothing else; the sums are done here/);
    r.take();
    r.say('Bucharest');
    await r.wait(); await r.wait();
    const out = plain(r.text);
    assert.match(out, /BUCHAREST/);
    assert.match(out, /the sun is (down|up|low)/, 'the sun says how dark it is');
    for (const name of ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn']) assert.match(out, new RegExp(name));
    assert.equal(urls.length, 1, 'the geocoding only');
    assert.match(urls[0], /geocoding-api\.open-meteo\.com\/v1\/search\?name=Bucharest/);
    assert.equal(r.s.store.get('city'), 'Bucharest');
});

test('ISS passes: the orbit fetched once from CelesTrak and kept; the passes over a city', async () => {
    const TLE = 'ISS (ZARYA)\n1 25544U 98067A   26309.85320381  .00006629  00000+0  12749-3 0  9998\n2 25544  51.6327 319.0560 0007195 352.5747   7.5134 15.49194530593711\n';
    const fetched = [];
    const fetchText = async u => { fetched.push(u); return TLE; };
    const fetchJson = async () => ({ results: [{ name: 'Bucharest', latitude: 44.43, longitude: 26.10 }] });
    let r = rig('iss', { online: () => true, fetchJson, fetchText });
    r.take();
    await r.wait(); await r.wait();
    r.say('Bucharest');
    await r.wait(); await r.wait(); await r.wait();
    assert.equal(fetched.length, 1);
    assert.equal(fetched[0], 'https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=tle');
    assert.match(plain(r.text), /BUCHAREST/);
    assert.match(plain(r.text), /highest \d+ deg at \d\d:\d\d/);
    const kept = r.s.store.get('iss.orbit');
    assert.ok(kept && JSON.parse(kept).tle, 'kept in the store');
    r = rig('iss', { online: () => true, fetchJson, fetchText, store: r.s.store });
    r.take();
    await r.wait(); await r.wait();
    r.say('Bucharest');
    await r.wait(); await r.wait(); await r.wait();
    assert.equal(fetched.length, 1, 'a week-old orbit is not fetched again');
});

test('ISS: the city is asked first; then where the station is now, and its passes over the city', async () => {
    const TLE = 'ISS (ZARYA)\n1 25544U 98067A   26309.85320381  .00006629  00000+0  12749-3 0  9998\n2 25544  51.6327 319.0560 0007195 352.5747   7.5134 15.49194530593711\n';
    const fetchJson = async url => (/wheretheiss/.test(url)
        ? { latitude: 46.5, longitude: -12.25, altitude: 420.1, velocity: 27600, visibility: 'daylight' }
        : { results: [{ name: 'Cluj-Napoca', latitude: 46.77, longitude: 23.6 }] });
    const r = rig('iss', { online: () => true, fetchJson, fetchText: async () => TLE });
    await r.wait(); await r.wait();
    assert.match(plain(r.text), /sent to open-meteo\.com/, 'the city is asked first');
    assert.ok(!/THE STATION NOW/.test(plain(r.text)), 'no station before the city');
    r.say('Cluj');
    await r.wait(); await r.wait(); await r.wait();
    assert.match(plain(r.text), /THE STATION NOW[\s\S]*over 46\.5 N, 12\.3 W/);
    assert.match(plain(r.text), /420 km up, 27600 km\/h, in daylight/);
    assert.match(plain(r.text), /CLUJ-NAPOCA/);
    assert.match(plain(r.text), /highest \d+ deg at \d\d:\d\d/);
});

const zipStored = files => {
    const zlib = require('node:zlib');
    const parts = [], central = [];
    let at = 0;
    for (const [name, body] of Object.entries(files)) {
        const raw = Buffer.from(body, 'utf8'), nameB = Buffer.from(name, 'utf8');
        const head = Buffer.alloc(30);
        head.writeUInt32LE(0x04034b50, 0); head.writeUInt32LE(raw.length, 18); head.writeUInt32LE(raw.length, 22); head.writeUInt16LE(nameB.length, 26);
        parts.push(head, nameB, raw);
        const dir = Buffer.alloc(46);
        dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt32LE(raw.length, 20); dir.writeUInt32LE(raw.length, 24); dir.writeUInt16LE(nameB.length, 28); dir.writeUInt32LE(at, 42);
        central.push(dir, nameB);
        at += 30 + nameB.length + raw.length;
    }
    const cd = Buffer.concat(central), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(at, 16);
    void zlib;
    return new Uint8Array(Buffer.concat([...parts, cd, end]));
};

const OPDS = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>Pride and Prejudice</title><author><name>Jane Austen</name></author>
<link href="https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice/downloads/x.epub?source=feed" length="1" rel="http://opds-spec.org/acquisition/open-access" title="Recommended compatible epub" type="application/epub+zip" />
<link href="https://standardebooks.org/x_advanced.epub?source=feed" rel="http://opds-spec.org/acquisition/open-access" title="Advanced epub" type="application/epub+zip" /></entry>
<entry><title>Emma &amp; Friends</title><author><name>Jane Austen</name></author><link href="https://example.org/no.azw3" title="Amazon Kindle azw3" /></entry>
</feed>`;

test('books: the feed gives the title, the author and the recommended EPUB; a book without one is left out', () => {
    const found = D.parseOpds(OPDS);
    assert.equal(found.length, 1);
    assert.equal(found[0].title, 'Pride and Prejudice');
    assert.equal(found[0].author, 'Jane Austen');
    assert.match(found[0].url, /\.epub\?source=feed$/);
    assert.ok(!/advanced/.test(found[0].url));
});

test('books: off without Online services; a search (only the words sent), a list, a book read a page at a time, then the list again', async () => {
    let r = rig('books');
    assert.match(r.text, /needs the internet/);
    const urls = [];
    const saved = new Map();
    const epub = zipStored({
        'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
        'OEBPS/content.opf': '<package><metadata><dc:title>Pride and Prejudice</dc:title></metadata><manifest><item id="c1" href="one.xhtml"/></manifest><spine><itemref idref="c1"/></spine></package>',
        'OEBPS/one.xhtml': '<html><body><p>It is a truth universally acknowledged.</p></body></html>',
    });
    r = rig('books', {
        online: () => true,
        fetchText: async u => { urls.push(u); return OPDS; },
        fetchBytes: async u => { urls.push(u); return epub; },
        files: { put: async (name, bytes) => saved.set(name, bytes) },
    });
    assert.match(plain(r.text), /sent to standardebooks\.org, nothing else/);
    r.take();
    r.say('austen');
    await r.wait(); await r.wait();
    assert.equal(urls[0], 'https://standardebooks.org/feeds/opds/all?query=austen&page=1&per-page=12');
    assert.match(plain(r.text), /\[A\] Pride and Prejudice - Jane Austen/);
    r.take();
    r.say('A');
    await r.wait(); await r.wait(); await r.wait();
    assert.match(urls[1], /\.epub\?source=feed$/);
    assert.match(plain(r.text), /Pride and Prejudice\nby Jane Austen/);
    assert.match(plain(r.text), /It is a truth universally acknowledged\./);
    assert.match(plain(r.text), /Saved in Files: PRIDE_01\.TXT/);
    const file = saved.get('PRIDE_01.TXT');
    assert.ok(file, 'the book is in the file area');
    assert.equal(file[file.length - 1], 0x1A, 'ended by ^Z');
    assert.match(Buffer.from(file).toString('latin1'), /It is a truth universally acknowledged\.\r\n/);
    assert.equal(r.left, false, 'back to the list, not out');
    r.say('Q');
    assert.equal(r.left, true);
});

test('books: a long book is kept as parts of at most 32K, each on a line end and ended by ^Z', async () => {
    const saved = new Map();
    const line = 'x'.repeat(99);
    const text = Array.from({ length: 1000 }, (_, i) => `${i} ${line}`).join('\n');
    const names = await D.saveBook({ s: { files: { put: async (n, b) => saved.set(n, b) } } }, { title: 'The Big Book', text });
    assert.deepEqual(names, ['THEBI_01.TXT', 'THEBI_02.TXT', 'THEBI_03.TXT', 'THEBI_04.TXT'], 'about 106K, four parts');
    for (const n of names) {
        const b = saved.get(n);
        assert.ok(b.length <= 32768, n);
        assert.equal(b[b.length - 1], 0x1A, n);
    }
    const all = names.map(n => Buffer.from(saved.get(n).subarray(0, -1)).toString('latin1')).join('');
    assert.equal(all.split('\r\n').filter(Boolean).length, 1000, 'every line kept, once');
});
