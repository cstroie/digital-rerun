/*
 * hayes.js: a Hayes-compatible modem, the line a UART talks to.
 *
 * In command mode what the program sends is a command line ("ATDT 5551212",
 * "ATH", "ATS0?"), echoed back, answered "OK" or "ERROR". Dialing asks the
 * `dial(number, link)` function for the other end; when it answers the modem
 * says "CONNECT 1200", raises carrier and passes bytes both ways until
 * "+++" (a second of silence before and after), "ATH", a drop of DTR or the
 * other end hanging up ("NO CARRIER").
 *
 *   dial(number, link)  returns a Promise of the other end, or of the reason
 *                       it did not answer: 'BUSY', 'NO ANSWER', 'NO CARRIER'
 *                       or 'NO DIALTONE'. The other end has send(byte) and
 *                       close(); it speaks to the program through
 *                       link.receive(bytes) and link.hangup().
 *
 * Commands: A (answers: no ring here), D (T P , ; numbers), E, H, I, O, Q,
 * S (Sr=n, Sr?), V, X, Z, &F, and &C &D &K &W &Y accepted and ignored. A
 * line may hold several; the first it does not know ends it with ERROR.
 * Registers: S2 escape character, S3 CR, S4 LF, S5 backspace, S12 guard time
 * (fiftieths of a second). Time is the UART's own (modem.now()).
 */
