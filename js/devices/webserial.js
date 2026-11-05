/*
 * webserial.js: a real modem on a USB serial port, as the line the UART talks
 * to (the Web Serial API: Chromium browsers, https or localhost, a click to
 * choose the port).
 *
 * A WiFi modem (Zimodem, WiModem232 ...) already speaks Hayes, so this line
 * adds nothing of its own: the bytes go through both ways. The UART's own
 * pacing (modem.baud) still spaces what comes in, so the emulated machine
 * hears it at the speed chosen, however fast the port is.
 *
 * Carrier: the modem's result lines tell it: "CONNECT ..." raises it and
 * "NO CARRIER" drops it. With `signals` on, the DCD line is read instead
 * and DTR is driven: off by default, because a USB board with an ESP chip
 * resets when DTR changes.
 *
 * `port` is what navigator.serial.requestPort() returns (the tests give a
 * fake with the same open, close, readable, writable, getSignals, setSignals).
 */
(function (root) {
    'use strict';

    const POLL_MS = 500;

    class SerialLine {
        /**
         * @param port    a SerialPort
         * @param options { baud, signals, onClose(error?) , setInterval, clearInterval }
         */
        constructor(port, { baud = 1200, signals = false, onClose = () => {}, setInterval: si = root.setInterval, clearInterval: ci = root.clearInterval } = {}) {
            this.port = port;
            this.baud = baud;
            this.signals = signals;
            this.onClose = onClose;
            this.si = si;
            this.ci = ci;
            this.modem = null;
            this.writer = null;
            this.reader = null;
            this.out = [];
            this.writing = Promise.resolve();
            this.line = '';
            this.opened = false;
            this.timer = null;
        }

        static supported() { return typeof navigator !== 'undefined' && 'serial' in navigator; }

        /** Ask the user for a port: needs a click. */
        static request() { return navigator.serial.requestPort(); }

        async open() {
            await this.port.open({ baudRate: this.baud, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
            this.opened = true;
            this.writer = this.port.writable.getWriter();
            this.readLoop();
            if (this.signals) this.timer = this.si(() => this.poll(), POLL_MS);
        }

        /** The UART has taken this line. */
        attached(modem) { this.modem = modem; modem.carrier = false; }

        /* ---------- from the program ---------- */

        send(byte) {
            this.out.push(byte & 0xFF);
            if (this.out.length > 1) return;
            queueMicrotask(() => {                           // bytes sent in one go are one write
                const chunk = Uint8Array.from(this.out);
                this.out = [];
                this.writing = this.writing.then(() => this.writer && this.writer.write(chunk)).catch(e => this.fail(e));
            });
        }

        dtr(on) {
            if (this.signals && this.opened) this.port.setSignals({ dataTerminalReady: on }).catch(e => this.fail(e));
        }

        /** A power cycle or a restored snapshot: the call is dropped. */
        reset() {
            this.out = [];
            this.line = '';
            if (this.modem) this.modem.carrier = false;
            if (this.signals && this.opened) this.port.setSignals({ dataTerminalReady: false }).catch(() => {});
        }

        /* ---------- from the modem ---------- */

        async readLoop() {
            this.reader = this.port.readable.getReader();
            try {
                for (;;) {
                    const { value, done } = await this.reader.read();
                    if (done) break;
                    if (value && value.length) this.incoming(value);
                }
                this.fail(null);
            } catch (e) {
                this.fail(e);
            }
        }

        incoming(bytes) {
            if (!this.modem) return;
            this.modem.receive(bytes);
            if (!this.signals) for (const b of bytes) this.watch(b);
        }

        /** Carrier from the result lines: CONNECT up, NO CARRIER down. */
        watch(b) {
            if (b === 13 || b === 10) {
                const text = this.line.trim();
                this.line = '';
                if (!text) return;
                if (!this.modem.carrier && /^CONNECT/.test(text)) this.modem.carrier = true;
                else if (this.modem.carrier && /^NO CARRIER/.test(text)) this.modem.carrier = false;
                return;
            }
            if (this.line.length < 40) this.line += String.fromCharCode(b);
        }

        /** The DCD line (with `signals` on). */
        async poll() {
            try {
                const s = await this.port.getSignals();
                if (this.modem) this.modem.carrier = !!s.dataCarrierDetect;
            } catch (e) { this.fail(e); }
        }

        /* ---------- the end ---------- */

        fail(error) {
            if (!this.opened) return;
            this.opened = false;
            if (this.timer) this.ci(this.timer);
            this.timer = null;
            if (this.modem) this.modem.carrier = false;
            this.onClose(error || undefined);
        }

        /** The user lets go of the port. */
        async close() {
            const was = this.opened;
            this.opened = false;
            if (this.timer) this.ci(this.timer);
            this.timer = null;
            if (this.modem) this.modem.carrier = false;
            try { if (this.reader) await this.reader.cancel(); } catch (e) { /* already ended */ }
            try { if (this.writer) { await this.writing; this.writer.releaseLock(); } } catch (e) { /* ditto */ }
            try { if (was) await this.port.close(); } catch (e) { /* ditto */ }
        }
    }

    const api = { SerialLine };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else Object.assign(root.DigitalRerun = root.DigitalRerun || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
