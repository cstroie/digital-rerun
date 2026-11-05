'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Machine } = require('../js/machine.js');
const { SerialLine } = require('../js/devices/webserial.js');

const SEC = 4000000;

/** A fake SerialPort: push() makes the modem say something; `written` is what was sent to it. */
function fakePort() {
    let controller;
    const written = [];
    const calls = [];
    const port = {
        written, calls, dcd: false,
        readable: new ReadableStream({ start(c) { controller = c; } }),
        writable: new WritableStream({ write(chunk) { written.push(...chunk); } }),
        open: async opts => { calls.push(['open', opts]); },
        close: async () => { calls.push(['close']); },
        getSignals: async () => ({ dataCarrierDetect: port.dcd }),
        setSignals: async s => { calls.push(['signals', s]); },
        push: text => controller.enqueue(typeof text === 'string' ? Uint8Array.from(text, c => c.charCodeAt(0)) : text),
        end: () => controller.close()
    };
    return port;
}
const tick = () => new Promise(r => setTimeout(r, 5));

async function rig(options = {}) {
    const m = new Machine();
    m.clock.hz = SEC;
    const port = fakePort();
    const closed = [];
    const line = new SerialLine(port, { baud: 9600, onClose: e => closed.push(e || null), setInterval: () => 1, clearInterval() {}, ...options });
    await line.open();
    m.modem.attach(line);
    return { m, port, line, closed };
}
const hear = m => { let out = ''; for (let i = 0; i < 4000; i++) { m.cycles += 20000; if (m.input(6) & 1) out += String.fromCharCode(m.input(7)); } return out; };

test('opens the port at the chosen speed, 8N1, no flow control', async () => {
    const { port } = await rig();
    assert.deepEqual(port.calls[0], ['open', { baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' }]);
});

test('what the program sends goes to the port, bytes sent together in one write', async () => {
    const { m, port } = await rig();
    m.output(7, 0x41);
    await tick();
    m.cycles += SEC;
    m.output(7, 0x54);
    await tick();
    assert.deepEqual(port.written, [0x41, 0x54]);
});

test('what the modem says reaches the program, paced by the UART at its baud rate', async () => {
    const { m, port } = await rig();
    port.push('OK\r\n');
    await tick();
    assert.equal(m.input(6) & 1, 0, 'not at once: a character takes its time');
    assert.equal(hear(m), 'OK\r\n');
});

test('carrier follows CONNECT and NO CARRIER in the result lines', async () => {
    const { m, port } = await rig();
    assert.equal(m.input(6) & 4, 0);
    port.push('\r\nCONNECT 1200\r\nwelcome\r\n');
    await tick();
    assert.equal(m.modem.carrier, true);
    port.push('NO CARRIER\r\n');
    await tick();
    assert.equal(m.modem.carrier, false);
    port.push('\r\nBUSY\r\n');
    await tick();
    assert.equal(m.modem.carrier, false);
});

test('the word CONNECT inside a sentence does not raise carrier', async () => {
    const { m, port } = await rig();
    port.push('the CONNECT word in a sentence\r\n');
    await tick();
    assert.equal(m.modem.carrier, false);
});

test('signals are left alone by default: DTR is not driven, DCD not read', async () => {
    const { m, port } = await rig();
    m.output(6, 1);
    m.output(6, 0);
    await tick();
    assert.deepEqual(port.calls.filter(c => c[0] === 'signals'), []);
});

test('with signals on: DTR follows the program, DCD is the carrier', async () => {
    const { m, port, line } = await rig({ signals: true });
    m.output(6, 1);
    m.output(6, 0);
    await tick();
    assert.deepEqual(port.calls.filter(c => c[0] === 'signals').map(c => c[1].dataTerminalReady), [true, false]);
    port.dcd = true;
    await line.poll();
    assert.equal(m.input(6) & 4, 4);
    port.dcd = false;
    await line.poll();
    assert.equal(m.input(6) & 4, 0);
    port.push('CONNECT 300\r\n');
    await tick();
    assert.equal(m.modem.carrier, false, 'with signals on the text does not decide');
});

test('a machine reset drops the call: carrier down, DTR low (with signals)', async () => {
    const { m, port } = await rig({ signals: true });
    m.modem.carrier = true;
    m.reset();
    assert.equal(m.modem.carrier, false);
    await tick();
    assert.equal(port.calls.filter(c => c[0] === 'signals').pop()[1].dataTerminalReady, false);
});

test('the port going away is reported once and carrier drops', async () => {
    const { m, port, closed } = await rig();
    m.modem.carrier = true;
    port.end();
    await tick();
    assert.deepEqual(closed, [null]);
    assert.equal(m.modem.carrier, false);
});

test('close lets go of the port', async () => {
    const { port, line, closed } = await rig();
    await line.close();
    assert.ok(port.calls.some(c => c[0] === 'close'));
    assert.deepEqual(closed, []);
});

test('supported(): false where there is no navigator.serial', () => {
    assert.equal(SerialLine.supported(), false);
});
