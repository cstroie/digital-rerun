'use strict';
// tools/coupler/coupler.c against what the page expects of the bridge: the same checks as
// test/bridge.test.js makes of tools/modem-bridge.js, on a built binary. Skipped without a C compiler.
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const { seedToken, DEFAULT_PORT } = require('../tools/modem-bridge.js');
const { Gateway } = require('../js/devices/gateway.js');

const SRC = path.join(__dirname, '../tools/coupler/coupler.c');
const BIN = path.join(__dirname, '.cache/coupler');
let built = false;
try {
    fs.mkdirSync(path.dirname(BIN), { recursive: true });
    const r = spawnSync('cc', ['-O2', '-Wall', '-Wextra', '-Werror', '-o', BIN, SRC, '-lpthread'], { encoding: 'utf8' });
    built = r.status === 0;
    if (!built && r.error === undefined) throw new Error(r.stderr);
} catch (e) { if (!/ENOENT/.test(String(e))) throw e; }
const skip = !built && 'no C compiler (cc)';
const BIN_TLS = path.join(__dirname, '.cache/coupler-tls');
let builtTls = false;
if (built) {
    const r = spawnSync('cc', ['-O2', '-Wall', '-Wextra', '-Werror', '-DWITH_TLS', '-o', BIN_TLS, SRC, '-lpthread', '-lssl', '-lcrypto'], { encoding: 'utf8' });
    builtTls = r.status === 0;
}
const skipTls = !builtTls && 'no OpenSSL to build with (make TLS=1)';

const children = new Set();
process.on('exit', () => { for (const c of children) c.kill(); });     // none left running, even after a failure

