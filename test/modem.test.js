'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Machine } = require('../js/machine.js');
const { Loopback } = require('../js/devices/modem.js');

const PER = 33333;                                  // T-states a character takes at 1200 baud and 4 MHz

function machine() {
    const m = new Machine();
    m.clock.hz = 4000000;
    m.modem.attach(new Loopback());
    return m;
}
const status = m => m.input(6);

test('no line plugged in: the status is 0FFh (no modem); with one it never is', () => {
    const m = new Machine();
    assert.equal(status(m), 0xFF);
    m.modem.attach({ send() {} });
    assert.equal(status(m), 0x02);
    assert.notEqual(status(m), 0xFF);
});

test('a character takes ten bit times: 120 a second at 1200 baud', () => {
    const m = machine();
    assert.equal(m.modem.perChar, PER);
    m.clock.hz = 2000000;
    assert.equal(m.modem.perChar, Math.round(2000000 * 10 / 1200));
    m.modem.baud = 300;
    assert.equal(m.modem.perChar, Math.round(2000000 * 10 / 300));
});

test('a received byte shows up after its time, not before', () => {
    const m = machine();
    m.modem.receive('A');
    assert.equal(status(m) & 1, 0);
    m.cycles = PER - 1;
    assert.equal(status(m) & 1, 0);
    m.cycles = PER;
    assert.equal(status(m) & 1, 1);
    assert.equal(m.input(7), 0x41);
    assert.equal(status(m) & 1, 0);
});

test('a burst is spread at the baud rate', () => {
    const m = machine();
    m.modem.receive('abc');
    const got = [];
    for (let t = 0; t <= 4 * PER; t += 1000) {
        m.cycles = t;
        if (status(m) & 1) got.push([Math.floor(t / PER), m.input(7)]);
    }
    assert.deepEqual(got.map(g => g[1]), [0x61, 0x62, 0x63]);
    assert.deepEqual(got.map(g => g[0]), [1, 2, 3]);
});

test('a byte not read before the next arrives is overrun: the new one is kept, the flag set until the data is read', () => {
    const m = machine();
    m.modem.receive('xy');
    m.cycles = 2 * PER;
    assert.equal(status(m) & 8, 8);
    assert.equal(m.input(7), 0x79);
    assert.equal(status(m) & 8, 0);
});

test('the transmitter is busy for a character time; a byte written then is lost', () => {
    const m = machine();
    const sent = [];
    m.modem.line.send = b => sent.push(b);
    assert.equal(status(m) & 2, 2);
    m.output(7, 0x41);
    assert.equal(status(m) & 2, 0);
    m.output(7, 0x42);
    assert.deepEqual(sent, [0x41]);
    assert.equal(m.modem.dropped, 1);
    m.cycles = PER;
    assert.equal(status(m) & 2, 2);
    m.output(7, 0x43);
    assert.deepEqual(sent, [0x41, 0x43]);
});

test('the loopback line sends back what it is sent, a character later', () => {
    const m = machine();
    assert.equal(status(m) & 4, 4);
    m.output(7, 0x5A);
    m.cycles = PER * 2;
    assert.equal(status(m) & 1, 1);
    assert.equal(m.input(7), 0x5A);
});

test('dropping DTR is told to the line', () => {
    const m = machine();
    const seen = [];
    m.modem.line.dtr = on => seen.push(on);
    m.output(6, 1);
    m.output(6, 0);
    m.output(6, 0);
    assert.deepEqual(seen, [true, false]);
});

test('a snapshot keeps the speed and drops the connection', () => {
    const m = machine();
    m.modem.baud = 2400;
    m.modem.receive('q');
    const s = m.getState();
    assert.deepEqual(s.modem, { baud: 2400, dtr: false });
    m.modem.baud = 300;
    m.setState(s);
    assert.equal(m.modem.baud, 2400);
    assert.equal(m.modem.carrier, false);
    assert.equal(m.modem.inbox.length, 0);
});

/*
 * A program: send "Hi", then read two bytes back into 0200h and halt.
 *   put: wait for the transmitter, send A      get: wait for a byte, read it
 */
const PROGRAM = [
    [0x0000, [0x3E, 0x48, 0xCD, 0x30, 0x00, 0x3E, 0x69, 0xCD, 0x30, 0x00,
              0xCD, 0x40, 0x00, 0x32, 0x00, 0x02, 0xCD, 0x40, 0x00, 0x32, 0x01, 0x02, 0x76]],
    [0x0030, [0x47, 0xDB, 0x06, 0xE6, 0x02, 0xCA, 0x31, 0x00, 0x78, 0xD3, 0x07, 0xC9]],
    [0x0040, [0xDB, 0x06, 0xE6, 0x01, 0xCA, 0x40, 0x00, 0xDB, 0x07, 0xC9]]
];

test('a Z80 program polling the modem sends and receives, and waiting costs no host time but the modem\'s clock moves', () => {
    const m = machine();
    for (const [at, bytes] of PROGRAM) m.memory.set(bytes, at);
    m.cpu.reset();
    m.state = 'running';
    let calls = 0;
    while (m.state === 'running' && calls++ < 200) m.run(60000);
    assert.equal(m.state, 'halted');
    assert.equal(m.memory[0x200], 0x48);
    assert.equal(m.memory[0x201], 0x69);
    assert.ok(m.modem.credit > 0, 'idle T-states were credited');
    assert.ok(m.modem.now() >= 3 * PER, 'two characters out and back take their time');
});

test('polling an empty modem is waiting: the run loop stops early', () => {
    const m = machine();
    m.memory.set([0xDB, 0x06, 0xE6, 0x01, 0xCA, 0x00, 0x00], 0);
    m.cpu.reset();
    m.state = 'running';
    const used = m.run(200000);
    assert.ok(used < 200000);
    assert.equal(m.waiting, true);
    assert.equal(m.modem.credit, 200000 - used);
});
