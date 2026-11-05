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
    const h = { out: t => { r.text += t; }, ask: (mode, fn) => r.asks.push({ mode, fn }), leave: () => { r.left = true; }, random: () => 0.3, s };
    r.take = () => { const t = r.text; r.text = ''; return t; };
    r.say = v => { const a = r.asks.pop(); assert.ok(a, 'a prompt was waiting'); return a.fn(a.mode === 'key' ? String(v).toUpperCase() : String(v)); };
    r.wait = () => new Promise(res => setImmediate(res));
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
    assert.match(r.text, / 1 {2}PIP/);
    r.take();
    r.say('2');
    assert.match(r.text, /Voted: ED/);
    assert.match(r.text, /#+ +\d+%  <- you/);
    assert.equal(r.left, true);
    const again = rig('poll', { poll: r.s.poll });
    assert.doesNotMatch(again.text, /Your vote/);
    assert.match(again.text, /<- you/);
});

test('art door: pick a picture, get it, come back to the list', () => {
    const r = rig('art');
    assert.match(r.text, / 1 {2}PIXEL/);
    r.take();
    r.say('1');
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
    assert.match(plain(r.text), /ATDT telehack\.com\n/);
    assert.match(plain(r.text), /ATDT particlesbbs\.dyndns\.org:6400/);
    assert.match(r.text, /bridge/);
    assert.equal(r.left, true);
    for (const [host, port] of D.DIRECTORY) { assert.match(host, /^[a-z0-9.-]+$/); assert.ok(port > 0 && port < 65536); }
});

test('news desk: off without Online services; Hacker News and Wikipedia when on', async () => {
    let r = rig('news');
    assert.match(r.text, /needs the internet/);
    const urls = [];
    const fetchJson = async url => {
        urls.push(url);
        if (/topstories/.test(url)) return [11, 12, 13];
        if (/item\/(\d+)/.test(url)) return { title: `Story \u201c${RegExp.$1}\u201d caf\u00e9`, url: 'https://www.example.org/a', score: 99 };
        return { events: [{ year: 1969, text: 'Something happened.' }, { year: 1066, text: 'Another thing.' }, { year: 1900, text: 'A third.' }] };
    };
    r = rig('news', { online: () => true, fetchJson });
    r.take();
    r.say('h');
    await r.wait(); await r.wait();
    assert.match(r.text, /1\. Story "11" cafe \(example\.org\)  99 pts/);
    assert.equal(urls.length, 4);
    assert.equal(r.left, true);
    r = rig('news', { online: () => true, fetchJson });
    r.say('w');
    await r.wait();
    assert.match(urls.at(-1), /onthisday\/events\/11\/05$/);
    assert.match(r.text, /1066: Another thing\.\n1900: A third\.\n1969: Something happened\./);
});

test('news desk: a desk that does not answer is said so; only the intended addresses are called', async () => {
    const urls = [];
    const r = rig('news', { online: () => true, fetchJson: async u => { urls.push(u); throw new Error('down'); } });
    r.say('h');
    await r.wait();
    assert.match(r.text, /desk is not answering/);
    for (const u of urls) assert.match(u, /^https:\/\/(hacker-news\.firebaseio\.com|en\.wikipedia\.org)\//);
});

test('sky desk: off by default; the ISS and the sun times of a city when on, only the city sent', async () => {
    let r = rig('sky');
    assert.match(r.text, /needs the internet/);
    const urls = [];
    const fetchJson = async url => {
        urls.push(url);
        if (/wheretheiss/.test(url)) return { latitude: 46.5, longitude: -12.25, altitude: 420.1, velocity: 27600, visibility: 'daylight' };
        if (/geocoding/.test(url)) return { results: [{ name: 'Cluj-Napoca', latitude: 46.77, longitude: 23.6 }] };
        return { daily: { sunrise: ['2026-11-05T07:12'], sunset: ['2026-11-05T16:48'] } };
    };
    r = rig('sky', { online: () => true, fetchJson });
    assert.match(r.text, /sent to open-meteo\.com, nothing else/);
    r.take();
    r.say('Cluj');
    await r.wait(); await r.wait(); await r.wait();
    assert.match(r.text, /over 46\.5 N, 12\.3 W/);
    assert.match(r.text, /420 km up, 27600 km\/h, in daylight/);
    assert.match(plain(r.text), /CLUJ-NAPOCA\n {2}sunrise 07:12 {3}sunset 16:48/);
    assert.equal(r.s.store.get('city'), 'Cluj-Napoca');
    assert.match(urls[1], /name=Cluj/);
    assert.equal(r.left, true);
});

test('sky desk: no city means just the station; the ISS call is the only one made', async () => {
    const urls = [];
    const r = rig('sky', { online: () => true, fetchJson: async u => { urls.push(u); return { latitude: 1, longitude: 1, altitude: 400, velocity: 27000, visibility: 'eclipsed' }; } });
    r.say('');
    await r.wait();
    assert.match(r.text, /Earth's shadow/);
    assert.equal(urls.length, 1);
});

test('the list: ten doors with distinct keys', () => {
    assert.equal(D.DOORS.length, 10);
    assert.equal(new Set(D.DOORS.map(d => d.key)).size, 10);
    for (const d of D.DOORS) { assert.equal(typeof d.run, 'function'); assert.ok(d.title); }
});
