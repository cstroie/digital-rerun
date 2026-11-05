/*
 * telnet.js: the telnet side of a connection to a BBS: what a terminal does
 * with the IAC commands so that the other end treats it as a plain terminal.
 *
 *   feed(bytes)   bytes from the wire -> the data for the program (commands
 *                 answered through send, NUL after CR dropped, IAC IAC one 255)
 *   encode(byte)  a byte from the program -> the bytes for the wire (255
 *                 doubled, CR as CR NUL)
 *
 * It agrees to ECHO and SUPPRESS-GO-AHEAD from the server (the server does
 * the echoing, as a BBS does), offers TERMINAL-TYPE and NAWS (the window size),
 * and refuses everything else (BINARY, LINEMODE ...).
 */
(function (root) {
    'use strict';

    const IAC = 255, DONT = 254, DO = 253, WONT = 252, WILL = 251, SB = 250, SE = 240;
    const ECHO = 1, SGA = 3, TTYPE = 24, NAWS = 31;

    class Telnet {
        /** `send(bytes)` writes to the wire. */
        constructor({ send, terminal = 'VT100', cols = 80, rows = 24 }) {
            this.send = send;
            this.terminal = terminal;
            this.cols = cols;
            this.rows = rows;
            this.state = 'data';
            this.verb = 0;
            this.sub = [];
            this.afterCR = false;
            this.us = new Set();             // options we have said WILL to
            this.them = new Set();           // options we have said DO to
        }

        feed(bytes) {
            const out = [];
            for (const b of bytes) {
                switch (this.state) {
                    case 'data':
                        if (b === IAC) { this.state = 'iac'; break; }
                        if (b === 0 && this.afterCR) { this.afterCR = false; break; }
                        this.afterCR = b === 13;
                        out.push(b);
                        break;
                    case 'iac':
                        if (b === IAC) { out.push(255); this.afterCR = false; this.state = 'data'; } else if (b >= WILL && b <= DONT) { this.verb = b; this.state = 'option'; } else if (b === SB) { this.sub = []; this.state = 'sub'; } else this.state = 'data';   // NOP, GA and the like
                        break;
                    case 'option':
                        this.option(this.verb, b);
                        this.state = 'data';
                        break;
                    case 'sub':
                        if (b === IAC) this.state = 'subiac'; else this.sub.push(b);
                        break;
                    case 'subiac':
                        if (b === SE) { this.subnegotiation(this.sub); this.state = 'data'; } else { if (b === IAC) this.sub.push(IAC); this.state = 'sub'; }
                        break;
                    default: this.state = 'data';
                }
            }
            return out;
        }

        option(verb, opt) {
            if (verb === WILL) {                                    // the server offers
                if (opt === ECHO || opt === SGA) { if (!this.them.has(opt)) { this.them.add(opt); this.send([IAC, DO, opt]); } } else this.send([IAC, DONT, opt]);
            } else if (verb === WONT) {
                if (this.them.delete(opt)) this.send([IAC, DONT, opt]);
            } else if (verb === DO) {                                // the server asks
                if (opt === TTYPE || opt === NAWS) {
                    if (!this.us.has(opt)) {
                        this.us.add(opt);
                        this.send([IAC, WILL, opt]);
                        if (opt === NAWS) this.sendSize();
                    }
                } else this.send([IAC, WONT, opt]);
            } else if (verb === DONT) {
                if (this.us.delete(opt)) this.send([IAC, WONT, opt]);
            }
        }

        sendSize() {
            const dim = n => [n >> 8, n & 0xFF].flatMap(v => (v === IAC ? [IAC, IAC] : [v]));
            this.send([IAC, SB, NAWS, ...dim(this.cols), ...dim(this.rows), IAC, SE]);
        }

        subnegotiation(sub) {
            if (sub[0] === TTYPE && sub[1] === 1) {                  // SEND: say what terminal this is
                this.send([IAC, SB, TTYPE, 0, ...Array.from(this.terminal, c => c.charCodeAt(0)), IAC, SE]);
            }
        }

        encode(byte) {
            if (byte === IAC) return [IAC, IAC];
            if (byte === 13) return [13, 0];
            return [byte];
        }
    }

    const api = { Telnet };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else Object.assign(root.DigitalRerun = root.DigitalRerun || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
