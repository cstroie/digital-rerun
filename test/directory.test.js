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
