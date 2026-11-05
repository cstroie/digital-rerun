'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Machine } = require('../js/machine.js');
const { Hayes } = require('../js/devices/hayes.js');

const SEC = 4000000;

/** A machine with a Hayes modem; `answers` maps a number to what dial() gives. */
function rig(answers = {}) {
    const m = new Machine();
    m.clock.hz = SEC;
    const dialed = [];
    const hayes = new Hayes({
        dialTime: 0,
        dial: (number, link) => {
            dialed.push(number);
            const a = answers[number];
            if (typeof a === 'function') return Promise.resolve(a(link));
            return Promise.resolve(a === undefined ? 'NO CARRIER' : a);
        }
    });
    m.modem.attach(hayes);
    m.dialed = dialed;
    m.hayes = hayes;
    return m;
}

/** Time passes by `cycles`, the program polling the modem every few thousand T-states, as a loop in Z80 would. */
function advance(m, cycles) {
    let out = '';
    for (let t = 0; t < cycles; t += 5000) {
        m.cycles += 5000;
        if (m.input(6) & 1) out += String.fromCharCode(m.input(7));
    }
    return out;
}
/** Whatever is still on the wire arrives. */
function drain(m) {
    let out = '';
    for (let i = 0; i < 200 && (m.modem.inbox.length || m.input(6) & 1); i++) out += advance(m, 5000);
    return out;
}
/** The program types `text` (a key every 40000 T-states), reading what comes back; all it heard is returned. */
function type(m, text, seconds = 1) {
    let out = '';
    for (const ch of text) { out += advance(m, 40000); m.output(7, ch.charCodeAt(0)); }
    return out + wait(m, seconds);
}
function wait(m, seconds = 1) {
    return advance(m, seconds * SEC) + drain(m);
}
const flush = () => new Promise(r => setImmediate(r));

test('AT answers OK, echoing what was typed', () => {
    const m = rig();
    assert.equal(type(m, 'AT\r'), 'AT\r\r\nOK\r\n');
});

test('echo off, numeric results, quiet', () => {
    const m = rig();
    type(m, 'ATE0\r');
    assert.equal(type(m, 'AT\r'), '\r\nOK\r\n');
    assert.equal(type(m, 'ATV0\r'), '0\r');
    assert.equal(type(m, 'AT\r'), '0\r');
    assert.equal(type(m, 'ATQ1\r'), '');
    assert.equal(type(m, 'AT\r'), '');
});

test('lower case, spaces, several commands in a line, an unknown one is ERROR', () => {
    const m = rig();
    type(m, 'ATE0\r');
    assert.equal(type(m, 'at e0 v1 l1 m0\r'), '\r\nOK\r\n');
    assert.equal(type(m, 'ATE0 W\r'), '\r\nERROR\r\n');
    assert.equal(type(m, 'hello\r'), '\r\nERROR\r\n');
    assert.equal(type(m, '\r'), '');
});

test('backspace edits the command line', () => {
    const m = rig();
    type(m, 'ATE0\r');
    assert.equal(type(m, 'ATX\x08Z\r'), '\r\nOK\r\n');
    assert.equal(type(m, 'ATQQ\x08\x08E0\r'), 'ATQQ\b\bE0\r\r\nOK\r\n');      // ATZ switched the echo back on
});

test('registers: set, read, refuse an unknown one', () => {
    const m = rig();
    type(m, 'ATE0\r');
    assert.equal(type(m, 'ATS12=25\r'), '\r\nOK\r\n');
    assert.equal(type(m, 'ATS12?\r'), '\r\n025\r\n\r\nOK\r\n');
    assert.equal(type(m, 'ATS99?\r'), '\r\nERROR\r\n');
    type(m, 'ATZ\r');
    assert.equal(type(m, 'ATS12?\r').includes('050'), true);
});

test('A/ repeats the last command', () => {
    const m = rig();
    type(m, 'ATE0\r');
    type(m, 'ATS0=3\r');
    assert.equal(type(m, 'A/'), '\r\nOK\r\n');
});

test('ATI tells what it is', () => {
    const m = rig();
    type(m, 'ATE0\r');
    assert.match(type(m, 'ATI3\r'), /DIGITAL RERUN MODEM 1200/);
});

test('ATDT: CONNECT 1200, carrier up, bytes both ways', async () => {
    let theirs = null;
    const got = [];
    const m = rig({ '5551212': link => { theirs = link; return { send: b => got.push(b), close() { this.closed = true; } }; } });
    type(m, 'ATE0\r');
    type(m, 'ATDT555-1212\r', 0);
    await flush();
    assert.deepEqual(m.dialed, ['5551212']);
    assert.equal(wait(m), '\r\nCONNECT 1200\r\n');
    assert.equal(m.input(6) & 4, 4);
    type(m, 'hi', 0);
    assert.deepEqual(got, [0x68, 0x69]);
    theirs.receive('WELCOME');
    assert.equal(wait(m), 'WELCOME');
});

test('dial failures: BUSY, NO ANSWER, no such number, a dial that throws', async () => {
    const m = rig({ 1: 'BUSY', 2: 'NO ANSWER', 4: 'something odd' });
    m.hayes.dial = (n) => n === '9' ? Promise.reject(new Error('x')) : ({ 1: Promise.resolve('BUSY'), 2: Promise.resolve('NO ANSWER'), 4: Promise.resolve('weird') })[n] || Promise.resolve('NO CARRIER');
    type(m, 'ATE0\r');
    for (const [n, say] of [['1', 'BUSY'], ['2', 'NO ANSWER'], ['3', 'NO CARRIER'], ['4', 'NO CARRIER'], ['9', 'NO CARRIER']]) {
        type(m, `ATD${n}\r`, 0);
        await flush();
        assert.equal(wait(m), `\r\n${say}\r\n`, n);
        assert.equal(m.input(6) & 4, 0);
    }
});