/** Start the binary (the TLS one if asked) on a free port; resolves { port, stop, log }. */
function start(args, bin = BIN) {
    const child = spawn(bin, ['--port=0', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    children.add(child);
    child.on('exit', () => children.delete(child));
    let log = '';
    return new Promise((resolve, reject) => {
        child.stderr.on('data', d => {
            log += d;
            const m = /ws:\/\/127\.0\.0\.1:(\d+)/.exec(log);
            if (m && !child.port) { child.port = +m[1]; resolve({ port: child.port, stop: () => child.kill(), log: () => log }); }
        });
        child.on('exit', code => { if (!child.port) reject(new Error(`exited ${code}: ${log}`)); });
    });
}

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
const close = s => new Promise(r => { s.closeAllConnections?.(); s.close(r); });
async function deadPort() { const d = await tcpServer(); const p = d.port; await close(d.server); return p; }

function client(port, params) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/connect?${new URLSearchParams(params)}`);
    ws.binaryType = 'arraybuffer';
    const c = { ws, messages: [], code: null, opened: false };
    c.done = new Promise(r => {
        ws.onclose = e => { c.code = e.code; r(c); };
        ws.onerror = () => { if (!c.opened) r(c); };      // a refused handshake: some Node versions never send the close
    });
    ws.onopen = () => { c.opened = true; };
    ws.onmessage = e => c.messages.push(typeof e.data === 'string' ? e.data : Buffer.from(e.data));
    c.until = async fn => { for (let i = 0; i < 300 && !fn(); i++) await new Promise(r => setTimeout(r, 10)); return fn(); };
    return c;
}

function upgrade(port, p, headers = {}) {
    return new Promise(resolve => {
        const req = http.request({ port, host: '127.0.0.1', path: p, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', ...headers } });
        req.on('upgrade', (res, socket) => { socket.destroy(); resolve({ status: res.statusCode, accept: res.headers['sec-websocket-accept'] }); });
        req.on('response', res => { res.resume(); resolve({ status: res.statusCode }); });
        req.on('error', () => resolve({ status: 0 }));
        req.end();
    });
}

test('C bridge: "connected", then bytes both ways, untouched, in pieces and whole; a ping is answered', { skip }, async () => {
    const { server: tcp, got, port: tport } = await tcpServer(Buffer.from([0xFF, 0xFD, 0x18, 65]));
    const b = await start([`--allow=127.0.0.1:${tport}`, '--token=s3cret']);
    try {
        const c = client(b.port, { host: '127.0.0.1', port: tport, token: 's3cret' });
        assert.ok(await c.until(() => c.messages.length >= 2));
        assert.equal(c.messages[0], 'connected');
        assert.deepEqual([...c.messages[1]], [0xFF, 0xFD, 0x18, 65]);
        c.ws.send(Uint8Array.from([1, 2, 3, 255]));
        const big = Buffer.alloc(70000, 7);
        c.ws.send(big);
        assert.ok(await c.until(() => got.length === 4 + big.length));
        assert.deepEqual(got.slice(0, 4), [1, 2, 3, 255]);
        tcp.last.write(Buffer.alloc(100000, 9));
        assert.ok(await c.until(() => c.messages.slice(1).reduce((n, m) => n + m.length, 0) >= 4 + 100000));
        c.ws.close();
        await c.done;
    } finally { b.stop(); await close(tcp); }
});

test('C bridge: the far end hanging up closes the WebSocket with 1000; the log names the host, not the data', { skip }, async () => {
    const { server: tcp, port: tport } = await tcpServer();
    const b = await start([`--allow=127.0.0.1:${tport}`]);
    try {
        const c = client(b.port, { host: '127.0.0.1', port: tport, token: seedToken({ port: DEFAULT_PORT }) });
        assert.ok(await c.until(() => c.messages.includes('connected')));
        tcp.last.destroy();
        await c.done;
        assert.equal(c.code, 1000);
        assert.match(b.log(), /\d\d:\d\d:\d\d connected 127\.0\.0\.1:\d+/);
    } finally { b.stop(); await close(tcp); }
});

test('C bridge: not on the list 4001, nothing listening 4002, bad port or host 4001; the allow patterns', { skip }, async () => {
    const { server: tcp, port: tport } = await tcpServer();
    const dead = await deadPort();
    const b = await start([`--allow=127.0.0.1:${tport},127.0.0.0/8:${dead},*.example.org`, '--token=t']);
    const code = async params => (await client(b.port, { token: 't', ...params }).done).code;
    try {
        assert.equal(await code({ host: 'example.org', port: 23 }), 4001, '*.example.org is not example.org');
        assert.equal(await code({ host: '127.0.0.1', port: dead }), 4002, 'in the block, nothing listening');
        assert.equal(await code({ host: '127.0.0.1', port: 99999 }), 4001);
        assert.equal(await code({ host: '127.0.0.1;rm', port: tport }), 4001);
        assert.equal(await code({ host: '127.0.0.2', port: tport }), 4001, 'the block is for its port only');
        assert.equal(await code({ host: 'no-such-host.example.org', port: 23 }), 4004, 'allowed, but no such name');
    } finally { b.stop(); }
    const star = await start(['--allow=*', '--token=t']);
    try {
        assert.equal((await client(star.port, { token: 't', host: '127.0.0.1', port: dead }).done).code, 4001, '* is public only');
    } finally { star.stop(); }
    const priv = await start(['--allow=*', '--allow-private', '--token=t']);
    try {
        assert.equal((await client(priv.port, { token: 't', host: '127.0.0.1', port: dead }).done).code, 4002);
        assert.match(priv.log(), /warning: \* with --allow-private/);
    } finally { priv.stop(); await close(tcp); }
});

test('C bridge: a wrong token or origin, a wrong path, a plain GET: refused; the handshake answer is right', { skip }, async () => {
    const b = await start(['--allow=*', '--token=good', '--origin=https://app.example']);
    try {
        const q = '/connect?host=example.org&port=23';
        assert.equal((await upgrade(b.port, q + '&token=bad', { Origin: 'https://app.example' })).status, 403);
        assert.equal((await upgrade(b.port, q, { Origin: 'https://app.example' })).status, 403, 'no token');
        assert.equal((await upgrade(b.port, q + '&token=goo', { Origin: 'https://app.example' })).status, 403, 'a prefix of it');
        assert.equal((await upgrade(b.port, q + '&token=good', { Origin: 'https://evil.example' })).status, 403);
        assert.equal((await upgrade(b.port, q + '&token=good')).status, 403, 'no Origin');
        assert.equal((await upgrade(b.port, '/other?token=good', { Origin: 'https://app.example' })).status, 400);
        assert.equal((await upgrade(b.port, q + '&token=good', { Origin: 'https://app.example', 'Sec-WebSocket-Version': '8' })).status, 400);
        const ok = await upgrade(b.port, q + '&token=g%6Fod', { Origin: 'https://app.example' });
        assert.equal(ok.status, 101, 'the token %-decoded');
        assert.equal(ok.accept, 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=', 'RFC 6455\'s example key');
        const plain = await new Promise(r => http.get({ port: b.port, host: '127.0.0.1', path: '/' }, res => { res.resume(); r(res.statusCode); }));
        assert.equal(plain, 426);
    } finally { b.stop(); }
});

test('C bridge: at most `max` connections at once, and a place frees when one ends', { skip }, async () => {
    const { server: tcp, port: tport } = await tcpServer();
    const b = await start([`--allow=127.0.0.1:${tport}`, '--max=1', '--token=t']);
    try {
        const a = client(b.port, { host: '127.0.0.1', port: tport, token: 't' });
        assert.ok(await a.until(() => a.messages.includes('connected')));
        const second = client(b.port, { host: '127.0.0.1', port: tport, token: 't' });
        await second.done;
        assert.equal(second.opened, false);
        a.ws.close();
        await a.done;
        await new Promise(r => setTimeout(r, 100));
        const third = client(b.port, { host: '127.0.0.1', port: tport, token: 't' });
        assert.ok(await third.until(() => third.messages.includes('connected')), 'the place is free again');
        third.ws.close();
        await third.done;
    } finally { b.stop(); await close(tcp); }
});

test('C bridge: a client that sends an unmasked frame is dropped', { skip }, async () => {
    const { server: tcp, port: tport } = await tcpServer();
    const b = await start([`--allow=127.0.0.1:${tport}`, '--token=t']);
    try {
        const socket = net.connect(b.port, '127.0.0.1');
        socket.resume();
        const ended = new Promise(r => { socket.on('close', () => r(true)); setTimeout(() => r(false), 2000); });
        await new Promise(r => socket.once('connect', r));
        socket.write(`GET /connect?host=127.0.0.1&port=${tport}&token=t HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`);
        await new Promise(r => setTimeout(r, 100));
        socket.write(Buffer.from([0x82, 0x01, 0x41]));
        assert.equal(await ended, true);
        socket.destroy();
    } finally { b.stop(); await close(tcp); }
});

test('C bridge: the gateway dials through it, telnet answered, data clean; refused is BUSY, not allowed NO CARRIER', { skip }, async () => {
    const IAC = 255;
    const { server: tcp, got, port: tport } = await tcpServer(Buffer.from([IAC, 253, 24, IAC, 251, 1, 87, 101, 108, 99, 111, 109, 101, 13, 0, 10]));
    const dead = await deadPort();
    const b = await start([`--allow=127.0.0.1:${tport},127.0.0.1:${dead}`, '--token=tok']);
    try {
        const received = [];
        let hung = false;
        const gw = new Gateway({ url: `ws://127.0.0.1:${b.port}`, token: 'tok' });
        const remote = await gw.dial('127.0.0.1', tport, { receive: x => received.push(...x), hangup: () => { hung = true; } });
        assert.equal(typeof remote, 'object');
        for (let i = 0; i < 200 && received.length < 9; i++) await new Promise(r => setTimeout(r, 10));
        assert.equal(Buffer.from(received).toString('latin1'), 'Welcome\r\n');
        for (let i = 0; i < 200 && got.length < 6; i++) await new Promise(r => setTimeout(r, 10));     // the page's answers, on their way
        assert.deepEqual(got.slice(0, 6), [IAC, 251, 24, IAC, 253, 1]);
        got.length = 0;
        remote.send(104); remote.send(255); remote.send(13);
        for (let i = 0; i < 200 && got.length < 5; i++) await new Promise(r => setTimeout(r, 10));
        assert.deepEqual(got, [104, 255, 255, 13, 0]);
        tcp.last.destroy();
        for (let i = 0; i < 200 && !hung; i++) await new Promise(r => setTimeout(r, 10));
        assert.equal(hung, true);
        const link = { receive() {}, hangup() {} };
        assert.equal(await gw.dial('127.0.0.1', dead, link), 'BUSY');
        assert.equal(await gw.dial('example.org', 23, link), 'NO CARRIER');
        assert.equal(await new Gateway({ url: `ws://127.0.0.1:${b.port}`, token: 'bad' }).dial('127.0.0.1', tport, link), 'NO DIALTONE', 'a wrong token: refused before it opens');
    } finally { b.stop(); await close(tcp); }
});

