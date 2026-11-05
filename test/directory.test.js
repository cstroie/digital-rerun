'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Directory } = require('../js/devices/directory.js');

const link = { receive() {}, hangup() {} };

test('a number of the directory is answered here', async () => {
    const d = new Directory();
    const remote = await d.dial('0', link);
    assert.equal(typeof remote.send, 'function');
});

test('an unknown number, or a host with no gateway: NO CARRIER', () => {
    const d = new Directory();
    assert.equal(d.dial('5559999', link), 'NO CARRIER');
    assert.equal(d.dial('BBS.EXAMPLE.ORG', link, 'bbs.example.org'), 'NO CARRIER');
});

test('a host goes to the gateway, port 23 unless one is given; a number does not', () => {
    const calls = [];
    const d = new Directory();
    d.gateway = { dial: (host, port) => { calls.push([host, port]); return Promise.resolve('BUSY'); } };
    d.dial('BBS.EXAMPLE.ORG', link, 'bbs.Example.org');
    d.dial('BBS.EXAMPLE.ORG:2323', link, 'bbs.Example.org:2323');
    d.dial('127.0.0.1:2300', link, '127.0.0.1:2300');
    assert.equal(d.dial('5559999', link, '5559999'), 'NO CARRIER');
    assert.equal(d.dial('HOST', link, 'a b'), 'NO CARRIER');
    assert.deepEqual(calls, [['bbs.Example.org', 23], ['bbs.Example.org', 2323], ['127.0.0.1', 2300]]);
});

test('an entry of the directory wins over the gateway', async () => {
    const d = new Directory();
    d.gateway = { dial: () => { throw new Error('should not be called'); } };
    d.add('5550100', () => ({ send() {}, close() {} }));
    assert.equal(typeof (await d.dial('5550100', link, '5550100')).send, 'function');
});

test('sometimesBusy: busy when the dice say so, the real answer otherwise', async () => {
    const { sometimesBusy } = require('../js/devices/directory.js');
    const make = () => ({ send() {}, close() {} });
    assert.equal(sometimesBusy(make, 0.1, () => 0.05)(link), 'BUSY');
    assert.equal(typeof sometimesBusy(make, 0.1, () => 0.5)(link).send, 'function');
    assert.equal(typeof sometimesBusy(make, 0, () => 0)(link).send, 'function', 'never busy at 0');
});

test('numbers: 555-0101 by its last four digits, in full, with the dash; the BBS as 0100', async () => {
    const { PHONEBOOK } = require('../js/devices/directory.js');
    const calls = [];
    const d = new Directory();
    d.gateway = { dial: (host, port) => { calls.push([host, port]); return Promise.resolve('BUSY'); } };
    d.add('5550100', () => ({ send() {}, close() {} }));
    for (const n of ['0101', '5550101']) d.dial(n, link, n);
    d.dial('0107', link, '0107');
    assert.deepEqual(calls, [['telehack.com', 23], ['telehack.com', 23], ['particlesbbs.dyndns.org', 6400]]);
    assert.equal(typeof (await d.dial('0100', link, '0100')).send, 'function', 'the short number of the board');
    assert.equal(typeof (await d.dial('5550100', link, '5550100')).send, 'function');
    assert.equal(d.dial('0199', link, '0199'), 'NO CARRIER', 'a number nobody has');
    assert.equal(PHONEBOOK.length, 10);
    assert.deepEqual(PHONEBOOK.map(e => e.n), ['0101', '0102', '0103', '0104', '0105', '0106', '0107', '0108', '0109', '0110']);
});

test('numbers: with no bridge the line has no dial tone', () => {
    const d = new Directory();
    assert.equal(d.dial('0101', link, '0101'), 'NO DIALTONE');
    assert.equal(d.dial('5550101', link, '555-0101'), 'NO DIALTONE');
});

test('numbers: the echo service is still 0, and a four digit number is not mistaken for it', () => {
    const d = new Directory();
    assert.equal(typeof d.dial('0', link, '0').send, 'function');
});
