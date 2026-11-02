'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Machine } = require('../js/machine.js');

/** A machine whose host clock stands at 2026-11-02 09:30:15.250 (local time). */
function machine() {
    const m = new Machine();
    const at = new Date(2026, 10, 2, 9, 30, 15, 250).getTime();
    m.clock.now = () => at;
    m.clock.reset();
    return m;
}
const latch = m => { m.output(20, 0); const r = []; for (let i = 0; i < 15; i++) r.push(m.input(20)); return r; };
const counter = r => (r[11] | r[12] << 8 | r[13] << 16 | r[14] << 24) >>> 0;

test('the clock answers 0FFh until something is latched, and after the record', () => {
    const m = machine();
    assert.equal(m.input(20), 0xFF);
    m.output(20, 0);
    for (let i = 0; i < 15; i++) m.input(20);
    assert.equal(m.input(20), 0xFF);
});

test('the record: CP/M days, BCD time, the date, the weekday', () => {
    const r = latch(machine());
    const days = Math.round((Date.UTC(2026, 10, 2) - Date.UTC(1977, 11, 31)) / 86400000);
    assert.equal(r[0], 1);
    assert.equal(r[1] | r[2] << 8, days);
    assert.deepEqual(r.slice(3, 6), [0x09, 0x30, 0x15]);
    assert.equal(r[6] | r[7] << 8, 2026);
    assert.deepEqual(r.slice(8, 11), [11, 2, 1]);                  // November, the 2nd, a Monday
    assert.equal(counter(r), 0);
    assert.equal(new Date(Date.UTC(1977, 11, 31) + days * 86400000).toISOString().slice(0, 10), '2026-11-02');
});

test('1 January 1978 is day 1', () => {
    const m = machine();
    const at = new Date(1978, 0, 1, 0, 0, 0).getTime();
    m.clock.now = () => at;
    m.clock.reset();
    const r = latch(m);
    assert.equal(r[1] | r[2] << 8, 1);
});

test('time is the machine\'s: T-states at hz, and it carries into the seconds', () => {
    const m = machine();
    m.cycles += 4000000 * 45;                                       // 45 s at 4 MHz
    const r = latch(m);
    assert.deepEqual(r.slice(3, 6), [0x09, 0x31, 0x00]);            // 09:30:15.25 + 45 s = 09:31:00
    assert.equal(counter(r), 45000);
    m.clock.hz = 8000000;                                           // twice as fast from now on
    m.cycles += 8000000;
    assert.equal(counter(latch(m)), 46000);
});

test('the record is one moment: reading it slowly does not move it', () => {
    const m = machine();
    m.output(20, 0);
    const a = m.input(20);
    m.cycles += 4000000 * 90;
    const rest = []; for (let i = 0; i < 14; i++) rest.push(m.input(20));
    assert.equal(a, 1);
    assert.equal(rest[4], 0x15);                                    // the seconds latched before
});

test('a program reads the clock mid-run: cycles are current at the port', () => {
    const m = machine();
    // loop: OUT (20),A ; IN A,(20) ; JR loop   - and check the counter moves while one run() is going
    const seen = [];
    m.clock.hz = 1000;                                              // 1 ms per 1 T-state-thousand, so a short run is visible
    m.state = 'running';
    m.memory.set([0xD3, 20, 0xDB, 20, 0xDB, 20, 0xDB, 20, 0xDB, 20, 0xDB, 20, 0xDB, 20, 0xDB, 20, 0xDB, 20, 0xDB, 20, 0xDB, 20, 0xDB, 20, 0xDB, 20, 0xDB, 20, 0xDB, 20, 0x18, 0xE0]);
    const o = m.output.bind(m), i = m.input.bind(m);
    let n = 0, rec = [];
    m.input = p => { const v = i(p); if (p === 20) { rec.push(v); if (++n % 15 === 0) { seen.push(counter(rec.slice(-15))); rec = []; } } return v; };
    m.output = (p, v) => o(p, v);
    m.run(2000);
    assert.ok(seen.length >= 2);
    assert.ok(seen[seen.length - 1] > seen[0], seen.join());
});

test('a snapshot keeps the counter', () => {
    const m = machine();
    m.cycles += 4000000 * 3;
    const s = m.getState();
    const n = machine();
    n.setState(s);
    assert.equal(counter(latch(n)), 3000);
});