test('C bridge: --show-token gives the token the JavaScript bridge gives; no --allow is a usage error', { skip }, () => {
    const show = (...a) => execFileSync(BIN, ['--show-token', ...a], { encoding: 'utf8' }).trim();
    assert.equal(show(), seedToken({ port: DEFAULT_PORT }));
    assert.equal(show('--port=2600'), seedToken({ port: 2600 }));
    assert.equal(show('--seed=abc'), seedToken({ port: DEFAULT_PORT, salt: 'abc' }));
    assert.equal(show('--token=mine'), 'mine');
    const r = spawnSync(BIN, [], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /usage: coupler --allow=/);
});

test('C bridge: a question typed a byte at a time reaches a one-read server whole (the gateway sends the line)', { skip }, async () => {
    const firsts = [];
    const tcp = net.createServer(s => {
        s.once('data', d => { firsts.push(d.toString('latin1')); s.end(`asked: ${d.toString('latin1').trim()}\r\n`); });
        s.on('error', () => {});
    });
    const tport = await new Promise(r => tcp.listen(0, '127.0.0.1', () => r(tcp.address().port)));
    const b = await start([`--allow=127.0.0.1:${tport}`, '--token=t']);
    try {
        const received = [];
        let hung = false;
        const remote = await new Gateway({ url: `ws://127.0.0.1:${b.port}`, token: 't', rawPorts: [tport] })
            .dial('127.0.0.1', tport, { receive: x => received.push(...x), hangup: () => { hung = true; } });
        for (const ch of 'bucharest\r\n') { remote.send(ch.charCodeAt(0)); await new Promise(r => setTimeout(r, 8)); }
        for (let i = 0; i < 200 && !hung; i++) await new Promise(r => setTimeout(r, 10));
        assert.deepEqual(firsts, ['bucharest\r\n']);
        assert.equal(Buffer.from(received).toString('latin1'), 'asked: bucharest\r\n');
    } finally { b.stop(); await close(tcp); }
});

