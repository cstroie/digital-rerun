/*
 * twentyq.js: TWENTY QUESTIONS, a WOPR game, in two minds.
 *
 *   1  You think of an animal and WOPR guesses it, asking yes/no questions.
 *      It learns: when it is wrong it asks what the animal was and for a
 *      question that tells the two apart, and keeps that in the browser
 *      (h.store). Works offline.
 *   2  WOPR thinks of something and you ask: only when the sysop's language
 *      model is connected (h.sysop.converse). The program holds the secret
 *      and checks guesses itself; the model only answers Yes, No or Sometimes.
 */
(function (root) {
    'use strict';

    /** The tree it starts with: a question node is { q, yes, no }, an animal { a }. */
    const SEED = () => ({
        q: 'Does it live in water?',
        yes: { q: 'Does it have legs?', yes: { a: 'a frog' }, no: { q: 'Is it a mammal?', yes: { a: 'a dolphin' }, no: { a: 'a fish' } } },
        no: { q: 'Does it fly?', yes: { a: 'a bird' }, no: { q: 'Does it purr?', yes: { a: 'a cat' }, no: { q: 'Does it have a trunk?', yes: { a: 'an elephant' }, no: { a: 'a dog' } } } }
    });

    const SECRETS = [
        ['a cat', 'animal'], ['an elephant', 'animal'], ['a penguin', 'animal'], ['a spider', 'animal'], ['a whale', 'animal'], ['a frog', 'animal'],
        ['a bicycle', 'object'], ['a lighthouse', 'object'], ['a floppy disk', 'object'], ['a telephone', 'object'], ['a toaster', 'object'], ['a kettle', 'object'],
        ['a violin', 'object'], ['a compass', 'object'], ['a candle', 'object'], ['a keyboard', 'object'], ['a modem', 'object'], ['a telescope', 'object'],
        ['the moon', 'place or thing in nature'], ['a volcano', 'place or thing in nature'], ['the ocean', 'place or thing in nature'], ['a rainbow', 'place or thing in nature'],
        ['a rocket', 'vehicle'], ['a submarine', 'vehicle'], ['a train', 'vehicle'], ['a hot air balloon', 'vehicle'],
        ['an apple', 'food'], ['a pizza', 'food'], ['a cup of tea', 'food'], ['bread', 'food']
    ];

    const NAMES = s => s.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\b(a|an|the|is|it|your|my|its|guess|i|think|its)\b/g, ' ').replace(/\s+/g, ' ').trim();

    /** Does the guess name the secret? Plain words, articles ignored; a plural is fine. */
    function sameThing(guess, secret) {
        const g = NAMES(guess), s = NAMES(secret);
        return !!g && (g === s || g === s + 's' || g + 's' === s);
    }

    /** What to ask the model to be. */
    const referee = (secret, kind) => `We are playing twenty questions. The secret is ${secret} (${kind}). Answer only with one of: Yes. No. Sometimes. ` +
        'Never say what the secret is, never give hints, and answer in at most three words, plain ASCII.';

    const twentyq = {
        name: 'TWENTY QUESTIONS',
        play(h, done) {
            const connected = !!(h.sysop && h.sysop.connected);
            h.out('\nTWENTY QUESTIONS.\n');
            if (!connected) return guesser();
            h.out('\n1  YOU THINK OF AN ANIMAL AND I GUESS IT (I LEARN)\n2  I THINK OF SOMETHING AND YOU ASK (THE SYSOP HELPS ME ANSWER)\n\nWHICH? ');
            h.ask('key', k => (k === '2' ? asker() : k === '1' ? guesser() : (h.out('\n'), done())));

            /* --- WOPR guesses --- */
            function guesser() {
                let tree;
                try { tree = JSON.parse(h.store && h.store.get('twentyq')) || SEED(); } catch (e) { tree = SEED(); }
                const save = () => { try { if (h.store) h.store.set('twentyq', JSON.stringify(tree)); } catch (e) { /* not kept */ } };
                h.out('\nTHINK OF AN ANIMAL. PRESS A KEY WHEN YOU HAVE ONE (Q LEAVES).\n');
                h.ask('key', k => { if (k === 'Q') { h.out('\n'); return done(); } walk(tree, null, null, 1); });

                function yn(text, fn) { h.out(`${text} (Y/N)? `); h.ask('key', k => { if (k === 'Y' || k === 'N') { h.out(k + '\n'); fn(k === 'Y'); } else { h.out('\n'); yn(text, fn); } }); }

                function walk(node, parent, side, n) {
                    if (node.a) {
                        return yn(`\nIS IT ${node.a.toUpperCase()}`, right => {
                            if (right) { h.out(`\nI GOT IT IN ${n} QUESTIONS.\n`); return again(); }
                            learn(node, parent, side);
                        });
                    }
                    yn(`${n}. ${node.q.toUpperCase()}`, yes => walk(yes ? node.yes : node.no, node, yes ? 'yes' : 'no', n + 1));
                }

                function learn(leaf, parent, side) {
                    h.out('\nI GIVE UP. WHAT WAS IT (E.G. A GOAT)? ');
                    h.ask('line', name => {
                        name = name.replace(/[^\x20-\x7e]/g, '').trim().toLowerCase();
                        if (!name) return again();
                        h.out(`GIVE ME A YES/NO QUESTION THAT IS YES FOR ${name.toUpperCase()} AND NO FOR ${leaf.a.toUpperCase()}:\n? `);
                        h.ask('line', q => {
                            q = q.replace(/[^\x20-\x7e]/g, '').trim();
                            if (!q) return again();
                            if (!/\?$/.test(q)) q += '?';
                            const fresh = { q, yes: { a: name }, no: { a: leaf.a } };
                            if (parent) parent[side] = fresh; else tree = fresh;
                            if (JSON.stringify(tree).length < 20000) save();
                            h.out('\nTHANK YOU. I WILL REMEMBER THAT.\n');
                            again();
                        }, 70);
                    }, 40);
                }

                function again() { yn('\nANOTHER ANIMAL', yes => (yes ? guesserAgain() : done())); }
                function guesserAgain() { h.out('\nTHINK OF AN ANIMAL. PRESS A KEY.\n'); h.ask('key', () => walk(tree, null, null, 1)); }
            }

            /* --- you ask, the sysop answers --- */
            function asker() {
                const [secret, kind] = SECRETS[Math.floor(h.random() * SECRETS.length) % SECRETS.length];
                const history = [];
                h.out(`\nI AM THINKING OF SOMETHING (${kind.toUpperCase()}). ASK YES/NO QUESTIONS. TO GUESS, TYPE GUESS <WHAT>. TWENTY QUESTIONS. Q GIVES UP.\n`);
                const turn = n => {
                    h.out(`\n${n}/20? `);
                    h.ask('line', async text => {
                        text = text.replace(/[^\x20-\x7e]/g, '').trim();
                        if (!text) return turn(n);
                        if (/^q(uit)?$/i.test(text)) { h.out(`\nIT WAS ${secret.toUpperCase()}.\n`); return done(); }
                        // GUESS <x> is a guess; "is it a <x>?" that names the secret wins too; any other line is a question
                        const guess = /^guess\s+(.+?)\??$/i.exec(text), named = /^is it (?:a|an|the)\s+(.+?)\??$/i.exec(text);
                        if ((guess && sameThing(guess[1], secret)) || (named && sameThing(named[1], secret))) { h.out(`\nYES! IT WAS ${secret.toUpperCase()}. YOU GOT IT IN ${n}.\n`); return done(); }
                        let answer = guess ? 'No.' : await h.sysop.converse(referee(secret, kind), history, text);
                        if (!answer) answer = 'The line crackled. Ask again?';
                        h.out(`${answer}\n`);
                        if (!guess) history.push({ role: 'user', content: text }, { role: 'assistant', content: answer });
                        if (n >= 20) { h.out(`\nOUT OF QUESTIONS. IT WAS ${secret.toUpperCase()}.\n`); return done(); }
                        turn(n + 1);
                    }, 70);
                };
                turn(1);
            }
        }
    };

    const api = { twentyq, sameThing, referee, SEED, SECRETS };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else Object.assign(root.DigitalRerun = root.DigitalRerun || {}, { twentyq });
})(typeof window !== 'undefined' ? window : globalThis);