test('ATD with no number is ERROR; dialing while connected is ERROR', async () => {
    const m = rig({ 7: () => ({ send() {}, close() {} }) });
    type(m, 'ATE0\r');
    assert.equal(type(m, 'ATD\r'), '\r\nERROR\r\n');
    type(m, 'ATD7\r', 0);
    await flush();
    wait(m);
    type(m, '+++', 0);
    wait(m, 2);
    assert.equal(type(m, 'ATD7\r'), '\r\nERROR\r\n');
});

test('a key pressed while dialing stops it', async () => {
    let closed = false;
    const m = rig({ 7: () => ({ send() {}, close() { closed = true; } }) });
    m.hayes.dialTime = 5;
    type(m, 'ATE0\r');
    type(m, 'ATD7\r', 0);
    await flush();
    assert.equal(wait(m, 1), '');
    assert.equal(type(m, 'x', 0) + wait(m, 0), '\r\nNO CARRIER\r\n');
    m.cycles += 10 * SEC;
    await flush();
    assert.equal(wait(m), '');
    assert.equal(closed, true);
    assert.equal(m.input(6) & 4, 0);
});

test('dialing takes its time before CONNECT', async () => {
    const m = rig({ 7: () => ({ send() {}, close() {} }) });
    m.hayes.dialTime = 3;
    type(m, 'ATE0\r');
    type(m, 'ATD7\r', 0);
    await flush();
    assert.equal(wait(m, 2), '');
    assert.equal(wait(m, 2), '\r\nCONNECT 1200\r\n');
});

test('+++ with a second of silence either side returns to command mode; ATO goes back online', async () => {
    const got = [];
    const m = rig({ 7: () => ({ send: b => got.push(b), close() { this.closed = true; } }) });
    type(m, 'ATE0\r');
    type(m, 'ATD7\r', 0);
    await flush();
    wait(m);
    m.cycles += 2 * SEC;
    type(m, '+++', 0);
    assert.equal(wait(m, 0), '');
    assert.equal(wait(m, 2), '\r\nOK\r\n');
    assert.deepEqual(got, [], 'the escape is not sent on');
    assert.equal(m.input(6) & 4, 4, 'carrier stays');
    assert.equal(type(m, 'ATO\r', 0) + wait(m, 0), '');
    type(m, 'a', 0);
    assert.deepEqual(got, [0x61]);
});

test('+++ typed in a hurry, or with more after it, is data', async () => {
    const got = [];
    const m = rig({ 7: () => ({ send: b => got.push(b), close() {} }) });
    type(m, 'ATE0\r');
    type(m, 'ATD7\r', 0);
    await flush();
    wait(m);
    type(m, '+++x', 0);                       // no silence before
    assert.equal(wait(m, 3), '');
    assert.deepEqual(got, [0x2B, 0x2B, 0x2B, 0x78]);
    got.length = 0;
    m.cycles += 3 * SEC;
    type(m, '++', 0);
    type(m, 'y', 0);
    assert.deepEqual(got, [0x2B, 0x2B, 0x79]);
});

test('ATH hangs up; DTR down hangs up; the other end hanging up says NO CARRIER', async () => {
    let theirs, closed = 0;
    const answer = link => { theirs = link; return { send() {}, close() { closed++; } }; };
    const m = rig({ 7: answer });
    type(m, 'ATE0\r');
    const connect = async () => { type(m, 'ATD7\r', 0); await flush(); wait(m); assert.equal(m.input(6) & 4, 4); };

    await connect();
    m.cycles += 2 * SEC; type(m, '+++', 0); wait(m, 2);
    assert.equal(type(m, 'ATH\r'), '\r\nOK\r\n');
    assert.equal(m.input(6) & 4, 0);
    assert.equal(closed, 1);

    await connect();
    m.output(6, 1);
    m.output(6, 0);
    assert.equal(m.input(6) & 4, 0);
    assert.equal(closed, 2);

    await connect();
    theirs.hangup();
    assert.equal(wait(m), '\r\nNO CARRIER\r\n');
    assert.equal(m.input(6) & 4, 0);
    assert.equal(type(m, 'AT\r'), '\r\nOK\r\n');
});

test('a snapshot restore hangs up', async () => {
    let closed = 0;
    const m = rig({ 7: () => ({ send() {}, close() { closed++; } }) });
    type(m, 'ATE0\r');
    type(m, 'ATD7\r', 0);
    await flush();
    wait(m);
    m.setState(m.getState());
    assert.equal(closed, 1);
    assert.equal(m.input(6) & 4, 0);
});

test('the dial function is given the host as typed too: its case and dashes kept', async () => {
    const seen = [];
    const m = rig();
    m.hayes.dial = (number, link, typed) => { seen.push([number, typed]); return Promise.resolve('NO CARRIER'); };
    type(m, 'ATE0\r');
    type(m, 'ATDT Bbs.Example-One.org:2323\r', 0);
    await flush();
    type(m, 'atd555-0100\r', 0);
    await flush();
    assert.deepEqual(seen, [['BBS.EXAMPLEONE.ORG:2323', 'Bbs.Example-One.org:2323'], ['5550100', '555-0100']]);
});
