/*
 * games.js: the small games of WOPR's list. Each is { name, play(h, done) }:
 *
 *   h.out(text)  h.ask('key'|'line', fn, max)  h.random()  h.player  h.scores
 *   done()       back to WOPR's menu
 *
 * BLACK JACK, HANGMAN, CODEBREAKER, NIM, BATTLESHIP, HUNT THE WUMPUS,
 * LUNAR LANDER, FALKEN'S MAZE. Plain ASCII, 80 columns, no timers: a turn is
 * a prompt. The pure parts (hand values, peg scores, the cave, the physics)
 * are exported for the tests.
 */
(function (root) {
    'use strict';

    const BOLD = '\x1b[1m', OFF = '\x1b[0m';

    /** Put a score on the table and say where it came in. */
    function record(h, game, score, low = false) {
        if (!h.scores || !(score > 0 || low)) return;
        const place = h.scores.add(game, h.player || 'GUEST', score, low);
        if (place) h.out(`\nHIGH SCORES: ${score}${place === 1 ? ' IS THE BEST YET' : ', NUMBER ' + place}.\n`);
    }

    const shuffle = (list, random) => {
        const a = list.slice();
        for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
        return a;
    };
    const pickOne = (list, random) => list[Math.floor(random() * list.length) % list.length];

    /* ============================ BLACK JACK ============================ */

    const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    const SUITS = ['S', 'H', 'D', 'C'];

    const newDeck = random => shuffle(RANKS.flatMap(r => SUITS.map(s => r + s)), random);

    /** { total, soft } of a hand: aces count 11 while that does not bust. */
    function handValue(cards) {
        let total = 0, aces = 0;
        for (const c of cards) {
            const r = c.slice(0, -1);
            if (r === 'A') { aces++; total += 11; } else total += 'JQK'.includes(r) ? 10 : Number(r);
        }
        while (total > 21 && aces) { total -= 10; aces--; }
        return { total, soft: aces > 0 };
    }

    const isBlackjack = cards => cards.length === 2 && handValue(cards).total === 21;
    const show = cards => cards.map(c => `[${c}]`).join(' ');

    const blackjack = {
        name: 'BLACK JACK',
        play(h, done) {
            let bank = 100;
            const finish = why => { h.out(`\n${why} YOU LEAVE THE TABLE WITH $${bank}.\n`); record(h, 'BLACK JACK', bank); done(); };

            const round = () => {
                if (bank <= 0) return finish('YOU ARE BROKE.');
                h.out(`\n${BOLD}BLACK JACK${OFF}  BANKROLL $${bank}. BET (1-${bank}, RETURN CASHES OUT)? `);
                h.ask('line', text => {
                    const bet = parseInt(text, 10);
                    if (!text.trim() || /^q/i.test(text)) return finish('CASHING OUT.');
                    if (!(bet >= 1 && bet <= bank)) { h.out('\nTHE HOUSE DOES NOT TAKE THAT BET.\n'); return round(); }
                    deal(bet);
                }, 6);
            };

            const deal = bet => {
                const deck = newDeck(h.random);
                const you = [deck.pop(), deck.pop()], dealer = [deck.pop(), deck.pop()];
                h.out(`\nDEALER  ${show([dealer[0]])} [??]\nYOU     ${show(you)}  (${handValue(you).total})\n`);
                if (isBlackjack(you) || isBlackjack(dealer)) {
                    h.out(`\nDEALER HAS ${show(dealer)}\n`);
                    if (isBlackjack(you) && isBlackjack(dealer)) return settle('PUSH. TWO BLACKJACKS.', 0);
                    return isBlackjack(you) ? settle('BLACKJACK! PAYS 3 TO 2.', Math.floor(bet * 1.5)) : settle('DEALER HAS BLACKJACK.', -bet);
                }
                action(deck, you, dealer, bet, true);
            };

            const action = (deck, you, dealer, bet, first) => {
                h.out(`(H)IT, (S)TAND${first && bank >= bet * 2 ? ', (D)OUBLE' : ''}? `);
                h.ask('key', k => {
                    if (k === 'D' && first && bank >= bet * 2) { bet *= 2; you.push(deck.pop()); h.out(`DOUBLE.\nYOU     ${show(you)}  (${handValue(you).total})\n`); return handValue(you).total > 21 ? settle('BUST.', -bet) : dealerPlay(deck, you, dealer, bet); }
                    if (k === 'H') { you.push(deck.pop()); h.out(`HIT.\nYOU     ${show(you)}  (${handValue(you).total})\n`); return handValue(you).total > 21 ? settle('BUST.', -bet) : action(deck, you, dealer, bet, false); }
                    if (k === 'S') { h.out('STAND.\n'); return dealerPlay(deck, you, dealer, bet); }
                    h.out('\n');
                    return action(deck, you, dealer, bet, first);
                });
            };

            const dealerPlay = (deck, you, dealer, bet) => {
                while (handValue(dealer).total < 17) dealer.push(deck.pop());
                const d = handValue(dealer).total, y = handValue(you).total;
                h.out(`DEALER  ${show(dealer)}  (${d})\n`);
                if (d > 21) return settle('DEALER BUSTS.', bet);
                if (y > d) return settle('YOU WIN.', bet);
                if (y < d) return settle('DEALER WINS.', -bet);
                return settle('PUSH.', 0);
            };

            const settle = (why, change) => {
                bank += change;
                h.out(`\n${why} ${change > 0 ? '+$' + change : change < 0 ? '-$' + -change : 'NO CHANGE'}.\n`);
                round();
            };

            h.out('\nBLACK JACK. DEALER STANDS ON 17. BLACKJACK PAYS 3 TO 2.\n');
            round();
        }
    };

    /* ============================= HANGMAN ============================= */

    const WORDS = ['MODEM', 'BAUD', 'CURSOR', 'KERNEL', 'BITMAP', 'PIXEL', 'SPECTRUM', 'RELAY', 'SIGNAL', 'CIPHER', 'PACKET', 'ROUTER',
        'SERVER', 'BINARY', 'DECIMAL', 'ASSEMBLER', 'COMPILER', 'POINTER', 'BUFFER', 'STACK', 'QUEUE', 'SOCKET', 'TERMINAL', 'PROMPT',
        'FLOPPY', 'SECTOR', 'TRACK', 'CHECKSUM', 'XMODEM', 'PROTOCOL', 'HANDSHAKE', 'CARRIER', 'ANTENNA', 'PHOSPHOR', 'KEYBOARD',
        'MAINFRAME', 'PROGRAM', 'SUBROUTINE', 'INTERRUPT', 'REGISTER', 'ACCUMULATOR', 'OVERFLOW', 'DATABASE', 'FIREWALL', 'PASSWORD',
        'ENCRYPT', 'GATEWAY', 'NETWORK', 'ORBIT', 'GALAXY', 'ROBOT', 'ANDROID', 'LASER', 'PLASMA', 'FUSION', 'COMET', 'NEBULA',
        'WORMHOLE', 'CYBORG', 'HOLOGRAM', 'SATELLITE', 'TELEMETRY', 'LIGHTHOUSE', 'SYSOP', 'BULLETIN', 'DIALUP', 'CASSETTE'];
    const GALLOWS = [
        ['', '', '', '', '', '', ' ========'],
        ['', '  |', '  |', '  |', '  |', '  |', ' ========'],
        [' +--+', '  |', '  |', '  |', '  |', '  |', ' ========'],
        [' +--+', ' O|', '  |', '  |', '  |', '  |', ' ========'],
        [' +--+', ' O|', ' |  |', '  |', '  |', '  |', ' ========'],
        [' +--+', ' O|', '/|\\|', '  |', '  |', '  |', ' ========'],
        [' +--+', ' O|', '/|\\|', '/ \\|', '  |', '  |', ' ========']
    ];
    const MAX_WRONG = 6;

    const hangman = {
        name: 'HANGMAN',
        play(h, done) {
            let streak = 0, used = [];
            const word = () => { const pool = WORDS.filter(x => !used.includes(x)); const w = pickOne(pool.length ? pool : WORDS, h.random); used.push(w); return w; };

            const next = () => {
                const w = word();
                turn(w, new Set(), 0);
            };
            const turn = (w, guessed, wrong) => {
                const shown = [...w].map(c => (guessed.has(c) ? c : '_')).join(' ');
                h.out(`\n${GALLOWS[wrong].join('\n')}\n\n${shown}\n${[...guessed].filter(c => !w.includes(c)).join(' ')}\n`);
                if (![...w].some(c => !guessed.has(c))) { streak++; h.out(`\nYOU GOT IT! STREAK ${streak}.\n`); return next(); }
                if (wrong >= MAX_WRONG) { h.out(`\nHANGED. THE WORD WAS ${w}.\n`); record(h, 'HANGMAN', streak); return done(); }
                h.out('A LETTER (Q GIVES UP)? ');
                h.ask('key', k => {
                    if (k === 'Q') { h.out(`\nTHE WORD WAS ${w}.\n`); record(h, 'HANGMAN', streak); return done(); }
                    if (!/^[A-Z]$/.test(k) || guessed.has(k)) return turn(w, guessed, wrong);
                    guessed.add(k);
                    turn(w, guessed, wrong + (w.includes(k) ? 0 : 1));
                });
            };
            h.out('\nHANGMAN. TECH WORDS. SIX WRONG LETTERS AND YOU HANG. YOUR SCORE IS THE STREAK.\n');
            next();
        }
    };

    /* ========================== CODEBREAKER ========================== */

    const COLORS = 'ABCDEF', PEGS = 4, TURNS = 10;

    /** { black, white }: black = right colour in the right place, white = right colour elsewhere. */
    function pegScore(secret, guess) {
        let black = 0;
        const s = [], g = [];
        for (let i = 0; i < secret.length; i++) { if (secret[i] === guess[i]) black++; else { s.push(secret[i]); g.push(guess[i]); } }
        let white = 0;
        for (const c of g) { const at = s.indexOf(c); if (at >= 0) { white++; s.splice(at, 1); } }
        return { black, white };
    }

    const codebreaker = {
        name: 'CODEBREAKER',
        play(h, done) {
            const secret = Array.from({ length: PEGS }, () => COLORS[Math.floor(h.random() * COLORS.length) % COLORS.length]).join('');
            h.out(`\nCODEBREAKER. I HOLD A CODE OF ${PEGS} LETTERS FROM ${COLORS[0]} TO ${COLORS.at(-1)} (LETTERS MAY REPEAT).\n` +
                `GUESS IT IN ${TURNS} TRIES. X = RIGHT LETTER, RIGHT PLACE. O = RIGHT LETTER, WRONG PLACE.\n`);
            const turn = n => {
                h.out(`\nTRY ${n}/${TURNS}? `);
                h.ask('line', text => {
                    const guess = text.toUpperCase().replace(/[^A-F]/g, '');
                    if (/^q/i.test(text.trim())) { h.out(`\nTHE CODE WAS ${secret}.\n`); return done(); }
                    if (guess.length !== PEGS) { h.out(`\n${PEGS} LETTERS, A TO ${COLORS.at(-1)}, PLEASE.\n`); return turn(n); }
                    const { black, white } = pegScore(secret, guess);
                    h.out(`${guess}  ${'X'.repeat(black)}${'O'.repeat(white)}${black + white ? '' : '-'}\n`);
                    if (black === PEGS) { const score = (TURNS + 1 - n) * 10; h.out(`\nCRACKED IN ${n}. SCORE ${score}.\n`); record(h, 'CODEBREAKER', score); return done(); }
                    if (n >= TURNS) { h.out(`\nOUT OF TRIES. THE CODE WAS ${secret}.\n`); return done(); }
                    turn(n + 1);
                }, 12);
            };
            turn(1);
        }
    };

    /* ============================== NIM ============================== */

    /** The move that leaves a nim-sum of zero (last object wins), or a token move when there is none. */
    function nimMove(heaps) {
        const sum = heaps.reduce((a, b) => a ^ b, 0);
        if (sum) for (let i = 0; i < heaps.length; i++) { const to = heaps[i] ^ sum; if (to < heaps[i]) return [i, heaps[i] - to]; }
        const big = heaps.indexOf(Math.max(...heaps));
        return [big, 1];
    }

    const nim = {
        name: 'NIM',
        play(h, done) {
            let wins = 0;
            const game = () => {
                const heaps = [3, 5, 7];
                h.out('\nNIM. THREE HEAPS, A B C. TAKE ANY NUMBER FROM ONE HEAP. WHOEVER TAKES THE LAST OBJECT WINS.\nYOU MOVE FIRST. EXAMPLE: A 2\n');
                you(heaps);
            };
            const board = heaps => heaps.map((n, i) => `${'ABC'[i]}: ${'* '.repeat(n)}`.trimEnd()).join('\n');
            const you = heaps => {
                h.out(`\n${board(heaps)}\n\nYOUR MOVE? `);
                h.ask('line', text => {
                    if (/^q/i.test(text.trim())) return end();
                    const m = /^\s*([abc])\s*(\d+)\s*$/i.exec(text);
                    const i = m ? 'ABC'.indexOf(m[1].toUpperCase()) : -1;
                    const n = m ? Number(m[2]) : 0;
                    if (!m || n < 1 || n > heaps[i]) { h.out('\nA HEAP LETTER AND A NUMBER THAT IS THERE.\n'); return you(heaps); }
                    heaps[i] -= n;
                    if (!heaps.some(Boolean)) { wins++; h.out('\nYOU TOOK THE LAST ONE. YOU WIN.\n'); return again(); }
                    const [j, k] = nimMove(heaps);
                    heaps[j] -= k;
                    h.out(`\nWOPR TAKES ${k} FROM ${'ABC'[j]}.\n`);
                    if (!heaps.some(Boolean)) { h.out('WOPR TOOK THE LAST ONE. WOPR WINS.\n'); return again(); }
                    you(heaps);
                }, 8);
            };
            const again = () => { h.out('\nAGAIN (Y/N)? '); h.ask('key', k => (k === 'Y' ? game() : end())); };
            const end = () => { h.out(`\nYOU WON ${wins}.\n`); record(h, 'NIM', wins); done(); };
            game();
        }
    };

    /* =========================== BATTLESHIP =========================== */

    const N = 8, FLEET = [4, 3, 3, 2];

    /** Random ships on an N x N grid: [{ cells: [index...] }]. */
    function placeFleet(random) {
        const taken = new Set(), ships = [];
        for (const len of FLEET) {
            for (let tries = 0; tries < 1000; tries++) {
                const horiz = random() < 0.5;
                const r = Math.floor(random() * (horiz ? N : N - len + 1)), c = Math.floor(random() * (horiz ? N - len + 1 : N));
                const cells = Array.from({ length: len }, (_, k) => (horiz ? r * N + c + k : (r + k) * N + c));
                if (cells.some(x => taken.has(x))) continue;
                cells.forEach(x => taken.add(x));
                ships.push({ cells });
                break;
            }
        }
        return ships;
    }

    /** "B5" or "b 5" -> cell index, or -1. */
    function parseCell(text) {
        const m = /^\s*([a-h])\s*([1-8])\s*$/i.exec(text);
        return m ? 'ABCDEFGH'.indexOf(m[1].toUpperCase()) * N + Number(m[2]) - 1 : -1;
    }

    const battleship = {
        name: 'BATTLESHIP',
        play(h, done) {
            const mine = placeFleet(h.random), theirs = placeFleet(h.random);
            const shotsAtMe = new Set(), myShots = new Set();
            const hunt = [];                                           // cells next to a hit, to try
            let fired = 0;

            const sunk = (fleet, shots, ship) => ship.cells.every(c => shots.has(c));
            const alive = (fleet, shots) => fleet.some(s => !sunk(fleet, shots, s));
            const cellChar = (fleet, shots, i, reveal) => (shots.has(i) ? (fleet.some(s => s.cells.includes(i)) ? 'X' : 'o') : reveal && fleet.some(s => s.cells.includes(i)) ? '#' : '.');
            const grids = () => {
                let t = '\n   YOUR SHOTS          YOUR FLEET\n   1 2 3 4 5 6 7 8     1 2 3 4 5 6 7 8\n';
                for (let r = 0; r < N; r++) {
                    const row = f => Array.from({ length: N }, (_, c) => f(r * N + c)).join(' ');
                    t += `${'ABCDEFGH'[r]}  ${row(i => cellChar(theirs, myShots, i, false))}     ${'ABCDEFGH'[r]}  ${row(i => cellChar(mine, shotsAtMe, i, true))}\n`;
                }
                return t;
            };

            const turn = () => {
                h.out(`${grids()}\nFIRE (E.G. B5, Q GIVES UP)? `);
                h.ask('line', text => {
                    if (/^q/i.test(text.trim())) { h.out('\nYOU STRIKE YOUR COLOURS.\n'); return done(); }
                    const i = parseCell(text);
                    if (i < 0 || myShots.has(i)) { h.out('\nA FRESH SQUARE, A1 TO H8.\n'); return turn(); }
                    myShots.add(i);
                    fired++;
                    const ship = theirs.find(s => s.cells.includes(i));
                    h.out(`\n${text.trim().toUpperCase()}: ${ship ? (sunk(theirs, myShots, ship) ? `HIT. YOU SANK A ${ship.cells.length}-SQUARE SHIP!` : 'HIT!') : 'MISS.'}\n`);
                    if (!alive(theirs, myShots)) {
                        const score = Math.max(1, N * N - fired);
                        h.out(`\nWOPR'S FLEET IS GONE. YOU WIN IN ${fired} SHOTS. SCORE ${score}.\n`);
                        record(h, 'BATTLESHIP', score);
                        return done();
                    }
                    reply();
                }, 6);
            };

            const reply = () => {
                let i = -1;
                while (hunt.length) { const c = hunt.pop(); if (!shotsAtMe.has(c)) { i = c; break; } }
                if (i < 0) {
                    const free = Array.from({ length: N * N }, (_, k) => k).filter(k => !shotsAtMe.has(k));
                    const parity = free.filter(k => ((k >> 3) + (k & 7)) % 2 === 0);
                    i = pickOne(parity.length ? parity : free, h.random);
                }
                shotsAtMe.add(i);
                const ship = mine.find(s => s.cells.includes(i));
                const name = `${'ABCDEFGH'[i >> 3]}${(i & 7) + 1}`;
                if (ship) {
                    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                        const r = (i >> 3) + dr, c = (i & 7) + dc;
                        if (r >= 0 && r < N && c >= 0 && c < N) hunt.push(r * N + c);
                    }
                }
                h.out(`WOPR FIRES AT ${name}: ${ship ? (sunk(mine, shotsAtMe, ship) ? `HIT. IT SANK YOUR ${ship.cells.length}-SQUARE SHIP.` : 'HIT.') : 'MISS.'}\n`);
                if (!alive(mine, shotsAtMe)) { h.out('\nYOUR FLEET IS GONE. WOPR WINS.\n'); return done(); }
                turn();
            };

            h.out('\nBATTLESHIP. TWO FLEETS OF FOUR SHIPS (4, 3, 3, 2) HIDE ON 8 BY 8 GRIDS. # IS YOUR SHIP, X A HIT, o A MISS.\n');
            turn();
        }
    };

    /* ========================= HUNT THE WUMPUS ========================= */

    const CAVE = [[2, 5, 8], [1, 3, 10], [2, 4, 12], [3, 5, 14], [1, 4, 6], [5, 7, 15], [6, 8, 17], [1, 7, 9], [8, 10, 18], [2, 9, 11],
        [10, 12, 19], [3, 11, 13], [12, 14, 20], [4, 13, 15], [6, 14, 16], [15, 17, 20], [7, 16, 18], [9, 17, 19], [11, 18, 20], [13, 16, 19]];

    /** A fresh cave: you, the wumpus, two bat rooms and two pits, all in different rooms. */
    function makeCave(random) {
        const rooms = shuffle(Array.from({ length: 20 }, (_, i) => i + 1), random);
        return { you: rooms[0], wumpus: rooms[1], bats: [rooms[2], rooms[3]], pits: [rooms[4], rooms[5]] };
    }

    const wumpus = {
        name: 'HUNT THE WUMPUS',
        play(h, done) {
            const cave = makeCave(h.random);
            let arrows = 5, turns = 0;
            const near = r => CAVE[r - 1];
            const warn = () => {
                const around = near(cave.you);
                h.out(`\nYOU ARE IN ROOM ${BOLD}${cave.you}${OFF}. TUNNELS LEAD TO ${around.join(', ')}.\n`);
                if (around.includes(cave.wumpus)) h.out('I SMELL A WUMPUS!\n');
                if (around.some(r => cave.pits.includes(r))) h.out('I FEEL A DRAFT.\n');
                if (around.some(r => cave.bats.includes(r))) h.out('BATS NEARBY!\n');
            };
            const lose = why => { h.out(`\n${why}\nHA HA HA - YOU LOSE!\n`); done(); };
            const arrive = () => {
                if (cave.you === cave.wumpus) {
                    if (h.random() < 0.5) { h.out('\n...OOPS! BUMPED A WUMPUS!\n'); cave.wumpus = pickOne(near(cave.wumpus), h.random); if (cave.wumpus !== cave.you) return turn(); }
                    return lose('TSK TSK TSK - WUMPUS GOT YOU!');
                }
                if (cave.pits.includes(cave.you)) return lose('YYYIIIIEEEE . . . FELL IN A PIT!');
                if (cave.bats.includes(cave.you)) { h.out('\nZAP - SUPER BAT SNATCH! ELSEWHEREVILLE FOR YOU!\n'); cave.you = 1 + Math.floor(h.random() * 20); return arrive(); }
                turn();
            };
            const turn = () => {
                turns++;
                warn();
                h.out(`\nARROWS ${arrows}.  (M)OVE ROOM, (S)HOOT ROOM ROOM ..., (Q)UIT? `);
                h.ask('line', text => {
                    const m = /^\s*([msq])\s*([\d\s,]*)$/i.exec(text);
                    if (!m) { h.out('\nM 5 MOVES, S 4 7 SHOOTS AN ARROW THROUGH ROOMS 4 AND 7.\n'); turns--; return turn(); }
                    const cmd = m[1].toUpperCase(), nums = (m[2].match(/\d+/g) || []).map(Number);
                    if (cmd === 'Q') { h.out('\nTHE CAVE KEEPS ITS SECRETS.\n'); return done(); }
                    if (cmd === 'M') {
                        if (!near(cave.you).includes(nums[0])) { h.out('\nNOT POSSIBLE.\n'); turns--; return turn(); }
                        cave.you = nums[0];
                        return arrive();
                    }
                    if (!nums.length || nums.length > 5) { h.out('\nSHOOT THROUGH 1 TO 5 ROOMS.\n'); turns--; return turn(); }
                    arrows--;
                    let at = cave.you;
                    for (const r of nums) {
                        at = near(at).includes(r) ? r : pickOne(near(at), h.random);              // a crooked arrow
                        if (at === cave.wumpus) {
                            const score = Math.max(1, 100 - turns + arrows * 5);
                            h.out('\nAHA! YOU GOT THE WUMPUS!\nHEE HEE HEE - THE WUMPUS\'LL GETCHA NEXT TIME!!\n' + `SCORE ${score}.\n`);
                            record(h, 'HUNT THE WUMPUS', score);
                            return done();
                        }
                        if (at === cave.you) return lose('OUCH! ARROW GOT YOU!');
                    }
                    h.out('\nMISSED.\n');
                    if (h.random() < 0.75) { cave.wumpus = pickOne(near(cave.wumpus), h.random); if (cave.wumpus === cave.you) return lose('TSK TSK TSK - WUMPUS GOT YOU!'); }
                    if (!arrows) return lose('YOU RAN OUT OF ARROWS.');
                    turn();
                }, 20);
            };
            h.out('\nHUNT THE WUMPUS. TWENTY ROOMS, THREE TUNNELS EACH. TWO PITS, TWO BAT ROOMS, ONE WUMPUS, FIVE CROOKED ARROWS.\n');
            turn();
        }
    };

    /* ========================== LUNAR LANDER ========================== */

    const LANDER = { gravity: 1.6, thrust: 0.25, maxBurn: 20, alt: 300, vel: -15, fuel: 280, safe: 2 };

    /** One second of flight with `burn` units of fuel: { alt, vel, fuel }. Down is negative velocity. */
    function lunarStep(s, burn) {
        burn = Math.max(0, Math.min(burn, LANDER.maxBurn, s.fuel));
        const vel = s.vel + burn * LANDER.thrust - LANDER.gravity;
        return { alt: s.alt + (s.vel + vel) / 2, vel, fuel: s.fuel - burn };
    }

    const lander = {
        name: 'LUNAR LANDER',
        play(h, done) {
            let s = { alt: LANDER.alt, vel: LANDER.vel, fuel: LANDER.fuel }, t = 0;
            h.out(`\nLUNAR LANDER. EACH SECOND YOU BURN 0 TO ${LANDER.maxBurn} UNITS OF FUEL; EACH UNIT PUSHES UP ${LANDER.thrust} M/S. MOON GRAVITY PULLS DOWN ${LANDER.gravity}.\n` +
                `TOUCH DOWN AT NO MORE THAN ${LANDER.safe} M/S. FUEL LEFT IS YOUR SCORE.\n`);
            const turn = () => {
                h.out(`\nT+${String(t).padStart(3)}  ALTITUDE ${s.alt.toFixed(1).padStart(6)} M   SPEED ${(-s.vel).toFixed(1).padStart(5)} M/S   FUEL ${String(Math.round(s.fuel)).padStart(3)}\nBURN (0-${Math.min(LANDER.maxBurn, Math.floor(s.fuel))})? `);
                h.ask('line', text => {
                    if (/^q/i.test(text.trim())) { h.out('\nYOU ABORT. THE MOON IS PATIENT.\n'); return done(); }
                    const burn = Number.parseInt(text, 10);
                    if (!(burn >= 0)) { h.out('\nA NUMBER, PLEASE.\n'); return turn(); }
                    const next = lunarStep(s, burn);
                    t++;
                    if (next.alt > 0) { s = next; return turn(); }
                    // touchdown: where in this second did the surface come up?
                    const f = s.alt / (s.alt - next.alt);
                    const v = s.vel + (next.vel - s.vel) * f;
                    const speed = -v;
                    h.out(`\nTOUCHDOWN AT T+${(t - 1 + f).toFixed(1)}. SPEED ${speed.toFixed(1)} M/S, FUEL ${Math.round(next.fuel)}.\n`);
                    if (speed <= LANDER.safe) { const score = Math.max(1, Math.round(next.fuel)); h.out(`A PERFECT LANDING! SCORE ${score}.\n`); record(h, 'LUNAR LANDER', score); } else if (speed <= 10) h.out('YOU CRASHED, BUT YOU WALK AWAY. THE LANDER DOES NOT.\n');
                    else h.out('A NEW CRATER. THE CREW WOULD HAVE BEEN PROUD.\n');
                    done();
                }, 4);
            };
            turn();
        }
    };

    /* ========================== FALKEN'S MAZE ========================== */

    const SIDE = 6, DIRS = { N: [-1, 0], S: [1, 0], E: [0, 1], W: [0, -1] }, OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };

    /** A random perfect maze on SIDE x SIDE: open[cell] = Set of directions you can go. */
    function makeMaze(random) {
        const open = Array.from({ length: SIDE * SIDE }, () => new Set());
        const seen = new Set([0]), stack = [0];
        while (stack.length) {
            const at = stack[stack.length - 1], r = Math.floor(at / SIDE), c = at % SIDE;
            const options = Object.entries(DIRS).map(([d, [dr, dc]]) => [d, r + dr, c + dc]).filter(([, rr, cc]) => rr >= 0 && rr < SIDE && cc >= 0 && cc < SIDE && !seen.has(rr * SIDE + cc));
            if (!options.length) { stack.pop(); continue; }
            const [d, rr, cc] = pickOne(options, random), to = rr * SIDE + cc;
            open[at].add(d);
            open[to].add(OPPOSITE[d]);
            seen.add(to);
            stack.push(to);
        }
        return open;
    }

    const maze = {
        name: "FALKEN'S MAZE",
        play(h, done) {
            const open = makeMaze(h.random), exit = SIDE * SIDE - 1;
            let at = 0, moves = 0;
            h.out("\nFALKEN'S MAZE. FIND THE WAY FROM THE NORTH-WEST CORNER TO THE SOUTH-EAST. N S E W MOVE. Q GIVES UP. FEWER MOVES, BETTER SCORE.\n");
            const turn = () => {
                const r = Math.floor(at / SIDE), c = at % SIDE;
                const way = [r < SIDE - 1 ? 'SOUTH' : '', c < SIDE - 1 ? 'EAST' : ''].filter(Boolean).join('-');
                h.out(`\nYOU ARE IN A CORRIDOR. EXITS: ${[...open[at]].sort().join(' ')}.  THE EXIT IS ${way || 'HERE'}.\n? `);
                h.ask('key', k => {
                    if (k === 'Q') { h.out('\nYOU SIT DOWN IN THE DARK.\n'); return done(); }
                    if (!open[at].has(k)) { h.out('\nA WALL.\n'); return turn(); }
                    const [dr, dc] = DIRS[k];
                    at = (r + dr) * SIDE + c + dc;
                    moves++;
                    if (at === exit) { h.out(`\nDAYLIGHT! OUT IN ${moves} MOVES.\n`); record(h, "FALKEN'S MAZE", moves, true); return done(); }
                    turn();
                });
            };
            turn();
        }
    };

    const GAMES = [blackjack, hangman, codebreaker, nim, battleship, wumpus, lander, maze];

    const api = { GAMES, handValue, newDeck, isBlackjack, pegScore, nimMove, placeFleet, parseCell, makeCave, CAVE, lunarStep, LANDER, makeMaze, WORDS, record };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else Object.assign(root.DigitalRerun = root.DigitalRerun || {}, { games: GAMES, gameTools: api });
})(typeof window !== 'undefined' ? window : globalThis);
