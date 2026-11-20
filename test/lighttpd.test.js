'use strict';
// The C bridge as a CGI under a real lighttpd (cgi.upgrade): the recipe of docs/modem.md, end to end
// with the page's gateway. Skipped where lighttpd or a C compiler is not installed.
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { Gateway } = require('../js/devices/gateway.js');

const lighttpd = ['/usr/sbin/lighttpd', '/usr/local/sbin/lighttpd', '/usr/bin/lighttpd'].find(f => fs.existsSync(f));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lighttpd-bridge-'));
const BIN = path.join(dir, 'coupler');
const built = lighttpd && spawnSync('cc', ['-O2', '-o', BIN, path.join(__dirname, '../tools/coupler/coupler.c'), '-lpthread']).status === 0;
// lighttpd 1.4.63 (Ubuntu 22.04) closes a CGI's stdin right after the 101: the coupler reads EOF, takes it for
// the page hanging up and leaves. 1.4.74 and 1.4.79 keep it open; older than 1.4.74 is not tried.
const version = lighttpd && (/lighttpd\/(\d+)\.(\d+)\.(\d+)/.exec(spawnSync(lighttpd, ['-v']).stdout) || []).slice(1).map(Number);
const tooOld = version && version.length === 3 && (version[0] * 1e6 + version[1] * 1e3 + version[2]) < 1004074;
const skip = !lighttpd ? 'no lighttpd' : tooOld ? `lighttpd ${version.join('.')} closes a CGI's stdin after the upgrade (1.4.74 or later)` : !built ? 'no C compiler' : false;

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

test('lighttpd runs the C bridge as a CGI: the page dials through it, bytes both ways, a hang-up comes back', { skip, timeout: 60000 }, async () => {
    const got = [];
    const host = net.createServer(s => { host.last = s; s.write('Welcome, caller.\r\n'); s.on('data', d => got.push(...d)); s.on('error', () => {}); });
    const tport = await new Promise(r => host.listen(0, '127.0.0.1', () => r(host.address().port)));
    const port = await freePort();
    fs.mkdirSync(path.join(dir, 'www'), { recursive: true });
    const conf = path.join(dir, 'lighttpd.conf');
    fs.writeFileSync(conf, `
server.document-root = "${dir}/www"
server.bind = "127.0.0.1"
server.port = ${port}
server.errorlog = "${dir}/error.log"
server.breakagelog = "${dir}/cgi.log"
server.modules += ( "mod_alias", "mod_cgi", "mod_setenv" )
$HTTP["url"] =~ "^/connect" {
    alias.url = ( "/connect" => "${BIN}" )
    cgi.assign = ( "" => "" )
    cgi.upgrade = "enable"
    setenv.add-environment = (
        "COUPLER_ALLOW" => "127.0.0.1:${tport}",
        "COUPLER_TOKEN" => "s3cret",
        "COUPLER_KNOWN" => "" )
    server.max-read-idle = 65535
    server.max-write-idle = 65535
}
`);
    const ls = spawn(lighttpd, ['-D', '-f', conf], { stdio: ['ignore', 'pipe', 'pipe'] });
    let lslog = '';
    ls.stderr.on('data', d => { lslog += d; });
    try {
        for (let i = 0; i < 100; i++) {          // up when it takes a connection
            const up = await new Promise(r => { const s = net.connect(port, '127.0.0.1', () => { s.destroy(); r(true); }); s.on('error', () => r(false)); });
            if (up) break;
            await new Promise(r => setTimeout(r, 50));
        }
        const received = [];
        let hung = false;
        const link = { receive: b => received.push(...b), hangup: () => { hung = true; } };
        assert.equal(await new Gateway({ url: `ws://127.0.0.1:${port}`, token: 'wrong', rawPorts: [tport] }).dial('127.0.0.1', tport, link), 'NO DIALTONE', 'a wrong token: refused (403) before it opens');
        const remote = await new Gateway({ url: `ws://127.0.0.1:${port}`, token: 's3cret', rawPorts: [tport] }).dial('127.0.0.1', tport, link);
        assert.equal(typeof remote, 'object', `dialed: ${remote} ${lslog} ${fs.existsSync(dir + '/error.log') ? fs.readFileSync(dir + '/error.log', 'utf8') : ''}`);
        for (let i = 0; i < 200 && received.length < 18; i++) await new Promise(r => setTimeout(r, 10));
        assert.equal(Buffer.from(received).toString(), 'Welcome, caller.\r\n');
        for (const ch of 'hello\r\n') remote.send(ch.charCodeAt(0));
        for (let i = 0; i < 200 && got.length < 7; i++) await new Promise(r => setTimeout(r, 10));
        assert.equal(Buffer.from(got).toString(), 'hello\r\n');
        host.last.destroy();
        for (let i = 0; i < 200 && !hung; i++) await new Promise(r => setTimeout(r, 10));
        assert.equal(hung, true, 'the host hanging up reaches the page');
        assert.match(fs.readFileSync(path.join(dir, 'cgi.log'), 'utf8'), /connected 127\.0\.0\.1:\d+/, 'the bridge logs to server.breakagelog (a CGI\'s stderr)');
    } finally {
        ls.kill();
        await new Promise(r => host.close(r));
    }
});