(function (root) {
    'use strict';

    const FAIL = ['BUSY', 'NO ANSWER', 'NO CARRIER', 'NO DIALTONE'];
    const NUMERIC = { 'OK': 0, 'CONNECT': 1, 'RING': 2, 'NO CARRIER': 3, 'ERROR': 4, 'CONNECT 1200': 5, 'NO DIALTONE': 6, 'BUSY': 7, 'NO ANSWER': 8 };
    const DEFAULTS = () => ({ 0: 0, 1: 0, 2: 43, 3: 13, 4: 10, 5: 8, 6: 2, 7: 50, 8: 2, 9: 6, 10: 14, 11: 95, 12: 50 });

    class Hayes {
        /** `dial`: see above. `dialTime`: seconds the dialing takes at least (the handshake you hear). */
        constructor({ dial = () => Promise.resolve('NO CARRIER'), dialTime = 2 } = {}) {
            this.dial = dial;
            this.dialTime = dialTime;
            this.modem = null;
            this.remote = null;
            this.recall = '';
            this.factory();
            this.reset();
        }

        factory() {
            this.echo = true;
            this.verbose = true;
            this.quiet = false;
            this.x = 4;
            this.regs = DEFAULTS();
        }

        /** Hang up, forget the command in hand; the settings stay. */
        reset() {
            if (this.remote) { try { this.remote.close(); } catch (e) { /* gone */ } }
            this.remote = null;
            this.online = false;
            this.dialing = null;
            this.buffer = '';
            this.held = [];
            this.plus = 0;
            this.lastTx = 0;
            this.escAt = 0;
            this.ticket = (this.ticket || 0) + 1;      // a dial still under way is forgotten
            if (this.modem) this.modem.carrier = false;
        }

        attached(modem) { this.modem = modem; modem.carrier = false; this.lastTx = modem.now(); }

        get hz() { return this.modem.machine.clock.hz; }
        get guard() { return this.regs[12] * this.hz / 50; }

        /* ---------- to the program ---------- */

        say(text) { if (this.modem) this.modem.receive(text); }

        result(name) {
            if (this.quiet) return;
            if (this.verbose) this.say(`\r\n${name}\r\n`);
            else this.say(`${NUMERIC[name] === undefined ? 4 : NUMERIC[name]}\r`);
        }

        /* ---------- from the program ---------- */

        send(byte) {
            if (this.dialing) { this.abortDial(); return; }                  // any key stops a dial
            if (this.online) this.sendOnline(byte);
            else this.sendCommand(byte);
        }

        sendCommand(byte) {
            const cr = this.regs[3], bs = this.regs[5];
            if (this.echo) this.say([byte]);
            if (byte === cr) { const line = this.buffer; this.buffer = ''; this.run(line); return; }
            if (byte === bs || byte === 0x7F) { this.buffer = this.buffer.slice(0, -1); return; }
            if (byte === this.regs[4]) return;
            if (this.buffer.length < 80) this.buffer += String.fromCharCode(byte);
            if (this.buffer.toUpperCase() === 'A/') { this.buffer = ''; this.run('A/'); }     // repeat, with no CR
        }

        sendOnline(byte) {
            const now = this.modem.now();
            const esc = this.regs[2];
            const quiet = now - this.lastTx >= this.guard;
            this.lastTx = now;
            if (byte === esc && (this.plus > 0 || quiet) && this.plus < 3) {
                this.held.push(byte);
                if (++this.plus === 3) this.escAt = now;
                return;
            }
            this.plus = 0;
            this.flush();
            this.remote.send(byte);
        }

        /** The "+++" that were not an escape go on to the other end. */
        flush() {
            const held = this.held;
            this.held = [];
            for (const b of held) this.remote.send(b);
        }

        /** The UART looks at the time: a dial may be ready to report; a guard time of silence after "+++" opens command mode. */
        tick(now) {
            this.settle();
            if (this.online && this.plus === 3 && now - this.lastTx >= this.guard) {
                this.plus = 0;
                this.held = [];
                this.online = false;
                this.result('OK');
            }
        }

        /** When the line next changes by itself (the modem's time), or 0. */
        nextAt() {
            if (this.dialing && this.dialing.finish) return this.dialing.until;
            if (this.online && this.plus === 3) return this.lastTx + this.guard;
            return 0;
        }

        /** The UART's DTR went down: hang up. */
        dtr(on) { if (!on && (this.online || this.dialing)) this.hangup(); }

        /* ---------- the commands ---------- */

        run(line) {
            let s = line.replace(/\s+/g, '').toUpperCase();
            if (s === 'A/') s = this.recall; else if (s.startsWith('AT')) this.recall = s; else if (s === '') return; else return this.result('ERROR');
            s = s.slice(2);
            let i = 0;
            const num = () => { let n = ''; while (i < s.length && s[i] >= '0' && s[i] <= '9') n += s[i++]; return n === '' ? 0 : Number(n); };
            while (i < s.length) {
                let c = s[i++];
                if (c === '&') c = '&' + (s[i++] || '');
                switch (c) {
                    case 'D': return this.call(s.slice(i));
                    case 'A': return this.result('NO CARRIER');
                    case 'E': this.echo = num() !== 0; break;
                    case 'H': { const n = num(); if (n > 1) return this.result('ERROR'); this.hangup(false); break; }
                    case 'I': { const n = num(); const t = ['1200', '', 'OK', 'DIGITAL RERUN MODEM 1200'][n]; if (t === undefined) return this.result('ERROR'); if (t) this.say(`\r\n${t}\r\n`); break; }
                    case 'L': case 'M': num(); break;
                    case 'O':
                        num();
                        if (!this.remote) return this.result('ERROR');
                        this.online = true;
                        this.lastTx = this.modem.now();
                        return;
                    case 'Q': this.quiet = num() !== 0; break;
                    case 'V': this.verbose = num() !== 0; break;
                    case 'X': { const n = num(); if (n > 4) return this.result('ERROR'); this.x = n; break; }
                    case 'Z': this.reset(); this.factory(); num(); break;
                    case '&F': this.factory(); num(); break;
                    case '&C': case '&D': case '&K': case '&W': case '&Y': num(); break;
                    case 'S': {
                        const r = num();
                        if (!(r in this.regs)) return this.result('ERROR');
                        if (s[i] === '=') { i++; const v = num(); if (v > 255) return this.result('ERROR'); this.regs[r] = v; } else if (s[i] === '?') { i++; this.say(`\r\n${String(this.regs[r]).padStart(3, '0')}\r\n`); }
                        break;
                    }
                    default: return this.result('ERROR');
                }
            }
            this.result('OK');
        }

        /* ---------- dialing and carrier ---------- */

        call(rest) {
            const number = rest.replace(/^[TP]/, '').replace(/[^0-9A-Z#*@:.+]/g, '');
            if (this.remote) return this.result('ERROR');
            if (!number) return this.result('ERROR');
            const ticket = ++this.ticket;
            const modem = this.modem;
            const until = modem.now() + this.dialTime * this.hz;
            this.dialing = { ticket };
            const early = [];                                  // what the other end says before the CONNECT is shown
            const link = {
                receive: bytes => {
                    if (this.ticket !== ticket) return;
                    if (this.online) modem.receive(bytes); else if (this.dialing) early.push(typeof bytes === 'string' ? bytes : Array.from(bytes).map(b => String.fromCharCode(b)).join(''));
                },
                hangup: () => { if (this.ticket === ticket && this.remote) this.hangup(true); }
            };
            Promise.resolve().then(() => this.dial(number, link)).catch(() => 'NO CARRIER').then(answer => {
                if (this.ticket !== ticket) { if (answer && typeof answer === 'object') answer.close(); return; }
                const finish = () => {
                    if (this.ticket !== ticket) { if (answer && typeof answer === 'object') answer.close(); return; }
                    this.dialing = null;
                    if (typeof answer === 'string') return this.result(FAIL.includes(answer) ? answer : 'NO CARRIER');
                    this.remote = answer;
                    this.online = true;
                    this.plus = 0;
                    this.lastTx = modem.now();
                    modem.carrier = true;
                    this.result(this.x > 0 ? 'CONNECT 1200' : 'CONNECT');
                    if (early.length) modem.receive(early.join(''));
                };
                this.dialing.answer = answer;
                this.dialing.finish = finish;
                this.dialing.until = until;
                this.settle();
            });
        }

        /** The answer is in: say it once the dialing has taken its time. */
        settle() {
            const d = this.dialing;
            if (d && d.finish && this.modem.now() >= d.until) d.finish();
        }

        abortDial() {
            const answer = this.dialing && this.dialing.answer;
            if (answer && typeof answer === 'object') answer.close();     // it answered; the program gave up first
            this.ticket++;
            this.dialing = null;
            this.result('NO CARRIER');
        }

        /** Hang up. `told`: the other end did it, so say NO CARRIER. */
        hangup(told) {
            const remote = this.remote;
            this.remote = null;
            this.ticket++;
            this.dialing = null;
            this.online = false;
            this.plus = 0;
            this.held = [];
            this.modem.carrier = false;
            if (remote && !told) { try { remote.close(); } catch (e) { /* gone */ } }
            if (told) this.result('NO CARRIER');
        }
    }

    const api = { Hayes };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else Object.assign(root.DigitalRerun = root.DigitalRerun || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
