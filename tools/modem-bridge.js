#!/usr/bin/env node
/*
 * modem-bridge.js: a WebSocket to TCP gateway, so the browser's modem can dial
 * a telnet host (a browser cannot open a TCP connection itself).
 *
 *   node tools/modem-bridge.js --allow=<hosts> [--port=1984] [--bind=127.0.0.1]
 *        [--token=<secret> | --seed=<salt>] [--show-token] [--origin=<page origin>[,...]]
 *        [--timeout=10] [--max=8] [--allow-private]
 *   tools/bridge.sh [hosts]      the same, with the board's directory allowed by default
 *
 *   --allow    which hosts may be dialed, comma separated: `bbs.example.org`,
 *              `bbs.example.org:2323`, `*.example.org`, an IPv4 block such as
 *              `192.168.0.0/16` or `10.0.0.0/8` (a literal address only, no DNS),
 *              or `*` for any public host. Required: nothing is dialed that is not named.
 *   --port     default 1984 (the year of a certain novel, and of a certain computer).
 *   --token    a secret the page must send. By default it is not random but worked out
 *              from this machine's name, your user name and the port (and --seed, if
 *              given): three words and four hex digits, the same every run, so it can be
 *              typed into DEVICES once. It keeps stray web pages out; it is not a secret
 *              from someone who knows those three things. --show-token prints it and exits.
 *   --origin   the page origin(s) allowed to connect (default: any).
 *   --allow-private  let `*` reach private and loopback addresses too (they
 *              can always be named in --allow).
 *   --max      connections at once (default 8). --timeout: seconds to connect.
 *
 * The page connects to ws://<bind>:<port>/connect?host=<h>&port=<p>&token=<t>.
 * The bridge makes the TCP connection and sends the text message "connected",
 * then passes bytes as binary messages both ways, untouched (the telnet
 * protocol is the page's). If it cannot connect it closes the WebSocket with
 * 4001 not allowed, 4002 refused, 4003 no answer in time, 4004 other.
 * It speaks ws:, not wss:: for a page served over https use localhost or put
 * a TLS reverse proxy in front. It logs the host dialed and nothing of what
 * is said. No dependencies.
 */
'use strict';
const http = require('http');
const net = require('net');
const crypto = require('crypto');

const os = require('os');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const DEFAULT_PORT = 1984;

const WORDS = ['relay', 'comet', 'lantern', 'signal', 'carrier', 'phosphor', 'beacon', 'orbit', 'kettle', 'pixel', 'cipher', 'vector', 'static', 'ghost', 'neon', 'quartz',
    'binary', 'socket', 'packet', 'modem', 'daemon', 'kernel', 'buffer', 'tensor', 'photon', 'plasma', 'nebula', 'zenith', 'cobalt', 'amber', 'raven', 'ember',
    'falcon', 'harbor', 'island', 'jungle', 'lumen', 'matrix', 'nimbus', 'onyx', 'prism', 'radar', 'sonar', 'tundra', 'umbra', 'valve', 'warp', 'xenon',
    'yonder', 'zephyr', 'argon', 'bishop', 'copper', 'dynamo', 'echo', 'fusion', 'gravity', 'helix', 'ion', 'jade', 'krypton', 'laser', 'meteor', 'nova'];

/**
 * A token worked out from the machine's name, the user and the port (and a salt): three
 * words and four hex digits. The same inputs, the same token, every run.
 */
function seedToken({ host = os.hostname(), user = (() => { try { return os.userInfo().username; } catch (e) { return 'user'; } })(), port = DEFAULT_PORT, salt = '' } = {}) {
    const h = crypto.createHash('sha256').update(`digitalrerun|${host}|${user}|${port}|${salt}`).digest();
    return `${WORDS[h[0] & 63]}-${WORDS[h[1] & 63]}-${WORDS[h[2] & 63]}-${h.subarray(3, 5).toString('hex')}`;
}
const MAX_FRAME = 1 << 20;

/** Is `host` a private, loopback or link-local address, or a local name (a literal check: no DNS)? */
function isPrivate(host) {
    host = host.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
    const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
    if (v4) {
        const [a, b] = [Number(v4[1]), Number(v4[2])];
        return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
    }
    return host.includes(':');                                // an IPv6 literal: not worth guessing
}

