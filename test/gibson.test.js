'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { gibson, makePuzzle, caesar, dayNumber } = require('../js/gibson.js');
const { adventure } = require('../js/adventure.js');
const { twentyq, sameThing, SEED } = require('../js/twentyq.js');
const { Scores } = require('../js/scores.js');

function rig(game, extra = {}) {
    const memory = new Map();
    const scores = new Scores({ get: k => memory.get(k) || null, set: (k, v) => memory.set(k, v) });
    const r = { text: '', asks: [], finished: false, scores, memory };
    const h = { out: t => { r.text += t; }, ask: (mode, fn) => r.asks.push({ mode, fn }), random: () => 0.1, player: 'ANN', scores, now: () => new Date(Date.UTC(2026, 10, 5, 12)), store: { get: k => memory.get('s.' + k) || null, set: (k, v) => memory.set('s.' + k, v) }, ...extra };
    r.take = () => { const t = r.text; r.text = ''; return t; };
    r.say = v => { const a = r.asks.pop(); assert.ok(a, 'a prompt was waiting: ' + r.text.slice(-80)); a.fn(a.mode === 'key' ? String(v).toUpperCase() : String(v)); };
    r.wait = () => new Promise(res => setImmediate(res));
    game.play(h, () => { r.finished = true; });
    return r;
}

/* ---- gibson ---- */

test('caesar: shifts letters only, round-trips, handles negatives and wrapping', () => {
    assert.equal(caesar('ABC xyz!', 3), 'DEF abc!');
    assert.equal(caesar(caesar('Hello, World', 7), -7), 'Hello, World');
    assert.equal(caesar('A', -1), 'Z');
    assert.equal(caesar('ABC', 26), 'ABC');
});

test('the puzzle is the same all day, different on another day, and always solvable', () => {
    const a = makePuzzle(20000), b = makePuzzle(20000), c = makePuzzle(20001);
    assert.deepEqual(a, b);
    assert.notDeepEqual(a.files['NOTES.ENC'], c.files['NOTES.ENC']);
    for (let day = 19000; day < 19400; day++) {
        const p = makePuzzle(day);
        assert.ok(p.shift >= 3 && p.shift <= 22);
        assert.equal(caesar(p.files['NOTES.ENC'], -p.shift), `THE OPERATOR PASSWORD IS ${p.password}. DO NOT TELL ANYONE.`);
        assert.match(p.files['LOG.TXT'], new RegExp(`${p.shift} places`));
        assert.match(p.safe['CODE.TXT'], new RegExp(p.code));
    }
    assert.equal(dayNumber(Date.UTC(2026, 10, 5)), Math.floor(Date.UTC(2026, 10, 5) / 86400000));
});

