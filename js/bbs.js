/*
 * bbs.js: the bulletin board you reach by dialing. It runs in the page, and
 * is what answers an ATDT in js/devices/directory.js.
 *
 *   T  the time and date          M  the moon
 *   B  the bulletin board         W  the weather desk (online, off by default)
 *   F  the file area: download and upload by XMODEM (checksum or CRC); L, the software library of the shelf
 *   C  chat with the sysop (services.sysop: the page's, not the emulated machine's)
 *   G  games: WOPR (js/wopr.js)   O  a fortune (js/fortune.js)
 *   S  services: reference desk, news, sky, the wall, last callers, high scores, the weekly vote,
 *      art gallery, mail to the sysop, the dial directory (js/doors.js)
 *   Q  quit (hangs up)
 *
 * Output is plain 7-bit text with VT100 bold and reverse; the caller's
 * terminal needs nothing else. Commands are single keys, as on the boards it
 * remembers; a line (a name, a message, a city) ends with RETURN and may be
 * edited with backspace. The board echoes what is typed, as the other end of
 * a modem does.
 *
 * The things a board needs come in as `services`, so the page, the tests and
 * a later host can differ:
 *   now()        a Date
 *   board        { list() -> Promise<[{ when, name, text }]>, add(post) -> Promise }
 *   store        { get(key), set(key, value) }: small memories (the last city)
 *   online()     may the board ask the internet? (SETUP; off by default)
 *   fetchJson(url) -> Promise<object>
 *   files        { list() -> Promise<[{ name, size }]>, get(name) -> Promise<Uint8Array|null>,
 *                  put(name, bytes) -> Promise }
 *   baud()       the line's speed: a short sign-on at 300, a banner from 2400 (default 1200)
 *   library      { list() -> Promise<[{ id, name, files: [name] }]>, get(id, name) -> Promise<Uint8Array> }: the shelf's programs
 *   doors, wall, callers, mail, poll   the services (js/doors.js, js/records.js); callers and mail also
 *                    count a call and tell of replies at sign-on
 *   games, scores   more games for WOPR (js/games.js) and the high-score tables (js/scores.js)
 *   wopr, fortunes   the game (js/wopr.js) and the cookie jar (js/fortune.js); default: the page's
 *   random()     0 <= r < 1 (default Math.random)
 *   sysop        { reply(history, text) -> Promise<string> }; without one the sysop is away
 *   after(fn, ms) -> handle, cancel(handle): timers (default setTimeout, clearTimeout)
 */