/* ---------- TLS (make TLS=1) ---------- */

const tlsMod = require('node:tls');
const os = require('node:os');
const FIX = path.join(__dirname, 'fixtures');
function tlsServer(n, port = 0) {
    const server = tlsMod.createServer({ key: fs.readFileSync(path.join(FIX, `tls${n}.key`)), cert: fs.readFileSync(path.join(FIX, `tls${n}.crt`)) }, s => {
        s.write('hello over tls\r\n');
        s.on('data', d => s.write(`got: ${d.toString('latin1')}`));
        s.on('error', () => {});
    });
    return new Promise(r => server.listen(port, '127.0.0.1', () => r({ server, port: server.address().port })));
}

test('C bridge with TLS: plain bytes to the page, TLS to the host; the certificate kept, a changed one refused (4005)', { skip: skipTls }, async () => {
    const known = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-c-')), 'known');
    let { server: srv, port: tport } = await tlsServer(1);
    const b = await start([`--allow=127.0.0.1:${tport}`, '--token=t', `--known=${known}`], BIN_TLS);
    try {
        let c = client(b.port, { host: '127.0.0.1', port: tport, tls: 1, token: 't' });
        assert.ok(await c.until(() => c.messages.length >= 2), String(c.messages));
        assert.equal(c.messages[0], 'connected');
        assert.equal(c.messages[1].toString(), 'hello over tls\r\n');
        c.ws.send(Buffer.from('gemini://x/\r\n'));
        assert.ok(await c.until(() => c.messages.some(m => typeof m !== 'string' && m.toString().includes('got: gemini://x/'))));
        c.ws.close();
        await c.done;
        const kept = fs.readFileSync(known, 'utf8');
        assert.match(kept, new RegExp(`^127\\.0\\.0\\.1:${tport} [0-9a-f]{64}\\n$`));
        const { knownHost } = require('../tools/modem-bridge.js');
        assert.equal(knownHost(known, `127.0.0.1:${tport}`, kept.trim().split(' ')[1]), 'same', 'the same file format as the JavaScript bridge');
        c = client(b.port, { host: '127.0.0.1', port: tport, tls: 1, token: 't' });
        assert.ok(await c.until(() => c.messages.includes('connected')));
        c.ws.close();
        await c.done;
        await close(srv);
        ({ server: srv } = await tlsServer(2, tport));
        c = client(b.port, { host: '127.0.0.1', port: tport, tls: 1, token: 't' });
        await c.done;
        assert.equal(c.code, 4005);
        assert.match(b.log(), /certificate changed 127\.0\.0\.1/);
    } finally { b.stop(); await close(srv); }
});

