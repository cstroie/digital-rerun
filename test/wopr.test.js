'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { wopr, UNLOADED, result, bestMoves, value } = require('../js/wopr.js');

/** A host that records what is said and lets the test answer the prompts. */
function rig(random = () => 0.3) {
    const h = { text: '', asks: [], left: false };
    h.host = {
        out: t => { h.text += t; },
        ask: (mode, fn, max) => { h.asks.push({ mode, fn, max }); },
        leave: () => { h.left = true; },
        random
    };
    h.take = () => { const t = h.text; h.text = ''; return t; };
    h.say = value => { const a = h.asks.pop(); assert.ok(a, 'a prompt was waiting'); a.fn(a.mode === 'key' ? String(value).toUpperCase() : value); };
    h.mode = () => h.asks[h.asks.length - 1] && h.asks[h.asks.length - 1].mode;
    wopr(h.host);
    return h;
}

test('it asks for a logon, greets by name, and asks the question', () => {
    const w = rig();
    assert.match(w.text, /W\.O\.P\.R\./);
    assert.match(w.text, /LOGON: $/);
    assert.equal(w.asks[0].max, 12);
    w.take();
    w.say('falken');
    assert.match(w.text, /GREETINGS, FALKEN\./);
    assert.match(w.text, /SHALL WE PLAY A GAME\?/);
});

test('a blank or odd logon is still greeted; nothing odd is echoed', () => {
    const w = rig();
    w.say('');
    assert.match(w.text, /GREETINGS\./);
    const v = rig();
    v.say('\x1b[2Jbob');
    assert.equal(v.text.includes('\x1b[2Jbob'), false);
});

test('LIST GAMES lists them; a game not loaded says so; unknown commands are refused; LOGOFF leaves', () => {
    const w = rig();
    w.say('x');
    w.take();
    w.say('list games');
    assert.match(w.text, /TIC-TAC-TOE/);
    assert.match(w.text, /GLOBAL THERMONUCLEAR WAR/);
    assert.match(w.text, /CHESS {3}\(not loaded on this line\)/);
    assert.match(w.text, /^ {2}1 {2}TIC-TAC-TOE/m);
    w.take();
    w.say('chess');
    assert.match(w.text, /CHESS: NOT LOADED ON THIS LINE/);
    w.take();
    w.say('xyzzy');
    assert.match(w.text, /UNKNOWN COMMAND/);
    w.take();
    w.say('');
    assert.match(w.text, /SHALL WE PLAY ANOTHER GAME/);
    w.say('logoff');
    assert.equal(w.left, true);
    assert.match(w.text, /CONNECTION TERMINATED/);
});

test('games are found by number or by the start of the name', () => {
    for (const cmd of ['1', 'tic', 'TIC-TAC-TOE']) {
        const w = rig();
        w.say('x');
        w.take();
        w.say(cmd);
        assert.match(w.text, /HOW MANY PLAYERS/, cmd);
    }
    const w = rig();
    w.say('x'); w.take(); w.say('glob');
    assert.match(w.text, /GLOBAL THERMONUCLEAR WAR/);
    assert.match(w.text, /WHICH SIDE/);
});

test('the engine never loses: every line of play by a human ends in a draw or a WOPR win', () => {
    let games = 0, humanWins = 0;
    const walk = (b, human) => {
        const r = result(b);
        if (r) { games++; if (r === 'X') humanWins++; return; }
        if (human) { for (let i = 0; i < 9; i++) if (!b[i]) { b[i] = 'X'; walk(b, false); b[i] = null; } } else {
            for (const m of bestMoves(b, 'O')) { b[m] = 'O'; walk(b, true); b[m] = null; }       // any of its equal best moves
        }
    };
    walk(Array(9).fill(null), true);
    assert.ok(games > 100);
    assert.equal(humanWins, 0);
});

test('the engine as the first player does not lose either, and perfect play is a draw', () => {
    assert.equal(value(Array(9).fill(null), 'X', 'O'), 0);
    let o = 0;
    const walk = (b, engine) => {
        const r = result(b);
        if (r) { if (r === 'O') o++; return; }
        if (!engine) { for (let i = 0; i < 9; i++) if (!b[i]) { b[i] = 'O'; walk(b, true); b[i] = null; } } else for (const m of bestMoves(b, 'X')) { b[m] = 'X'; walk(b, false); b[m] = null; }
    };
    walk(Array(9).fill(null), true);
    assert.equal(o, 0);
});

test('it takes a win and blocks a loss', () => {
    const b = ['X', 'X', null, 'O', 'O', null, null, null, null];
    assert.deepEqual(bestMoves(b, 'X'), [2], 'X wins at 3');
    assert.deepEqual(bestMoves(['X', 'X', null, null, 'O', null, null, null, null], 'O'), [2], 'O blocks at 3');
});

