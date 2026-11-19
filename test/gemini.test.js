'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Terminal } = require('../js/terminal.js');
const { CpmFs } = require('../js/cpmfs.js');
const { boot, settle, say, run, oneShot } = require('./net.js');

function screen(m) {
    const t = new Terminal();
    t.writeString(m.out);
    return t.text().split('\n');
}
async function shows(m, text, frames = 30000) {
    for (let i = 0; i < frames; i += 50) {
        await settle(m, 50);
        if (screen(m).some(r => r.includes(text))) return;
    }
    throw new Error(`the screen never showed ${JSON.stringify(text)}:\n${screen(m).join('\n')}`);
}
const row = (m, text) => screen(m).find(r => r.includes(text));

const LONG = 'This paragraph is one long line, as gemtext has them, and the client must wrap it at the words to fit the eighty columns of the screen without cutting any word in two.';
const PAGES = {
    '/': '20 text/gemini\r\n# Welcome\r\n\r\n' + LONG + '\r\n=> about.gmi About this capsule\r\n=> gemini://other.test/ Elsewhere\r\n=> https://example.org/ The web\r\n=> /dir/index.gmi\r\n* item one\r\n> a quote\r\n```art\r\n  /\\_/\\  ascii\r\n```\r\nThe end.\r\n',
    '/about.gmi': '20 text/gemini; lang=en\r\n# About\r\nA small capsule.\r\n',
    '/dir/index.gmi': '20 text/gemini\r\n=> sub/page.gmi Down\r\n=> ../up.gmi Up\r\n=> ./same.gmi Same\r\n=> ?x=1 Query\r\n',
    '/dir/sub/page.gmi': '20 text/gemini\r\nThe page below.\r\n',
    '/up.gmi': '20\r\nUp at the top (no type: gemtext).\r\n',
    '/search': '10 Search for\r\n',
    '/old': '31 /about.gmi\r\n',
    '/missing': '51 Not found here\r\n',
    '/pic.png': '20 image/png\r\n\x89PNG...',
    '/notes.txt': '20 text/plain\r\n=> not a link in plain text\r\n',
    '/secret': '60 Certificate wanted\r\n'
};
function capsule(asked) {
    return oneShot(line => {
        asked.push(line);
        const m = /^gemini:\/\/[^/]+(\/[^?]*)(\?.*)?$/.exec(line);
        if (!m) return '59 Bad request\r\n';
        if (m[1] === '/search' && m[2]) return `20 text/gemini\r\nYou searched ${decodeURIComponent(m[2].slice(1))}.\r\n`;
        return PAGES[m[1]] || '51 Not found\r\n';
    });
}

