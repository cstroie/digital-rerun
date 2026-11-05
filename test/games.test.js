'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../js/games.js');
const { GAMES } = T;
const { Scores } = require('../js/scores.js');

const game = name => GAMES.find(g => g.name === name);
const mulberry = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

/** A host for one game: records what is said, lets the test answer the prompts. */
function rig(name, random = mulberry(1)) {
    const memory = new Map();
    const scores = new Scores({ get: k => memory.get(k) || null, set: (k, v) => memory.set(k, v) });
    const r = { text: '', asks: [], finished: false, scores };
    const h = { out: t => { r.text += t; }, ask: (mode, fn) => r.asks.push({ mode, fn }), random, player: 'ANN', scores };
    r.take = () => { const t = r.text; r.text = ''; return t; };
    r.say = v => { const a = r.asks.pop(); assert.ok(a, 'a prompt was waiting'); a.fn(a.mode === 'key' ? String(v).toUpperCase() : String(v)); };
    r.waiting = () => r.asks.length > 0;
    game(name).play(h, () => { r.finished = true; });
    return r;
}

test('there are eight games, each with a name and play()', () => {
    assert.deepEqual(GAMES.map(g => g.name), ['BLACK JACK', 'HANGMAN', 'CODEBREAKER', 'NIM', 'BATTLESHIP', 'HUNT THE WUMPUS', 'LUNAR LANDER', "FALKEN'S MAZE"]);
    for (const g of GAMES) assert.equal(typeof g.play, 'function');
});

/* ---- black jack ---- */

test('hand values: face cards, aces soft and hard, bust', () => {
    const v = c => T.handValue(c);
    assert.deepEqual(v(['KS', 'QH']), { total: 20, soft: false });
    assert.deepEqual(v(['AS', 'KH']), { total: 21, soft: true });
    assert.deepEqual(v(['AS', 'AH']), { total: 12, soft: true });
    assert.deepEqual(v(['AS', '9H', '5D']), { total: 15, soft: false });
    assert.equal(v(['10S', '9H', '5D']).total, 24);
    assert.equal(T.isBlackjack(['AS', 'KH']), true);
    assert.equal(T.isBlackjack(['7S', '7H', '7D']), false);
});

test('a deck has 52 different cards', () => {
    const d = T.newDeck(mulberry(5));
    assert.equal(d.length, 52);
    assert.equal(new Set(d).size, 52);
});

test('black jack: bets, plays, and the bank moves by the bet (or 3 to 2); RETURN cashes out and scores', () => {
    const g = rig('BLACK JACK', mulberry(7));
    let bank = 100;
    for (let round = 0; round < 40 && !g.finished; round++) {
        g.take();
        g.say('10');
        const text0 = g.take();
        if (/BLACKJACK|PUSH/.test(text0) && !g.waiting()) { continue; }
        for (let k = 0; k < 12 && g.waiting() && g.asks.at(-1).mode === 'key' && !/BANKROLL/.test(g.text); k++) g.say('S');
        if (g.waiting() && g.asks.at(-1).mode === 'line') break;
    }
    assert.match(g.text + 'x', /BANKROLL \$\d+/);
    const m = /BANKROLL \$(\d+)/.exec(g.text);
    bank = Number(m[1]);
    assert.ok(bank > 0);
    g.say('');
    assert.equal(g.finished, true);
    assert.match(g.text, /CASHING OUT/);
    assert.equal(g.scores.top('BLACK JACK')[0].score, bank);
});

test('black jack: a bet the house does not take is refused', () => {
    const g = rig('BLACK JACK');
    g.take();
    g.say('500');
    assert.match(g.text, /DOES NOT TAKE THAT BET/);
    g.take();
    g.say('0');
    assert.match(g.text, /DOES NOT TAKE THAT BET/);
});

/* ---- hangman ---- */

const aim = (list, word) => () => (list.indexOf(word) + 0.5) / list.length;

