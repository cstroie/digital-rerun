'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const http = require('node:http');
const { createBridge, allowed, isPrivate } = require('../tools/modem-bridge.js');
const { Gateway } = require('../js/devices/gateway.js');

test('isPrivate: loopback, private ranges, local names; public addresses are not', () => {
    for (const h of ['localhost', '127.0.0.1', '10.1.2.3', '192.168.0.9', '172.16.0.1', '172.31.255.1', '169.254.1.1', 'printer.local', '::1', '100.64.0.1']) assert.equal(isPrivate(h), true, h);
    for (const h of ['bbs.example.org', '8.8.8.8', '172.32.0.1', '11.0.0.1']) assert.equal(isPrivate(h), false, h);
});

test('allowed: names, ports, *.domain, * (public only unless allowed)', () => {
    assert.equal(allowed(['bbs.example.org'], 'BBS.example.org', 23, false), true);
    assert.equal(allowed(['bbs.example.org'], 'other.example.org', 23, false), false);
    assert.equal(allowed(['bbs.example.org:2323'], 'bbs.example.org', 23, false), false);
    assert.equal(allowed(['bbs.example.org:2323'], 'bbs.example.org', 2323, false), true);
    assert.equal(allowed(['*.example.org'], 'a.b.example.org', 23, false), true);
    assert.equal(allowed(['*.example.org'], 'example.org', 23, false), false);
    assert.equal(allowed(['*'], 'anywhere.net', 1, false), true);
    assert.equal(allowed(['*'], '127.0.0.1', 1, false), false);
    assert.equal(allowed(['*'], '127.0.0.1', 1, true), true);
    assert.equal(allowed(['127.0.0.1'], '127.0.0.1', 1, false), true, 'named, so allowed');
    assert.equal(allowed([], 'bbs.example.org', 23, false), false);
});

/** A TCP server that records what it gets and says `greeting` first. */
function tcpServer(greeting = Buffer.alloc(0)) {
    const got = [];
    const server = net.createServer(s => {
        server.last = s;
        if (greeting.length) s.write(greeting);
        s.on('data', d => got.push(...d));
        s.on('error', () => {});
    });
    return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, got, port: server.address().port })));
}
const listen = server => new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const closeAll = (...servers) => Promise.all(servers.map(s => new Promise(r => { s.closeAllConnections?.(); s.close(r); })));