test('GEMINI host: the request, the page: a heading, a paragraph wrapped at the words, links numbered, a list, a quote, preformatted', async () => {
    const asked = [];
    const { m, dialed } = boot({ hosts: { 'capsule.test:1965': capsule(asked) } });
    await run(m, 'GEMINI capsule.test');
    await shows(m, 'The end.');
    const rows = screen(m);
    assert.deepEqual(dialed, ['capsule.test:1965']);
    assert.deepEqual(asked, ['gemini://capsule.test/']);
    assert.match(rows[0], /^ GEMINI {2}capsule\.test\//);
    assert.equal(rows[1].trimEnd(), 'Welcome');
    assert.ok(m.out.includes('\x1b[1mWelcome\x1b[0m'), 'the heading is bold');
    const para = rows.slice(3, 6).map(r => r.trimEnd());
    assert.ok(para.every(r => r.length <= 79), para.join('|'));
    assert.equal(para.join(' ').replace(/\s+$/, ''), LONG.slice(0, para.join(' ').trimEnd().length), 'wrapped at blanks, no word cut');
    assert.equal(row(m, 'About this').trimEnd(), '  1  About this capsule');
    assert.equal(row(m, 'Elsewhere').trimEnd(), '  2  Elsewhere');
    assert.equal(row(m, '/dir/index.gmi').trimEnd(), '  4  /dir/index.gmi', 'no name: the address');
    assert.equal(row(m, 'item one').trimEnd(), '  * item one');
    assert.equal(row(m, 'a quote').trimEnd(), '  > a quote');
    assert.equal(row(m, 'ascii').trimEnd(), '  /\\_/\\  ascii', 'as it is');
    assert.ok(!rows.some(r => r.includes('```')), 'the fences are not shown');
    assert.match(rows[23], /^\[1-1\d\/1\d\]/);
});

test('GEMINI: links followed: relative, absolute, ../ and ./ and ?query; B back; the web is not gemini', async () => {
    const asked = [];
    const hosts = { 'capsule.test:1965': capsule(asked), 'other.test:1965': oneShot(l => { asked.push(l); return '20 text/gemini\r\nThe other capsule.\r\n'; }) };
    const { m } = boot({ hosts });
    await run(m, 'GEMINI capsule.test');
    await shows(m, 'The end.');
    say(m, '1\r');
    await shows(m, 'A small capsule.');
    say(m, 'b');
    await shows(m, 'The end.');
    say(m, '3\r');
    await shows(m, 'Not a gemini link');
    say(m, '4\r');
    await shows(m, 'Query');
    for (const [n, page] of [['1', 'The page below.'], ['2', 'Up at the top'], ['3', 'The capsule says no'], ['4', 'index.gmi?x=1']]) {
        say(m, n + '\r');
        await shows(m, page);
        say(m, 'b');
        for (let i = 0; i < 400 && !/index\.gmi\s*$/.test(screen(m)[0]); i++) await settle(m, 50);   // back on the page itself (its bar)
    }
    say(m, 'b');
    await shows(m, 'The end.');
    say(m, '2\r');
    await shows(m, 'The other capsule.');
    const want = ['gemini://capsule.test/', 'gemini://capsule.test/about.gmi', 'gemini://capsule.test/', 'gemini://capsule.test/dir/index.gmi',
        'gemini://capsule.test/dir/sub/page.gmi', 'gemini://capsule.test/dir/index.gmi', 'gemini://capsule.test/up.gmi', 'gemini://capsule.test/dir/index.gmi',
        'gemini://capsule.test/dir/same.gmi', 'gemini://capsule.test/dir/index.gmi', 'gemini://capsule.test/dir/index.gmi?x=1', 'gemini://capsule.test/dir/index.gmi',
        'gemini://capsule.test/', 'gemini://other.test/'];
    assert.deepEqual(asked, want);
});

test('GEMINI: input (10) asks and sends the words encoded; a redirect (31) is followed; errors and other types say so', async () => {
    const asked = [];
    const { m } = boot({ hosts: { 'capsule.test:1965': capsule(asked) } });
    await run(m, 'GEMINI capsule.test/search');
    await shows(m, 'Search for?');
    say(m, 'retro & cp/m\r');
    await shows(m, 'You searched retro & cp/m.');
    assert.equal(asked[1], 'gemini://capsule.test/search?retro%20%26%20cp%2Fm');
    for (const [where, text] of [['/old', 'A small capsule.'], ['/missing', 'Not found here'], ['/pic.png', 'Not text'], ['/secret', 'client certificate'], ['/notes.txt', '=> not a link in plain text']]) {
        say(m, 'g');
        await shows(m, 'Go to');
        say(m, `capsule.test${where}\r`);
        await shows(m, text);
    }
    assert.ok(asked.includes('gemini://capsule.test/about.gmi'), 'the redirect followed');
    assert.ok(!row(m, 'not a link').startsWith('  1'), 'plain text has no links');
});

test('GEMINI: another port is dialed and named; the home page from GEMINI.DIR; W saves the gemtext; Q leaves with the echo on', async () => {
    const asked = [];
    const { m, dialed } = boot({
        hosts: { 'capsule.test:1966': oneShot(l => { asked.push(l); return '20 text/gemini\r\n# On 1966\r\n=> / Home\r\n'; }) },
        files: { 'GEMINI.DIR': 'gemini://capsule.test:1966/ A capsule on another port\r\n' }
    });
    await run(m, 'GEMINI');
    await shows(m, 'A capsule on another port');
    assert.match(screen(m)[0], /home \(GEMINI\.DIR\)/);
    assert.equal(row(m, 'another port').trimEnd(), '  1  A capsule on another port');
    say(m, '1\r');
    await shows(m, 'On 1966');
    assert.deepEqual(dialed, ['capsule.test:1966']);
    assert.deepEqual(asked, ['gemini://capsule.test:1966/']);
    assert.match(screen(m)[0], /capsule\.test:1966\//);
    say(m, 'w');
    await shows(m, 'Save as');
    say(m, 'page.gmi\r');
    await shows(m, 'Saved.');
    const saved = Buffer.from(new CpmFs(m.fdc.drives[1]).read('PAGE.GMI')).toString('latin1');
    assert.ok(saved.startsWith('# On 1966\r\n=> / Home\r\n\x1a'), JSON.stringify(saved.slice(0, 40)));
    say(m, 'q');
    await settle(m, 200);
    assert.equal(m.modem.line.echo, true);
});

test('GEMINI end to end: the modem, the gateway, the bridge speaking TLS, a capsule with its own certificate', async () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const tls = require('node:tls');
    const { createBridge } = require('../tools/modem-bridge.js');
    const { Gateway } = require('../js/devices/gateway.js');
    const FIX = path.join(__dirname, 'fixtures');
    const asked = [];
    const capsuleSrv = tls.createServer({ key: fs.readFileSync(path.join(FIX, 'tls1.key')), cert: fs.readFileSync(path.join(FIX, 'tls1.crt')) }, s => {
        let buf = '';
        s.on('data', d => {
            buf += d.toString('latin1');
            if (!buf.includes('\r\n')) return;
            asked.push(buf.trim());
            s.end('20 text/gemini\r\n# Over TLS\r\n=> /next.gmi Next\r\n');
        });
        s.on('error', () => {});
    });
    const cport = await new Promise(r => capsuleSrv.listen(0, '127.0.0.1', () => r(capsuleSrv.address().port)));
    const known = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-')), 'known');
    const bridge = createBridge({ allow: [`127.0.0.1:${cport}`], known });
    const bport = await new Promise(r => bridge.listen(0, '127.0.0.1', () => r(bridge.address().port)));
    const gateway = new Gateway({ url: `ws://127.0.0.1:${bport}`, rawPorts: [cport], tlsPorts: [cport] });
    const { m } = boot({ gateway });
    try {
        await run(m, `GEMINI 127.0.0.1:${cport}`);
        await shows(m, 'Over TLS');
        assert.deepEqual(asked, [`gemini://127.0.0.1:${cport}/`], 'one request line, whole, through TLS');
        assert.equal(row(m, 'Next').trimEnd(), '  1  Next');
        assert.match(fs.readFileSync(known, 'utf8'), /^127\.0\.0\.1:\d+ [0-9a-f]{64}\n$/, 'the certificate kept');
    } finally {
        m.modem.line.reset();
        bridge.closeAllConnections?.();
        await new Promise(r => bridge.close(r));
        await new Promise(r => capsuleSrv.close(r));
    }
});
