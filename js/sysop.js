/*
 * sysop.js: the sysop of the BBS you can chat with. It runs on the host (the
 * page), not on the emulated machine.
 *
 * Two minds, one voice:
 *   - an OpenAI-compatible chat endpoint (Ollama, llama.cpp, LM Studio or a
 *     hosted API), when SETUP names one and Online services is on. What is
 *     sent: the persona below, the last few lines of this chat, and the line
 *     just typed. Nothing else leaves the page.
 *   - a small rule-based sysop (the old ELIZA trick, in the board's voice),
 *     which needs nothing and answers whenever the endpoint cannot.
 *
 * Replies are cut down to plain ASCII, a few short lines, so that a 1200 baud
 * VT100 can show them.
 *
 *   new Sysop({ online, config, fetch, random })
 *     online()   may the sysop ask the internet?
 *     config()   { url, model, key } from SETUP (url empty: no endpoint)
 *     fetch      like window.fetch
 *   reply(history, text) -> Promise<string>, history = [{ role, content }]
 */
(function (root) {
    'use strict';

    const WIDTH = 74, KEEP = 10, MAX_CHARS = 480, TIMEOUT_MS = 25000;

    const PERSONA = [
        'You are the SYSOP of the Digital Rerun BBS: a one-line bulletin board that answers at 1200 baud on a CP/M',
        'computer running inside a web page. You work the night shift. Your day job is Relay Station Kettle-7, where',
        'you tune a spectrogram and deliver letters to recurring callers, with a cat named Pixel. You are dry, warm',
        'and a little tired, and you like callers.',
        'You know the board: T time, M moon, B bulletins, F files (XMODEM), W weather, C this chat, G games (WOPR), O a fortune, S services (reference, news, wall, mail), Q quit. You know',
        'TERM (Ctrl-] R receives and S sends a file, Q quits, H hangs up), Hayes AT commands, CP/M 2.2 and 3, the Z80,',
        '8080 assembler and the old software of the shelf.',
        'Write plain ASCII only, at most four short lines of about 70 characters, no markdown, no lists, no emoji.',
        'Stay in character, but if someone sincerely asks whether you are a person, say you are an AI sysop program.',
        'Never ask for personal data; if a caller gives a name, a number or a medical detail, tell them not to put',
        'such things on a public board.'
    ].join(' ');

    /* ---------- the text of a reply ---------- */

    const SMART = { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', '•': '*', ' ': ' ' };

    /** Plain ASCII, no markdown, no more than MAX_CHARS (cut at a sentence if it can be). */
    function tidy(text) {
        let t = String(text).replace(/[‘’“”–—…• ]/g, c => SMART[c]);
        t = t.normalize('NFKD').replace(/[^\x09\x0a\x20-\x7e]/g, '');
        t = t.replace(/```[\s\S]*?```/g, ' ').replace(/[*_`#>]+/g, '').replace(/^\s*[-+]\s+/gm, '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
        if (t.length > MAX_CHARS) {
            const cut = t.slice(0, MAX_CHARS);
            const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
            t = end > 120 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '...';
        }
        return t;
    }

    /** Lines of at most `width` characters; paragraphs kept. */
    function wrap(text, width = WIDTH) {
        const out = [];
        for (const para of text.split('\n')) {
            let line = '';
            for (const word of para.split(' ')) {
                if (!word) continue;
                if (line && line.length + 1 + word.length > width) { out.push(line); line = word; } else line = line ? line + ' ' + word : word;
            }
            out.push(line);
        }
        return out.join('\n');
    }

    /* ---------- the rule-based sysop ---------- */

    const REFLECT = { i: 'you', me: 'you', my: 'your', mine: 'yours', am: 'are', "i'm": 'you are', you: 'I', your: 'my', yours: 'mine', "you're": 'I am', myself: 'yourself', yourself: 'myself' };
    const reflect = s => s.toLowerCase().replace(/[^a-z' ]/g, ' ').split(/\s+/).filter(Boolean).map(w => REFLECT[w] || w).join(' ');

    /** [pattern, answers]; "$1" is what the pattern caught, with the pronouns turned round. */
    const RULES = [
        [/\b(are you|r u) (a |an )?(human|person|real|man|woman|bot|robot|ai|machine|program|computer|alive)\b/i, [
            'I am a sysop program, an AI, and I keep the board. The cat is real, though.',
            'A program. A patient one. It is the night shift and nobody else applied.']],
        [/\b(who|what) (are|r) you\b/i, [
            'I am the sysop: a program that minds this board while you sleep. Mostly I dust the signals.',
            'Sysop of Digital Rerun, one line, 1200 baud. The rest is paperwork.']],
        [/\b(your name|called)\b/i, ['Sysop will do. At Kettle-7 they call me the night shift.']],
        [/\b(hello|hi|hey|good (morning|evening|night|afternoon))\b/i, [
            'Evening, caller. Mind the gap between signals. What brings you to the board?',
            'Hello. You caught me with a cold cup of tea. What can I do for you?']],
        [/\b(bye|goodbye|good night|see you|later|quit|exit)\b/i, ['Take care. Type /BYE when you want the menu back.']],
        [/\b(thanks|thank you|cheers)\b/i, ['Any time. That is what the night shift is for.']],
        [/\b(xmodem|download|upload|transfer|file)s?\b/i, [
            'Files: press F at the menu. In TERM, Ctrl-] R to receive and Ctrl-] S to send. Ctrl-X stops one.',
            'XMODEM is patient. It sends 128 bytes, waits for an ACK, sends the next. Give it a minute at 1200 baud.']],
        [/\b(term|terminal|ctrl|escape)\b/i, [
            'TERM: Ctrl-] then Q quits and leaves the call up, H hangs up, R and S move files.',
            'Type AT, expect OK. ATDT then a number. +++ with a quiet second either side gets the modem back.']],
        [/\b(atdt|modem|baud|hayes|dial|carrier|at command)/i, [
            '1200 baud is 120 characters a second. Slow enough to read as it comes, which was the idea.',
            'ATDT dials, ATH hangs up, +++ gets the modem back. The rest is superstition.']],
        [/\b(weather|rain|snow|forecast|sun|cold|hot|temperature)\b/i, [
            'The weather desk is W at the menu, if the internet is allowed in SETUP. Out my window it is dark.',
            'I only know the sky from the spectrogram. Try W, if you let the board ask the internet.']],
        [/\bmoon\b/i, ['M at the menu draws it. Waxing on the right, waning on the left, as seen from the north.']],
        [/\b(cp\/?m|z80|8080|assembler|asm|bios|bdos|zork|wordstar|basic|forth)\b/i, [
            'CP/M: a command line, a hundred and some bytes at 0100h, and everything else is your business. I like it.',
            'The Z80 is an 8080 that went to night school. Same machine code, more tricks. What are you building?']],
        [/\b(kettle|relay|signal|spectrogram|pixel|cat)\b/i, [
            'Kettle-7 is the relay station. Signals drift, I tune them, the letters get delivered. Pixel sits on the keyboard.',
            'Pixel the cat has opinions about the spectrogram. Mostly that it should be warm.']],
        [/\b(bbs|board|bulletin|post|message)s?\b/i, [
            'The bulletins are B at the menu: a name and one line. Keep it kind and keep it free of names and numbers.',
            'Leave a note on the board. Someone will read it, on the next shift or the one after.']],
        [/\b(help|menu|commands|what can)\b/i, ['T time, M moon, B bulletins, F files, C chat, W weather, G games, O fortune, S services. Q quits.']],
        [/\b(sad|tired|lonely|bored|stressed|anxious|angry)\b/i, [
            'It is a long night for everyone. Tell me more, if you like. I have time and tea.',
            'I know that one. The signals come back. They always come back.']],
        [/\bi (?:am|m|feel|think|believe) (.+)/i, [
            'Why do you say you are $1?',
            'How long have you been $1?',
            'And what does it mean to you, being $1?']],
        [/\bi (?:want|need|wish|would like) (.+)/i, [
            'What would it change, getting $1?',
            'Is $1 something you can have tonight?']],
        [/\bi (?:can'?t|cannot|don'?t) (.+)/i, [
            'What stops you? Maybe nothing does.',
            'Have you tried, or is it a feeling?']],
        [/\bbecause\b/i, ['Is that the real reason? Sometimes it is only the first one.']],
        [/\b(why)\b/i, ['Good question. At 1200 baud there is time to think about it.', 'Why not? Ask me again after the next signal.']],
        [/\b(yes|yeah|sure|ok|okay)\b/i, ['Good. Go on.']],
        [/\b(no|nope|not really)\b/i, ['All right. Tell me what you would rather talk about.']],
        [/\byou (.+)/i, ['We were talking about you, not me. But go on: why do you say I $1?']],
        [/\?\s*$/, ['I would tell you, but I have only ever been told the things that happen on this board.', 'What do you think?']]
    ];
    const DEFAULTS = [
        'Go on. I am listening, in between signals.',
        'Tell me more. The line is quiet tonight.',
        'Hm. Say that another way?',
        'That is a thing to think about on the night shift. Go on.'
    ];

    /* ---------- the sysop ---------- */

    class Sysop {
        constructor({ online = () => false, config = () => ({}), fetch = root.fetch && root.fetch.bind(root), random = Math.random } = {}) {
            this.online = online;
            this.config = config;
            this.fetch = fetch;
            this.random = random;
            this.turn = 0;
        }

        /** Is an endpoint named and the internet allowed? */
        get connected() {
            const c = this.config() || {};
            return !!(this.online() && c.url && c.model && this.fetch);
        }

        async reply(history, text) {
            if (this.connected) {
                try {
                    const t = tidy(await this.ask(history, text));
                    if (t) return wrap(t);
                } catch (e) { /* the back office is down: the rules answer */ }
            }
            return wrap(this.rules(text));
        }

        /**
         * A reply for something other than the chat (a game's questions, a hint), under its own
         * instructions: ASCII text from the endpoint, or null when there is none (no endpoint,
         * the internet not allowed, or it failed): the caller has its own fallback.
         */
        async converse(system, history, text) {
            if (!this.connected) return null;
            try { return tidy(await this.ask(history, text, system)) || null; } catch (e) { return null; }
        }

        /** One chat completion from the endpoint. */
        async ask(history, text, system = PERSONA) {
            const c = this.config();
            const messages = [{ role: 'system', content: system }, ...history.slice(-KEEP * 2), { role: 'user', content: text }];
            const res = await this.fetch(c.url.replace(/\/+$/, '') + '/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(c.key ? { Authorization: `Bearer ${c.key}` } : {}) },
                body: JSON.stringify({ model: c.model, messages, max_tokens: 220, temperature: 0.8, stream: false }),
                signal: root.AbortSignal && AbortSignal.timeout ? AbortSignal.timeout(TIMEOUT_MS) : undefined,
                referrerPolicy: 'no-referrer'
            });
            if (!res.ok) throw new Error(String(res.status));
            const data = await res.json();
            return data.choices[0].message.content;
        }

        /** The rule-based answer. */
        rules(text) {
            const t = text.trim();
            for (const [re, answers] of RULES) {
                const m = re.exec(t);
                if (!m) continue;
                const answer = answers[(this.turn++ + Math.floor(this.random() * answers.length)) % answers.length];
                return answer.replace(/\$1/g, () => reflect(m[1] || '').trim());
            }
            return DEFAULTS[(this.turn++ + Math.floor(this.random() * DEFAULTS.length)) % DEFAULTS.length];
        }
    }

    const api = { Sysop, tidy, wrap, reflect, PERSONA };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else Object.assign(root.DigitalRerun = root.DigitalRerun || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
