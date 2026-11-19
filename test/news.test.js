'use strict';
// NEWS against a made-up NNTP server: a group (numbers past 16 bits, the newest first), an article
// (its head cut to four lines, a dot-stuffed line), back, L, an empty group, O at the low mark; one call.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Terminal } = require('../js/terminal.js');
const { boot, settle, say, run } = require('./net.js');

function screen(m) { const t = new Terminal(); t.writeString(m.out); return t.text().split('\n'); }
async function shows(m, text, frames = 30000) {
    for (let i = 0; i < frames; i += 50) { await settle(m, 50); if (screen(m).some(r => r.includes(text))) return; }
    throw new Error(`never showed ${JSON.stringify(text)}:\n${screen(m).join('\n')}`);
}

const ARTS = {
    9999998: ['Old news', 'Ann <ann@x.org>'],
    9999999: ['Re: Old news', '"Bob B." <bob@y.org>'],
    10000000: ['Newest one', 'carl@z.org (Carl)']
};
function server(log) {
    return link => {
        let buf = '';
        link.receive('200 news.test ready (no posting)\r\n');
        return {
            send(byte) {
                if (byte === 13) return;
                if (byte !== 10) { buf += String.fromCharCode(byte); return; }
                const l = buf; buf = ''; log.push(l);
                let m;
                if (l === 'MODE READER') return link.receive('200 reader\r\n');
                if ((m = /^GROUP (\S+)$/.exec(l))) return link.receive(m[1] === 'comp.os.cpm' ? '211 3 9999998 10000000 comp.os.cpm\r\n' : m[1] === 'comp.sys.empty' ? '211 0 5 4 comp.sys.empty\r\n' : '411 No such group\r\n');
                if ((m = /^OVER (\d+)-(\d+)$/.exec(l))) {
                    let t = '224 Overview follows\r\n';
                    for (let n = +m[1]; n <= +m[2]; n++) if (ARTS[n]) t += `${n}\t${ARTS[n][0]}\t${ARTS[n][1]}\tdate\t<${n}@x>\t\t100\t5\r\n`;
                    return link.receive(t + '.\r\n');
                }
                if ((m = /^ARTICLE (\d+)$/.exec(l))) {
                    const a = ARTS[m[1]];
                    if (!a) return link.receive('423 No such article\r\n');
                    return link.receive(`220 ${m[1]} <x>\r\nPath: a!b\r\nFrom: ${a[1]}\r\nSubject: ${a[0]}\r\nMessage-ID: <x>\r\nDate: today\r\n\r\nHello there.\r\n..dotted line\r\n.\r\n`);
                }
                if (l === 'LIST ACTIVE comp.*') return link.receive('215 list\r\ncomp.os.cpm 10000000 9999998 y\r\ncomp.sys.empty 4 5 y\r\n.\r\n');
                if (l === 'QUIT') { link.receive('205 bye\r\n'); return link.hangup(); }
                link.receive('500 What?\r\n');
            },
            close() { log.push('<closed>'); }
        };
    };
}

test('NEWS: a group (32-bit numbers, newest first), an article, back, L, one call', async () => {
    const log = [];
    const { m, dialed } = boot({ hosts: { 'news.test:119': server(log) } });
    await run(m, 'NEWS news.test/comp.os.cpm');
    await shows(m, 'Old news');
    let s = screen(m);
    assert.match(s[0], /^ NEWS {2}news\.test {2}comp\.os\.cpm/);
    assert.equal(s[1].trimEnd(), '   1  carl@z.org (Carl)  Newest one');
    assert.equal(s[2].trimEnd(), '   2  Bob B.             Re: Old news');
    assert.equal(s[3].trimEnd(), '   3  Ann                Old news');
    assert.ok(log.includes('OVER 9999998-10000000'), log.join('|'));
    let at = say(m, '1\r');
    await shows(m, 'dotted line');
    s = screen(m);
    assert.match(s[0], /comp\.os\.cpm  #10000000/);
    assert.ok(s.some(r => r.trimEnd() === 'From: carl@z.org (Carl)'));
    assert.ok(!s.some(r => r.includes('Path:') || r.includes('Message-ID')));
    assert.ok(s.some(r => r.trimEnd() === '.dotted line'));
    say(m, 'b');
    await settle(m, 300);
    assert.ok(screen(m).some(r => r.includes('Newest one')));
    say(m, 'l');
    await shows(m, 'Groups like');
    say(m, 'comp.*\r');
    await shows(m, 'comp.sys.empty');
    s = screen(m);
    say(m, '2\r');
    await shows(m, 'No articles');
    say(m, '1\r');
    await shows(m, 'Old news');
    say(m, 'o');
    await shows(m, 'These are the oldest');
    say(m, 'q');
    await shows(m, 'B>');
    assert.deepEqual(dialed, ['news.test:119']);
    assert.equal(log.at(-1), 'QUIT');
});

