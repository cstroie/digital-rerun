/*
 * gibson.js: HACK THE GIBSON, a puzzle in a pretend terminal (a WOPR game).
 *
 * A daily puzzle (the same all day, a new one tomorrow): read the files,
 * find the shift of a Caesar cipher, decode the operator's note, log in, and
 * read the safe. Nothing here touches a real machine: it is a few strings.
 *
 *   HELP  LS [dir]  CAT file  ROT n text-or-file  LOGIN user password
 *   HINT  QUIT
 *
 * The score is 100 less two for each command and fifteen for each hint.
 */
(function (root) {
    'use strict';

    const WORDS = ['PIXEL', 'KETTLE', 'RELAY', 'SIGNAL', 'PHOSPHOR', 'SPECTRUM', 'CARRIER', 'BEACON', 'LANTERN', 'HARBOR', 'COMET', 'ORBIT'];
    const HOSTS = ['GIBSON-7', 'KETTLE-NET', 'RELAY-LINK', 'NIGHT-SHIFT'];

    /** A small repeatable generator: the day decides the puzzle. */
    function seeded(seed) {
        let a = seed | 0;
        return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    }

    /** Letters moved `n` places along the alphabet (negative: back); everything else stays. */
    function caesar(text, n) {
        return text.replace(/[A-Za-z]/g, c => {
            const base = c <= 'Z' ? 65 : 97;
            return String.fromCharCode(((c.charCodeAt(0) - base + n) % 26 + 26) % 26 + base);
        });
    }

    /** The puzzle for a day number: host, shift, password, the files, the code in the safe. */
    function makePuzzle(day) {
        const r = seeded(day * 7919 + 13);
        const pick = list => list[Math.floor(r() * list.length) % list.length];
        const shift = 3 + Math.floor(r() * 20);
        const password = pick(WORDS);
        const host = pick(HOSTS);
        const code = String(1000 + Math.floor(r() * 9000));
        const note = `THE OPERATOR PASSWORD IS ${password}. DO NOT TELL ANYONE.`;
        return {
            host, shift, password, code,
            files: {
                'README.TXT': `${host} maintenance terminal.\nOperator notes are kept scrambled in NOTES.ENC.\nThe operator account is OPERATOR. The safe is in SAFE/.`,
                'LOG.TXT': `[03:10] backup complete\n[03:12] key rotation: the scramble shifts every letter ${shift} places along\n[03:15] night shift: all quiet. the cat is on the keyboard`,
                'NOTES.ENC': caesar(note, shift)
            },
            safe: { 'CODE.TXT': `LAUNCH CODE ${code}. (IT LAUNCHES NOTHING. THIS IS A GAME.)` }
        };
    }

    const dayNumber = now => Math.floor(now / 86400000);

    const gibson = {
        name: 'HACK THE GIBSON',
        play(h, done) {
            const now = h.now ? h.now() : new Date();
            const p = makePuzzle(dayNumber(now.getTime ? now.getTime() : now));
            let commands = 0, hints = 0, strikes = 0, user = 'GUEST', stage = 0;

            const bar = '\x1b[7m\x1b[K\x1b[0m\n';        // a reverse line across the screen: erase-to-end-of-line, not sixty characters
            h.out(`\n${bar}CONNECTED TO ${p.host}.  GUEST ACCESS.\nTHIS IS A PUZZLE. NO REAL SYSTEM IS TOUCHED. TYPE HELP.\n${bar}`);

            const score = () => Math.max(1, 100 - commands * 2 - hints * 15);
            const files = dir => (dir === 'SAFE' ? p.safe : p.files);
            const find = name => {
                const m = /^(?:(SAFE)\/)?(.+)$/i.exec(name.trim());
                if (!m) return null;
                const dir = m[1] ? 'SAFE' : '', f = m[2].toUpperCase();
                if (dir === 'SAFE' && user !== 'OPERATOR') return 'DENIED';
                return files(dir)[f] || null;
            };

            const hint = () => {
                hints++;
                const lines = [
                    'START WITH LS, THEN CAT EACH FILE. THE LOG SAYS HOW THE NOTES WERE SCRAMBLED.',
                    `THE NOTES WERE SHIFTED FORWARD ${p.shift} PLACES. ROT ${p.shift} NOTES.ENC SHIFTS THEM BACK.`,
                    'THE DECODED NOTE NAMES THE PASSWORD. LOGIN OPERATOR <PASSWORD>, THEN LS SAFE.',
                    'CAT SAFE/CODE.TXT.'
                ];
                return lines[Math.min(stage, lines.length - 1)];
            };

            const prompt = () => {
                h.out(`\n${user.toLowerCase()}@${p.host.toLowerCase()}> `);
                h.ask('line', run, 60);
            };

            const finish = (msg, points) => {
                h.out(`\n${msg}\n`);
                if (points) { h.out(`SCORE ${points}.\n`); if (h.scores) { const place = h.scores.add('HACK THE GIBSON', h.player || 'GUEST', points); if (place) h.out(`HIGH SCORES: NUMBER ${place}.\n`); } }
                done();
            };

            const run = text => {
                const [cmdRaw, ...rest] = text.trim().split(/\s+/);
                const cmd = (cmdRaw || '').toUpperCase(), arg = rest.join(' ');
                if (!cmd) return prompt();
                commands++;
                switch (cmd) {
                    case 'HELP': case '?':
                        commands--;
                        h.out('LS [DIR]   CAT FILE   ROT N TEXT-OR-FILE   LOGIN USER PASSWORD   WHOAMI   HINT (COSTS POINTS)   QUIT\n');
                        break;
                    case 'WHOAMI': h.out(`${user}\n`); break;
                    case 'LS': {
                        const dir = arg.toUpperCase().replace(/\/$/, '');
                        if (dir === 'SAFE') h.out(user === 'OPERATOR' ? Object.keys(p.safe).join('  ') + '\n' : 'PERMISSION DENIED.\n');
                        else h.out(Object.keys(p.files).join('  ') + '  SAFE/\n');
                        break;
                    }
                    case 'CAT': {
                        const f = find(arg);
                        if (f === 'DENIED') { h.out('PERMISSION DENIED.\n'); break; }
                        if (f === null) { h.out('NO SUCH FILE.\n'); break; }
                        h.out(f + '\n');
                        if (/CODE\.TXT$/i.test(arg)) return finish('THE SAFE OPENS. YOU ARE IN. NO SYSTEMS WERE HARMED.', score());
                        if (/NOTES\.ENC$/i.test(arg)) stage = Math.max(stage, 1);
                        if (/LOG\.TXT$/i.test(arg)) stage = Math.max(stage, 1);
                        break;
                    }
                    case 'ROT': {
                        const m = /^(-?\d+)\s+(.+)$/.exec(arg);
                        if (!m) { h.out('USAGE: ROT N TEXT-OR-FILE\n'); break; }
                        const file = find(m[2]);
                        const source = file && file !== 'DENIED' ? file : m[2];
                        const out = caesar(source, -Number(m[1]));
                        h.out(out + '\n');
                        if (Number(m[1]) === p.shift && out.includes(p.password)) stage = Math.max(stage, 2);
                        break;
                    }
                    case 'LOGIN': {
                        const [u, pw] = rest;
                        if (u && u.toUpperCase() === 'OPERATOR' && pw && pw.toUpperCase() === p.password) { user = 'OPERATOR'; stage = Math.max(stage, 3); h.out('WELCOME, OPERATOR.\n'); } else {
                            strikes++;
                            h.out(`LOGIN FAILED. (${strikes}/3)\n`);
                            if (strikes >= 3) return finish('TRACE COMPLETE. CONNECTION LOST. (THE SYSOP LAUGHS. TRY AGAIN TOMORROW, OR RIGHT NOW.)', 0);
                        }
                        break;
                    }
                    case 'HINT': h.out(hint() + '\n'); break;
                    case 'QUIT': case 'EXIT': case 'LOGOUT': case 'Q': return finish('CONNECTION CLOSED.', 0);
                    default: h.out(`${cmd}: COMMAND NOT FOUND. TYPE HELP.\n`); commands--;
                }
                prompt();
            };
            prompt();
        }
    };

    const api = { gibson, makePuzzle, caesar, seeded, dayNumber };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else Object.assign(root.DigitalRerun = root.DigitalRerun || {}, { gibson });
})(typeof window !== 'undefined' ? window : globalThis);
