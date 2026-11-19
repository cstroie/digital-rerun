/*
 * directory.js: who answers when the modem dials. The numbers are not
 * telephone numbers: a name or a few digits, each with a function that
 * makes the other end (send(byte), close(); it speaks through link.receive).
 *
 *   0  the echo service: says hello, sends back what it is sent
 *   555-0100  the BBS (the page adds it)      555-0101 ... 0110  the telnet hosts below
 *
 * A number may be dialed in full, with or without the dash, or by its last four
 * digits: ATDT 555-0101, ATDT5550101, ATDT0101. The telnet hosts need the bridge
 * (js/devices/gateway.js); without one the line has no dial tone.
 *
 * `dial(number, link)` is what Hayes calls.
 */
(function (root) {
    'use strict';

    /** Sends back what it is sent; CR becomes CR LF. A test of the line and of the terminal. */
    function echoService(link) {
        link.receive('\r\nDIGITAL RERUN ECHO SERVICE\r\nWhat you type comes back. +++ and ATH to leave.\r\n\r\n');
        return {
            send(byte) { link.receive(byte === 13 ? [13, 10] : [byte]); },
            close() { /* nothing to free */ }
        };
    }

    /** The telnet hosts you can dial by number: the last four digits of 555-nnnn, the host and port, what it is. */
    const PHONEBOOK = [
        { n: '0101', host: 'telehack.com', port: 23, text: 'Telehack: a simulated 1980s ARPANET, with games and a very old shell' },
        { n: '0102', host: 'bbs.fozztexx.com', port: 23, text: 'Level 29 BBS: a retro BBS with doors and files' },
        { n: '0103', host: 'towel.blinkenlights.nl', port: 23, text: 'Star Wars in ASCII, frame by frame (leave it running)' },
        { n: '0104', host: 'nethack.alt.org', port: 23, text: 'NetHack, played on a public server' },
        { n: '0105', host: 'bbs.retrocampus.com', port: 23, text: 'RetroCampus: a BBS for old computers' },
        { n: '0106', host: 'bbs.hispamsx.org', port: 23, text: 'A Synchronet BBS of the MSX community' },
        { n: '0107', host: 'particlesbbs.dyndns.org', port: 6400, text: 'Particles BBS' },
        { n: '0108', host: 'aardmud.org', port: 4000, text: 'Aardwolf: a long-running text MUD' },
        { n: '0109', host: 'batmud.bat.org', port: 23, text: 'BatMUD: another, older, MUD' },
        { n: '0110', host: 'sdf.org', port: 23, text: 'SDF Public Access Unix System' }
    ];

    /** The IRC servers IRC.DIR offers (IRC.COM): plain TCP on a port of 6660-6669, which the gateway passes through raw. */
    const IRCBOOK = [
        { host: 'irc.libera.chat', port: 6667, text: 'Libera.Chat: free and open source projects' },
        { host: 'irc.oftc.net', port: 6667, text: 'OFTC: the Open and Free Technology Community' },
        { host: 'irc.rizon.net', port: 6667, text: 'Rizon' },
        { host: 'irc.efnet.org', port: 6667, text: 'EFnet: the oldest network, still going' },
        { host: 'irc.dal.net', port: 6667, text: 'DALnet' },
        { host: 'us.undernet.org', port: 6667, text: 'Undernet' },
        { host: 'irc.quakenet.org', port: 6667, text: 'QuakeNet: games' }
    ];

    /** The gopher holes GOPHER.DIR offers (GOPHER.COM, its home menu): port 70, passed raw by the gateway. */
    const GOPHERBOOK = [
        { host: 'gopher.floodgap.com', port: 70, text: 'Floodgap: the hub of gopherspace, Veronica-2 search' },
        { host: 'sdf.org', port: 70, text: 'SDF Public Access Unix System' },
        { host: 'gopher.quux.org', port: 70, text: 'quux.org: the old Gopher archives' },
        { host: 'gopherpedia.com', port: 70, text: 'Gopherpedia: Wikipedia over gopher' },
        { host: 'bitreich.org', port: 70, text: 'Bitreich: suckless people and their phlogs' },
        { host: 'koremoon.duckdns.org', port: 70, text: 'Kore Moon: my own gopher hole' }
    ];

    /** The MUDs MUD.DIR offers (MUD.COM): telnet, so any port but the raw ones. */
    const MUDBOOK = [
        { host: 'aardmud.org', port: 4000, text: 'Aardwolf: a big, friendly, long-running MUD' },
        { host: 'batmud.bat.org', port: 23, text: 'BatMUD: since 1990' },
        { host: 'discworld.starturtle.net', port: 4242, text: 'Discworld MUD: after the novels' },
        { host: 'alteraeon.com', port: 3000, text: 'Alter Aeon: fantasy, many classes' },
        { host: 'ancient.anguish.org', port: 2222, text: 'Ancient Anguish: an LPMud since 1992' },
        { host: '3k.org', port: 3000, text: '3Kingdoms: an LPMud' }
    ];

    /** The questions FINGER.DIR offers (FINGER.COM: alone it lists them, FINGER n asks one): port 79, passed raw. */
    const FINGERBOOK = [
        { ask: 'help@graph.no', text: 'Weather by finger: how to ask' },
        { ask: 'oslo@graph.no', text: 'The weather in Oslo' },
        { ask: 'london@graph.no', text: 'The weather in London' },
        { ask: '@sdf.org', text: 'Who is on SDF' }
    ];

    /** The capsules GEMINI.DIR offers (GEMINI.COM, its home page): port 1965, TLS spoken by the bridge. */
    const GEMINIBOOK = [
        { url: 'gemini://geminiprotocol.net/', text: 'Project Gemini: the protocol and its software' },
        { url: 'gemini://kennedy.gemi.dev/', text: 'Kennedy: a search engine for Geminispace' },
        { url: 'gemini://gemi.dev/', text: 'gemi.dev: news, Wikipedia and more, made gemtext' },
        { url: 'gemini://bbs.geminispace.org/', text: 'Bubble: a bulletin board of Geminispace' },
        { url: 'gemini://koremoon.duckdns.org/', text: 'Kore Moon: my own capsule' }
    ];

    /** The clocks NETTIME.COM asks: the daytime service (port 13, raw), in NIST's format. */
    const TIMEHOST = 'time.nist.gov';

    /** An entry that is busy now and then (another caller has the one line): `make` is the real answer. */
    function sometimesBusy(make, chance = 0.1, random = Math.random) {
        return link => (random() < chance ? 'BUSY' : make(link));
    }

    class Directory {
        constructor() {
            this.entries = new Map();
            this.add('0', echoService);
            /** A host dialed that is no number here goes to `gateway` (js/devices/gateway.js), when there is one. */
            this.gateway = null;
            this.dial = this.dial.bind(this);
        }

        /** `make(link)` returns the other end, or a promise of it, or a reason it did not answer ('BUSY'...). */
        add(number, make) { this.entries.set(String(number), make); return this; }

        dial(number, link, typed = number) {
            const full = /^\d{4}$/.test(number) ? `555${number}` : number;          // 0101 is 555-0101
            const make = this.entries.get(full);
            if (make) return make(link);
            const listed = PHONEBOOK.find(e => `555${e.n}` === full);
            if (listed) return this.gateway ? this.gateway.dial(listed.host, listed.port, link) : 'NO DIALTONE';
            const host = /^([A-Za-z0-9._-]+)(?::(\d{1,5}))?$/.exec(typed);
            if (this.gateway && host && /[A-Za-z.]/.test(host[1])) return this.gateway.dial(host[1], host[2] ? Number(host[2]) : 23, link);
            return 'NO CARRIER';
        }
    }

    const api = { Directory, echoService, sometimesBusy, PHONEBOOK, IRCBOOK, GOPHERBOOK, MUDBOOK, FINGERBOOK, GEMINIBOOK, TIMEHOST };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else Object.assign(root.DigitalRerun = root.DigitalRerun || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
