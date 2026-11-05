/*
 * adventure.js: KETTLE-7, a small text adventure (a WOPR game). A night shift
 * at a relay station: the dish is unplugged, the dial is stuck, a letter must
 * go out before dawn. Eight rooms, five things, one cat.
 *
 * Verbs: N S E W U D (or GO), LOOK, TAKE, DROP, INV, EXAMINE, USE, READ, PET,
 * DRINK, SEND, HINT (asks the sysop's model when it is connected, else the
 * station's own hint), HELP, QUIT. Score: 100 points, less one for every
 * three moves; PIXEL and the tea are worth a few.
 */
(function (root) {
    'use strict';

    const ROOMS = {
        control: { name: 'CONTROL ROOM', exits: { w: 'corridor', e: 'kitchen', u: 'roof' }, desc: () => 'Racks hum. A big spectrogram screen shows only static. A dial sits under it, stuck on the wrong number. A ladder goes up to the roof. A corridor leads west, the kitchen is east.' },
        corridor: { name: 'CORRIDOR', exits: { e: 'control', w: 'storage', s: 'bunk' }, desc: () => 'A narrow corridor with a flickering strip light. West is the storage room, south is the bunk room, east is the control room.' },
        storage: { name: 'STORAGE ROOM', exits: { e: 'corridor' }, dark: true, desc: () => 'Shelves of spares, boxes of fuses, a smell of old dust.' },
        bunk: { name: 'BUNK ROOM', exits: { n: 'corridor' }, desc: () => 'A narrow bunk, a blanket with cat hair on it, a shelf. The way out is north.' },
        kitchen: { name: 'KITCHEN', exits: { w: 'control' }, desc: () => 'A kettle, a mug, a drawer that sticks. The control room is west.' },
        roof: { name: 'ROOF', exits: { d: 'control' }, desc: s => `The relay dish stands on the roof, wind in its struts.${s.dish ? ' A cable runs from the dish to the hatch. It hums.' : ' A cable socket on its base is empty: someone unplugged it.'} The ladder goes down.` }
    };

    const THINGS = {
        torch: { name: 'TORCH', words: ['torch', 'flashlight', 'light'], at: 'bunk', desc: 'A heavy torch. It works.' },
        cable: { name: 'CABLE', words: ['cable', 'cord', 'lead'], at: 'storage', hidden: true, desc: 'A long uplink cable with a weatherproof plug at each end.' },
        key: { name: 'TUNING KEY', words: ['key', 'tuning', 'tuner'], at: 'kitchen', hidden: true, desc: 'A small brass key stamped TUNE.' },
        letter: { name: 'LETTER', words: ['letter', 'envelope', 'message'], at: 'control', desc: 'A sealed letter addressed to someone out past the relay. It must go out before dawn.' },
        tea: { name: 'MUG OF TEA', words: ['tea', 'mug', 'cup'], at: 'kitchen', desc: 'A mug of tea, still warm. Pixel knows when you are making it.' }
    };

    const POINTS = { torch: 5, cable: 10, key: 10, dish: 20, tuned: 25, sent: 30 };

    const find = (words, text) => Object.keys(THINGS).find(k => THINGS[k].words.some(w => text.split(/\s+/).includes(w)));

    function newState() {
        return { room: 'bunk', moves: 0, points: 0, got: {}, dish: false, tuned: false, pixel: 'kitchen', petted: false, tea: false,
            where: Object.fromEntries(Object.entries(THINGS).map(([k, t]) => [k, t.at])), seen: {} };
    }

    function hintFor(s) {
        if (!s.got.torch && s.where.torch !== 'inv') return 'The storage room is dark. A torch might be in the bunk room.';
        if (s.where.cable !== 'inv' && !s.dish) return 'With the torch, search the storage room. A cable is what the dish wants.';
        if (!s.dish) return 'Take the cable up the ladder to the roof and USE it there.';
        if (s.where.key !== 'inv' && !s.tuned) return 'Pixel sits where something small is hidden. Try the kitchen, and LOOK.';
        if (!s.tuned) return 'Back in the control room: USE the key on the dial.';
        return 'The letter is on the desk in the control room. SEND it.';
    }

    const adventure = {
        name: 'KETTLE-7',
        play(h, done) {
            const s = newState();
            const out = h.out;
            const here = () => Object.keys(THINGS).filter(k => s.where[k] === s.room && !(THINGS[k].hidden && !s.seen[k]));
            const dark = () => ROOMS[s.room].dark && s.where.torch !== 'inv';

            const look = () => {
                const r = ROOMS[s.room];
                out(`\n${r.name}\n`);
                if (dark()) { out('It is pitch dark. You might be eaten by a grue, or at least trip over something. East is the corridor.\n'); return; }
                out(r.desc(s) + '\n');
                const things = here().map(k => THINGS[k].name);
                if (things.length) out(`You see: ${things.join(', ')}.\n`);
                if (s.pixel === s.room) out('PIXEL the cat is here, being a cat.\n');
            };
            const award = key => { if (!s.got[key]) { s.got[key] = true; s.points += POINTS[key] || 0; } };

            const finish = () => {
                const score = Math.max(1, s.points + Math.min(5, s.petted ? 3 : 0) + (s.tea ? 2 : 0) - Math.floor(s.moves / 3));
                out(`\nTHE LETTER GOES OUT AT DAWN. THE RELAY HUMS. PIXEL PURRS ON THE KEYBOARD.\nYOU FINISHED IN ${s.moves} MOVES. SCORE ${score}.\n`);
                if (h.scores) { const place = h.scores.add('KETTLE-7', h.player || 'GUEST', score); if (place) out(`HIGH SCORES: NUMBER ${place}.\n`); }
                done();
            };

            const step = text => {
                const words = text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\b(the|a|an|to|at|on|with|in)\b/g, ' ').replace(/\s+/g, ' ').trim();
                const [verb = '', ...rest] = words.split(' ');
                const noun = rest.join(' ');
                if (!verb) return prompt();
                const dirs = { n: 'n', north: 'n', s: 's', south: 's', e: 'e', east: 'e', w: 'w', west: 'w', u: 'u', up: 'u', d: 'd', down: 'd' };
                s.moves++;
                const go = d => {
                    const to = ROOMS[s.room].exits[d];
                    if (!to) { out('You cannot go that way.\n'); return; }
                    s.room = to;
                    if (to === 'storage' && s.where.torch === 'inv') s.seen.cable = true;
                    look();
                };
                if (dirs[verb]) { go(dirs[verb]); return prompt(); }
                switch (verb) {
                    case 'go': case 'walk': case 'climb': if (dirs[noun]) go(dirs[noun]); else out('Go where?\n'); break;
                    case 'look': case 'l': look(); break;
                    case 'inventory': case 'inv': case 'i': {
                        const mine = Object.keys(THINGS).filter(k => s.where[k] === 'inv').map(k => THINGS[k].name);
                        out(mine.length ? `You carry: ${mine.join(', ')}.\n` : 'You carry nothing but a night shift of tiredness.\n');
                        break;
                    }
                    case 'take': case 'get': case 'grab': {
                        const k = find(null, noun);
                        if (!k) { out('Take what?\n'); break; }
                        if (s.where[k] === 'inv') { out('You already have it.\n'); break; }
                        if (s.where[k] !== s.room || (dark() && k !== 'torch') || (THINGS[k].hidden && !s.seen[k])) { out('You do not see that here.\n'); break; }
                        s.where[k] = 'inv';
                        out('Taken.\n');
                        if (k === 'torch' || k === 'cable' || k === 'key') award(k);
                        break;
                    }
                    case 'drop': {
                        const k = find(null, noun);
                        if (!k || s.where[k] !== 'inv') { out('You do not have that.\n'); break; }
                        s.where[k] = s.room;
                        out('Dropped.\n');
                        break;
                    }
                    case 'examine': case 'x': case 'inspect': case 'read': {
                        const k = find(null, noun);
                        if (k && (s.where[k] === 'inv' || (s.where[k] === s.room && !dark()))) { out(THINGS[k].desc + '\n'); break; }
                        if (/dial/.test(noun)) { out(s.tuned ? 'The dial sits on the right number.\n' : 'A dial with a keyhole beside it, stuck on the wrong number. It needs a small key.\n'); break; }
                        if (/screen|spectrogram/.test(noun)) { out(s.tuned && s.dish ? 'A bright trace: the uplink is alive.\n' : 'Static. Only static.\n'); break; }
                        if (/dish/.test(noun) && s.room === 'roof') { out(s.dish ? 'It hums.\n' : 'The dish needs its cable.\n'); break; }
                        if (/pixel|cat/.test(noun) && s.pixel === s.room) { out('A grey cat with opinions about the spectrogram.\n'); break; }
                        if (/shelf|shelves|boxes/.test(noun) && s.room === 'storage' && !dark()) { out('Behind a box of fuses you notice a coiled cable.\n'); s.seen.cable = true; break; }
                        out('Nothing special.\n');
                        break;
                    }
                    case 'search': case 'open': {
                        if (s.room === 'storage' && !dark()) { out('You push the boxes aside: a coiled cable.\n'); s.seen.cable = true; break; }
                        if (s.room === 'kitchen' && (noun === '' || /drawer/.test(noun))) { out(s.seen.key ? 'The drawer is empty now.\n' : 'The drawer sticks, then gives: a small brass key.\n'); s.seen.key = true; break; }
                        out('Nothing to open.\n');
                        break;
                    }
                    case 'use': {
                        const k = find(null, noun);
                        if (!k || s.where[k] !== 'inv') { out('You do not have that.\n'); break; }
                        if (k === 'cable') { if (s.room === 'roof' && !s.dish) { s.dish = true; award('dish'); out('You plug the cable into the dish. A low hum rises. The dish is live.\n'); } else out('There is nothing to plug it into here.\n'); break; }
                        if (k === 'key') { if (s.room === 'control' && !s.tuned) { s.tuned = true; award('tuned'); out('The key turns. The dial clicks to the right number, and the static resolves into a clean trace.\n'); } else out('It fits nothing here.\n'); break; }
                        if (k === 'torch') { out('It is already on, in a way.\n'); break; }
                        if (k === 'tea') { out('Try DRINK.\n'); break; }
                        out('Nothing happens.\n');
                        break;
                    }
                    case 'tune': case 'turn': if (s.room === 'control') { out(s.tuned ? 'The dial is already right.\n' : 'The dial will not turn without a key.\n'); } else out('Nothing here to tune.\n'); break;
                    case 'pet': case 'stroke': case 'feed':
                        if (/pixel|cat/.test(noun) && s.pixel === s.room) { s.petted = true; out('Pixel purrs. She glances toward the kitchen drawer, then back at you.\n'); s.seen.key = true; } else out('There is no cat here.\n');
                        break;
                    case 'drink': case 'sip': if (s.where.tea === 'inv') { s.tea = true; out('Hot, sweet and strong. The night shift improves.\n'); } else out('You have nothing to drink.\n'); break;
                    case 'send': case 'deliver': case 'transmit': {
                        if (s.room !== 'control') { out('The uplink is in the control room.\n'); break; }
                        if (s.where.letter !== 'inv') { out('You have no letter to send.\n'); break; }
                        if (!s.dish) { out('The dish is unplugged. Nothing will leave the roof.\n'); break; }
                        if (!s.tuned) { out('The dial is stuck: the uplink is on the wrong number.\n'); break; }
                        award('sent');
                        return finish();
                    }
                    case 'hint': case 'help': {
                        if (verb === 'help') { out('N S E W U D, LOOK, TAKE, DROP, INV, EXAMINE, USE, SEARCH, PET, DRINK, SEND, HINT, QUIT.\n'); break; }
                        const fallback = hintFor(s);
                        s.moves += 2;
                        if (h.sysop && h.sysop.connected) {
                            out('Pixel flicks an ear. The sysop thinks about it...\n');
                            h.sysop.converse('You are the sysop of a night-shift relay station, giving a one-sentence hint in a text adventure. The player should: take the torch from the bunk room, find the cable in the storage room, plug it into the roof dish, find the key in the kitchen drawer, use it on the dial in the control room, then send the letter. Give only the next useful hint, in one short sentence, plain ASCII.', [], `State: ${hintFor(s)}`)
                                .then(t => { out((t || fallback) + '\n'); prompt(); });
                            return;
                        }
                        out(fallback + '\n');
                        break;
                    }
                    case 'quit': case 'q': case 'exit': out('You put down the torch. The relay can wait until tomorrow.\n'); return done();
                    default: out('I do not understand that.\n');
                }
                prompt();
            };
            const prompt = () => { out('\n> '); h.ask('line', step, 40); };

            out('\nKETTLE-7. A RELAY STATION, NIGHT SHIFT. THE LETTER MUST GO OUT BEFORE DAWN. TYPE HELP.\n');
            look();
            prompt();
        }
    };

    const api = { adventure, ROOMS, THINGS, hintFor, newState };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else Object.assign(root.DigitalRerun = root.DigitalRerun || {}, { adventure });
})(typeof window !== 'undefined' ? window : globalThis);