test('a game: you play, WOPR answers, the board is shown, the game ends and asks again', () => {
    const w = rig();
    w.say('x'); w.take(); w.say('tic-tac-toe'); w.take();
    w.say('1');
    assert.match(w.text, /YOU ARE X, WOPR IS O/);
    assert.match(w.text, /YOUR MOVE \(1-9\)\? $/);
    w.take();
    w.say('5');
    assert.match(w.text, /WOPR PLAYS \d\./);
    assert.match(w.text, / X \|/);
    w.take();
    w.say('5');                                                  // taken
    assert.match(w.text, /NOT A FREE SQUARE/);
    w.take();
    // play on to the end with any free square
    for (let guard = 0; guard < 10 && !/PLAY AGAIN/.test(w.text); guard++) {
        const board = w.text; // eslint-disable-line no-unused-vars
        w.say([1, 2, 3, 4, 6, 7, 8, 9][guard % 8]);
    }
    assert.match(w.text, /A DRAW\.|WOPR WINS\./);
    assert.match(w.text, /PLAY AGAIN \(Y\/N\)\? $/);
    w.take();
    w.say('n');
    assert.match(w.text, /SHALL WE PLAY ANOTHER GAME/);
});

test('Q gives a game up', () => {
    const w = rig();
    w.say('x'); w.take(); w.say('1'); w.say('1'); w.take();
    w.say('q');
    assert.match(w.text, /GAME ABANDONED/);
});

test('zero players: WOPR plays itself ten times, all drawn, then the lesson', () => {
    const w = rig(Math.random);
    w.say('x'); w.take(); w.say('1'); w.take();
    w.say('0');
    assert.match(w.text, /WOPR PLAYS ITSELF/);
    assert.equal((w.text.match(/^GAME +\d+/gm) || []).length, 10);
    assert.equal((w.text.match(/DRAW$/gm) || []).length, 10);
    assert.match(w.text, /ALL GAMES DRAWN/);
    assert.match(w.text, /THE ONLY WINNING MOVE IS NOT TO PLAY/);
});

test('global thermonuclear war: choose a side and targets, watch the exchange, nobody wins', () => {
    const w = rig();
    w.say('x'); w.take(); w.say('global');
    assert.match(w.text, /A SIMULATION/);
    w.say('2');
    assert.match(w.text, /EAST/);
    assert.match(w.text, /1 {2}GRIDPORT/);
    w.take();
    w.say('3 1 8 9');
    assert.match(w.text, /TARGETS: SILO FIELD, GRIDPORT, POLAR STATION/);
    assert.match(w.text, /LAUNCH DETECTED/);
    assert.match(w.text, /EXCHANGE COMPLETE/);
    assert.match(w.text, /WINNER: NONE/);
    assert.match(w.text, /THE ONLY WINNING MOVE IS NOT TO PLAY/);
    assert.match(w.text, /HOW ABOUT A NICE GAME OF CHESS\?/);
    assert.match(w.text, /SHALL WE PLAY ANOTHER GAME/);
    const rows = w.text.split('\n').filter(l => /^T\+/.test(l));
    assert.equal(rows.length, 7);
    const pct = rows.map(r => r.match(/(\d+)%\s+(\d+)%/).slice(1).map(Number));
    for (let i = 1; i < pct.length; i++) assert.ok(pct[i][0] <= pct[i - 1][0] && pct[i][1] <= pct[i - 1][1], 'assets only fall');
    assert.ok(pct.at(-1)[0] <= 5 && pct.at(-1)[1] <= 5);
});

test('a bad target list is filled in; nothing in the output is outside ASCII and escapes', () => {
    const w = rig(Math.random);
    w.say('x'); w.take(); w.say('global'); w.say('1'); w.take(); w.say('zz');
    assert.match(w.text, /TARGETS: \w/);
    assert.equal(/[^\x20-\x7e\r\n\x1b\[0-9;mHJ]/.test(w.text), false);
});

test('the games that join through the host are listed, numbered after tic-tac-toe, and played with a host of their own', () => {
    const calls = [];
    const w = rig();
    w.take();
    // a second rig with games
    const h = { text: '', asks: [], left: false };
    const host = {
        out: t => { h.text += t; }, ask: (mode, fn) => h.asks.push({ mode, fn }), leave() {}, random: () => 0,
        scores: { add() {} }, games: [{ name: 'HANGMAN', play: (g, done) => { calls.push([typeof g.out, g.player, typeof g.scores.add]); g.out('PLAYING\n'); done(); } }]
    };
    wopr(host);
    h.asks.pop().fn('Ann');
    h.text = '';
    h.asks.pop().fn('list');
    assert.match(h.text, /^ {2}1 {2}TIC-TAC-TOE\n {2}2 {2}HANGMAN\n {2}3 {2}GLOBAL THERMONUCLEAR WAR\n/m);
    h.text = '';
    h.asks.pop().fn('han');
    assert.match(h.text, /PLAYING/);
    assert.match(h.text, /SHALL WE PLAY ANOTHER GAME/);
    assert.deepEqual(calls, [['function', 'ANN', 'function']]);
});

test('the games not loaded stay on the list', () => {
    assert.deepEqual(UNLOADED, ['CHESS', 'CHECKERS', 'POKER', 'FIGHTER COMBAT', 'DESERT WARFARE']);
});
