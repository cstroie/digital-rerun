'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Telnet } = require('../js/devices/telnet.js');

const IAC = 255, DONT = 254, DO = 253, WONT = 252, WILL = 251, SB = 250, SE = 240;

function rig(options = {}) {
    const sent = [];
    const t = new Telnet({ send: b => sent.push(...b), ...options });
    return { t, sent, feed: bytes => t.feed(bytes), take: () => sent.splice(0) };
}

test('plain data passes untouched; IAC IAC is one 255', () => {
    const { feed } = rig();
    assert.deepEqual(feed([72, 105, 13, 10]), [72, 105, 13, 10]);
    assert.deepEqual(feed([65, IAC, IAC, 66]), [65, 255, 66]);
});

test('a NUL after CR is dropped, a NUL elsewhere is kept', () => {
    const { feed } = rig();
    assert.deepEqual(feed([13, 0, 65, 0, 66]), [13, 65, 0, 66]);
});

test('commands split across reads', () => {
    const { feed, take } = rig();
    assert.deepEqual(feed([65, IAC]), [65]);
    assert.deepEqual(feed([DO]), []);
    assert.deepEqual(feed([24, 66]), [66]);
    assert.deepEqual(take(), [IAC, WILL, 24]);
});

test('the server echoes and suppresses go-ahead: agreed, once', () => {
    const { feed, take } = rig();
    feed([IAC, WILL, 1, IAC, WILL, 3]);
    assert.deepEqual(take(), [IAC, DO, 1, IAC, DO, 3]);
    feed([IAC, WILL, 1]);
    assert.deepEqual(take(), [], 'not answered twice');
    feed([IAC, WONT, 1]);
    assert.deepEqual(take(), [IAC, DONT, 1]);
});

test('terminal type: offered, and told when asked', () => {
    const { feed, take } = rig({ terminal: 'VT100' });
    feed([IAC, DO, 24]);
    assert.deepEqual(take(), [IAC, WILL, 24]);
    feed([IAC, SB, 24, 1, IAC, SE]);
    assert.deepEqual(take(), [IAC, SB, 24, 0, ...Buffer.from('VT100'), IAC, SE]);
});

test('window size: offered, then sent as 80 by 24', () => {
    const { feed, take } = rig();
    feed([IAC, DO, 31]);
    assert.deepEqual(take(), [IAC, WILL, 31, IAC, SB, 31, 0, 80, 0, 24, IAC, SE]);
});

test('everything else is refused: DO becomes WONT, WILL becomes DONT', () => {
    const { feed, take } = rig();
    feed([IAC, DO, 0, IAC, DO, 34, IAC, WILL, 0, IAC, WILL, 39]);
    assert.deepEqual(take(), [IAC, WONT, 0, IAC, WONT, 34, IAC, DONT, 0, IAC, DONT, 39]);
});

test('a bare NOP or GO-AHEAD is ignored', () => {
    const { feed, take } = rig();
    assert.deepEqual(feed([65, IAC, 241, 66, IAC, 249, 67]), [65, 66, 67]);
    assert.deepEqual(take(), []);
});

test('what the program sends: 255 doubled, CR as CR NUL', () => {
    const { t } = rig();
    assert.deepEqual(t.encode(65), [65]);
    assert.deepEqual(t.encode(255), [255, 255]);
    assert.deepEqual(t.encode(13), [13, 0]);
});

test('serverEchoes: false until the server says WILL ECHO, false again after WONT ECHO', () => {
    const t = new Telnet({ send() {} });
    assert.strictEqual(t.serverEchoes(), false);
    t.feed([255, 251, 1]);
    assert.strictEqual(t.serverEchoes(), true);
    t.feed([255, 252, 1]);
    assert.strictEqual(t.serverEchoes(), false);
});
