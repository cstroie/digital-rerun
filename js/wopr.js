/*
 * wopr.js: WOPR, the game computer of the BBS, in the manner of an old
 * war-games film. Entered with G at the BBS menu.
 *
 *   LOGON: a name (anything), then "SHALL WE PLAY A GAME?" and a prompt:
 *   a game by name or number, LIST GAMES, HELP, LOGOFF.
 *
 *   TIC-TAC-TOE      against WOPR (it does not lose), or 0 players: WOPR
 *                    plays itself.
 *   GLOBAL THERMONUCLEAR WAR   a simulation of the blocs (fictional) trading
 *                    blows; nobody wins.
 *   the other names on the list are not loaded on this line.
 *
 * It needs a `host` from the BBS session:
 *   out(text)            send text to the caller
 *   ask('line'|'key', fn, max)   wait for a line (at most max characters) or a
 *                        key (upper case) and hand it to fn
 *   leave()              back to the BBS menu
 *   random()             0 <= r < 1
 */
(function (root) {
    'use strict';

    const CLEAR = '\x1b[2J\x1b[H', BOLD = '\x1b[1m', REV = '\x1b[7m', OFF = '\x1b[0m';

    const GAMES = [
        { name: "FALKEN'S MAZE" }, { name: 'CHECKERS' }, { name: 'CHESS' }, { name: 'POKER' },
        { name: 'FIGHTER COMBAT' }, { name: 'DESERT WARFARE' },
        { name: 'TIC-TAC-TOE', play: 'ttt' }, { name: 'GLOBAL THERMONUCLEAR WAR', play: 'gtw' }
    ];

    /* ---------- tic-tac-toe ---------- */

    const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

    /** 'X' or 'O' if a line is complete, 'draw' if the board is full, else null. */
    function result(b) {
        for (const [x, y, z] of LINES) if (b[x] && b[x] === b[y] && b[x] === b[z]) return b[x];
        return b.every(Boolean) ? 'draw' : null;
    }

    /** The value of the board for `me` to move: +1 I win, 0 draw, -1 I lose (with best play on both sides). */
    function value(b, me, other) {
        const r = result(b);
        if (r) return r === 'draw' ? 0 : r === me ? 1 : -1;
        let best = -2;
        for (let i = 0; i < 9; i++) {
            if (b[i]) continue;
            b[i] = me;
            best = Math.max(best, 0 - value(b, other, me));
            b[i] = null;
        }
        return best;
    }

    /** Every move of `me` that is as good as any other. */
    function bestMoves(b, me) {
        const other = me === 'X' ? 'O' : 'X';
        let best = -2, moves = [];
        for (let i = 0; i < 9; i++) {
            if (b[i]) continue;
            b[i] = me;
            const v = 0 - value(b, other, me);
            b[i] = null;
            if (v > best) { best = v; moves = [i]; } else if (v === best) moves.push(i);
        }
        return moves;
    }

    function board(b) {
        const c = i => b[i] || String(i + 1);
        const row = i => ` ${c(i)} | ${c(i + 1)} | ${c(i + 2)}`;
        return `\n${row(0)}\n---+---+---\n${row(3)}\n---+---+---\n${row(6)}\n\n`;
    }

    /* ---------- the thermonuclear simulation ---------- */

    const TARGETS = ['GRIDPORT', 'NORTH RANGE', 'SILO FIELD', 'CAPITAL RING', 'SEA BASE', 'RELAY HILL', 'DEEP VALLEY', 'POLAR STATION'];

    function wopr(host) {
        const { out, ask } = host;
        const rnd = () => host.random();
        const pickOne = list => list[Math.floor(rnd() * list.length) % list.length];

        /* ---- the session ---- */

        function start() {
            out(`${CLEAR}${REV} W.O.P.R. ${OFF}  WAR OPERATION PLAN RESPONSE\n\nLOGON: `);
            ask('line', name => {
                name = name.replace(/[^\x20-\x7e]/g, '').trim().toUpperCase();
                out(`\nGREETINGS${name ? ', ' + name : ''}.\n`);
                menu(true);
            }, 12);
        }

        function menu(first) {
            out(`\n${first ? 'SHALL WE PLAY A GAME?' : 'SHALL WE PLAY ANOTHER GAME?'}\n\n? `);
            ask('line', command, 30);
        }

        function list() {
            out('\n');
            GAMES.forEach((g, i) => out(`${String(i + 1).padStart(3)}  ${g.name}${g.play ? '' : '   (not loaded on this line)'}\n`));
        }

        function command(text) {
            const t = text.trim().toUpperCase();
            if (!t) return menu(false);
            if (/^(LOGOFF|LOG OFF|QUIT|EXIT|BYE|Q)$/.test(t)) {
                out('\nLOGGING OFF.  --CONNECTION TERMINATED--\n');
                return host.leave();
            }
            if (/^(LIST( GAMES)?|GAMES|HELP( GAMES)?|\?)$/.test(t)) { list(); out('\nTYPE A NAME OR A NUMBER. LOGOFF LEAVES.\n'); return menu(false); }
            let game = /^\d+$/.test(t) ? GAMES[Number(t) - 1] : t.length >= 3 ? GAMES.find(g => g.name.startsWith(t)) : null;
            if (!game && t.length >= 3) game = GAMES.find(g => g.name.includes(t));
            if (!game) { out('\nUNKNOWN COMMAND. TYPE LIST GAMES.\n'); return menu(false); }
            if (!game.play) { out(`\n${game.name}: NOT LOADED ON THIS LINE.\n`); return menu(false); }
            return game.play === 'ttt' ? ticTacToe() : thermonuclear();
        }

        /* ---- tic-tac-toe ---- */

        function ticTacToe() {
            out('\nTIC-TAC-TOE.  HOW MANY PLAYERS (0 OR 1)? ');
            ask('key', k => {
                if (k === '0') return watch();
                if (k === '1') return play();
                out('\n');
                return menu(false);
            });
        }

        function play() {
            const b = Array(9).fill(null);
            out('\nYOU ARE X, WOPR IS O. YOU MOVE FIRST. Q GIVES UP.\n' + board(b));
            turn(b);
        }

        function turn(b) {
            out('YOUR MOVE (1-9)? ');
            ask('key', k => {
                if (k === 'Q') { out('\nGAME ABANDONED.\n'); return menu(false); }
                const i = Number(k) - 1;
                if (!(i >= 0 && i < 9) || b[i]) { out('\nNOT A FREE SQUARE.\n'); return turn(b); }
                b[i] = 'X';
                out(`${k}\n`);
                let r = result(b);
                if (!r) { const m = pickOne(bestMoves(b, 'O')); b[m] = 'O'; out(`WOPR PLAYS ${m + 1}.\n`); r = result(b); }
                out(board(b));
                if (!r) return turn(b);
                out(r === 'draw' ? 'A DRAW.\n' : r === 'O' ? 'WOPR WINS.\n' : 'YOU WIN. (THIS SHOULD NOT HAPPEN.)\n');
                again(ticTacToe);
            });
        }

        function again(next) {
            out('\nPLAY AGAIN (Y/N)? ');
            ask('key', k => { out('\n'); if (k === 'Y') next(); else menu(false); });
        }

        /** Zero players: WOPR against WOPR, a game after another. */
        function watch() {
            out('\nWOPR PLAYS ITSELF.\n\n');
            for (let g = 1; g <= 10; g++) {
                const b = Array(9).fill(null);
                const moves = [];
                let me = 'X', r = null;
                while (!r) { const m = pickOne(bestMoves(b, me)); b[m] = me; moves.push(m + 1); r = result(b); me = me === 'X' ? 'O' : 'X'; }
                out(`GAME ${String(g).padStart(2)}  ${moves.join(' ')}  ${r === 'draw' ? 'DRAW' : r + ' WINS'}\n`);
            }
            out('\nALL GAMES DRAWN. NO WINNER.\n');
            lesson(false);
            menu(false);
        }

        /* ---- global thermonuclear war ---- */

        function thermonuclear() {
            out(`\n${BOLD}GLOBAL THERMONUCLEAR WAR${OFF}   (A SIMULATION. NOTHING HERE IS REAL.)\n\n` +
                'WHICH SIDE?  1 WEST BLOC   2 EAST BLOC   ');
            ask('key', k => {
                if (k !== '1' && k !== '2') { out('\n'); return menu(false); }
                const side = k === '1' ? 'WEST' : 'EAST', other = k === '1' ? 'EAST' : 'WEST';
                out(`${side}\n\nPRIORITY TARGETS:\n\n`);
                TARGETS.forEach((t, i) => out(` ${i + 1}  ${t}\n`));
                out('\nPICK THREE (NUMBERS, E.G. 1 4 7)? ');
                ask('line', text => {
                    let picks = [...new Set((text.match(/[1-8]/g) || []).map(Number))].slice(0, 3);
                    while (picks.length < 3) { const n = 1 + Math.floor(rnd() * 8) % 8; if (!picks.includes(n)) picks.push(n); }
                    exchange(side, other, picks.map(n => TARGETS[n - 1]));
                }, 12);
            });
        }

        function exchange(side, other, targets) {
            out(`\nTARGETS: ${targets.join(', ')}\n\nRUNNING SCENARIO ...\n\n`);
            out(`${'TIME'.padEnd(8)}${'EVENT'.padEnd(24)}${'WEST'.padStart(6)}${'EAST'.padStart(6)}\n`);
            let west = 100, east = 100, t = 0;
            const events = ['LAUNCH DETECTED', 'FIRST STRIKE', 'COUNTER-STRIKE', 'SECOND WAVE', 'RELAY LOST', 'LAST RESERVES', 'EXCHANGE COMPLETE'];
            events.forEach((e, i) => {
                const last = i === events.length - 1;
                west = last ? Math.min(west, Math.floor(rnd() * 6)) : Math.max(1, west - Math.floor(10 + rnd() * 25));
                east = last ? Math.min(east, Math.floor(rnd() * 6)) : Math.max(1, east - Math.floor(10 + rnd() * 25));
                t += 4 + Math.floor(rnd() * 20);
                const clock = `T+${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
                out(`${clock.padEnd(8)}${e.padEnd(24)}${(west + '%').padStart(6)}${(east + '%').padStart(6)}\n`);
            });
            out('\nWINNER: NONE\n');
            lesson(true);
            menu(false);
        }

        function lesson(chess) {
            out('\nA STRANGE GAME.\nTHE ONLY WINNING MOVE IS NOT TO PLAY.\n');
            if (chess) out('\nHOW ABOUT A NICE GAME OF CHESS?\n');
        }

        start();
    }

    const api = { wopr, GAMES, TARGETS, result, bestMoves, value, board };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else Object.assign(root.DigitalRerun = root.DigitalRerun || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
