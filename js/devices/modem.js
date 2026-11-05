/*
 * modem.js: the serial port a modem is plugged into (a UART), paced at the
 * line's baud rate.
 *
 *   IN  6   status: bit 0 a received byte waits, bit 1 the transmitter is
 *           empty, bit 2 carrier detect, bit 3 overrun. Bits 4-7 are 0: a
 *           status of 0FFh means no modem is here.
 *   OUT 6   control: bit 0 DTR (dropping it hangs up)
 *   IN  7   the received byte
 *   OUT 7   a byte to send (lost when the transmitter is busy)
 *
 * A character takes ten bit times. Time is the machine's own: its T-states
 * at `hz`, plus the T-states a waiting program did not run (`credit`), so the
 * rate is the same at any emulator speed, paused or restored from a snapshot.
 *
 * What is on the other end is a "line": an object with send(byte), dtr(on)
 * and reset(). It calls receive(bytes) for what arrives and sets carrier.
 * A snapshot does not keep a connection: restoring drops carrier.
 */
(function (root) {
    'use strict';

    const RDA = 1, TBE = 2, DCD = 4, OVERRUN = 8;

    class Modem {
        /** `machine` is read for its T-state count (`cycles`) and its speed (`clock.hz`). */
        constructor(machine) {
            this.machine = machine;
            this.baud = 1200;
            this.line = null;
            this.credit = 0;
            this.reset();
        }

        reset() {
            this.inbox = [];               // [{ byte, at }]: on the wire, delivered at `at`
            this.free = 0;                 // when the wire is free for the next byte
            this.register = 0;
            this.ready = false;
            this.overrun = false;
            this.txAt = 0;                 // the transmitter is busy until then
            this.carrier = false;
            this.dtr = false;
            this.dropped = 0;              // bytes lost: written while busy
        }

        /** T-states one character takes at the baud rate. */
        get perChar() { return Math.round(this.machine.clock.hz * 10 / this.baud); }

        /** The modem's time: T-states run, and idle ones credited. */
        now() { return this.machine.cycles + this.credit; }

        attach(line) {
            if (this.line && this.line.reset) this.line.reset();
            this.line = line;
            this.carrier = false;
            if (line && line.attached) line.attached(this);
        }

        /** Bytes arriving from the line (an array or a string), one after another at the baud rate. */
        receive(bytes) {
            const t0 = this.now(), per = this.perChar;
            for (const b of typeof bytes === 'string' ? Array.from(bytes, c => c.charCodeAt(0) & 0xFF) : bytes) {
                this.free = Math.max(this.free, t0) + per;
                this.inbox.push({ byte: b & 0xFF, at: this.free });
            }
        }

        /** Deliver the bytes whose time has come into the receive register. */
        pump() {
            const now = this.now();
            while (this.inbox.length && this.inbox[0].at <= now) {
                if (this.ready) this.overrun = true;          // the last one was never read: lost
                this.register = this.inbox.shift().byte;
                this.ready = true;
            }
        }

        status() {
            this.pump();
            return (this.ready ? RDA : 0) | (this.now() >= this.txAt ? TBE : 0) | (this.carrier ? DCD : 0) | (this.overrun ? OVERRUN : 0);
        }

        read() {
            this.pump();
            this.overrun = false;
            if (!this.ready) return 0x00;
            this.ready = false;
            return this.register;
        }

        write(byte) {
            const now = this.now();
            if (now < this.txAt) { this.dropped++; return; }
            this.txAt = now + this.perChar;
            if (this.line) this.line.send(byte & 0xFF);
        }

        control(value) {
            const dtr = (value & 1) !== 0;
            if (this.dtr && !dtr && this.line && this.line.dtr) this.line.dtr(false);
            else if (!this.dtr && dtr && this.line && this.line.dtr) this.line.dtr(true);
            this.dtr = dtr;
        }

        /** A waiting program did not run `tstates`: the modem's time passes anyway. */
        idle(tstates) { if (tstates > 0) this.credit += tstates; }

        getState() { return { baud: this.baud, dtr: this.dtr }; }

        /** The line's connection is gone: carrier drops, the wire empties. */
        setState(s) {
            this.reset();
            this.credit = 0;
            this.baud = (s && s.baud) || 1200;
            if (this.line && this.line.reset) this.line.reset();
        }
    }

    /** A line that sends back what it is sent, a character later: carrier up. For tests and for the wiring. */
    class Loopback {
        attached(modem) { this.modem = modem; modem.carrier = true; }
        send(byte) { if (this.modem) this.modem.receive([byte]); }
        reset() { if (this.modem) this.modem.carrier = false; }
    }

    const api = { Modem, Loopback };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else Object.assign(root.DigitalRerun = root.DigitalRerun || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
