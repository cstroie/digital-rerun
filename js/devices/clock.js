/*
 * clock.js: the date and time port. Read only.
 *
 *   OUT 20  any value: latch the date and time and rewind the record
 *   IN  20  the next byte of the latched record (0FFh from the sixteenth on,
 *           and before anything is latched there is no clock: nothing answers 0FFh)
 *
 * The record, 15 bytes:
 *    0      1, a clock is here
 *    1- 2   days since 31 Dec 1977 (1 Jan 1978 is 1), low byte first: CP/M 3's date
 *    3      hour, BCD
 *    4      minute, BCD
 *    5      second, BCD
 *    6- 7   year, low byte first
 *    8      month 1-12
 *    9      day 1-31
 *   10      day of the week, 0 Sunday
 *   11-14   milliseconds since reset, low byte first, wrapping at 2^32: for timing
 *
 * The time is the host's local time when the machine was reset, moved on by
 * the machine's own time: its T-states at `hz` (the speed setting), so a
 * paused or stepped machine stands still and a snapshot keeps its counter.
 * The record is latched whole, so a program never reads the minute of one
 * moment and the second of another. `now` (host milliseconds) can be replaced
 * for tests.
 */
(function (root) {
    'use strict';

    const node = typeof module !== 'undefined' && module.exports;
    const DAY = 86400000;
    const bcd = n => ((n / 10 | 0) << 4) | (n % 10);

    class Clock {
        /** `machine` is read for its T-state count (`cycles`), kept current by its run loop. */
        constructor(machine, now = Date.now) {
            this.machine = machine;
            this.now = now;
            /** T-states per second of the emulated CPU. */
            this.hz = 4000000;
            this.reset();
            this.record = null;
            this.index = 0;
        }

        /** The host's time now becomes the machine's, and its counter starts at 0. */
        reset() {
            this.base = this.now();
            this.ms = 0;
            this.last = this.machine ? this.machine.cycles : 0;
        }

        /** Machine time passed since the last look. */
        sync() {
            const c = this.machine.cycles;
            this.ms += (c - this.last) * 1000 / this.hz;
            this.last = c;
            return this.ms;
        }

        /** The 15 bytes for the moment `ms` of machine time. */
        encode() {
            const ms = this.sync();
            const d = new Date(this.base + Math.floor(ms));
            const days = Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1977, 11, 31)) / DAY);
            const counter = Math.floor(ms) >>> 0;
            return Uint8Array.of(1, days & 0xFF, (days >> 8) & 0xFF, bcd(d.getHours()), bcd(d.getMinutes()), bcd(d.getSeconds()),
                d.getFullYear() & 0xFF, d.getFullYear() >> 8, d.getMonth() + 1, d.getDate(), d.getDay(),
                counter & 0xFF, (counter >>> 8) & 0xFF, (counter >>> 16) & 0xFF, counter >>> 24);
        }

        latch() {
            this.record = this.encode();
            this.index = 0;
        }

        read() {
            if (!this.record || this.index >= this.record.length) return 0xFF;
            return this.record[this.index++];
        }

        getState() { return { ms: this.sync(), hz: this.hz }; }

        /** After a snapshot: the counter goes on from where it was, the date from the host's now. */
        setState(s) {
            this.base = this.now();
            this.ms = s && s.ms || 0;
            this.last = this.machine.cycles;
            this.record = null;
        }
    }

    const api = { Clock };
    if (node) module.exports = api;
    else Object.assign(root.DigitalRerun = root.DigitalRerun || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
