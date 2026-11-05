/*
 * doors.js: the board's services, the "S" at its menu. Each door is
 * { key, title, run(h) }; h is { out, ask, leave, random, s } where s holds
 * the board's services (store, wall, callers, mail, poll, scores, sysop,
 * online, fetchJson, now). leave() returns to the services menu.
 *
 *   R reference desk   N news desk (online)   K sky desk (online)   L the wall
 *   U last callers     H high scores          V this week's vote    A art gallery
 *   E mail to the sysop                       D dial directory
 */
(function (root) {
    'use strict';

    const node = typeof module !== 'undefined' && module.exports;
    const ref = node ? require('./reference.js') : root.DigitalRerun.reference;

    const BOLD = '\x1b[1m', REV = '\x1b[7m', OFF = '\x1b[0m';
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
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
    const title = (name, extra = '') => `\n\n${REV} ${name} ${OFF}${extra ? '  ' + extra : ''}\n\n`;

    /* ============================ reference ============================ */

    function reference(h) {
        const menu = () => {
            h.out(`${title('REFERENCE DESK')}${BOLD}A${OFF}SCII chart  ${BOLD}C${OFF}onvert a number  ${BOLD}B${OFF}DOS  b${BOLD}I${OFF}OS  ${BOLD}T${OFF} AT commands  ${BOLD}O${OFF}pcodes  ${BOLD}V${OFF}T100  ${BOLD}Q${OFF}uit  ? `);
            h.ask('key', k => {
                h.out('\n\n');
                if (k === 'A') h.out(ref.asciiChart().join('\n') + '\n');
                else if (k === 'B') h.out(`${'FN'.padEnd(4)}${'NAME'.padEnd(22)}IN / OUT\n` + ref.BDOS.map(([n, name, io]) => `${String(n).padEnd(4)}${name.padEnd(22)}${io}`).join('\n') + '\n\nCALL 0005h with C=function. The answer is in A (or HL).\n');
                else if (k === 'I') h.out(`CP/M 2.2 BIOS jump table (from the warm-boot address minus 3):\n` + ref.BIOS.map(([n, d], i) => `+${String(i * 3).padStart(2, '0')}  ${n.padEnd(8)}${d}`).join('\n') + '\n');
                else if (k === 'T') h.out(ref.AT.map(([c, d]) => `${c.padEnd(14)}${d}`).join('\n') + '\n');
                else if (k === 'O') h.out(`${'BYTES'.padEnd(11)}${'8080'.padEnd(11)}Z80\n` + ref.OPCODES.map(([b, a, z]) => `${b.padEnd(11)}${a.padEnd(11)}${z}`).join('\n') + '\n');
                else if (k === 'V') h.out(ref.VT100.map(([c, d]) => `${c.padEnd(16)}${d}`).join('\n') + '\n');
                else if (k === 'C') return convert();
                else if (k === 'Q') return h.leave();
                menu();
            });
        };
        const convert = () => {
            h.out('NUMBER (255, $FF, 0FFh, 0b1010, \'A\') OR "TEXT"? ');
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
            h.out(title('THE WALL', `${entries.length} one-liner${entries.length === 1 ? '' : 's'}`));
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
        h.out(title('LAST CALLERS'));
        for (const c of all) h.out(`#${String(c.n).padEnd(5)} ${when(c.when).padEnd(13)} ${c.minutes ? c.minutes + ' min' : 'on the line'}\n`);
        if (!all.length) h.out('No one yet.\n');
        h.leave();
    }

    /* ============================== scores ============================ */

    function scores(h) {
        const games = h.s.scores.games();
        h.out(title('HIGH SCORES'));
        if (!games.length) h.out('The tables are empty. WOPR is waiting.\n');
        for (const g of games.sort()) {
            h.out(`${BOLD}${g}${OFF}\n`);
            h.s.scores.top(g, 3).forEach((e, i) => h.out(`  ${i + 1}. ${e.name.padEnd(13)}${String(e.score).padStart(6)}  ${when(e.when)}\n`));
        }
        h.leave();
    }

    /* =============================== poll ============================= */

    function poll(h) {
        const p = h.s.poll, { q, options } = p.question();
        const results = () => {
            const counts = p.tally(), total = counts.reduce((a, b) => a + b, 0), max = Math.max(...counts);
            h.out('\nTHE REGULARS (MADE UP) AND YOU:\n');
            options.forEach((o, i) => h.out(` ${i + 1}  ${o.padEnd(26).slice(0, 26)} ${'#'.repeat(Math.round(counts[i] / max * 20)).padEnd(20)} ${String(Math.round(counts[i] / total * 100)).padStart(3)}%${p.mine() === i ? '  <- you' : ''}\n`));
            h.leave();
        };
        h.out(title('THIS WEEK\'S VOTE', q));
        options.forEach((o, i) => h.out(` ${i + 1}  ${o}\n`));
        if (p.mine() !== undefined) return results();
        h.out('\nYour vote (1-4, Q to look)? ');
        h.ask('key', k => {
            const i = Number(k) - 1;
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
        h.out(title('ART GALLERY'));
        ART.forEach(([name], i) => h.out(` ${i + 1}  ${name}\n`));
        h.out('\nWhich (1-6, Q to leave)? ');
        h.ask('key', k => {
            const i = Number(k) - 1;
            if (!(i >= 0 && i < ART.length)) return h.leave();
            h.out(`\n\n${ART[i][1].join('\n')}\n`);
            art(h);
        });
    }

    /* ============================== mail ============================== */

    function mail(h) {
        const menu = () => {
            const unread = h.s.mail.unread();
            h.out(title('MAIL TO THE SYSOP', unread ? `${unread} new repl${unread === 1 ? 'y' : 'ies'}` : ''));
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
            menu();
        };
        menu();
    }

    /* =========================== dial directory ======================= */

    const DIRECTORY = [
        ['telehack.com', 23, 'Telehack: a simulated 1980s ARPANET, with games and a very old shell'],
        ['bbs.fozztexx.com', 23, 'Level 29 BBS: a retro BBS with doors and files'],
        ['towel.blinkenlights.nl', 23, 'Star Wars in ASCII, frame by frame (leave it running)'],
        ['nethack.alt.org', 23, 'NetHack, played on a public server'],
        ['bbs.retrocampus.com', 23, 'RetroCampus: a BBS for old computers'],
        ['bbs.hispamsx.org', 23, 'A Synchronet BBS of the MSX community'],
        ['particlesbbs.dyndns.org', 6400, 'Particles BBS'],
        ['aardmud.org', 4000, 'Aardwolf: a long-running text MUD'],
        ['batmud.bat.org', 23, 'BatMUD: another, older, MUD'],
        ['sdf.org', 23, 'SDF Public Access Unix System']
    ];

    function directory(h) {
        h.out(title('DIAL DIRECTORY', 'checked 5 Nov 2026'));
        for (const [host, port, text] of DIRECTORY) h.out(`${BOLD}ATDT ${host}${port === 23 ? '' : ':' + port}${OFF}\n${wrap(text, 76, '   ')}\n`);
        h.out('\nThese are other people\'s machines, over the internet. They need the bridge (SETUP,\nMODEM) with --allow naming the host. Boards come and go; be kind to them.\n');
        h.leave();
    }

    /* ============================ online desks ======================== */

    const offline = h => { h.out('\nThat desk needs the internet: SETUP, Online services.\n'); h.leave(); };
    const notAnswering = h => { h.out('\nThe desk is not answering.\n'); h.leave(); };

    function news(h) {
        if (!h.s.online()) return offline(h);
        h.out(title('NEWS DESK'));
        h.out(`${BOLD}H${OFF}acker News front page, ${BOLD}W${OFF}ikipedia: on this day, ${BOLD}Q${OFF}uit? `);
        h.ask('key', async k => {
            try {
                if (k === 'H') {
                    h.out('\n\nCalling hacker-news.firebaseio.com ...\n\n');
                    const ids = (await h.s.fetchJson('https://hacker-news.firebaseio.com/v0/topstories.json')).slice(0, 8);
                    const items = await Promise.all(ids.map(id => h.s.fetchJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)));
                    items.filter(Boolean).forEach((it, i) => {
                        let host = '';
                        try { host = it.url ? ` (${new URL(it.url).hostname.replace(/^www\./, '')})` : ''; } catch (e) { /* no host */ }
                        h.out(`${wrap(`${i + 1}. ${ascii(it.title)}${host}  ${it.score} pts`, 76, '')}\n`);
                    });
                } else if (k === 'W') {
                    const d = h.s.now();
                    h.out('\n\nCalling wikipedia.org ...\n\n');
                    const data = await h.s.fetchJson(`https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`);
                    const events = (data.events || []).filter(e => e.text && e.year);
                    const chosen = [];
                    while (chosen.length < 5 && events.length) chosen.push(events.splice(Math.floor(h.random() * events.length) % events.length, 1)[0]);
                    chosen.sort((a, b) => a.year - b.year).forEach(e => h.out(`${wrap(`${e.year}: ${ascii(e.text)}`, 76)}\n`));
                    if (!chosen.length) h.out('Nothing on the wire today.\n');
                } else { h.out('\n'); return h.leave(); }
            } catch (e) { return notAnswering(h); }
            h.leave();
        });
    }

    function sky(h) {
        if (!h.s.online()) return offline(h);
        h.out(title('SKY DESK'));
        const run = async city => {
            h.out('\nCalling the sky ...\n\n');
            try {
                const iss = await h.s.fetchJson('https://api.wheretheiss.at/v1/satellites/25544');
                const ns = iss.latitude >= 0 ? 'N' : 'S', ew = iss.longitude >= 0 ? 'E' : 'W';
                h.out(`${BOLD}INTERNATIONAL SPACE STATION${OFF}\n  over ${Math.abs(iss.latitude).toFixed(1)} ${ns}, ${Math.abs(iss.longitude).toFixed(1)} ${ew}\n  ${Math.round(iss.altitude)} km up, ${Math.round(iss.velocity)} km/h, ${iss.visibility === 'daylight' ? 'in daylight' : iss.visibility === 'eclipsed' ? 'in the Earth\'s shadow' : ascii(iss.visibility)}\n`);
                if (city) {
                    const geo = await h.s.fetchJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`);
                    const place = geo && geo.results && geo.results[0];
                    if (place) {
                        const f = await h.s.fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&daily=sunrise,sunset&timezone=auto&forecast_days=1`);
                        h.s.store.set('city', place.name);
                        h.out(`\n${BOLD}${ascii(place.name).toUpperCase()}${OFF}\n  sunrise ${f.daily.sunrise[0].slice(11)}   sunset ${f.daily.sunset[0].slice(11)}  (local time)\n`);
                    } else h.out(`\nNo such place: ${ascii(city)}.\n`);
                }
            } catch (e) { return notAnswering(h); }
            h.leave();
        };
        const last = h.s.store.get('city') || '';
        h.out(`A city for sunrise and sunset${last ? ` (RETURN for ${last})` : ' (RETURN to skip)'}?\nThe name is sent to open-meteo.com, nothing else.\n? `);
        h.ask('line', text => run(ascii(text) || last), 40);
    }

    /* ============================== the list ========================== */

    const DOORS = [
        { key: 'R', title: 'Reference desk', run: reference },
        { key: 'N', title: 'News desk (online)', run: news },
        { key: 'K', title: 'Sky desk (online)', run: sky },
        { key: 'L', title: 'The wall', run: wall },
        { key: 'U', title: 'Last callers', run: callers },
        { key: 'H', title: 'High scores', run: scores },
        { key: 'V', title: 'This week\'s vote', run: poll },
        { key: 'A', title: 'Art gallery', run: art },
        { key: 'E', title: 'Mail to the sysop', run: mail },
        { key: 'D', title: 'Dial directory', run: directory }
    ];

    const api = { DOORS, DIRECTORY, ART, reference, wall, callers, scores, poll, art, mail, directory, news, sky, ascii, wrap };
    if (node) module.exports = api;
    else Object.assign(root.DigitalRerun = root.DigitalRerun || {}, { doors: DOORS });
})(typeof window !== 'undefined' ? window : globalThis);
