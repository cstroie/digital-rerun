/*
 * directory.js: who answers when the modem dials. The numbers are not
 * telephone numbers: a name or a few digits, each with a function that
 * makes the other end (send(byte), close(); it speaks through link.receive).
 *
 *   0  the echo service: says hello, sends back what it is sent
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
            const make = this.entries.get(number);
            if (make) return make(link);
            const host = /^([A-Za-z0-9._-]+)(?::(\d{1,5}))?$/.exec(typed);
            if (this.gateway && host && /[A-Za-z.]/.test(host[1])) return this.gateway.dial(host[1], host[2] ? Number(host[2]) : 23, link);
            return 'NO CARRIER';
        }
    }

    const api = { Directory, echoService };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else Object.assign(root.DigitalRerun = root.DigitalRerun || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