test('hangman: guess a word, the streak grows; six wrong letters hang you and score the streak', () => {
    const g = rig('HANGMAN', aim(T.WORDS, 'MODEM'));
    g.take();
    for (const k of 'MODE') g.say(k);
    assert.match(g.text, /YOU GOT IT! STREAK 1/);
    g.take();
    // the next word is random from the same stream (always the same index: MODEM is used, so another is chosen): lose it
    for (const k of 'WXZJVK') { if (g.waiting()) g.say(k); }
    assert.match(g.text, /HANGED\. THE WORD WAS/);
    assert.equal(g.finished, true);
    assert.equal(g.scores.top('HANGMAN')[0].score, 1);
});

test('hangman: a letter twice or a non-letter is ignored; Q gives up and shows the word', () => {
    const g = rig('HANGMAN', aim(T.WORDS, 'BAUD'));
    g.take();
    g.say('B');
    const before = g.take();
    assert.match(before, /B _ _ _/);
    g.say('B');
    g.say('7');
    g.say('q');
    assert.match(g.text, /THE WORD WAS BAUD/);
    assert.equal(g.finished, true);
});

test('hangman: every word is in capitals, A to Z only', () => {
    for (const w of T.WORDS) assert.match(w, /^[A-Z]+$/);
    assert.equal(new Set(T.WORDS).size, T.WORDS.length);
});

/* ---- codebreaker ---- */

test('peg scores: black for place, white for colour, no double counting', () => {
    assert.deepEqual(T.pegScore('ABCD', 'ABCD'), { black: 4, white: 0 });
    assert.deepEqual(T.pegScore('ABCD', 'DCBA'), { black: 0, white: 4 });
    assert.deepEqual(T.pegScore('AABB', 'ABAB'), { black: 2, white: 2 });
    assert.deepEqual(T.pegScore('AAAA', 'AFFF'), { black: 1, white: 0 });
    assert.deepEqual(T.pegScore('ABCD', 'EEEE'), { black: 0, white: 0 });
});

test('codebreaker: a wrong guess scores, a right one wins with a score; bad input is refused', () => {
    const g = rig('CODEBREAKER', () => 0.01);                  // the code is AAAA
    g.take();
    g.say('AB');
    assert.match(g.text, /4 LETTERS/);
    g.take();
    g.say('abff');
    assert.match(g.text, /ABFF {2}X\n/);
    g.take();
    g.say('AAAA');
    assert.match(g.text, /CRACKED IN 2\. SCORE 90/);
    assert.equal(g.finished, true);
    assert.equal(g.scores.top('CODEBREAKER')[0].score, 90);
});

test('codebreaker: out of tries reveals the code', () => {
    const g = rig('CODEBREAKER', () => 0.01);
    for (let i = 0; i < 10; i++) g.say('FFFF');
    assert.match(g.text, /OUT OF TRIES\. THE CODE WAS AAAA/);
    assert.equal(g.finished, true);
});

/* ---- nim ---- */

test('nim: the computer move leaves a nim-sum of zero whenever it can', () => {
    for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) for (let c = 0; c < 6; c++) {
        const heaps = [a, b, c];
        if (!heaps.some(Boolean)) continue;
        const sum = a ^ b ^ c;
        const [i, k] = T.nimMove(heaps);
        assert.ok(k >= 1 && k <= heaps[i]);
        const after = heaps.slice(); after[i] -= k;
        if (sum) assert.equal(after[0] ^ after[1] ^ after[2], 0, heaps.join());
    }
});

test('nim: the perfect first move (take 1 from C) wins against it; a poor one loses', () => {
    let g = rig('NIM');
    g.take();
    g.say('C 1');                                        // 3 5 6: nim-sum 0
    for (let guard = 0; guard < 10 && !/AGAIN/.test(g.text); guard++) {
        const m = /A:[ ]?((?:\* ?)*)\nB:[ ]?((?:\* ?)*)\nC:[ ]?((?:\* ?)*)\n/.exec(g.text);
        const heaps = m.slice(1).map(x => (x.match(/\*/g) || []).length);
        g.take();
        const [i, k] = T.nimMove(heaps);
        g.say(`${'ABC'[i]} ${k}`);
    }
    assert.match(g.text, /YOU WIN/);
    g.say('n');
    assert.equal(g.finished, true);
    assert.equal(g.scores.top('NIM')[0].score, 1);

    g = rig('NIM');
    g.say('A 3');                                        // 0 5 7: the computer has the win
    for (let guard = 0; guard < 12 && !/WOPR WINS/.test(g.text); guard++) g.say('B 1');
    assert.match(g.text, /WOPR TAKES/);
});