test('C bridge with TLS: a host that does not speak it is 4004; built without TLS, a TLS call is refused (4004)', { skip: skipTls }, async () => {
    const { server: tcp, port: tport } = await tcpServer();
    const b = await start([`--allow=127.0.0.1:${tport}`, '--token=t', '--known='], BIN_TLS);
    const plain = await start([`--allow=127.0.0.1:${tport}`, '--token=t'], BIN);
    try {
        const timer = setTimeout(() => tcp.last && tcp.last.destroy(), 300);
        const c = client(b.port, { host: '127.0.0.1', port: tport, tls: 1, token: 't' });
        await c.done;
        clearTimeout(timer);
        assert.equal(c.code, 4004);
        const p = client(plain.port, { host: '127.0.0.1', port: tport, tls: 1, token: 't' });
        await p.done;
        assert.equal(p.code, 4004);
        assert.match(plain.log(), /not built in \(make TLS=1\)/);
    } finally { b.stop(); plain.stop(); await close(tcp); }
});

/* ---------- as a CGI (the request in the environment, the call on stdin and stdout) ---------- */

/** A masked client frame. */
function clientFrame(op, data = Buffer.alloc(0)) {
    const mask = Buffer.from([1, 2, 3, 4]);
    const len = data.length;
    const head = len < 126 ? Buffer.from([0x80 | op, 0x80 | len]) : Buffer.from([0x80 | op, 0x80 | 126, len >> 8, len & 255]);
    return Buffer.concat([head, mask, Buffer.from(data.map((b, i) => b ^ mask[i & 3]))]);
}
/** The server's frames in a buffer: [{ op, data }]. */
function serverFrames(buf) {
    const out = [];
    let i = 0;
    while (i + 2 <= buf.length) {
        let len = buf[i + 1] & 127, at = i + 2;
        if (len === 126) { len = buf.readUInt16BE(at); at += 2; } else if (len === 127) { len = Number(buf.readBigUInt64BE(at)); at += 8; }
        if (at + len > buf.length) break;
        out.push({ op: buf[i] & 15, data: buf.subarray(at, at + len) });
        i = at + len;
    }
    return out;
}