test('gibson: the solution wins and scores; the safe is closed until you log in', () => {
    const g = rig(gibson);
    const p = makePuzzle(dayNumber(Date.UTC(2026, 10, 5, 12)));
    assert.match(g.text, /CONNECTED TO/);
    g.take();
    g.say('cat safe/code.txt');
    assert.match(g.text, /PERMISSION DENIED/);
    g.say('ls');
    assert.match(g.text, /README\.TXT +LOG\.TXT +NOTES\.ENC +SAFE\//);
    g.say('cat log.txt');
    assert.match(g.text, new RegExp(`${p.shift} places`));
    g.take();
    g.say(`rot ${p.shift} notes.enc`);
    assert.match(g.text, new RegExp(`PASSWORD IS ${p.password}`));
    g.say(`login operator ${p.password.toLowerCase()}`);
    assert.match(g.text, /WELCOME, OPERATOR/);
    g.say('ls safe');
    assert.match(g.text, /CODE\.TXT/);
    g.take();
    g.say('cat safe/code.txt');
    assert.match(g.text, new RegExp(`LAUNCH CODE ${p.code}`));
    assert.match(g.text, /THE SAFE OPENS/);
    assert.equal(g.finished, true);
    const score = g.scores.top('HACK THE GIBSON')[0].score;
    assert.ok(score >= 80 && score < 100, String(score));
});

test('gibson: three failed logins end the game; hints cost points; HELP and unknown commands cost nothing', () => {
    let g = rig(gibson);
    g.say('login operator nope'); g.say('login x y');
    assert.match(g.text, /\(2\/3\)/);
    g.say('login operator wrong');
    assert.match(g.text, /TRACE COMPLETE/);
    assert.equal(g.finished, true);
    assert.deepEqual(g.scores.top('HACK THE GIBSON'), []);

    g = rig(gibson);
    const p = makePuzzle(dayNumber(Date.UTC(2026, 10, 5, 12)));
    g.say('help'); g.say('xyzzy');
    g.take();
    g.say('hint');
    assert.match(g.text, /START WITH LS/);
    g.say(`login operator ${p.password}`);
    g.say('cat safe/code.txt');
    const score = g.scores.top('HACK THE GIBSON')[0].score;
    assert.equal(score, 100 - 3 * 2 - 15);        // the hint, the login, the cat: three commands, one hint
});

test('gibson: ROT also works on text you give it, and a wrong shift gives nonsense', () => {
    const g = rig(gibson);
    g.take();
    g.say('rot 3 KHOOR');
    assert.match(g.text, /HELLO/);
    g.say('rot');
    assert.match(g.text, /USAGE/);
    g.say('quit');
    assert.equal(g.finished, true);
});

/* ---- twenty questions ---- */

test('sameThing: articles and plurals do not matter, other things do', () => {
    assert.equal(sameThing('a cat', 'a cat'), true);
    assert.equal(sameThing('the cat', 'a cat'), true);
    assert.equal(sameThing('is it a cat?', 'a cat'), true);
    assert.equal(sameThing('cats', 'a cat'), true);
    assert.equal(sameThing('a dog', 'a cat'), false);
    assert.equal(sameThing('', 'a cat'), false);
    assert.equal(sameThing('floppy disk', 'a floppy disk'), true);
});

test('twentyq: offline it guesses an animal down the tree, and is right', () => {
    const g = rig(twentyq);                       // no sysop: straight into the animal game
    assert.match(g.text, /THINK OF AN ANIMAL/);
    g.say('x');
    g.say('n'); g.say('n'); g.say('y');            // lives in water? no. flies? no. purrs? yes -> cat
    assert.match(g.text, /IS IT A CAT/);
    g.say('y');
    assert.match(g.text, /I GOT IT IN 4 QUESTIONS/);
    g.say('n');
    assert.equal(g.finished, true);
});

test('twentyq: when it is wrong it learns, and remembers next time (kept in the store)', () => {
    let g = rig(twentyq);
    g.say('x'); g.say('n'); g.say('n'); g.say('y');   // ... a cat?
    g.say('n');                                        // no
    assert.match(g.text, /WHAT WAS IT/);
    g.say('a lion');
    assert.match(g.text, /YES FOR A LION AND NO FOR A CAT/);
    g.say('Is it very big and roars');
    assert.match(g.text, /I WILL REMEMBER/);
    const saved = JSON.parse(g.memory.get('s.twentyq'));
    assert.equal(saved.no.no.yes.q, 'Is it very big and roars?');
    g.say('n');
    assert.equal(g.finished, true);
    // a new game with that store: the new question is on the way to the lion
    const g2 = rig(twentyq, { store: { get: k => g.memory.get('s.' + k), set() {} } });
    g2.say('x'); g2.say('n'); g2.say('n'); g2.say('y');
    assert.match(g2.text, /VERY BIG AND ROARS/i);
    g2.say('y');
    assert.match(g2.text, /IS IT A LION/);
});

test('twentyq: a damaged store falls back to the seed tree', () => {
    const g = rig(twentyq, { store: { get: () => '{not json', set() {} } });
    g.say('x');
    assert.match(g.text, /DOES IT LIVE IN WATER/);
    assert.equal(typeof SEED().q, 'string');
});

test('twentyq: with the sysop connected there is a choice; the asker mode keeps the secret and checks guesses itself', async () => {
    const asked = [];
    const sysop = { connected: true, converse: async (system, history, text) => { asked.push([system, history.length, text]); return 'Yes.'; } };
    const g = rig(twentyq, { sysop, random: () => 0 });          // the secret is the first: a cat
    assert.match(g.text, /WHICH\? $/);
    g.say('2');
    assert.match(g.text, /ANIMAL\)\. ASK YES\/NO QUESTIONS/);
    g.take();
    g.say('is it alive?');
    await g.wait();
    assert.match(g.text, /Yes\./);
    assert.match(asked[0][0], /secret is a cat \(animal\)/);
    assert.match(asked[0][0], /Never say what the secret is/);
    g.take();
    g.say('guess a dog');
    await g.wait();
    assert.match(g.text, /No\./);
    assert.equal(asked.length, 1, 'a guess is not sent to the model');
    g.take();
    g.say('is it a cat');
    await g.wait();
    assert.match(g.text, /YES! IT WAS A CAT\. YOU GOT IT IN 3/);
    assert.equal(g.finished, true);
});

