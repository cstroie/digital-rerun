'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Sysop, tidy, wrap, reflect, PERSONA } = require('../js/sysop.js');

const answer = content => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });
const zero = () => 0;

test('tidy: plain ASCII, no markdown, smart quotes straightened', () => {
    assert.equal(tidy('It’s “fine” — really…'), 'It\'s "fine" - really...');
    assert.equal(tidy('**Bold** and `code` and # head'), 'Bold and code and head');
    assert.equal(tidy('café 😀 ok'), 'cafe ok');
    assert.equal(tidy('- one\n- two\n\n\nthree'), 'one\ntwo\nthree');
    assert.equal(tidy('a ```\nlong code\n``` b'), 'a b');
});

test('tidy: cut short at a sentence when it can be', () => {
    const long = ('This is a sentence of some length. ').repeat(40);
    const t = tidy(long);
    assert.ok(t.length <= 480);
    assert.ok(t.endsWith('.'));
    assert.ok(tidy('x'.repeat(2000)).length <= 483);
});

test('wrap: lines no longer than the width, paragraphs kept', () => {
    const w = wrap('one two three four five six seven eight nine ten', 20);
    assert.ok(w.split('\n').every(l => l.length <= 20));
    assert.equal(w.replace(/\n/g, ' '), 'one two three four five six seven eight nine ten');
    assert.equal(wrap('a\nb', 20), 'a\nb');
    assert.equal(wrap('x'.repeat(30), 10), 'x'.repeat(30), 'a word too long is not broken');
});

test('reflect turns the pronouns round', () => {
    assert.equal(reflect('I am afraid of my cat'), 'you are afraid of your cat');
    assert.equal(reflect("you're nice, I think"), 'I am nice you think');
});

test('the rules: honest about being a program, know the board, reflect, and have a default', () => {
    const s = new Sysop({ random: zero });
    assert.match(s.rules('are you a human?'), /program|AI/);
    assert.match(s.rules('how do I download a file'), /Ctrl-\] R|XMODEM/);
    assert.match(s.rules('what is the weather'), /W at the menu|spectrogram/);
    assert.match(s.rules('I am worried about my exam'), /worried about your exam/);
    assert.match(s.rules('I want a quiet night'), /a quiet night/);
    assert.match(s.rules('zxcv qwerty'), /./);
    assert.match(s.rules('help'), /T time.*G says goodbye/);
});

test('the rules vary: the same question is not answered the same way every time', () => {
    const s = new Sysop({ random: zero });
    const a = s.rules('hello'), b = s.rules('hello');
    assert.notEqual(a, b);
});

test('every canned answer is plain ASCII and short', () => {
    const s = new Sysop({ random: zero });
    for (const q of ['hello', 'who are you', 'bye', 'thanks', 'xmodem', 'term', 'baud', 'weather', 'moon', 'cp/m', 'kettle', 'bbs', 'help', 'sad', 'I am x', 'I want x', 'I cant x', 'because', 'why', 'yes', 'no', 'you x', 'what?', 'zzz']) {
        for (let i = 0; i < 3; i++) {
            const t = s.rules(q);
            assert.equal(/[^\x20-\x7e]/.test(t), false, q);
            assert.ok(t.length < 200, q);
        }
    }
});

test('with no endpoint, or the internet not allowed, the rules answer and nothing is fetched', async () => {
    let calls = 0;
    const fetch = async () => { calls++; return answer('x'); };
    let s = new Sysop({ online: () => false, config: () => ({ url: 'http://h/v1', model: 'm' }), fetch, random: zero });
    assert.equal(s.connected, false);
    assert.match(await s.reply([], 'hello'), /Evening|Hello/);
    s = new Sysop({ online: () => true, config: () => ({}), fetch, random: zero });
    assert.equal(s.connected, false);
    await s.reply([], 'hello');
    assert.equal(calls, 0);
});

test('with an endpoint: the persona, the recent chat and the new line go to /chat/completions, nothing else', async () => {
    let seen;
    const fetch = async (url, init) => { seen = { url, init }; return answer('Quiet night. **Mostly** signals.'); };
    const s = new Sysop({ online: () => true, config: () => ({ url: 'http://localhost:11434/v1/', model: 'llama3.2', key: 'k3y' }), fetch });
    assert.equal(s.connected, true);
    const history = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Hello.' }];
    assert.equal(await s.reply(history, 'how is the night'), 'Quiet night. Mostly signals.');
    assert.equal(seen.url, 'http://localhost:11434/v1/chat/completions');
    assert.equal(seen.init.headers.Authorization, 'Bearer k3y');
    assert.equal(seen.init.referrerPolicy, 'no-referrer');
    const body = JSON.parse(seen.init.body);
    assert.equal(body.model, 'llama3.2');
    assert.equal(body.stream, false);
    assert.deepEqual(body.messages.map(m => m.role), ['system', 'user', 'assistant', 'user']);
    assert.equal(body.messages[0].content, PERSONA);
    assert.equal(body.messages[3].content, 'how is the night');
    assert.deepEqual(Object.keys(body).sort(), ['max_tokens', 'messages', 'model', 'stream', 'temperature']);
});

test('the persona says it is an AI when sincerely asked, and keeps ASCII and brevity', () => {
    assert.match(PERSONA, /sincerely asks.*AI sysop program/);
    assert.match(PERSONA, /plain ASCII/);
    assert.equal(/[^\x20-\x7e]/.test(PERSONA), false);
});

test('only the last ten exchanges are sent', async () => {
    let body;
    const s = new Sysop({ online: () => true, config: () => ({ url: 'http://h/v1', model: 'm' }), fetch: async (u, i) => { body = JSON.parse(i.body); return answer('ok'); } });
    const history = Array.from({ length: 50 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
    await s.reply(history, 'now');
    assert.equal(body.messages.length, 1 + 20 + 1);
    assert.equal(body.messages[1].content, 'm30');
});

test('a failing endpoint (error, bad status, junk, empty) falls back to the rules', async () => {
    for (const fetch of [async () => { throw new Error('down'); }, async () => ({ ok: false, status: 500 }), async () => ({ ok: true, json: async () => ({}) }), async () => answer('   ')]) {
        const s = new Sysop({ online: () => true, config: () => ({ url: 'http://h/v1', model: 'm' }), fetch, random: zero });
        assert.match(await s.reply([], 'hello'), /Evening|Hello/);
    }
});

test('no key: no Authorization header', async () => {
    let headers;
    const s = new Sysop({ online: () => true, config: () => ({ url: 'http://h/v1', model: 'm' }), fetch: async (u, i) => { headers = i.headers; return answer('ok'); } });
    await s.reply([], 'x');
    assert.equal('Authorization' in headers, false);
});
