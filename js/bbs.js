/*
 * bbs.js: the bulletin board you reach by dialing. It runs in the page, and
 * is what answers an ATDT in js/devices/directory.js.
 *
 *   T  the time and date          M  the moon
 *   B  the bulletin board         W  the weather desk (online, off by default)
 *   G  goodbye
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

    /* ---------- a line of text, cleaned ---------- */

    const clean = s => s.replace(/[^\x20-\x7e]/g, '').trim();

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
            this.out(`${CLEAR}${REV}  DIGITAL RERUN BBS  ${OFF}  1200 baud, 24 hours a day, one line\n\n` +
                `Welcome, caller. The sysop is asleep; the board is not.\n`);
            this.menu();
        }

        menu() {
            this.out(`\n${BOLD}T${OFF}ime  ${BOLD}M${OFF}oon  ${BOLD}B${OFF}ulletins  ${BOLD}W${OFF}eather  ${BOLD}G${OFF}oodbye   ? `);
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
                default: /* busy: the caller types ahead; it is dropped */
            }
        }

        command(key) {
            switch (key) {
                case 'T': return this.time();
                case 'M': return this.moonPage();
                case 'B': return this.bulletins();
                case 'W': return this.weather();
                case 'G': return this.goodbye();
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

        close() { this.closed = true; }
    }

    /** The function a directory entry is: dials make a Session. */
    function bbs(services) {
        return link => new Session(link, services);
    }

    const api = { bbs, Session, moon, moonArt, weatherPage, sky, MemoryBoard, StoredBoard };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else Object.assign(root.DigitalRerun = root.DigitalRerun || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