test('twentyq: the asker gives up after twenty questions, or on Q, and says what it was', async () => {
    const sysop = { connected: true, converse: async () => null };
    let g = rig(twentyq, { sysop, random: () => 0 });
    g.say('2');
    for (let i = 0; i < 20; i++) { g.say('is it big?'); await g.wait(); }
    assert.match(g.text, /The line crackled/);
    assert.match(g.text, /OUT OF QUESTIONS\. IT WAS A CAT/);
    assert.equal(g.finished, true);
    g = rig(twentyq, { sysop, random: () => 0 });
    g.say('2'); g.say('q');
    await g.wait();
    assert.match(g.text, /IT WAS A CAT/);
});

/* ---- the adventure ---- */

test('kettle-7: the whole story wins, in order, with a score', () => {
    const g = rig(adventure);
    assert.match(g.text, /BUNK ROOM/);
    for (const cmd of ['take torch', 'n', 'w']) g.say(cmd);
    assert.match(g.text, /STORAGE ROOM/);
    assert.match(g.text, /You see: CABLE/);
    for (const cmd of ['take cable', 'e', 'e', 'u', 'use cable']) g.say(cmd);
    assert.match(g.text, /The dish is live/);
    for (const cmd of ['d', 'e', 'search drawer', 'take key', 'drink tea']) g.say(cmd);
    g.take();
    g.say('take tea'); g.say('drink tea');
    assert.match(g.text, /Hot, sweet and strong/);
    for (const cmd of ['w', 'use key', 'take letter']) g.say(cmd);
    g.take();
    g.say('send letter');
    assert.match(g.text, /THE LETTER GOES OUT AT DAWN/);
    assert.equal(g.finished, true);
    const score = g.scores.top('KETTLE-7')[0].score;
    assert.ok(score >= 60 && score <= 105, String(score));
});

test('kettle-7: the storage room is dark without the torch; you cannot take what you cannot see', () => {
    const g = rig(adventure);
    g.say('n'); g.say('w');
    assert.match(g.text, /pitch dark/);
    g.take();
    g.say('take cable');
    assert.match(g.text, /do not see that here/);
    g.say('e'); g.say('s'); g.say('take torch'); g.say('n'); g.say('w');
    assert.match(g.text, /You see: CABLE/);
});

test('kettle-7: the letter cannot go until the dish is plugged in and the dial tuned; the dial needs the key', () => {
    const g = rig(adventure);
    g.say('n'); g.say('e'); g.say('take letter'); g.take();
    g.say('send letter');
    assert.match(g.text, /dish is unplugged/);
    g.say('examine dial');
    assert.match(g.text, /needs a small key/);
    g.take();
    g.say('tune');
    assert.match(g.text, /will not turn without a key/);
});

test('kettle-7: pixel gives away the key; inventory, drop, hints, help, quit, nonsense', () => {
    const g = rig(adventure);
    g.say('n'); g.say('e'); g.say('e');
    assert.match(g.text, /PIXEL the cat is here/);
    g.take();
    g.say('pet pixel');
    assert.match(g.text, /Pixel purrs/);
    g.say('look');
    assert.match(g.text, /TUNING KEY/, 'the key is now in view');
    g.say('i');
    assert.match(g.text, /carry nothing/);
    g.take();
    g.say('hint');
    assert.match(g.text, /storage room is dark/);
    g.say('help');
    assert.match(g.text, /N S E W U D/);
    g.say('dance');
    assert.match(g.text, /do not understand/);
    g.say('q');
    assert.equal(g.finished, true);
});

test('kettle-7: with the sysop connected a hint comes from the model, with the station\'s hint as the fallback', async () => {
    let g = rig(adventure, { sysop: { connected: true, converse: async () => 'Try the bunk room, caller.' } });
    g.take();
    g.say('hint');
    await g.wait();
    assert.match(g.text, /Try the bunk room, caller\./);
    g = rig(adventure, { sysop: { connected: true, converse: async () => null } });
    g.take();
    g.say('hint');
    await g.wait();
    assert.match(g.text, /torch might be in the bunk room/);
});