/** Is the IPv4 literal `host` inside the block `net`/`bits` (say 192.168.0.0/16)? */
function inCidr(host, net, bits) {
    const ip = s => { const p = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s); if (!p) return null; const o = p.slice(1).map(Number); return o.every(x => x <= 255) ? ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0 : null; };
    const h = ip(host), n = ip(net);
    if (h === null || n === null || bits < 0 || bits > 32) return false;
    const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
    return ((h & mask) >>> 0) === ((n & mask) >>> 0);
}

/** Is host:port named by the allow list? */
function allowed(list, host, port, allowPrivate) {
    host = host.toLowerCase();
    for (const entry of list) {
        const m = /^(.+?)(?::(\d+))?$/.exec(entry.toLowerCase());
        if (!m) continue;
        if (m[2] && Number(m[2]) !== port) continue;
        const pat = m[1];
        const block = /^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/.exec(pat);
        if (block) { if (inCidr(host, block[1], Number(block[2]))) return true; continue; }
        if (pat === '*') { if (isPrivate(host) && !allowPrivate) continue; return true; }
        if (pat.startsWith('*.')) { if (host.endsWith(pat.slice(1)) && !(isPrivate(host) && !allowPrivate)) return true; continue; }
        if (pat === host) return true;
    }
    return false;
}

/* ---------- WebSocket frames ---------- */

function frame(opcode, payload) {
    const n = payload.length;
    const head = n < 126 ? Buffer.from([0x80 | opcode, n]) : n < 65536 ? Buffer.from([0x80 | opcode, 126, n >> 8, n & 0xFF]) : (() => { const b = Buffer.alloc(10); b[0] = 0x80 | opcode; b[1] = 127; b.writeBigUInt64BE(BigInt(n), 2); return b; })();
    return Buffer.concat([head, payload]);
}

/** Cuts the client's masked frames out of a byte stream; calls on(opcode, payload) for each message. */
class FrameReader {
    constructor(on, fail) { this.buf = Buffer.alloc(0); this.on = on; this.fail = fail; this.parts = []; this.partOp = 0; }
    push(chunk) {
        this.buf = Buffer.concat([this.buf, chunk]);
        for (;;) {
            const b = this.buf;
            if (b.length < 2) return;
            const fin = (b[0] & 0x80) !== 0, op = b[0] & 0x0F, masked = (b[1] & 0x80) !== 0;
            let len = b[1] & 0x7F, at = 2;
            if (!masked || (b[0] & 0x70)) return this.fail(1002);
            if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); at = 4; } else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); at = 10; }
            if (len > MAX_FRAME) return this.fail(1009);
            if (b.length < at + 4 + len) return;
            const mask = b.subarray(at, at + 4);
            const data = Buffer.from(b.subarray(at + 4, at + 4 + len));
            for (let i = 0; i < len; i++) data[i] ^= mask[i & 3];
            this.buf = b.subarray(at + 4 + len);
            if (op >= 8) { if (!fin || len > 125) return this.fail(1002); this.on(op, data); continue; }
            if (op !== 0) { this.partOp = op; this.parts = []; } else if (!this.partOp) return this.fail(1002);
            this.parts.push(data);
            if (fin) { const whole = Buffer.concat(this.parts); const o = this.partOp; this.parts = []; this.partOp = 0; this.on(o, whole); }
        }
    }
}

/* ---------- the bridge ---------- */

/**
 * @param options { allow: [..], token, origins: [..]|null, timeout (s), max, allowPrivate, log(text) }
 * @returns an http.Server (call listen)
 */
