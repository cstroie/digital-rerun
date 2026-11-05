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
            this.dial = this.dial.bind(this);
        }

        /** `make(link)` returns the other end, or a promise of it, or a reason it did not answer ('BUSY'...). */
        add(number, make) { this.entries.set(String(number), make); return this; }

        dial(number, link) {
            const make = this.entries.get(number);
            return make ? make(link) : 'NO CARRIER';
        }
    }

    const api = { Directory, echoService };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else Object.assign(root.DigitalRerun = root.DigitalRerun || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
