/*
 * serial.js: the console and the printer ports.
 *
 *   IN  0   console status: 0FFh when a key is waiting, else 0
 *   IN  1   console data: the next key
 *   OUT 1   console data: a character to the terminal
 *   IN  2   printer status: 0FFh when ready, 0 when off line
 *   OUT 3   printer data: a byte to the printer
 *   IN  4   paper tape reader: the next byte of the tape, 1Ah when it has run out
 *   OUT 5   paper tape punch: a byte to the punch
 */
(function (root) {
    'use strict';

    const PASTE_WAIT = 16;
    const PASTE_BURST = 8;         // characters printed between two polls: a program redrawing, not the BDOS checking for ^S
    const PASTE_STUCK = 2000000;   // T-states (half a second at 4 MHz) a paste may wait for quiet that never comes
    const PASTE_ASKS = 4;          // polls in a row, each after a burst: the program asking again and again

    class Console {
        constructor() {
            this.queue = [];
            /** Called with each byte the CPU writes. */
            this.output = null;
            /** Status reads that found no key since the last key or output: a polling loop. */
            this.idlePolls = 0;
            /** Pasted text, waiting to be typed one key at a time. */
            this.pending = [];
            this.waits = 0;
            this.burst = 0;
            this.asks = 0;
            /** The machine's T-state count, for a paste stuck waiting (set by the machine). */
            this.now = () => 0;
            this.since = 0;
        }

        /**
         * Type text at a careful typist's pace: each key is offered only once
         * the program has asked for one PASTE_WAIT times in a row with nothing
         * printed in between, that is when it really waits for a key. The
         * BDOS looks for ^S each time it prints a character and keeps a key
         * it finds there; a program that reads the keyboard another way then
         * loses it. Waiting for quiet means no key is there to be taken.
         * A program that prints between all its polls (a game redrawing its
         * screen) is never quiet. The BDOS polls once for each character it
         * prints; such a program prints many between its polls. When a paste
         * has waited PASTE_STUCK T-states, and the program has polled
         * PASTE_ASKS times in a row each after PASTE_BURST characters or
         * more, it is asking again and again: it gets the next key. A
         * program that only prints a while (an answer, a redrawn status
         * line) goes quiet, or polls between single characters, before that.
         */
        paste(keys) {
            if (!this.pending.length) this.since = this.now();
            for (const ch of keys) this.pending.push(ch.charCodeAt(0) & 0xFF);
            this.idlePolls = 0;
        }

        /** Queue keys: a string or an array of byte values. */
        type(keys) {
            if (typeof keys === 'string') {
                for (const ch of keys) this.queue.push(ch.charCodeAt(0) & 0xFF);
            } else this.queue.push(...keys);
            this.idlePolls = 0;
        }

        status() {
            if (this.queue.length) return 0xFF;
            if (this.pending.length) {                 // a paste is under way: not idle
                this.asks = this.burst >= PASTE_BURST ? this.asks + 1 : 0;
                this.burst = 0;
                const asking = this.asks >= PASTE_ASKS && this.now() - this.since >= PASTE_STUCK;
                if (++this.waits >= PASTE_WAIT || asking) {
                    this.waits = 0;
                    this.asks = 0;
                    this.since = this.now();
                    this.queue.push(this.pending.shift());
                }
                return 0x00;
            }
            this.idlePolls++;
            return 0x00;
        }

        read() {
            this.idlePolls = 0;
            return this.queue.length ? this.queue.shift() : 0x00;
        }

        write(byte) {
            this.idlePolls = 0;
            this.waits = 0;
            this.burst++;
            if (this.output) this.output(byte & 0x7F);
        }
    }

    class PrinterPort {
        constructor() {
            this.online = true;
            /** Called with each byte the CPU prints. */
            this.output = null;
        }

        status() { return this.online ? 0xFF : 0x00; }

        write(byte) {
            if (this.output) this.output(byte);
        }
    }

    /** The paper tape reader: the bytes of a loaded tape, then ^Z for ever. */
    class TapeReader {
        constructor() { this.load(new Uint8Array(0), ''); }
        load(bytes, name) { this.tape = bytes; this.pos = 0; this.name = name; }
        get left() { return this.tape.length - this.pos; }
        read() {
            if (this.pos < this.tape.length) { const b = this.tape[this.pos++]; if (this.onRead) this.onRead(); return b; }
            return 0x1A;
        }
    }

    /** The paper tape punch: keeps what is punched until it is saved or cleared. */
    class TapePunch {
        constructor() { this.clear(); }
        clear() { this.bytes = []; }
        write(b) { this.bytes.push(b & 0xFF); if (this.onWrite) this.onWrite(); }
    }

    const api = { Console, PrinterPort, TapeReader, TapePunch };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else Object.assign(root.DigitalRerun = root.DigitalRerun || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