function createBridge({ allow = [], token = '', origins = null, timeout = 10, max = 8, allowPrivate = false, log = () => {} } = {}) {
    let active = 0;
    const server = http.createServer((req, res) => { res.writeHead(426, { 'Content-Type': 'text/plain' }); res.end('This is a modem bridge: connect with a WebSocket.\n'); });

    server.on('upgrade', (req, socket) => {
        const refuse = (status, text) => { socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`); socket.destroy(); };
        let url;
        try { url = new URL(req.url, 'http://x'); } catch (e) { return refuse(400, 'Bad Request'); }
        const key = req.headers['sec-websocket-key'];
        if (url.pathname !== '/connect' || !key || req.headers.upgrade?.toLowerCase() !== 'websocket' || req.headers['sec-websocket-version'] !== '13') return refuse(400, 'Bad Request');
        if (origins && !origins.includes(req.headers.origin)) return refuse(403, 'Forbidden');
        const given = Buffer.from(url.searchParams.get('token') || ''), want = Buffer.from(token);
        if (token && (given.length !== want.length || !crypto.timingSafeEqual(given, want))) return refuse(403, 'Forbidden');
        if (active >= max) return refuse(503, 'Service Unavailable');
        active++;

        socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
            `Sec-WebSocket-Accept: ${crypto.createHash('sha1').update(key + GUID).digest('base64')}\r\n\r\n`);
        socket.setNoDelay(true);

        let tcp = null, closed = false;
        const close = code => {
            if (closed) return;
            closed = true;
            active--;
            if (tcp) tcp.destroy();
            if (socket.writable) socket.end(frame(8, Buffer.from([code >> 8, code & 0xFF])));
            else socket.destroy();
        };
        const reader = new FrameReader((op, data) => {
            if (op === 8) close(1000);
            else if (op === 9) socket.write(frame(10, data));
            else if (op === 2 || op === 1) { if (tcp && !tcp.destroyed && tcp.writable && !tcp.connecting) tcp.write(data); }
        }, code => close(code));
        socket.on('data', c => reader.push(c));
        socket.on('close', () => close(1001));
        socket.on('error', () => close(1011));

        const host = url.searchParams.get('host') || '', port = Number(url.searchParams.get('port'));
        if (!/^[A-Za-z0-9.-]{1,253}$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535 || !allowed(allow, host, port, allowPrivate)) {
            log(`refused ${host}:${port}`);
            return close(4001);
        }
        tcp = net.connect({ host, port });
        tcp.setTimeout(timeout * 1000);
        tcp.once('connect', () => {
            tcp.setTimeout(0);
            log(`connected ${host}:${port}`);
            socket.write(frame(1, Buffer.from('connected')));
        });
        tcp.on('data', d => { if (closed) return; for (let i = 0; i < d.length; i += 65536) socket.write(frame(2, d.subarray(i, i + 65536))); });
        tcp.once('timeout', () => { log(`no answer ${host}:${port}`); close(4003); });
        tcp.once('error', e => { log(`failed ${host}:${port} ${e.code || ''}`); close(e.code === 'ECONNREFUSED' ? 4002 : 4004); });
        tcp.once('end', () => close(1000));
        tcp.once('close', () => close(1000));
    });
    return server;
}

function main() {
    const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true]; }));
    const port = Number(args.port) || DEFAULT_PORT;
    const token = typeof args.token === 'string' ? args.token : seedToken({ port, salt: typeof args.seed === 'string' ? args.seed : '' });
    if (args['show-token']) { console.log(token); return; }
    if (args.help || !args.allow || args.allow === true) {
        console.error('usage: node tools/modem-bridge.js --allow=<host[:port],*.domain,*> [--port=1984] [--bind=127.0.0.1] [--token=<secret> | --seed=<salt>] [--show-token] [--origin=<origin>] [--timeout=10] [--max=8] [--allow-private]');
        process.exit(args.help ? 0 : 2);
    }
    const server = createBridge({
        allow: args.allow.split(',').map(s => s.trim()).filter(Boolean),
        token,
        origins: typeof args.origin === 'string' ? args.origin.split(',') : null,
        timeout: Number(args.timeout) || 10,
        max: Number(args.max) || 8,
        allowPrivate: !!args['allow-private'],
        log: t => console.error(new Date().toISOString().slice(11, 19), t)
    });
    const bind = typeof args.bind === 'string' ? args.bind : '127.0.0.1';
    server.listen(port, bind, () => {
        console.error(`modem bridge on ws://${bind}:${port}  allowing: ${args.allow}`);
        console.error(`token: ${token}`);
        console.error('In DigitalRerun: DEVICES, MODEM: put the URL and the token there, then ATDT host:port in TERM.');
        if (args.allow.split(',').includes('*') && args['allow-private']) console.error('warning: * with --allow-private reaches every address this machine can.');
    });
}

if (require.main === module) main();
module.exports = { createBridge, allowed, isPrivate, frame, FrameReader, seedToken, DEFAULT_PORT };
