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

/* ---------- the token and the script ---------- */

const { seedToken, DEFAULT_PORT } = require('../tools/modem-bridge.js');
const { execFileSync, spawn } = require('node:child_process');
const path = require('node:path');

test('the default port is 1984', () => assert.equal(DEFAULT_PORT, 1984));

test('seedToken: three words and four hex digits, the same for the same inputs, different for any change', () => {
    const base = { host: 'box', user: 'ann', port: 1984, salt: '' };
    const t = seedToken(base);
    assert.match(t, /^[a-z]+-[a-z]+-[a-z]+-[0-9a-f]{4}$/);
    assert.equal(seedToken({ ...base }), t);
    for (const change of [{ host: 'box2' }, { user: 'bob' }, { port: 2600 }, { salt: 'x' }]) assert.notEqual(seedToken({ ...base, ...change }), t, JSON.stringify(change));
    assert.match(seedToken(), /^[a-z]+-[a-z]+-[a-z]+-[0-9a-f]{4}$/, 'from this machine and user by default');
});

test('--show-token prints the token the bridge would use, and exits', () => {
    const script = path.join(__dirname, '../tools/modem-bridge.js');
    const out = execFileSync('node', [script, '--show-token'], { encoding: 'utf8' }).trim();
    assert.equal(out, seedToken({ port: DEFAULT_PORT }));
    assert.equal(execFileSync('node', [script, '--show-token', '--port=2600'], { encoding: 'utf8' }).trim(), seedToken({ port: 2600 }));
    assert.equal(execFileSync('node', [script, '--show-token', '--seed=abc'], { encoding: 'utf8' }).trim(), seedToken({ port: DEFAULT_PORT, salt: 'abc' }));
    assert.equal(execFileSync('node', [script, '--show-token', '--token=mine'], { encoding: 'utf8' }).trim(), 'mine');
});

test('tools/bridge.sh: valid sh, executable, shows the same token, takes the port and a seed from the environment', () => {
    const sh = path.join(__dirname, '../tools/bridge.sh');
    execFileSync('sh', ['-n', sh]);
    assert.ok(require('node:fs').statSync(sh).mode & 0o111, 'executable');
    assert.equal(execFileSync(sh, ['--show-token'], { encoding: 'utf8' }).trim(), seedToken({ port: 1984 }));
    assert.equal(execFileSync(sh, ['--show-token'], { encoding: 'utf8', env: { ...process.env, BRIDGE_PORT: '2600', BRIDGE_SEED: 'q' } }).trim(), seedToken({ port: 2600, salt: 'q' }));
});

test('tools/bridge.sh starts a bridge on the default port that the gateway can dial through, allowing the directory\'s hosts', async () => {
    const sh = path.join(__dirname, '../tools/bridge.sh');
    const port = 20000 + Math.floor(Math.random() * 20000);
    const child = spawn(sh, [], { env: { ...process.env, BRIDGE_PORT: String(port) }, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', d => { err += d; });
    try {
        for (let i = 0; i < 100 && !/token:/.test(err); i++) await new Promise(r => setTimeout(r, 50));
        assert.match(err, new RegExp(`ws://127\\.0\\.0\\.1:${port}`));
        assert.ok(err.includes(`token: ${seedToken({ port })}`), err);
        const link = { receive() {}, hangup() {} };
        // right token, a host not on the list: the bridge answers (4001: NO CARRIER), so it is there and checking the list
        assert.equal(await new Gateway({ url: `ws://127.0.0.1:${port}`, token: seedToken({ port }) }).dial('example.org', 23, link), 'NO CARRIER');
        // wrong token: refused before the upgrade, which the page sees as no bridge
        assert.equal(await new Gateway({ url: `ws://127.0.0.1:${port}`, token: 'wrong' }).dial('example.org', 23, link), 'NO DIALTONE');
    } finally { child.kill(); }
});

/** A WebSocket that records what is sent and lets the test say what comes. */
function fakeSocket() {
    class FakeWS {
        constructor(url) { FakeWS.last = this; this.url = url; this.sent = []; this.readyState = 1; setImmediate(() => { this.onopen && this.onopen(); this.onmessage({ data: 'connected' }); }); }
        send(d) { this.sent.push(...d); }
        close() { this.readyState = 3; }
    }
    return FakeWS;
}

test('the gateway: the IRC ports (6660-6669) are raw: no telnet, no CR NUL, no local echo', async () => {
    const WS = fakeSocket();
    const got = [];
    const link = { receive: b => got.push(...b), hangup() {} };
    const remote = await new Gateway({ url: 'ws://127.0.0.1:1984', WebSocketClass: WS }).dial('irc.example.org', 6667, link);
    assert.equal(typeof remote, 'object');
    for (const b of [78, 255, 13, 10]) remote.send(b);
    assert.deepEqual(WS.last.sent, [78, 255, 13, 10], 'untouched');
    assert.deepEqual(got, [], 'no echo');
    WS.last.onmessage({ data: Uint8Array.from([255, 253, 24, 58, 0, 13, 10]).buffer });
    assert.deepEqual(got, [255, 253, 24, 58, 0, 13, 10], 'nothing taken out');
    // a telnet port still gets its CR NUL and its local echo
    const WS2 = fakeSocket();
    const got2 = [];
    const remote2 = await new Gateway({ url: 'ws://127.0.0.1:1984', WebSocketClass: WS2 }).dial('mud.example.org', 4000, { receive: b => got2.push(...b), hangup() {} });
    remote2.send(13);
    assert.deepEqual(WS2.last.sent, [13, 0]);
    assert.deepEqual(got2, [13, 10]);
});