/** Run the binary as a CGI: resolves { head, frames(), send(buf), done, exitCode, log } */
function cgi(env, bin = BIN) {
    const child = spawn(bin, [], {
        env: { PATH: process.env.PATH, GATEWAY_INTERFACE: 'CGI/1.1', REQUEST_METHOD: 'GET', HTTP_UPGRADE: 'websocket', HTTP_SEC_WEBSOCKET_KEY: 'dGhlIHNhbXBsZSBub25jZQ==', HTTP_SEC_WEBSOCKET_VERSION: '13', ...env },
        stdio: ['pipe', 'pipe', 'pipe']
    });
    children.add(child);
    const r = { out: Buffer.alloc(0), log: '', head: null };
    child.stdout.on('data', d => { r.out = Buffer.concat([r.out, d]); });
    child.stderr.on('data', d => { r.log += d; });
    child.stdin.on('error', () => {});
    r.done = new Promise(res => child.on('exit', code => { children.delete(child); r.exitCode = code; res(r); }));
    r.send = b => child.stdin.write(b);
    r.end = () => child.stdin.end();
    r.split = () => { const at = r.out.indexOf('\r\n\r\n'); return at < 0 ? null : { head: r.out.subarray(0, at).toString('latin1'), frames: serverFrames(r.out.subarray(at + 4)) }; };
    r.until = async fn => { for (let i = 0; i < 300 && !fn(); i++) await new Promise(res => setTimeout(res, 10)); return fn(); };
    return r;
}

test('C bridge as a CGI: Status 101 with the right accept, "connected", bytes both ways, 1000 when the host hangs up', { skip }, async () => {
    const { server: tcp, got, port: tport } = await tcpServer(Buffer.from('hello from the host\r\n'));
    try {
        const r = cgi({ QUERY_STRING: `host=127.0.0.1&port=${tport}&token=t`, MODEM_BRIDGE_ALLOW: `127.0.0.1:${tport}`, MODEM_BRIDGE_TOKEN: 't', MODEM_BRIDGE_KNOWN: '' });
        assert.ok(await r.until(() => { const s = r.split(); return s && s.frames.length >= 2; }), r.out.toString('latin1') + r.log);
        const { head, frames } = r.split();
        assert.match(head, /^Status: 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK\+xOo=$/);
        assert.equal(frames[0].op, 1);
        assert.equal(frames[0].data.toString(), 'connected');
        assert.equal(frames[1].data.toString(), 'hello from the host\r\n');
        r.send(clientFrame(2, Buffer.from('typed\r\n')));
        assert.ok(await r.until(() => got.length >= 7));
        assert.equal(Buffer.from(got).toString(), 'typed\r\n');
        tcp.last.destroy();
        await r.done;
        const last = r.split().frames.pop();
        assert.equal(last.op, 8);
        assert.equal(last.data.readUInt16BE(0), 1000);
        assert.match(r.log, /connected 127\.0\.0\.1:\d+/);
    } finally { await close(tcp); }
});

