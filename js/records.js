/*
 * records.js: what the board keeps between calls, in the browser, through a
 * `store` ({ get(key), set(key, value) }: strings, like localStorage's).
 *
 *   Wall      one-liners left by callers (the last 30)
 *   Callers   who called: a number, a time, how long (the last 20)
 *   Mail      notes to the sysop and his replies (the last 20)
 *   Poll      the week's question, your vote, the tally
 */
(function (root) {
    'use strict';

    const load = (store, key, fallback) => { try { return JSON.parse(store.get(key)) || fallback; } catch (e) { return fallback; } };
    const save = (store, key, value) => { try { store.set(key, JSON.stringify(value)); } catch (e) { /* full: not kept */ } };

    class Wall {
        constructor(store, now = Date.now) { this.store = store; this.now = now; }
        list() { return load(this.store, 'wall', []); }
        add(name, text) {
            const all = this.list();
            all.push({ when: this.now(), name: String(name || 'ANON').slice(0, 12), text: String(text).slice(0, 70) });
            save(this.store, 'wall', all.slice(-30));
        }
    }

    class Callers {
        constructor(store, now = Date.now) { this.store = store; this.now = now; }
        list() { return load(this.store, 'callers', []); }
        /** A call begins: its number. */
        start() {
            const n = (Number(this.store.get('callerCount')) || 0) + 1;
            try { this.store.set('callerCount', String(n)); } catch (e) { /* ignore */ }
            const all = this.list();
            all.push({ n, when: this.now(), minutes: null });
            save(this.store, 'callers', all.slice(-20));
            return n;
        }
        /** The call ends: how long it lasted. */
        end(n) {
            const all = this.list();
            const c = all.find(x => x.n === n);
            if (c) { c.minutes = Math.max(1, Math.round((this.now() - c.when) / 60000)); save(this.store, 'callers', all); }
        }
    }

    class Mail {
        constructor(store, now = Date.now) { this.store = store; this.now = now; }
        list() { return load(this.store, 'mail', []); }
        send(text) {
            const all = this.list();
            const id = (all.at(-1) ? all.at(-1).id : 0) + 1;
            all.push({ id, when: this.now(), text: String(text).slice(0, 300), reply: null, read: false });
            save(this.store, 'mail', all.slice(-20));
            return id;
        }
        setReply(id, reply) {
            const all = this.list();
            const m = all.find(x => x.id === id);
            if (m) { m.reply = String(reply).slice(0, 600); save(this.store, 'mail', all); }
        }
        unread() { return this.list().filter(m => m.reply && !m.read).length; }
        markRead() { const all = this.list(); all.forEach(m => { if (m.reply) m.read = true; }); save(this.store, 'mail', all); }
    }

    /** One question a week, 26 of them in turn. Votes: yours is kept; the regulars' tally is a fixed made-up one. */
    const QUESTIONS = [
        ['Best 8-bit CPU?', ['Z80', '6502', '8080', '6809']],
        ['Favourite way to spend a night shift?', ['Reading', 'Coding', 'Tea and staring', 'Sleeping']],
        ['Most useful CP/M program?', ['PIP', 'ED', 'DDT', 'WordStar']],
        ['Best baud rate?', ['300', '1200', '2400', '9600']],
        ['Which text adventure?', ['Zork', 'Colossal Cave', 'Kettle-7', 'Anything with a grue']],
        ['Phosphor colour?', ['Green', 'Amber', 'White', 'Whatever is on']],
        ['The best thing about a BBS?', ['The people', 'The files', 'The slowness', 'The one line']],
        ['Soup or sandwich on the night shift?', ['Soup', 'Sandwich', 'Toast', 'Tea only']],
        ['Which will outlive the others?', ['CP/M', 'The BBS', 'Floppy disks', 'The cat']],
        ['Favourite editor?', ['ED', 'WordStar', 'vi', 'A pencil']],
        ['How do you say XMODEM?', ['X-modem', 'Ex-modem', 'Zee-modem', 'Slowly']],
        ['Hex or decimal?', ['Hex', 'Decimal', 'Octal, fight me', 'Binary']],
        ['Best sci-fi computer?', ['WOPR', 'HAL', 'A ship\'s computer', 'The coffee machine']],
        ['Ideal terminal?', ['VT100', 'ADM-3A', 'VT52', 'A teletype']],
        ['What do you carry?', ['A floppy', 'A cable', 'A torch', 'A cat']],
        ['Keyboard feel?', ['Clicky', 'Mushy', 'Heavy', 'Ours is the one with the cat on it']],
        ['The signal is...', ['In the noise', 'Out there', 'Drifting', 'A letter']],
        ['Backup strategy?', ['Floppies', 'Faith', 'A second floppy', 'Panic']],
        ['Best beep?', ['The bell', 'The modem screech', 'The disk step', 'Silence']],
        ['Dial or dash?', ['Dial', 'Dash', 'Both', 'Neither']],
        ['A good bulletin is...', ['Short', 'Funny', 'Useful', 'A haiku']],
        ['Cats or computers?', ['Cats', 'Computers', 'Cats on computers', 'Yes']],
        ['Time of the best calls?', ['Midnight', '3 AM', 'Dawn', 'Any time']],
        ['Fortune cookies are...', ['Wise', 'Silly', 'Both', 'Data']],
        ['Favourite game of the board?', ['WOPR', 'Wumpus', 'Black Jack', 'The Gibson']],
        ['The best part of the night shift?', ['The quiet', 'The tea', 'The signals', 'The sunrise']]
    ];

    class Poll {
        constructor(store, now = Date.now) { this.store = store; this.now = now; }
        week() { return Math.floor(this.now() / (7 * 86400000)); }
        question() {
            const w = this.week();
            const [q, options] = QUESTIONS[w % QUESTIONS.length];
            return { week: w, q, options };
        }
        mine() { return load(this.store, 'poll', {})[this.week()]; }
        vote(i) {
            const all = load(this.store, 'poll', {});
            if (all[this.week()] !== undefined) return false;
            all[this.week()] = i;
            save(this.store, 'poll', all);
            return true;
        }
        /** The tally: the regulars' made-up votes for this week's question, plus yours. */
        tally() {
            const { week, options } = this.question();
            const counts = options.map((_, i) => 4 + ((week * 31 + i * 17 + 5) * 2654435761 >>> 0) % 17);
            const mine = this.mine();
            if (mine !== undefined) counts[mine]++;
            return counts;
        }
    }

    const api = { Wall, Callers, Mail, Poll, QUESTIONS };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else Object.assign(root.DigitalRerun = root.DigitalRerun || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
