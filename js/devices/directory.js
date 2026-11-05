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

    const api = { Directory, echoService, sometimesBusy, PHONEBOOK };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else Object.assign(root.DigitalRerun = root.DigitalRerun || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
