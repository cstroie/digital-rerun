/*
 * machine.js: a Z80 with 64K of RAM, a console, a printer, a clock and a
 * disk controller on I/O ports.
 *
 * Reset works like z80pack's: the "boot ROM" reads sector 1 of track 0 of
 * drive A: into 0000h and starts the CPU there. That sector is the loader
 * written on the disk, which brings in CCP, BDOS and BIOS from the system
 * tracks and jumps to the BIOS. Nothing about CP/M is built in here: change
 * the system tracks and you change the system.
 */
(function (root) {
    'use strict';

    const node = typeof module !== 'undefined' && module.exports;
    const Z80 = node ? require('./z80.js') : root.DigitalRerun.Z80;
    const { FDC, Disk } = node ? require('./devices/fdc.js') : root.DigitalRerun;
    const { Console, PrinterPort, TapeReader, TapePunch } = node ? require('./devices/serial.js') : root.DigitalRerun;
    const { Clock } = node ? require('./devices/clock.js') : root.DigitalRerun;
    const { Modem } = node ? require('./devices/modem.js') : root.DigitalRerun;

    const IDLE_GAP = 20000;

    class Machine {
        constructor() {
            this.memory = new Uint8Array(65536);
            this.console = new Console();
            this.console.now = () => this.cycles;
            this.printer = new PrinterPort();
            this.reader = new TapeReader();
            this.punch = new TapePunch();
            this.fdc = new FDC(this.memory);
            this.cycles = 0;
            this.clock = new Clock(this);
            this.modem = new Modem(this);
            /** Addresses the debugger stops at; empty: the run loop never looks. */
            this.breakpoints = new Set();
            /** Called with the address when a breakpoint stops the machine. */
            this.onBreak = null;
            /** After run(): was the program waiting for a key? (see run) */
            this.idle = false;
            this.waiting = false;
            /** 'stopped' | 'running' | 'paused' (the debugger) | 'halted' */
            this.state = 'stopped';
            const mem = this.memory;
            this.cpu = new Z80({
                mem_read: a => mem[a],
                mem_write: (a, v) => { mem[a] = v; },
                io_read: port => this.input(port & 0xFF),
                io_write: (port, v) => this.output(port & 0xFF, v)
            });
        }

        input(port) {
            if (port !== 0 && port !== 6) this.console.idlePolls = 0;      // any other I/O is work, not waiting
            switch (port) {
                case 0: return this.console.status();
                case 1: return this.console.read();
                case 6: {                                       // the modem's status: polling it with nothing there is waiting
                    const status = this.modem.status();
                    if (status & 1) this.console.idlePolls = 0; else this.console.idlePolls++;
                    return status;
                }
                case 7: return this.modem.read();
                case 2: return this.printer.status();
                case 4: return this.reader.read();
                case 10: case 14: case 18: return this.fdc.in(port);
                case 20: return this.clock.read();
                default: return 0xFF;
            }
        }

        output(port, value) {
            this.console.idlePolls = 0;
            switch (port) {
                case 1: this.console.write(value); break;
                case 3: this.printer.write(value); break;
                case 5: this.punch.write(value); break;
                case 6: this.modem.control(value); break;
                case 7: this.modem.write(value); break;
                case 20: this.clock.latch(); break;
                case 10: case 11: case 12: case 13: case 15: case 16: case 17:
                    this.fdc.out(port, value);
                    break;
            }
        }

        /** Clear RAM, load the boot sector of A: and start at 0000h. */
        reset() {
            this.memory.fill(0);
            this.cpu.reset();
            this.cycles = 0;
            this.clock.reset();
            this.modem.setState(null);            // a power cycle: the call is dropped, the times start again
            const fdc = this.fdc;
            Object.assign(fdc, { drive: 0, track: 0, sector: 1, dma: 0x0000 });
            const status = fdc.command(0);
            if (status !== 0) {
                this.state = 'stopped';
                return false;
            }
            fdc.dma = 0x80;
            this.state = 'running';
            return true;
        }

        /** Everything needed to continue later: CPU, RAM, controller, and a copy of each disk. */
        getState() {
            const f = this.fdc;
            return {
                memory: this.memory.slice(),
                cpu: this.cpu.getState(),
                cycles: this.cycles,
                clock: this.clock.getState(),
                state: this.state,
                fdc: { drive: f.drive, track: f.track, sector: f.sector, dma: f.dma, status: f.status },
                printerOnline: this.printer.online,
                modem: this.modem.getState(),
                drives: f.drives.map((d, i) => d && { drive: i, name: d.name, origin: d.origin, format: d.format, readOnly: d.readOnly, data: d.data.slice() }).filter(Boolean)
            };
        }

        setState(s) {
            this.memory.set(s.memory);
            this.cpu.setState(s.cpu);
            this.cycles = s.cycles;
            this.clock.setState(s.clock);
            this.state = s.state;
            Object.assign(this.fdc, s.fdc);
            this.printer.online = s.printerOnline;
            this.modem.setState(s.modem);
            this.fdc.drives.fill(null);
            for (const d of s.drives) this.fdc.mount(d.drive, new Disk(d.format, d.data.slice(), { name: d.name, readOnly: d.readOnly, origin: d.origin || '' }));
            this.console.queue.length = 0;
            this.console.idlePolls = 0;
        }

        /* --- the debugger's controls --- */

        get pc() { return this.cpu.get_pc(); }

        pause() { if (this.state === 'running') this.state = 'paused'; }

        resume() { if (this.state === 'paused') this.state = 'running'; }

        /** One instruction, while paused. Returns its T-states. */
        step() {
            if (this.state !== 'paused') return 0;
            const t = this.cpu.run_instruction();
            this.cycles += t;
            if (this.halted) this.state = 'halted';
            return t;
        }

        get halted() {
            return this.cpu.getState().halted;
        }

        /**
         * A program waiting (polling) while the modem has something coming: the
         * T-states until it arrive are spent as the polling would have, and the
         * program looks again. Returns them, or 0 when nothing is due within
         * `room` (the run then stops and credits the rest).
         */
        skipIdle(room) {
            const gap = this.modem.untilEvent();
            if (gap === null || gap > room) return 0;
            this.modem.idle(gap);
            this.console.idlePolls = 0;
            return gap || 1;
        }

        /**
         * Run for about `budget` T-states. Returns the T-states used. Stops
         * early when the program sits in a tight loop waiting for a key (so
         * an idle machine costs nothing) or on HALT. Afterwards:
         *   waiting  it asked for a key more than 64 times with nothing
         *            typed, printed or read in between: a tight wait loop
         *            (the CCP, most programs at a prompt)
         *   idle     waiting, or asking at least every IDLE_GAP T-states
         *            between other work (BBC BASIC asks every ~7700). A
         *            compiler checking for ^C looks idle too: good enough
         *            for the RUN light, not to know a command has finished.
         */
        run(budget) {
            if (this.state !== 'running') return 0;
            const cpu = this.cpu;
            const con = this.console;
            let used = 0;
            con.idlePolls = 0;
            if (this.breakpoints.size) {
                const bp = this.breakpoints;
                let first = true;                 // leaving a breakpoint: do not stop on it again
                while (used < budget) {
                    const pc = cpu.get_pc();
                    if (!first && bp.has(pc)) { this.pause(); if (this.onBreak) this.onBreak(pc); break; }
                    first = false;
                    const t = cpu.run_instruction();
                    used += t;
                    this.cycles += t;
                    if (con.idlePolls > 64) { const skipped = this.skipIdle(budget - used); if (!skipped) break; used += skipped; }
                }
            } else {
                while (used < budget) {
                    const t = cpu.run_instruction();
                    used += t;
                    this.cycles += t;       // current at every port read: the clock counts on it
                    if (con.idlePolls > 64) { const skipped = this.skipIdle(budget - used); if (!skipped) break; used += skipped; }
                }
            }
            const polls = con.idlePolls;
            this.waiting = polls > 64;
            if (this.waiting) this.modem.idle(budget - used);   // a waiting loop would have spent the rest
            this.idle = this.waiting || (polls >= 4 && used / polls < IDLE_GAP);
            if (this.halted) this.state = 'halted';
            return used;
        }
    }

    const api = { Machine };
    if (node) module.exports = api;
    else Object.assign(root.DigitalRerun = root.DigitalRerun || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