/** Connect a WebSocket to the bridge; resolves { ws, messages, closed } once open or closed. */
function client(port, params) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/connect?${new URLSearchParams(params)}`);
    ws.binaryType = 'arraybuffer';
    const c = { ws, messages: [], code: null, opened: false };
    c.done = new Promise(r => { ws.onclose = e => { c.code = e.code; r(c); }; });
    ws.onopen = () => { c.opened = true; };
    ws.onmessage = e => c.messages.push(typeof e.data === 'string' ? e.data : Buffer.from(e.data));
    c.until = async fn => { for (let i = 0; i < 200 && !fn(); i++) await new Promise(r => setTimeout(r, 10)); return fn(); };
    return c;
}

test('a connection: "connected", then bytes both ways, untouched', async () => {
    const { server: tcp, got, port: tport } = await tcpServer(Buffer.from([0xFF, 0xFD, 0x18, 65]));
    const bridge = createBridge({ allow: [`127.0.0.1:${tport}`], token: 's3cret' });
    const bport = await listen(bridge);
    const c = client(bport, { host: '127.0.0.1', port: tport, token: 's3cret' });
    assert.ok(await c.until(() => c.messages.length >= 2));
    assert.equal(c.messages[0], 'connected');
    assert.deepEqual([...c.messages[1]], [0xFF, 0xFD, 0x18, 65], 'the bridge does not touch the bytes');
    c.ws.send(Uint8Array.from([1, 2, 3, 255]));
    assert.ok(await c.until(() => got.length === 4));
    assert.deepEqual(got, [1, 2, 3, 255]);
    c.ws.close();
    await c.done;
    await closeAll(bridge, tcp);
});

test('the far end hanging up closes the WebSocket', async () => {
    const { server: tcp, port: tport } = await tcpServer();
    const bridge = createBridge({ allow: [`127.0.0.1:${tport}`] });
    const bport = await listen(bridge);
    const c = client(bport, { host: '127.0.0.1', port: tport });
    assert.ok(await c.until(() => c.messages.includes('connected')));
    tcp.last.destroy();
    await c.done;
    assert.equal(c.code, 1000);
    await closeAll(bridge, tcp);
});

test('refused: not on the list 4001, nothing listening 4002, bad port 4001', async () => {
    const { server: tcp, port: tport } = await tcpServer();
    const dead = await tcpServer();
    const deadPort = dead.port;
    await closeAll(dead.server);
    const bridge = createBridge({ allow: [`127.0.0.1:${tport}`, `127.0.0.1:${deadPort}`] });
    const bport = await listen(bridge);
    let c = client(bport, { host: 'example.org', port: 23 });
    await c.done;
    assert.equal(c.code, 4001);
    c = client(bport, { host: '127.0.0.1', port: deadPort });
    await c.done;
    assert.equal(c.code, 4002);
    c = client(bport, { host: '127.0.0.1', port: 99999 });
    await c.done;
    assert.equal(c.code, 4001);
    c = client(bport, { host: '127.0.0.1;rm', port: tport });
    await c.done;
    assert.equal(c.code, 4001);
    await closeAll(bridge, tcp);
});

/** An upgrade request by hand, to see the status line. */
function upgrade(port, path, headers = {}) {
    return new Promise(resolve => {
        const req = http.request({ port, host: '127.0.0.1', path, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', ...headers } });
        req.on('upgrade', (res, socket) => { socket.destroy(); resolve(res.statusCode); });
        req.on('response', res => { res.resume(); resolve(res.statusCode); });
        req.on('error', () => resolve(0));
        req.end();
    });
}

test('a wrong token or origin, a wrong path, a plain GET: refused before any connection is made', async () => {
    const bridge = createBridge({ allow: ['*'], token: 'good', origins: ['https://app.example'] });
    const port = await listen(bridge);
    const q = '/connect?host=example.org&port=23';
    assert.equal(await upgrade(port, q + '&token=bad', { Origin: 'https://app.example' }), 403);
    assert.equal(await upgrade(port, q, { Origin: 'https://app.example' }), 403, 'no token');
    assert.equal(await upgrade(port, q + '&token=good', { Origin: 'https://evil.example' }), 403);
    assert.equal(await upgrade(port, q + '&token=good'), 403, 'no Origin');
    assert.equal(await upgrade(port, '/other?token=good', { Origin: 'https://app.example' }), 400);
    assert.equal(await upgrade(port, q + '&token=good', { Origin: 'https://app.example' }), 101);
    const plain = await new Promise(r => http.get({ port, host: '127.0.0.1', path: '/' }, res => { res.resume(); r(res.statusCode); }));
    assert.equal(plain, 426);
    await closeAll(bridge);
});

test('at most `max` connections at once', async () => {
    const { server: tcp, port: tport } = await tcpServer();
    const bridge = createBridge({ allow: [`127.0.0.1:${tport}`], max: 1 });
    const bport = await listen(bridge);
    const a = client(bport, { host: '127.0.0.1', port: tport });
    assert.ok(await a.until(() => a.messages.includes('connected')));
    const b = client(bport, { host: '127.0.0.1', port: tport });
    await b.done;
    assert.equal(b.opened, false);
    a.ws.close();
    await a.done;
    await closeAll(bridge, tcp);
});

test('a client that sends an unmasked frame is dropped', async () => {
    const { server: tcp, port: tport } = await tcpServer();
    const bridge = createBridge({ allow: [`127.0.0.1:${tport}`] });
    const port = await listen(bridge);
    const socket = net.connect(port, '127.0.0.1');
    socket.resume();                                        // read what the bridge says, so that its end is seen
    const ended = new Promise(r => { socket.on('close', () => r(true)); setTimeout(() => r(false), 2000); });
    await new Promise(r => socket.once('connect', r));
    socket.write(`GET /connect?host=127.0.0.1&port=${tport} HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`);
    await new Promise(r => setTimeout(r, 100));
    socket.write(Buffer.from([0x82, 0x01, 0x41]));         // a binary frame without the mask the protocol requires
    assert.equal(await ended, true);
    socket.destroy();
    await closeAll(bridge, tcp);
});

test('the gateway: dials through the bridge, telnet negotiation answered, data clean', async () => {
    const IAC = 255;
    const { server: tcp, got, port: tport } = await tcpServer(Buffer.from([IAC, 253, 24, IAC, 251, 1, 87, 101, 108, 99, 111, 109, 101, 13, 0, 10]));
    const bridge = createBridge({ allow: [`127.0.0.1:${tport}`], token: 'tok' });
    const bport = await listen(bridge);
    const received = [];
    let hung = false;
    const gw = new Gateway({ url: `ws://127.0.0.1:${bport}`, token: 'tok' });
    const remote = await gw.dial('127.0.0.1', tport, { receive: b => received.push(...b), hangup: () => { hung = true; } });
    assert.equal(typeof remote, 'object');
    for (let i = 0; i < 100 && received.length < 9; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(Buffer.from(received).toString('latin1'), 'Welcome\r\n');
    assert.deepEqual(got.slice(0, 6), [IAC, 251, 24, IAC, 253, 1], 'WILL TTYPE, DO ECHO');
    got.length = 0;
    remote.send(104); remote.send(255); remote.send(13);
    for (let i = 0; i < 100 && got.length < 4; i++) await new Promise(r => setTimeout(r, 10));
    assert.deepEqual(got, [104, 255, 255, 13, 0]);
    tcp.last.destroy();
    for (let i = 0; i < 100 && !hung; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(hung, true);
    await closeAll(bridge, tcp);
});

test('the gateway answers like a phone: no bridge, refused, busy', async () => {
    const dead = await tcpServer();
    const deadPort = dead.port;
    await closeAll(dead.server);
    const bridge = createBridge({ allow: [`127.0.0.1:${deadPort}`] });
    const bport = await listen(bridge);
    const link = { receive() {}, hangup() {} };
    assert.equal(await new Gateway({ url: 'ws://127.0.0.1:1' }).dial('127.0.0.1', 23, link), 'NO DIALTONE');
    assert.equal(await new Gateway({ url: 'not a url' }).dial('127.0.0.1', 23, link), 'NO DIALTONE');
    assert.equal(await new Gateway({ url: `ws://127.0.0.1:${bport}` }).dial('example.org', 23, link), 'NO CARRIER');
    assert.equal(await new Gateway({ url: `ws://127.0.0.1:${bport}` }).dial('127.0.0.1', deadPort, link), 'BUSY');
    await closeAll(bridge);
});