test('C bridge as a CGI: no upgrade 426, a wrong token or origin 403, no token or no allow list 500; a host not allowed 4001', { skip }, async () => {
    const status = async env => { const r = cgi(env); await r.done; return r.out.toString('latin1').split('\r\n')[0]; };
    const base = { QUERY_STRING: 'host=example.org&port=23&token=t', MODEM_BRIDGE_ALLOW: '127.0.0.1', MODEM_BRIDGE_TOKEN: 't' };
    assert.equal(await status({ ...base, HTTP_UPGRADE: '' }), 'Status: 400 Bad Request', 'an empty upgrade');
    const plain = spawn(BIN, [], { env: { PATH: process.env.PATH, GATEWAY_INTERFACE: 'CGI/1.1', REQUEST_METHOD: 'GET', ...base } });
    let pout = '';
    plain.stdout.on('data', d => { pout += d; });
    await new Promise(r => plain.on('exit', r));
    assert.match(pout, /^Status: 426 Upgrade Required\r\n[\s\S]*connect with a WebSocket/, 'a plain GET');
    assert.equal(await status({ ...base, QUERY_STRING: 'host=example.org&port=23&token=x' }), 'Status: 403 Forbidden');
    assert.equal(await status({ ...base, MODEM_BRIDGE_ORIGIN: 'https://app.example', HTTP_ORIGIN: 'https://evil.example' }), 'Status: 403 Forbidden');
    assert.equal(await status({ ...base, MODEM_BRIDGE_TOKEN: undefined }), 'Status: 500 Internal Server Error', 'no token set: nobody');
    assert.equal(await status({ ...base, MODEM_BRIDGE_ALLOW: undefined }), 'Status: 500 Internal Server Error', 'no allow list');
    const r = cgi(base);
    await r.done;
    const s = r.split();
    assert.match(s.head, /^Status: 101/);
    assert.equal(s.frames[0].op, 8);
    assert.equal(s.frames[0].data.readUInt16BE(0), 4001);
});

test('C bridge: a quiet call gets a ping (as a CGI and as the daemon); the browser\'s pong is taken quietly', { skip }, async () => {
    const { server: tcp, port: tport } = await tcpServer();
    try {
        const r = cgi({ QUERY_STRING: `host=127.0.0.1&port=${tport}&token=t`, MODEM_BRIDGE_ALLOW: `127.0.0.1:${tport}`, MODEM_BRIDGE_TOKEN: 't', MODEM_BRIDGE_PING: '1' });
        assert.ok(await r.until(() => { const s = r.split(); return s && s.frames.some(f => f.op === 9); }), 'a ping within the second and a bit');
        r.send(clientFrame(10));
        r.send(clientFrame(8, Buffer.from([0x03, 0xE8])));
        await r.done;
        assert.equal(r.split().frames.pop().data.readUInt16BE(0), 1000);
        const b = await start([`--allow=127.0.0.1:${tport}`, '--token=t', '--ping=1']);
        try {
            const sock = net.connect(b.port, '127.0.0.1');
            let got = Buffer.alloc(0);
            sock.on('data', d => { got = Buffer.concat([got, d]); });
            await new Promise(res => sock.once('connect', res));
            sock.write(`GET /connect?host=127.0.0.1&port=${tport}&token=t HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`);
            for (let i = 0; i < 300 && !serverFrames(got.subarray(got.indexOf('\r\n\r\n') + 4)).some(f => f.op === 9); i++) await new Promise(res => setTimeout(res, 10));
            assert.ok(serverFrames(got.subarray(got.indexOf('\r\n\r\n') + 4)).some(f => f.op === 9), 'the daemon pings too');
            sock.destroy();
        } finally { b.stop(); }
    } finally { await close(tcp); }
});

test('C bridge as a CGI with TLS: the call to the capsule is TLS, the page gets plain bytes', { skip: skipTls }, async () => {
    const { server: srv, port: tport } = await tlsServer(1);
    try {
        const r = cgi({ QUERY_STRING: `host=127.0.0.1&port=${tport}&token=t&tls=1`, MODEM_BRIDGE_ALLOW: `127.0.0.1:${tport}`, MODEM_BRIDGE_TOKEN: 't', MODEM_BRIDGE_KNOWN: '' }, BIN_TLS);
        assert.ok(await r.until(() => { const s = r.split(); return s && s.frames.length >= 2; }), r.log);
        assert.equal(r.split().frames[1].data.toString(), 'hello over tls\r\n');
        r.end();
        await r.done;
    } finally { await close(srv); }
});