test('nim: a move that is not there is refused', () => {
    const g = rig('NIM');
    g.take();
    g.say('A 9');
    assert.match(g.text, /A HEAP LETTER AND A NUMBER THAT IS THERE/);
    g.say('D 1');
    g.say('hello');
    assert.equal(g.finished, false);
});

/* ---- battleship ---- */

test('fleets: four ships of 4, 3, 3 and 2 squares, on the grid, not touching each other\'s squares', () => {
    for (let seed = 1; seed < 30; seed++) {
        const fleet = T.placeFleet(mulberry(seed));
        assert.deepEqual(fleet.map(s => s.cells.length), [4, 3, 3, 2]);
        const all = fleet.flatMap(s => s.cells);
        assert.equal(new Set(all).size, all.length);
        for (const s of fleet) {
            assert.ok(s.cells.every(c => c >= 0 && c < 64));
            const rows = new Set(s.cells.map(c => c >> 3)), cols = new Set(s.cells.map(c => c & 7));
            assert.ok(rows.size === 1 || cols.size === 1, 'a straight line');
        }
    }
});

test('battleship: cells are read as A1 to H8, anything else is -1', () => {
    assert.equal(T.parseCell('A1'), 0);
    assert.equal(T.parseCell(' b 5 '), 12);
    assert.equal(T.parseCell('H8'), 63);
    assert.equal(T.parseCell('I1'), -1);
    assert.equal(T.parseCell('A9'), -1);
    assert.equal(T.parseCell(''), -1);
});

test('battleship: a sweep of the whole grid ends the game one way or the other, with the boards shown', () => {
    const g = rig('BATTLESHIP', mulberry(3));
    assert.match(g.text, /YOUR SHOTS.*YOUR FLEET/s);
    for (let i = 0; i < 64 && !g.finished; i++) g.say(`${'ABCDEFGH'[i >> 3]}${(i & 7) + 1}`);
    assert.equal(g.finished, true);
    assert.match(g.text, /YOU WIN|WOPR WINS/);
});

test('battleship: a square twice or nonsense is refused; Q strikes the colours', () => {
    const g = rig('BATTLESHIP', mulberry(4));
    g.say('A1');
    g.take();
    g.say('A1');
    assert.match(g.text, /A FRESH SQUARE/);
    g.say('zz');
    g.say('q');
    assert.equal(g.finished, true);
});

/* ---- wumpus ---- */

test('the cave: twenty rooms, three tunnels each, every tunnel goes both ways', () => {
    assert.equal(T.CAVE.length, 20);
    T.CAVE.forEach((tunnels, i) => {
        assert.equal(tunnels.length, 3);
        for (const t of tunnels) assert.ok(T.CAVE[t - 1].includes(i + 1), `${i + 1}-${t}`);
    });
});

test('a new cave puts everything in different rooms', () => {
    for (let seed = 1; seed < 40; seed++) {
        const c = T.makeCave(mulberry(seed));
        const all = [c.you, c.wumpus, ...c.bats, ...c.pits];
        assert.equal(new Set(all).size, 6);
        assert.ok(all.every(r => r >= 1 && r <= 20));
    }
});

test('wumpus: warnings, and a good shot wins (cave with everything in order: you 1, wumpus 2, bats 3 4, pits 5 6)', () => {
    const g = rig('HUNT THE WUMPUS', () => 0.9999);
    assert.match(g.text, /YOU ARE IN ROOM .*1.* TUNNELS LEAD TO 2, 5, 8/);
    assert.match(g.text, /I SMELL A WUMPUS!/);
    assert.match(g.text, /I FEEL A DRAFT\./);
    g.say('S 2');
    assert.match(g.text, /YOU GOT THE WUMPUS/);
    assert.equal(g.finished, true);
    assert.ok(g.scores.top('HUNT THE WUMPUS')[0].score > 90);
});

