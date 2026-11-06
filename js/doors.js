/*
 * doors.js: the board's services, the "S" at its menu. Each door is
 * { key, title, run(h) }; h is { out, ask, leave, random, s } where s holds
 * the board's services (store, wall, callers, mail, poll, scores, sysop,
 * online, fetchJson, now). leave() returns to the services menu.
 *
 *   R reference desk   N news desk (online)   L the wall
 *   U last callers     H high scores          V this week's vote    A art gallery
 *   E mail to the sysop                       D dial directory
 *   X earthquakes (online)   O aurora (online)   W Wikipedia (online)
 *   T planets tonight (online)   I ISS passes (online)
 */
(function (root) {
    'use strict';

    const node = typeof module !== 'undefined' && module.exports;
    const ref = node ? require('./reference.js') : root.DigitalRerun.reference;

    const BOLD = '\x1b[1m', DIM = '\x1b[2m', REV = '\x1b[7m', OFF = '\x1b[0m';
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    // the cursor forward to a column (the terminal has no column move): from `start`, the visible text so far, to `target`
    const fwd = (start, visible, target) => `\x1b[${Math.max(1, target - start - visible.length)}C`;
    const pad2 = n => String(n).padStart(2, '0');
    const when = ms => { const d = new Date(ms); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
    const ascii = s => String(s).normalize('NFKD').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim();
    const wrap = (text, width = 74, indent = '') => {
        const lines = [];
        let line = '';
        for (const w of text.split(' ')) {
            if (line && (indent + line).length + 1 + w.length > width) { lines.push(indent + line); line = w; } else line = line ? line + ' ' + w : w;
        }
        lines.push(indent + line);
        return lines.join('\n');
    };
    /** A new page for a door (the bars, the crumb), or, with no screen to draw on, a plain heading. */
    const begin = (h, name, extra = '') => {
        if (h.page) { h.page(`SERVICES  >  ${name}`, extra); return '\n'; }
        return `\n\n${REV} ${name} ${OFF}${extra ? '  ' + extra : ''}\n\n`;
    };
    /** The door is done: a key first, if there is a screen to keep, then back to the services. */
    const finish = h => (h.pause ? h.pause(h.leave) : h.leave());
    /** A key, then `next` (no screen: straight on). */
    const finish2 = (h, next) => (h.pause ? h.pause(next) : next());
    /** A long text, a page at a time when there is a screen. */
    const show = (h, text, next) => (h.more ? h.more(text, next) : (h.out(text.endsWith('\n') ? text : text + '\n'), next()));

    /* ============================ reference ============================ */

    function reference(h) {
        const menu = () => {
            h.out(`${begin(h, 'REFERENCE DESK', 'press a key')}\x1b[K${BOLD}[A]${OFF} ASCII chart${fwd(1, '[A] ASCII chart', 27)}${BOLD}[C]${OFF} convert a number${fwd(27, '[C] convert a number', 52)}${BOLD}[B]${OFF} BDOS functions\n\x1b[K${BOLD}[I]${OFF} BIOS table${fwd(1, '[I] BIOS table', 27)}${BOLD}[T]${OFF} AT commands${fwd(27, '[T] AT commands', 52)}${BOLD}[O]${OFF} opcodes\n\x1b[K${BOLD}[V]${OFF} VT100 codes\n\n\x1b[K${BOLD}[Q]${OFF} back\n\n${BOLD}bbs>${OFF} `);
            h.ask('key', k => {
                const again = () => (h.pause ? h.pause(menu) : menu());
                const out = text => show(h, `\n${text}`, again);
                if (k === 'A') return out(ref.asciiChart().join('\n'));
                if (k === 'B') return out(`${'FN'.padEnd(4)}${'NAME'.padEnd(22)}IN / OUT\n` + ref.BDOS.map(([n, name, io]) => `${String(n).padEnd(4)}${name.padEnd(22)}${io}`).join('\n') + '\n\nCALL 0005h with C=function. The answer is in A (or HL).');
                if (k === 'I') return out(`CP/M 2.2 BIOS jump table (from the warm-boot address minus 3):\n` + ref.BIOS.map(([n, d], i) => `+${String(i * 3).padStart(2, '0')}  ${n.padEnd(8)}${d}`).join('\n'));
                if (k === 'T') return out(ref.AT.map(([c, d]) => `${c.padEnd(14)}${d}`).join('\n'));
                if (k === 'O') return out(`${'BYTES'.padEnd(11)}${'8080'.padEnd(11)}Z80\n` + ref.OPCODES.map(([b, a, z]) => `${b.padEnd(11)}${a.padEnd(11)}${z}`).join('\n'));
                if (k === 'V') return out(ref.VT100.map(([c, d]) => `${c.padEnd(16)}${d}`).join('\n'));
                if (k === 'C') return convert();
                if (k === 'Q') return h.leave();
                menu();
            });
        };
        const convert = () => {
            h.out('\nNUMBER (255, $FF, 0FFh, 0b1010, \'A\') OR "TEXT"? ');
            h.ask('line', text => {
                text = text.trim();
                if (!text) return menu();
                const quoted = /^"(.*)"$/.exec(text);
                if (quoted) h.out(`${[...ascii(quoted[1])].map(c => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')).join(' ')}\n`);
                else {
                    const n = ref.parseNumber(text);
                    if (n === null || n > 0xFFFFFFFF) h.out('NOT A NUMBER I KNOW.\n'); else h.out(ref.showNumber(n).join('\n') + '\n');
                }
                convert();
            }, 40);
        };
        menu();
    }

    /* ============================== wall ============================== */

    function wall(h) {
        const list = () => {
            const entries = h.s.wall.list();
            h.out(begin(h, 'THE WALL', `${entries.length} one-liner${entries.length === 1 ? '' : 's'}`));
            if (!entries.length) h.out('Blank brick. Be the first to write on it.\n');
            for (const e of entries.slice(-10)) h.out(`${BOLD}${e.name}${OFF}  ${when(e.when)}\n  ${e.text}\n`);
            h.out(`\n${BOLD}W${OFF}rite on the wall, ${BOLD}Q${OFF}uit? `);
            h.ask('key', k => (k === 'W' ? write() : h.leave()));
        };
        const write = () => {
            h.out('\n\nYour name? ');
            h.ask('line', name => {
                name = ascii(name).slice(0, 12) || 'ANON';
                h.out('One line? ');
                h.ask('line', text => {
                    text = ascii(text).slice(0, 70);
                    if (text) { h.s.wall.add(name, text); h.out('Chalked up.\n'); } else h.out('Nothing written.\n');
                    list();
                }, 70);
            }, 12);
        };
        list();
    }

    /* ============================= callers ============================ */

    function callers(h) {
        const all = h.s.callers.list().slice(-10).reverse();
        h.out(begin(h, 'LAST CALLERS'));
        for (const c of all) h.out(`#${String(c.n).padEnd(5)} ${when(c.when).padEnd(13)} ${c.minutes ? c.minutes + ' min' : 'on the line'}\n`);
        if (!all.length) h.out('No one yet.\n');
        finish(h);
    }

    /* ============================== scores ============================ */

    function scores(h) {
        const games = h.s.scores.games();
        h.out(begin(h, 'HIGH SCORES'));
        if (!games.length) h.out('The tables are empty. WOPR is waiting.\n');
        for (const g of games.sort()) {
            h.out(`${BOLD}${g}${OFF}\n`);
            h.s.scores.top(g, 3).forEach((e, i) => h.out(`  ${i + 1}. ${e.name.padEnd(13)}${String(e.score).padStart(6)}  ${when(e.when)}\n`));
        }
        finish(h);
    }

    /* =============================== poll ============================= */

    /** The letter of the i-th item of a menu: A for the first. */
    const LETTER = i => String.fromCharCode(65 + i);

    function poll(h) {
        const p = h.s.poll, { q, options } = p.question();
        const results = () => {
            const counts = p.tally(), total = counts.reduce((a, b) => a + b, 0), max = Math.max(...counts);
            h.out('\nTHE REGULARS (MADE UP) AND YOU:\n');
            options.forEach((o, i) => h.out(` ${LETTER(i)}  ${o.padEnd(26).slice(0, 26)} ${'#'.repeat(Math.round(counts[i] / max * 20)).padEnd(20)} ${String(Math.round(counts[i] / total * 100)).padStart(3)}%${p.mine() === i ? '  <- you' : ''}\n`));
            finish(h);
        };
        h.out(begin(h, 'THIS WEEK\'S VOTE', q));
        options.forEach((o, i) => h.out(` ${LETTER(i)}  ${o}\n`));
        if (p.mine() !== undefined) return results();
        h.out('\nYour vote (A-D, Q to look)? ');
        h.ask('key', k => {
            const i = k.charCodeAt(0) - 65;
            if (i >= 0 && i < options.length) { p.vote(i); h.out(`\nVoted: ${options[i]}.\n`); }
            results();
        });
    }

    /* ============================== art =============================== */

    const ART = [
        ['PIXEL', ['      /\\_/\\', '     ( o.o )', '      > ^ <      PIXEL, NIGHT SHIFT', '     /|   |\\', '    (_|   |_)']],
        ['RELAY', ['         *', '        /|\\', '       / | \\', '      /--+--\\', '     /  /|\\  \\', '       /_|_\\', '      |_____|    KETTLE-7']],
        ['FLOPPY', ['  +----------------+', '  | []   CP/M  2.2 |', '  |    ________    |', '  |   |        |   |', '  |   |   A:   |   |', '  |   |________|   |', '  +----------------+']],
        ['ROCKET', ['        /\\', '       /  \\', '      | () |', '      |    |', '     /|    |\\', '    / |____| \\', '   /__/_||_\\__\\', '       /__\\', '       ****']],
        ['TERMINAL', ['   .--------------------.', '   |  A> _              |', '   |                    |', '   |                    |', '   \'--------------------\'', '        /__________\\']],
        ['LIGHTHOUSE', ['        _', '       [_]', '       /_\\', '      |   |', '      | O |', '      |   |', '     /|___|\\', '   ~~~~~~~~~~~~~~']]
    ];

    function art(h) {
        h.out(begin(h, 'ART GALLERY', 'press a letter'));
        ART.forEach(([name], i) => h.out(` ${LETTER(i)}  ${name}\n`));
        h.out('\nWhich (A-F, Q to leave)? ');
        h.ask('key', k => {
            const i = k.charCodeAt(0) - 65;
            if (!(i >= 0 && i < ART.length)) return h.leave();
            h.out(`${begin(h, `ART GALLERY  >  ${ART[i][0]}`, 'press any key')}\n${ART[i][1].map(l => '    ' + l).join('\n')}\n`);
            finish2(h, () => art(h));
        });
    }

    /* ============================== mail ============================== */

    function mail(h) {
        const menu = () => {
            const unread = h.s.mail.unread();
            h.out(begin(h, 'MAIL TO THE SYSOP', unread ? `${unread} new repl${unread === 1 ? 'y' : 'ies'}` : ''));
            h.out(`${BOLD}W${OFF}rite a note, ${BOLD}R${OFF}ead the replies, ${BOLD}Q${OFF}uit? `);
            h.ask('key', k => {
                if (k === 'W') return write();
                if (k === 'R') return read();
                h.leave();
            });
        };
        const write = () => {
            h.out('\n\nOne line for the sysop (no names, numbers or medical details)? ');
            h.ask('line', text => {
                text = ascii(text).slice(0, 70);
                if (!text) return menu();
                const id = h.s.mail.send(text);
                h.out('Sent. The sysop answers on his next shift. (He is a program.)\n');
                Promise.resolve(h.s.sysop ? h.s.sysop.reply([], text) : '').then(r => { if (r) h.s.mail.setReply(id, ascii(r).replace(/\s*\n\s*/g, ' ')); }).catch(() => {});
                menu();
            }, 70);
        };
        const read = () => {
            const all = h.s.mail.list().filter(m => m.reply);
            h.out('\n');
            if (!all.length) h.out('No replies yet. The sysop is asleep, or typing.\n');
            for (const m of all.slice(-5)) h.out(`${BOLD}you${OFF}    ${when(m.when)}  ${m.text}\n${BOLD}sysop${OFF}  ${m.reply}\n\n`);
            h.s.mail.markRead();
            finish2(h, menu);
        };
        menu();
    }

    /* =========================== dial directory ======================= */

    /** The telnet hosts, with the numbers they are dialed by (js/devices/directory.js). */
    const DIRECTORY = node ? require('./devices/directory.js').PHONEBOOK : root.DigitalRerun.PHONEBOOK;

    function directory(h) {
        h.out(begin(h, 'DIAL DIRECTORY', 'checked 5 Nov 2026'));
        const lines = DIRECTORY.map(e => `${BOLD}ATDT ${e.n}${OFF}  ${e.host}${e.port === 23 ? '' : ':' + e.port}\n${wrap(e.text, 76, '   ')}`).join('\n');
        show(h, `${lines}\n\n${wrap('Dial 0101 or 555-0101. These are other people\'s machines, over the internet: they need the bridge (DEVICES, MODEM). You can also dial a host by name: ATDT telehack.com. Be kind to them.', 76)}`, () => finish(h));
    }

    /* ============================ online desks ======================== */

    const offline = h => { h.out('\nThat desk needs the internet: DEVICES, Online services.\n'); finish(h); };
    const notAnswering = h => { h.out('\nThe desk is not answering.\n'); finish(h); };

    /* ============================ the news ============================ */

    /** The headlines of an RSS feed: the title and the date of each item, the first `n`. */
    function parseRss(xml, n = 8) {
        const field = (body, name) => { const m = new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`).exec(body); return m ? unent(m[1]).trim() : ''; };
        return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, n)
            .map(m => ({ title: ascii(field(m[1], 'title')), sub: field(m[1], 'pubDate').replace(' +0000', ' UTC') }));
    }

    /** The sources of the news desk: each gets its headlines as { title, sub } items. */
    const NEWS = [
        { key: 'H', title: 'Hacker News', desc: 'the front page: tech and startups', get: async h => {
            const ids = (await h.s.fetchJson('https://hacker-news.firebaseio.com/v0/topstories.json')).slice(0, 8);
            const items = (await Promise.all(ids.map(id => h.s.fetchJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)))).filter(Boolean);
            return items.map(it => {
                let host = '';
                try { host = it.url ? ` (${new URL(it.url).hostname.replace(/^www\./, '')})` : ''; } catch (e) { /* no host */ }
                return { title: `${ascii(it.title)}${host}`, sub: `${it.score} points` };
            });
        } },
        { key: 'D', title: 'Dev.to', desc: 'the top articles of the day', get: async h => (await h.s.fetchJson('https://dev.to/api/articles?top=1&per_page=8'))
            .map(a => ({ title: ascii(a.title), sub: `by ${ascii((a.user && a.user.name) || '')}` })) },
        { key: 'W', title: 'Wired', desc: 'technology, science and culture', get: async h => parseRss(await h.s.fetchText('https://www.wired.com/feed/rss')) },
        { key: 'T', title: 'The New York Times', desc: 'the home page headlines', get: async h => parseRss(await h.s.fetchText('https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml')) },
        { key: 'N', title: 'NASA', desc: 'the latest headlines', get: async h => parseRss(await h.s.fetchText('https://www.nasa.gov/feed/')) },
        { key: 'O', title: 'On This Day', desc: 'Wikipedia: five events for today', get: async h => {
            const d = h.s.now();
            const data = await h.s.fetchJson(`https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`);
            const events = (data.events || []).filter(e => e.text && e.year), chosen = [];
            while (chosen.length < 5 && events.length) chosen.push(events.splice(Math.floor(h.random() * events.length) % events.length, 1)[0]);
            return chosen.sort((a, b) => a.year - b.year).map(e => ({ title: `${e.year}: ${ascii(e.text)}`, sub: '' }));
        } }
    ];

    /** The news desk: the menu on top, with its keys in the status bar. A source's headlines come below the menu, a page at a
     *  time; after the last line the desk waits, with the keys in the status bar. Q, or two Esc keys, go back; any other key
     *  redraws the menu. */
    function news(h) {
        if (!h.s.online()) return offline(h);
        const keys = NEWS.map(s => s.key).join('');
        const hint = `Keys: ${keys}   Esc-Esc/Q: Back`;
        const PAGE = 12;                                    // the lines of headlines that fit under the menu
        const menu = () => {
            h.out(begin(h, 'NEWS DESK', hint));
            h.out(NEWS.map(src => `\x1b[K  ${BOLD}[${src.key}]${OFF} ${src.title}${fwd(1, `  [${src.key}] ${src.title}`, 27)}${DIM}${src.desc}${OFF}\n`).join('')
                + `
\x1b[K  ${BOLD}[Q]${OFF} Back${fwd(1, '  [Q] Back', 27)}${DIM}to the services${OFF}\n`);
            wait();
        };
        const wait = () => {
            if (h.status) h.status(hint);
            h.ask('key', async k => {
                if (k === 'Q') return h.leave();
                const src = NEWS.find(s => s.key === k);
                if (!src) return menu();                   // not a key of this screen: the menu again, on a clean screen
                h.out(`\nCalling ${src.title} ...\n`);
                let items;
                try { items = await src.get(h); } catch (e) { h.out('\nThe desk is not answering.\n'); return wait(); }
                const text = items.length
                    ? items.map((it, i) => `\n${wrap(`${i + 1}. ${it.title}`, 76)}\n${it.sub ? `   ${it.sub}\n` : ''}`).join('')
                    : '\nNothing on the wire.\n';
                if (h.more) h.more(text, wait, PAGE);      // a page at a time, the keys in the status bar after the last line
                else { h.out(text); wait(); }
            }, 0, () => h.leave());                        // two Esc keys leave
        };
        menu();
    }

    /* ============================ more online desks ==================== */

    /** Entities and CDATA of a feed's text, back to plain characters (ascii() does the rest). */
    const unent = s => String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
        .replace(/&quot;/g, '"').replace(/&apos;|&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const num = v => (v == null || Number.isNaN(Number(v)) ? '-' : String(Math.round(Number(v))));

    /** The Kp index, as NOAA's storm scale (G1 from Kp 5). */
    const gScale = kp => (kp >= 9 ? 'G5 extreme storm' : kp >= 8 ? 'G4 severe storm' : kp >= 7 ? 'G3 strong storm' : kp >= 6 ? 'G2 moderate storm' : kp >= 5 ? 'G1 minor storm' : 'G0 quiet');

    /** Earthquakes of the last day, magnitude 2.5 and up, the ten largest. Nothing of yours is sent. */
    async function quakes(h) {
        if (!h.s.online()) return offline(h);
        h.out(begin(h, 'EARTHQUAKES', 'the last day, M2.5 and up'));
        h.out('Calling earthquake.usgs.gov ...\n');
        try {
            const data = await h.s.fetchJson('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson');
            const list = (data.features || []).map(f => ({ mag: f.properties.mag, place: ascii(f.properties.place || 'unknown place'), time: f.properties.time, depth: f.geometry.coordinates[2] }))
                .filter(q => q.mag != null).sort((a, b) => b.mag - a.mag).slice(0, 10);
            if (!list.length) h.out('\nNo earthquakes of that size in the last day.\n');
            for (const q of list) h.out(`${wrap(`M${q.mag.toFixed(1)}  ${q.place}  ${when(q.time)}, ${num(q.depth)} km deep`, 76)}\n`);
        } catch (e) { return notAnswering(h); }
        finish(h);
    }

    /** Space weather: the planetary K index of the last hours, and the storm scale it means. */
    async function aurora(h) {
        if (!h.s.online()) return offline(h);
        h.out(begin(h, 'AURORA', 'space weather'));
        h.out('Calling services.swpc.noaa.gov ...\n');
        try {
            const rows = await h.s.fetchJson('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json');
            const last = rows.slice(-8), now = last[last.length - 1], kp = Number(now.Kp);
            h.out(`\n${BOLD}Kp ${kp.toFixed(1)}${OFF}  ${gScale(kp)}   at ${now.time_tag.slice(11, 16)} UTC\n`);
            h.out(`last hours  ${last.map(r => Number(r.Kp).toFixed(1)).join('  ')}\n\n`);
            h.out(`${wrap('Kp is the planetary K index, 0 (quiet) to 9 (extreme), in 3-hour steps. From Kp 5 the aurora can be seen further south than usual.', 76)}\n`);
        } catch (e) { return notAnswering(h); }
        finish(h);
    }

    /** A word or a name, looked up in Wikipedia: the lead of the article. Each answer is followed by the next prompt; two Esc keys leave. */
    function wiki(h) {
        if (!h.s.online()) return offline(h);
        h.out(begin(h, 'WIKIPEDIA', 'Esc-Esc leaves'));
        h.out(`A word or a name? ${DIM}The word is sent to en.wikipedia.org, nothing else.${OFF}\n`);
        const ask = () => {
            h.out('? ');
            h.ask('line', async text => {
                const term = ascii(text).slice(0, 60);
                if (term) {
                    h.out('\nCalling en.wikipedia.org ...\n');
                    try {
                        const data = await h.s.fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term.replace(/ /g, '_'))}`);
                        if (data.type === 'disambiguation') h.out(`\n${ascii(data.title)} can mean several things.\n`);
                        else if (!data.extract) h.out('\nNo article.\n');
                        else h.out(`\n${BOLD}${ascii(data.title)}${OFF}\n${wrap(ascii(data.extract), 76)}\n`);
                    } catch (e) { h.out('\nNo such article, or the desk is not answering.\n'); }
                    h.out('\n');
                }
                ask();
            }, 60, () => { h.out('\n'); h.leave(); });
        };
        ask();
    }

    /* ============================ the sky ============================ */

    const skyCalc = node ? require('./sky.js') : root.DigitalRerun.skyCalc;
    const hhmm = d => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    const ORBIT_KEY = 'iss.orbit', ORBIT_DAYS = 7;

    /** A city's place, from open-meteo's geocoding (the name is the only thing sent). */
    async function geocode(h, city) {
        const geo = await h.s.fetchJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`);
        return (geo && geo.results && geo.results[0]) || null;
    }

    /** The city prompt of a sky desk (the last city is the default); `then(place)` runs with the place, then the desk ends. */
    function askCity(h, note, then) {
        const last = h.s.store.get('city') || '';
        h.out(`A city${last ? ` (RETURN for ${last})` : ''}?\n${DIM}${note}${OFF}\n? `);
        h.ask('line', async text => {
            const city = ascii(text).slice(0, 40) || last;
            if (!city) return h.leave();
            h.out('\nCalling the sky ...\n');
            try {
                const place = await geocode(h, city);
                if (!place) h.out(`\nNo such place: ${city}.\n`);
                else { h.s.store.set('city', place.name); await then(place); }
            } catch (e) { h.out('\nThe desk is not answering.\n'); }
            finish(h);
        }, 40);
    }

    /** The planets you can see with the eye, tonight, for a city. Worked out here: the city name is the only thing sent. */
    function tonight(h) {
        if (!h.s.online()) return offline(h);
        h.out(begin(h, 'PLANETS TONIGHT', 'the five you can see with the eye'));
        askCity(h, 'The name is sent to open-meteo.com, nothing else; the sums are done here.', place => {
            const now = h.s.now();
            const sky = skyCalc.planetsTonight(skyCalc.loadAstronomy(), now, place.latitude, place.longitude);
            h.out(`\n${BOLD}${ascii(place.name).toUpperCase()}${OFF}  ${hhmm(now)} local\n`);
            h.out(`the sun is ${sky.dark ? 'down: the sky is dark' : sky.sunAlt > 0 ? 'up' : 'low: twilight'}\n\n`);
            for (const p of sky.planets) {
                const up = p.alt > 0 ? `up, ${skyCalc.compass(p.az)} ${Math.round(p.alt)} deg now` : 'below the horizon now';
                const night = p.dark ? `best in the dark at ${hhmm(p.best)}, ${Math.round(p.bestAlt)} deg up` : 'not up in the dark in the next 12 hours';
                h.out(`${p.name.padEnd(9)} ${up}\n          ${night}\n`);
            }
        });
    }

    /** The orbit of the ISS: kept for a week, fetched from CelesTrak when it is older. Only the fetch goes out. */
    async function loadOrbit(h) {
        let cached = null;
        try { cached = JSON.parse(h.s.store.get(ORBIT_KEY) || 'null'); } catch (e) { cached = null; }
        if (cached && cached.tle && h.s.now().getTime() - cached.time < ORBIT_DAYS * 86400000) return cached.tle;
        const tle = skyCalc.parseTle(await h.s.fetchText('https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=tle'));
        if (!tle) throw new Error('no orbit');
        h.s.store.set(ORBIT_KEY, JSON.stringify({ tle, time: h.s.now().getTime() }));
        return tle;
    }

    /** The ISS: where the station is now (nothing of yours is sent), then its passes over a city, the next three days, above 10 degrees. */
    function iss(h) {
        if (!h.s.online()) return offline(h);
        h.out(begin(h, 'ISS PASSES', 'the station now, and its passes over a city'));
        const now = async () => {
            try {
                const s = await h.s.fetchJson('https://api.wheretheiss.at/v1/satellites/25544');
                const ns = s.latitude >= 0 ? 'N' : 'S', ew = s.longitude >= 0 ? 'E' : 'W';
                h.out(`\n${BOLD}THE STATION NOW${OFF}\n  over ${Math.abs(s.latitude).toFixed(1)} ${ns}, ${Math.abs(s.longitude).toFixed(1)} ${ew}\n`
                    + `  ${Math.round(s.altitude)} km up, ${Math.round(s.velocity)} km/h, ${s.visibility === 'daylight' ? 'in daylight' : s.visibility === 'eclipsed' ? 'in the Earth\'s shadow' : ascii(s.visibility)}\n`);
            } catch (e) { h.out('\nThe station is not answering.\n'); }
        };
        askCity(h, 'The name is sent to open-meteo.com; the station is looked up at wheretheiss.at and its orbit at celestrak.org.', async place => {
            await now();
            const tle = await loadOrbit(h);
            const passes = skyCalc.issPasses(skyCalc.loadSatellite(), tle, place.latitude, place.longitude, h.s.now(), 3, 10).slice(0, 8);
            h.out(`\n${BOLD}${ascii(place.name).toUpperCase()}${OFF}\n`);
            if (!passes.length) h.out('No passes above 10 degrees in the next three days.\n');
            for (const p of passes) {
                h.out(`${MONTHS[p.rise.getMonth()]} ${p.rise.getDate()} ${hhmm(p.rise)}-${hhmm(p.set)}  ${skyCalc.compass(p.riseAz)} to ${skyCalc.compass(p.setAz)}, `
                    + `highest ${Math.round(p.maxEl)} deg at ${hhmm(p.maxAt)}\n`);
            }
        });
    }

    /* ============================== the list ========================== */

    /* group: info, talk, dial (the S menu, in that order) or sky (the K menu of the main page); online: needs Online services */
    const DOORS = [
        { key: 'R', title: 'Reference Desk', desc: 'ASCII, hex, BDOS, opcodes', group: 'info', run: reference },
        { key: 'N', title: 'News Desk', desc: 'six sources, pick one', group: 'info', online: true, run: news },
        { key: 'W', title: 'Wikipedia', desc: 'look up a word or a name', group: 'info', online: true, run: wiki },
        { key: 'E', title: 'Earthquakes', desc: 'the last day, the largest', group: 'info', online: true, run: quakes },
        { key: 'L', title: 'The Wall', desc: 'one-liners from callers', group: 'main', run: wall },
        { key: 'C', title: 'Last Callers', desc: 'who called, and when', group: 'talk', run: callers },
        { key: 'M', title: 'Mail SysOp', desc: 'a note, and a reply', group: 'main', run: mail },
        { key: 'V', title: 'This Week\'s Vote', desc: 'one question a week', group: 'talk', run: poll },
        { key: 'A', title: 'Art Gallery', desc: 'small pictures', group: 'talk', run: art },
        { key: 'H', title: 'High Scores', desc: 'the best of the games', group: 'talk', run: scores },
        { key: 'D', title: 'Dial Directory', desc: 'telnet hosts to dial', group: 'dial', run: directory },
        { key: 'P', title: 'Planets', desc: 'the five you can see with the eye', group: 'sky', online: true, run: tonight },
        { key: 'I', title: 'ISS Passes', desc: 'when the station goes over a city', group: 'sky', online: true, run: iss },
        { key: 'A', title: 'Aurora', desc: 'space weather, the storm scale', group: 'sky', online: true, run: aurora }
    ];

    const api = { DOORS, DIRECTORY, ART, reference, wall, callers, scores, poll, art, mail, directory, news, quakes, aurora, wiki, parseRss, NEWS, tonight, iss, gScale, unent, ascii, wrap };
    if (node) module.exports = api;
    else Object.assign(root.DigitalRerun = root.DigitalRerun || {}, { doors: DOORS });
})(typeof window !== 'undefined' ? window : globalThis);