(function (root) {
    'use strict';

    const CLEAR = '\x1b[2J\x1b[H', BOLD = '\x1b[1m', REV = '\x1b[7m', OFF = '\x1b[0m';
    const NAME_MAX = 12, TEXT_MAX = 70, CITY_MAX = 40, SHOWN = 8, KEPT = 50;
    const SYNODIC = 29.530588853, NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
    const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const pad2 = n => String(n).padStart(2, '0');

    /* ---------- the moon ---------- */

    /** Age in days since the new moon, the fraction lit, the name of the phase, days to the next new and full. */
    function moon(date) {
        const days = (date.getTime() - NEW_MOON) / 86400000;
        const age = ((days % SYNODIC) + SYNODIC) % SYNODIC;
        const phase = age / SYNODIC;
        const names = [[1.85, 'New moon'], [5.53, 'Waxing crescent'], [9.22, 'First quarter'], [12.91, 'Waxing gibbous'],
            [16.61, 'Full moon'], [20.30, 'Waning gibbous'], [23.99, 'Last quarter'], [27.68, 'Waning crescent']];
        const name = (names.find(([limit]) => age < limit) || [0, 'New moon'])[1];
        return {
            age, phase, name,
            lit: (1 - Math.cos(2 * Math.PI * phase)) / 2,
            toNew: SYNODIC - age,
            toFull: (SYNODIC / 2 - age + SYNODIC) % SYNODIC
        };
    }

    /** The moon drawn in `#` (lit) and `.` (dark), 11 rows; lit on the right while it waxes (northern sky). */
    function moonArt(phase) {
        const rows = [], r = 5, c = Math.cos(2 * Math.PI * phase);
        for (let y = -r; y <= r; y++) {
            const w = Math.sqrt(r * r - y * y);
            const half = Math.round(w * 2);                       // characters are about twice as tall as wide
            let line = '';
            for (let x = -2 * r; x <= 2 * r; x++) {
                if (Math.abs(x) > half) { line += ' '; continue; }
                const u = Math.min(w, Math.max(-w, x / 2));          // back to the circle's own units, inside the rim
                const e = 1e-9;                                     // the rim belongs to the lit side of a gibbous moon, not to a crescent
                const lit = phase <= 0.5 ? u > w * c - (phase > 0.25 ? e : 0) : u < -w * c + (phase < 0.75 ? e : 0);
                line += lit ? '#' : '.';
            }
            rows.push(line.replace(/\s+$/, ''));
        }
        return rows;
    }

    /* ---------- the weather ---------- */

    function sky(code) {
        if (code === 0) return 'Clear';
        if (code === 1) return 'Mainly clear';
        if (code === 2) return 'Partly cloudy';
        if (code === 3) return 'Overcast';
        if (code === 45 || code === 48) return 'Fog';
        if (code >= 51 && code <= 57) return 'Drizzle';
        if (code >= 61 && code <= 67) return 'Rain';
        if (code >= 71 && code <= 77) return 'Snow';
        if (code >= 80 && code <= 82) return 'Showers';
        if (code === 85 || code === 86) return 'Snow showers';
        if (code >= 95) return 'Thunderstorm';
        return 'Unsettled';
    }

    /** The weather desk's page as lines of text, from Open-Meteo's forecast and the place it was asked for. */
    function weatherPage(place, w) {
        const lines = [];
        const where = [place.name, place.country_code].filter(Boolean).join(', ');
        lines.push(`${BOLD}WEATHER DESK${OFF}  ${where}`, '');
        const c = w.current;
        lines.push(`Now  ${c.temperature_2m.toFixed(1)} C, ${sky(c.weather_code)}, wind ${Math.round(c.wind_speed_10m)} km/h, humidity ${c.relative_humidity_2m}%`, '');
        const d = w.daily, n = d.time.length;
        const lo = Math.min(...d.temperature_2m_min), hi = Math.max(...d.temperature_2m_max);
        const span = Math.max(1, hi - lo), width = 30;
        lines.push(`${REV} Day Date   ${'Low'.padStart(4)}  ${'High'.padStart(4)}  ${'Rain'.padStart(4)}  ${'Range'.padEnd(width)} ${'Sky'.padEnd(14)}${OFF}`);
        for (let i = 0; i < n; i++) {
            const day = DAYS[new Date(d.time[i] + 'T12:00:00Z').getUTCDay()].slice(0, 3);
            const a = Math.round((d.temperature_2m_min[i] - lo) / span * (width - 1));
            const b = Math.round((d.temperature_2m_max[i] - lo) / span * (width - 1));
            const bar = Array.from({ length: width }, (_, k) => (k >= a && k <= b ? '=' : '.')).join('');
            lines.push(` ${day} ${d.time[i].slice(5)}  ${d.temperature_2m_min[i].toFixed(0).padStart(4)}  ${d.temperature_2m_max[i].toFixed(0).padStart(4)}  ${d.precipitation_sum[i].toFixed(1).padStart(4)}  ${bar} ${sky(d.weather_code[i])}`);
        }
        lines.push('', `Temperatures in C, rain in mm. Source: open-meteo.com`);
        return lines;
    }

    /** What a fast line affords: a banner at 2400 baud and above (at 300 the sign-on is short). */
    const BANNER = [' ___ ___ ___ ___ _____ _   _   ___ ___ ___ _   _ _  _', '|   \\_ _/ __|_ _|_   _/_\\ | | | _ \\ __| _ \\ | | | \\| |', '| |) | | (_ | | |  | |/ _ \\| |_|   / _||   / |_| | .` |', '|___/___\\___|___| |_/_/ \\_\\____|_|_\\___|_|_\\\\___/|_|\\_|'].join('\n');

    /** Words wrapped to `width`. */
    function wrapText(text, width) {
        const out = [];
        let line = '';
        for (const word of text.split(/\s+/)) {
            if (line && line.length + 1 + word.length > width) { out.push(line); line = word; } else line = line ? line + ' ' + word : word;
        }
        out.push(line);
        return out.join('\n');
    }

    /* ---------- a line of text, cleaned ---------- */

    const clean = s => s.replace(/[^\x20-\x7e]/g, '').trim();

    /* ---------- XMODEM ---------- */

    const SOH = 1, EOT = 4, ACK = 6, NAK = 21, CAN = 24, EOF = 26, CRC_C = 67;
    const BLOCK = 128, XRETRIES = 10;

    function crc16(bytes) {
        let crc = 0;
        for (const b of bytes) {
            crc ^= b << 8;
            for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
        }
        return crc;
    }

    /** Block `n` (1-based) of `data` as it goes on the wire; checksum or CRC. */
    function xmodemBlock(data, n, crc) {
        const chunk = new Uint8Array(BLOCK).fill(EOF);
        chunk.set(data.subarray((n - 1) * BLOCK, n * BLOCK));
        const out = [SOH, n & 0xFF, ~n & 0xFF, ...chunk];
        if (crc) { const c = crc16(chunk); out.push(c >> 8, c & 0xFF); } else out.push(chunk.reduce((a, b) => (a + b) & 0xFF, 0));
        return out;
    }

    /* ---------- the files ---------- */

    const TEXT = s => Uint8Array.from(Array.from(s.replace(/\n/g, '\r\n') + '\x1a', c => c.charCodeAt(0) & 0xFF));
    /** What the board always has. HELLO.COM is a CP/M program: nine bytes of code and a greeting. */
    const BUILTIN_FILES = {
        'ABOUT.TXT': TEXT('This is the Digital Rerun BBS, a board that lives in your browser.\n' +
            'It answers at 1200 baud, one caller at a time, and is never busy.\n\n' +
            'Download files with XMODEM (TERM: Ctrl-] R). Upload yours (Ctrl-] S).\n' +
            'Uploads stay in this browser.\n'),
        'HELLO.COM': Uint8Array.from([0x11, 0x09, 0x01, 0x0E, 0x09, 0xCD, 0x05, 0x00, 0xC9,
            ...Array.from('Hello from the BBS!\r\n$', c => c.charCodeAt(0))])
    };
    const UPLOAD_MAX = 32768, UPLOADS_MAX = 262144;

    /** The file area in memory: the built-in files, then what callers uploaded. */
    class MemoryFiles {
        constructor(uploads = {}) { this.uploads = new Map(Object.entries(uploads)); }
        all() { return new Map([...Object.entries(BUILTIN_FILES), ...this.uploads]); }
        list() { return Promise.resolve([...this.all()].map(([name, data]) => ({ name, size: data.length }))); }
        get(name) { return Promise.resolve(this.all().get(name) || null); }
        put(name, bytes) {
            if (name in BUILTIN_FILES) return Promise.reject(new Error('reserved'));
            if (bytes.length > UPLOAD_MAX) return Promise.reject(new Error('too big'));
            const others = [...this.uploads].filter(([n]) => n !== name).reduce((t, [, d]) => t + d.length, 0);
            if (others + bytes.length > UPLOADS_MAX) return Promise.reject(new Error('full'));
            this.uploads.set(name, Uint8Array.from(bytes));
            return Promise.resolve();
        }
    }

    /** The file area with its uploads kept in the browser (localStorage, base64). */
    class StoredFiles extends MemoryFiles {
        constructor(storage, key = 'digitalrerun.bbs.files') {
            super();
            this.storage = storage;
            this.key = key;
            try {
                for (const [name, b64] of Object.entries(JSON.parse(storage.getItem(key)) || {})) {
                    this.uploads.set(name, Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
                }
            } catch (e) { this.uploads.clear(); }
        }
        put(name, bytes) {
            return super.put(name, bytes).then(() => {
                const o = {};
                for (const [n, d] of this.uploads) o[n] = btoa(String.fromCharCode(...d));
                try { this.storage.setItem(this.key, JSON.stringify(o)); } catch (e) { /* full: it stays in memory */ }
            });
        }
    }

    /** "name.ext" as CP/M files have it: upper case, 8.3, nothing else; null if it is not one. */
    function cpmName(text) {
        const m = /^([A-Za-z0-9$_-]{1,8})(?:\.([A-Za-z0-9$_-]{0,3}))?$/.exec(text.trim());
        return m ? (m[1] + (m[2] ? '.' + m[2] : '')).toUpperCase() : null;
    }

    /* ---------- the board ---------- */

    /** The bulletin board in memory: tests, and the page's fallback. */
    class MemoryBoard {
        constructor(posts = []) { this.posts = posts.slice(); }
        list() { return Promise.resolve(this.posts.slice()); }
        add(post) { this.posts.push(post); this.posts = this.posts.slice(-KEPT); return Promise.resolve(); }
    }

    /** The bulletin board kept in the browser (localStorage), so it is there next time. */
    class StoredBoard extends MemoryBoard {
        constructor(storage, key = 'digitalrerun.bbs.board') {
            super();
            this.storage = storage;
            this.key = key;
            try { this.posts = JSON.parse(storage.getItem(key)) || []; } catch (e) { this.posts = []; }
        }
        add(post) {
            return super.add(post).then(() => { try { this.storage.setItem(this.key, JSON.stringify(this.posts)); } catch (e) { /* full: it stays in memory */ } });
        }
    }

    /* ---------- a caller ---------- */

    class Session {
        constructor(link, services) {
            this.link = link;
            this.s = services;
            this.closed = false;
            this.mode = 'menu';              // menu | line | key | busy
            this.buffer = '';
            this.done = null;
            this.keyHandler = null;
            this.sign();
        }

        out(text) { if (!this.closed) this.link.receive(text.replace(/\r?\n/g, '\r\n')); }

        /* --- screens --- */

        sign() {
            let extra = '';
            if (this.s.callers) {
                const last = this.s.callers.list().at(-1);
                this.callerN = this.s.callers.start();
                const d = last && new Date(last.when);
                extra = `You are caller #${this.callerN}.${d ? ` The last call was ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} at ${pad2(d.getHours())}:${pad2(d.getMinutes())}.` : ''}\n`;
            }
            if (this.s.mail && this.s.mail.unread()) extra += `${BOLD}You have mail from the sysop${OFF}: S for services, then E.\n`;
            const baud = this.s.baud ? this.s.baud() : 1200;
            if (baud <= 300) this.out(`${CLEAR}DIGITAL RERUN BBS\n${extra.replace(/\x1b\[[0-9;]*m/g, '').split('\n')[0]}\n`);
            else this.out(`${CLEAR}${baud >= 2400 ? `${BOLD}${BANNER}${OFF}\n` : ''}${REV}  DIGITAL RERUN BBS  ${OFF}  ${baud} baud, 24 hours a day, one line\n\n` +
                `Welcome, caller. The sysop is asleep; the board is not.\n${extra}`);
            this.menu();
        }

        /** The call is over: how long it was. */
        endCall() {
            if (this.callerN && this.s.callers) this.s.callers.end(this.callerN);
            this.callerN = null;
        }

        menu() {
            this.out(`\n${BOLD}T${OFF}ime  ${BOLD}M${OFF}oon  ${BOLD}B${OFF}ulletins  ${BOLD}F${OFF}iles  ${BOLD}C${OFF}hat  ${BOLD}W${OFF}eather  ${BOLD}G${OFF}ames  f${BOLD}O${OFF}rtune  ${BOLD}S${OFF}ervices  ${BOLD}Q${OFF}uit   ? `);
            this.mode = 'menu';
        }

        time() {
            const d = this.s.now();
            this.out(`\n\nIt is ${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())} where you are.\n`);
            this.menu();
        }

        moonPage() {
            const m = moon(this.s.now());
            const art = moonArt(m.phase);
            this.out('\n\n' + art.map(l => '      ' + l).join('\n') +
                `\n\n${BOLD}${m.name}${OFF}, ${Math.round(m.lit * 100)}% lit, ${m.age.toFixed(1)} days old.\n` +
                `Full moon in ${m.toFull.toFixed(0)} days, new moon in ${m.toNew.toFixed(0)}.\n`);
            this.menu();
        }

        goodbye() {
            this.out(`\n\nThank you for calling. Mind the gap between signals.\n`);
            this.mode = 'busy';
            this.endCall();
            this.link.hangup();
        }

        /* --- the bulletin board --- */

        async bulletins() {
            this.mode = 'busy';
            let posts;
            try { posts = await this.s.board.list(); } catch (e) { posts = []; }
            const shown = posts.slice(-SHOWN);
            this.out(`\n\n${REV} BULLETINS ${OFF}  ${posts.length} on the board\n\n`);
            if (!shown.length) this.out('Nothing yet. Be the first.\n');
            for (const p of shown) {
                const d = new Date(p.when);
                this.out(`${BOLD}${p.name}${OFF}  ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}\n  ${p.text}\n`);
            }
            this.out(`\n${BOLD}P${OFF}ost a message, ${BOLD}Q${OFF}uit to the menu? `);
            this.ask('key', k => {
                if (k === 'P') this.post(); else { this.out('\n'); this.menu(); }
            });
        }

        post() {
            this.out('\n\nYour name? ');
            this.ask('line', name => {
                name = clean(name).slice(0, NAME_MAX) || 'ANON';
                this.out('Your message (one line)? ');
                this.ask('line', async text => {
                    text = clean(text).slice(0, TEXT_MAX);
                    if (!text) { this.out('Nothing posted.\n'); return this.menu(); }
                    this.mode = 'busy';
                    try { await this.s.board.add({ when: this.s.now().getTime(), name, text }); this.out('Posted. Thank you.\n'); }
                    catch (e) { this.out('The board is full of static. Not posted.\n'); }
                    this.menu();
                }, TEXT_MAX);
            }, NAME_MAX);
        }

        /* --- the file area --- */

        async files() {
            this.mode = 'busy';
            let list;
            try { list = await this.s.files.list(); } catch (e) { list = []; }
            this.out(`\n\n${REV} FILES ${OFF}  XMODEM, checksum or CRC\n\n`);
            for (const f of list) this.out(`${f.name.padEnd(13)}${String(f.size).padStart(7)} bytes  ${String(Math.ceil(f.size / BLOCK)).padStart(4)} blocks\n`);
            if (!list.length) this.out('Nothing here.\n');
            this.out(`\n${BOLD}D${OFF}ownload, ${BOLD}U${OFF}pload, ${this.s.library ? `${BOLD}L${OFF}ibrary, ` : ''}${BOLD}Q${OFF}uit to the menu? `);
            this.ask('key', k => {
                if (k === 'D') this.download(list);
                else if (k === 'U') this.upload();
                else if (k === 'L' && this.s.library) this.library();
                else { this.out('\n'); this.menu(); }
            });
        }

        download(list) {
            this.out('\n\nFile? ');
            this.ask('line', async text => {
                const name = cpmName(text);
                const data = name && await this.s.files.get(name);
                if (!data) { this.out('No such file.\n'); return this.menu(); }
                this.beginSend(name, data);
            }, 12);
        }

        /** The caller is to receive `data` by XMODEM. */
        beginSend(name, data) {
            this.out(`${name}: ${Math.ceil(data.length / BLOCK)} blocks, about ${Math.ceil(data.length * 10 / 120)} seconds.\n` +
                'Start your XMODEM receive now. Ctrl-X cancels.\n');
            this.xsend = { data, blocks: Math.ceil(data.length / BLOCK), n: 1, crc: false, state: 'wait', tries: 0 };
            this.mode = 'xsend';
            this.timeout(60000, () => this.xabort('Nobody answered. Back to the menu.'));
        }

        /** The software library: the shelf's programs, by XMODEM. */
        async library() {
            this.mode = 'busy';
            let disks = [];
            try { disks = await this.s.library.list(); } catch (e) { /* none */ }
            this.out(`\n\n${REV} SOFTWARE LIBRARY ${OFF}\n\n`);
            if (!disks.length) { this.out('The shelves are bare (or not reachable from here).\n'); return this.menu(); }
            disks.forEach((d, i) => this.out(`${String(i + 1).padStart(3)}  ${clean(d.name).padEnd(30).slice(0, 30)} ${d.files.length} files\n`));
            this.out('\nWhich disk (number, RETURN to leave)? ');
            this.ask('line', async text => {
                const d = disks[Number.parseInt(text, 10) - 1];
                if (!d) { this.out('\n'); return this.menu(); }
                this.out(`\n${BOLD}${clean(d.name)}${OFF}\n`);
                const cols = d.files.map(f => f.padEnd(13)).join('').match(/.{1,78}/g) || [];
                this.out(cols.join('\n') + '\n\nFile name? ');
                this.ask('line', async f => {
                    const name = d.files.find(x => x.toUpperCase() === f.trim().toUpperCase());
                    if (!name) { this.out('No such file.\n'); return this.menu(); }
                    let data = null;
                    try { data = await this.s.library.get(d.id, name); } catch (e) { /* not reachable */ }
                    if (!data) { this.out('The shelf would not give it up (offline?).\n'); return this.menu(); }
                    this.beginSend(cpmName(name) || name.toUpperCase(), data);
                }, 12);
            }, 3);
        }

        /** The receiver's byte while a file goes out. */
        xsendByte(b) {
            const x = this.xsend;
            if (b === CAN) return this.xabort('Cancelled.');
            if (x.state === 'wait') {
                if (b !== NAK && b !== CRC_C) return;
                x.crc = b === CRC_C;
                return this.xblock();
            }
            if (b === ACK) {
                x.tries = 0;
                if (x.state === 'eot') { this.clear(); this.mode = 'busy'; this.out('\n\nTransfer complete.\n'); return this.menu(); }
                if (x.n >= x.blocks) { x.state = 'eot'; return this.xeot(); }
                x.n++;
                return this.xblock();
            }
            if (b === NAK) {
                if (++x.tries > XRETRIES) return this.xabort('Too many errors.');
                return x.state === 'eot' ? this.xeot() : this.xblock();
            }
        }

        xblock() {
            const x = this.xsend;
            x.state = 'sent';
            this.link.receive(xmodemBlock(x.data, x.n, x.crc));
            this.timeout(20000, () => { if (++x.tries > XRETRIES) this.xabort('Lost the line.'); else this.xblock(); });
        }

        xeot() {
            this.link.receive([EOT]);
            this.timeout(20000, () => { if (++this.xsend.tries > XRETRIES) this.xabort('Lost the line.'); else this.xeot(); });
        }

        xabort(why) {
            this.clear();
            this.link.receive([CAN, CAN]);
            this.mode = 'busy';
            this.out(`\n\n${why}\n`);
            this.menu();
        }

        upload() {
            this.out('\n\nName for the file (8.3)? ');
            this.ask('line', text => {
                const name = cpmName(text);
                if (!name || name in BUILTIN_FILES) { this.out('Not a name I can use.\n'); return this.menu(); }
                this.out(`Start your XMODEM send now. Ctrl-X cancels.\n`);
                this.xrecv = { name, data: [], n: 1, step: 'soh', block: [], tries: 0, started: false };
                this.mode = 'xrecv';
                this.xnak();
            }, 12);
        }

        /** Ask for the first block, or again for the last. */
        xnak() {
            const x = this.xrecv;
            if (++x.tries > (x.started ? XRETRIES : 6)) return this.xabort('Nothing came. Back to the menu.');
            x.step = 'soh';
            x.block = [];
            this.link.receive([NAK]);
            this.timeout(x.started ? 5000 : 10000, () => this.xnak());
        }

        xrecvByte(b) {
            const x = this.xrecv;
            if (x.step === 'soh') {
                if (b === SOH) { x.step = 'body'; x.block = []; this.timeout(3000, () => this.xnak()); } else if (b === CAN) this.xabort('Cancelled.');
                else if (b === EOT) this.xfinish();
                return;
            }
            x.block.push(b);
            this.timeout(3000, () => this.xnak());
            if (x.block.length < 2 + BLOCK + 1) return;
            const [n, inv, ...rest] = x.block;
            const data = rest.slice(0, BLOCK), sum = rest[BLOCK];
            if ((n + inv) !== 0xFF || data.reduce((a, c) => (a + c) & 0xFF, 0) !== sum) return this.xnak();
            if (n === ((x.n - 1) & 0xFF)) { x.step = 'soh'; this.link.receive([ACK]); return this.timeout(5000, () => this.xnak()); }   // the last one again
            if (n !== (x.n & 0xFF)) return this.xabort('Out of step.');
            if (x.data.length + BLOCK > UPLOAD_MAX) return this.xabort('That file is too big.');
            x.data.push(...data);
            x.n++;
            x.tries = 0;
            x.started = true;
            x.step = 'soh';
            this.link.receive([ACK]);
            this.timeout(5000, () => this.xnak());
        }

        async xfinish() {
            const x = this.xrecv;
            this.clear();
            this.link.receive([ACK]);
            this.mode = 'busy';
            const bytes = x.data;
            try { await this.s.files.put(x.name, Uint8Array.from(bytes)); this.out(`\n\n${x.name} received, ${bytes.length} bytes. Thank you.\n`); } catch (e) { this.out(`\n\nThe file area could not keep ${x.name}.\n`); }
            this.menu();
        }

        timeout(ms, fn) {
            this.clear();
            this.timer = (this.s.after || setTimeout)(() => { this.timer = null; if (!this.closed) fn(); }, ms);
        }

        clear() {
            if (this.timer) (this.s.cancel || clearTimeout)(this.timer);
            this.timer = null;
        }

        /* --- the sysop --- */

        chat() {
            if (!this.s.sysop) {
                this.out('\n\nThe sysop has stepped away from the keyboard.\n');
                return this.menu();
            }
            this.history = [];
            this.out(`\n\n${REV} SYSOP ${OFF}  You are talking to the sysop, a program. /BYE leaves.\n` +
                'Please do not type names, numbers or medical details here.\n\n');
            this.chatPrompt();
        }

        chatPrompt() {
            this.out(`${BOLD}you>${OFF} `);
            this.ask('line', async text => {
                text = clean(text);
                if (/^\/?(bye|quit|exit|q)$/i.test(text)) { this.out(`${BOLD}sysop>${OFF} Take care. Mind the gap between signals.\n`); return this.menu(); }
                if (!text) return this.chatPrompt();
                this.out(`${BOLD}sysop>${OFF} (typing)`);
                let answer;
                try { answer = await this.s.sysop.reply(this.history, text); } catch (e) { answer = ''; }
                answer = clean(String(answer || '')).length ? String(answer) : 'The line crackled. Say that again?';
                this.out('\r\x1b[K' + `${BOLD}sysop>${OFF} ` + answer.replace(/\n/g, '\n       ') + '\n\n');
                this.history.push({ role: 'user', content: text }, { role: 'assistant', content: answer });
                this.history = this.history.slice(-20);
                this.chatPrompt();
            }, TEXT_MAX);
        }

        /* --- the services --- */

        services() {
            const doors = this.s.doors;
            if (!doors) { this.out('\n\nThe services desk is closed.\n'); return this.menu(); }
            this.out(`\n\n${REV} SERVICES ${OFF}\n\n`);
            const half = Math.ceil(doors.length / 2);
            for (let i = 0; i < half; i++) {
                const left = doors[i], right = doors[i + half];
                this.out(` ${BOLD}${left.key}${OFF}  ${left.title.padEnd(26)}${right ? `${BOLD}${right.key}${OFF}  ${right.title}` : ''}\n`);
            }
            this.out(`\n ${BOLD}Q${OFF}  back to the menu   ? `);
            this.ask('key', k => {
                const door = doors.find(d => d.key === k);
                if (!door) { this.out('\n'); return this.menu(); }
                this.mode = 'busy';
                door.run({ out: t => this.out(t), ask: (mode, fn, max) => this.ask(mode, fn, max), leave: () => this.services(), random: this.s.random || Math.random, s: this.s });
            });
        }

        /* --- WOPR --- */

        game() {
            this.mode = 'busy';
            const wopr = this.s.wopr;
            if (!wopr) { this.out('\n\nThe games room is locked.\n'); return this.menu(); }
            wopr({
                out: t => this.out(t),
                ask: (mode, fn, max) => this.ask(mode, fn, max),
                leave: () => { this.out('\n'); this.menu(); },
                random: this.s.random || Math.random,
                games: this.s.games, scores: this.s.scores, sysop: this.s.sysop, store: this.s.store, now: this.s.now
            });
        }

        /* --- a fortune --- */

        fortune() {
            const fortunes = this.s.fortunes;
            if (!fortunes) { this.out('\n\nThe cookie jar is empty.\n'); return this.menu(); }
            this.seen = this.seen || [];
            const i = fortunes.pick(this.s.random || Math.random, this.seen);
            this.seen = [...this.seen, i].slice(-20);
            const text = wrapText(fortunes.FORTUNES[i], 66).split('\n');
            this.out(`\n\n${REV} FORTUNE ${OFF}  ${i + 1} of ${fortunes.FORTUNES.length}\n\n${text.map(l => '  ' + l).join('\n')}\n\n` +
                `Another (${BOLD}Y${OFF}/N)? `);
            this.ask('key', k => { if (k === 'Y') this.fortune(); else { this.out('\n'); this.menu(); } });
        }

        /* --- the weather desk --- */

        weather() {
            if (!this.s.online()) {
                this.out(`\n\nThe weather desk is not answering.\n(It needs the internet: SETUP, Online services.)\n`);
                return this.menu();
            }
            const last = this.s.store.get('city') || '';
            this.out(`\n\nWEATHER DESK. Which city${last ? ` (RETURN for ${last})` : ''}?\n` +
                `The name is sent to open-meteo.com, nothing else.\n? `);
            this.ask('line', async city => {
                city = clean(city) || last;
                if (!city) return this.menu();
                this.mode = 'busy';
                this.out('\nCalling the desk...\n');
                try {
                    const geo = await this.s.fetchJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`);
                    const place = geo && geo.results && geo.results[0];
                    if (!place) { this.out(`No such place: ${city}.\n`); return this.menu(); }
                    const w = await this.s.fetchJson('https://api.open-meteo.com/v1/forecast' +
                        `?latitude=${place.latitude}&longitude=${place.longitude}` +
                        '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code' +
                        '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code&timezone=auto&forecast_days=4');
                    this.s.store.set('city', place.name);
                    this.out('\n' + weatherPage(place, w).join('\n') + '\n');
                } catch (e) {
                    this.out('The weather desk is not answering.\n');
                }
                this.menu();
            }, CITY_MAX);
        }

        /* --- input --- */

        /** Wait for a key ('key') or a line ('line', at most `max` characters) and give it to `fn`. */
        ask(mode, fn, max = 0) {
            this.mode = mode;
            this.buffer = '';
            this.max = max;
            this.done = fn;
        }

        send(byte) {
            if (this.closed) return;
            switch (this.mode) {
                case 'menu': return this.command(String.fromCharCode(byte).toUpperCase());
                case 'key': { const fn = this.done; this.mode = 'busy'; return fn(String.fromCharCode(byte).toUpperCase()); }
                case 'line': return this.edit(byte);
                case 'xsend': return this.xsendByte(byte);
                case 'xrecv': return this.xrecvByte(byte);
                default: /* busy: the caller types ahead; it is dropped */
            }
        }

        command(key) {
            switch (key) {
                case 'T': return this.time();
                case 'M': return this.moonPage();
                case 'B': return this.bulletins();
                case 'W': return this.weather();
                case 'F': return this.files();
                case 'C': return this.chat();
                case 'G': return this.game();
                case 'O': return this.fortune();
                case 'S': return this.services();
                case 'Q': return this.goodbye();
                case '?': case 'H': this.out('\n'); return this.menu();
                default: /* RETURN, line feed, noise: nothing */
            }
        }

        edit(byte) {
            if (byte === 13) {
                const fn = this.done, line = this.buffer;
                this.out('\n');
                this.mode = 'busy';
                return fn(line);
            }
            if (byte === 8 || byte === 127) {
                if (this.buffer.length) { this.buffer = this.buffer.slice(0, -1); this.out('\b \b'); }
                return;
            }
            if (byte < 32 || byte > 126 || (this.max && this.buffer.length >= this.max)) return;
            this.buffer += String.fromCharCode(byte);
            this.out(String.fromCharCode(byte));
        }

        close() { this.closed = true; this.clear(); this.endCall(); }
    }

    /** The function a directory entry is: dials make a Session. */
    function bbs(services) {
        return link => new Session(link, services);
    }

    const api = { bbs, Session, moon, moonArt, weatherPage, sky, MemoryBoard, StoredBoard, MemoryFiles, StoredFiles, BUILTIN_FILES, xmodemBlock, crc16, cpmName };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else Object.assign(root.DigitalRerun = root.DigitalRerun || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