test('wumpus: a pit kills, a wall of text is refused, a room you cannot reach is refused', () => {
    let g = rig('HUNT THE WUMPUS', () => 0.9999);
    g.take();
    g.say('M 5');
    assert.match(g.text, /FELL IN A PIT/);
    assert.equal(g.finished, true);
    g = rig('HUNT THE WUMPUS', () => 0.9999);
    g.take();
    g.say('M 20');
    assert.match(g.text, /NOT POSSIBLE/);
    g.say('hello');
    assert.match(g.text, /M 5 MOVES/);
    g.say('q');
    assert.equal(g.finished, true);
});

test('wumpus: random play always ends, and never throws', () => {
    for (let seed = 1; seed < 25; seed++) {
        const r = mulberry(seed), g = rig('HUNT THE WUMPUS', mulberry(seed + 100));
        for (let i = 0; i < 300 && !g.finished; i++) {
            const here = /ROOM \S*?(\d+)\S* ?\./.exec(g.text.replace(/\x1b\[[0-9;]*m/g, '').split('YOU ARE IN ROOM').pop() && 'ROOM ' + g.text.replace(/\x1b\[[0-9;]*m/g, '').split('YOU ARE IN ROOM ').pop());
            const tunnels = (/TUNNELS LEAD TO ([\d, ]+)\./.exec(g.text.split('YOU ARE IN ROOM').pop()) || [, '2'])[1].split(',').map(Number);
            g.take();
            g.say(r() < 0.3 ? `S ${tunnels[Math.floor(r() * 3)]}` : `M ${tunnels[Math.floor(r() * 3)]}`);
            void here;
        }
        assert.equal(g.finished, true, `seed ${seed}`);
    }
});

/* ---- lander ---- */

test('lander: a step: free fall gains speed, burning slows it, fuel is spent, the burn is limited', () => {
    const { gravity: g, thrust: th, maxBurn } = T.LANDER;
    const s0 = { alt: 300, vel: -15, fuel: 280 };
    const a = T.lunarStep(s0, 0);
    assert.ok(Math.abs(a.vel - (-15 - g)) < 1e-9);
    assert.ok(Math.abs(a.alt - (300 + (-15 + -15 - g) / 2)) < 1e-9);
    assert.equal(a.fuel, 280);
    const b = T.lunarStep(s0, maxBurn);
    assert.ok(Math.abs(b.vel - (-15 + maxBurn * th - g)) < 1e-9);
    assert.equal(b.fuel, 280 - maxBurn);
    assert.equal(T.lunarStep(s0, 99).fuel, 280 - maxBurn, 'at most the maximum');
    assert.equal(T.lunarStep({ alt: 10, vel: 0, fuel: 3 }, 20).fuel, 0, 'at most what is left');
    assert.equal(T.lunarStep(s0, -5).fuel, 280, 'no negative burn');
});

/** A policy that lands softly with the shipped numbers (so the game can be won): brake late and hard, then hover. */
function safeBurns() {
    let s = { alt: T.LANDER.alt, vel: T.LANDER.vel, fuel: T.LANDER.fuel };
    const { gravity: g, thrust: th, maxBurn } = T.LANDER;
    const burns = [];
    for (let t = 0; t < 300; t++) {
        const need = (s.vel * s.vel) / (2 * (maxBurn * th - g));
        let b = s.alt <= need + 16 ? maxBurn : 0;
        if (s.vel > -2 && s.alt < 60) b = Math.round(g / th);
        b = Math.min(b, s.fuel);
        const n = T.lunarStep(s, b);
        burns.push(b);
        if (n.alt <= 0) return { burns, speed: -(s.vel + (n.vel - s.vel) * (s.alt / (s.alt - n.alt))), fuel: n.fuel };
        s = n;
    }
    return null;
}

test('lander: the game can be won: a policy exists that touches down softly with fuel to spare', () => {
    const r = safeBurns();
    assert.ok(r, 'it lands');
    assert.ok(r.speed <= T.LANDER.safe, `speed ${r.speed}`);
    assert.ok(r.fuel > 10, `fuel ${r.fuel}`);
});

test('lander: and falling with no burn is a crash', () => {
    let s = { alt: T.LANDER.alt, vel: T.LANDER.vel, fuel: T.LANDER.fuel };
    while (s.alt > 0) s = T.lunarStep(s, 0);
    assert.ok(-s.vel > 10);
});

test('lander: that policy, played through the game, is a perfect landing that scores the fuel left', () => {
    const r = safeBurns();
    const g = rig('LUNAR LANDER');
    for (const b of r.burns) g.say(String(b));
    assert.match(g.text, /A PERFECT LANDING! SCORE \d+/);
    assert.equal(g.finished, true);
    assert.ok(g.scores.top('LUNAR LANDER')[0].score > 10);
});

test('lander: playing a policy to touchdown ends the game with a verdict; a crash is a crash', () => {
    const g = rig('LUNAR LANDER');
    for (let i = 0; i < 300 && !g.finished; i++) g.say('0');                // free fall
    assert.match(g.text, /TOUCHDOWN/);
    assert.match(g.text, /NEW CRATER/);
    assert.equal(g.finished, true);
});

test('lander: bad input is asked again; Q aborts', () => {
    const g = rig('LUNAR LANDER');
    g.say('abc');
    assert.match(g.text, /A NUMBER/);
    g.say('q');
    assert.equal(g.finished, true);
});

/* ---- maze ---- */

test('the maze: every square reachable, no loops (a perfect maze)', () => {
    for (let seed = 1; seed < 20; seed++) {
        const open = T.makeMaze(mulberry(seed));
        const edges = open.reduce((n, s) => n + s.size, 0) / 2;
        assert.equal(edges, 35, 'a spanning tree of 36 squares');
        const seen = new Set([0]), q = [0];
        const D = { N: -6, S: 6, E: 1, W: -1 };
        while (q.length) { const at = q.pop(); for (const d of open[at]) { const to = at + D[d]; if (!seen.has(to)) { seen.add(to); q.push(to); } } }
        assert.equal(seen.size, 36);
    }
});

test('maze: walk the solution, get out, and the move count is scored (low is better)', () => {
    const seed = 11;
    const open = T.makeMaze(mulberry(seed));
    const D = { N: -6, S: 6, E: 1, W: -1 };
    const prev = new Map([[0, null]]), q = [0];
    while (q.length) { const at = q.shift(); for (const d of open[at]) { const to = at + D[d]; if (!prev.has(to)) { prev.set(to, [at, d]); q.push(to); } } }
    const path = [];
    for (let at = 35; prev.get(at); at = prev.get(at)[0]) path.unshift(prev.get(at)[1]);
    const g = rig("FALKEN'S MAZE", mulberry(seed));
    for (const d of path) g.say(d);
    assert.match(g.text, new RegExp(`OUT IN ${path.length} MOVES`));
    assert.equal(g.finished, true);
    assert.equal(g.scores.top("FALKEN'S MAZE")[0].score, path.length);
});

test('maze: a wall is a wall; Q gives up', () => {
    const g = rig("FALKEN'S MAZE", mulberry(2));
    const open = T.makeMaze(mulberry(2));
    const wall = ['N', 'W'].find(d => !open[0].has(d));            // the corner has no way north or west
    g.say(wall);
    assert.match(g.text, /A WALL/);
    g.say('q');
    assert.equal(g.finished, true);
});

/* ---- scores ---- */

test('scores: best first, ties by age, top ten, low-is-better tables, a place or 0', () => {
    const memory = new Map();
    let t = 0;
    const s = new Scores({ get: k => memory.get(k) || null, set: (k, v) => memory.set(k, v) }, () => ++t);
    assert.equal(s.add('G', 'A', 10), 1);
    assert.equal(s.add('G', 'B', 30), 1);
    assert.equal(s.add('G', 'C', 10), 3, 'a tie ranks behind the earlier');
    for (let i = 0; i < 12; i++) s.add('G', 'X', 100 + i);
    assert.equal(s.top('G').length, 10);
    assert.equal(s.add('G', 'LOW', 1), 0, 'below the top ten: no place');
    assert.equal(s.add('M', 'A', 20, true), 1);
    assert.equal(s.add('M', 'B', 10, true), 1, 'fewer is better here');
    assert.deepEqual(s.top('M').map(e => e.name), ['B', 'A']);
    assert.deepEqual(s.games().sort(), ['G', 'M']);
    assert.deepEqual(s.top('none'), []);
    assert.equal(s.top('G')[0].name.length <= 12, true);
});
