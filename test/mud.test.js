'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Terminal } = require('../js/terminal.js');
const { boot, until, settle, say, run } = require('./net.js');

function screen(m) {
    const t = new Terminal();
    t.writeString(m.out);
    return t.text().split('\n');
}
async function shows(m, text, frames = 20000) {
    for (let i = 0; i < frames; i += 50) {
        await settle(m, 50);
        if (screen(m).some(r => r.includes(text))) return;
    }
    throw new Error(`the screen never showed ${JSON.stringify(text)}:\n${screen(m).join('\n')}`);
}

/** A small world: asks a name and a password (prompts with no line end), then says what you say; QUIT hangs up. */
function world(log) {
    return link => {
        let buf = '', state = 'name';
        setImmediate(function hello() {
            if (!link) return;
            link.receive('\x1b[1;32mWelcome\x1b[0m to the \x1b[33mTest\x1b[0m World!\r\n\r\nBy what name? ');
        });
        return {
            send(byte) {
                if (byte !== 13) { buf += String.fromCharCode(byte); return; }
                const line = buf; buf = '';
                log.push(line);
                if (state === 'name') { state = 'pass'; link.receive('Password: '); return; }
                if (state === 'pass') { state = 'in'; link.receive(`\r\nWelcome back.\r\n> `); return; }
                if (line === 'flood') { link.receive(Array.from({ length: 120 }, (_, i) => `room line ${i + 1}`).join('\n\r') + '\n\r> '); return; }
                if (line === 'quit') { link.receive('Bye.\r\n'); link.hangup(); return; }
                link.receive(`You say: ${line}\r\n> `);
            },
            close() { log.closed = true; }
        };
    };
}

test('MUD: the screen, /help; /connect lists MUD.DIR; a number dials the line', async () => {
    const log = [];
    const { m, dialed } = boot({ hosts: { 'world.example:4000': world(log) }, files: { 'MUD.DIR': 'world.example:4000 The Test World\r\nother.example Another\r\n' } });
    await run(m, 'MUD');
    await shows(m, 'MUD for CP/M');
    let rows = screen(m);
    assert.match(rows[0], /^ MUD {2}not connected/);
    assert.equal(rows[23].trimEnd(), '>');
    say(m, '/connect\r');
    await shows(m, ' 1  world.example:4000 The Test World');
    say(m, '/connect 1\r');
    await shows(m, 'By what name?');
    rows = screen(m);
    assert.match(rows[0], /^ MUD {2}on world\.example:4000/);
    assert.ok(rows.some(r => r.trimEnd() === 'Welcome to the Test World!'), 'the colours are left out:\n' + rows.join('\n'));
    assert.ok(!m.out.includes('\x1b[1;32m'), 'no colour code reaches the screen');
    assert.deepEqual(dialed, ['world.example:4000']);
});

test('MUD: lines go out with CR; a password shows as stars and is not kept; Ctrl-P brings a line back', async () => {
    const log = [];
    const { m } = boot({ hosts: { 'world.example:4000': world(log) } });
    await run(m, 'MUD world.example:4000');
    await shows(m, 'By what name?');
    say(m, 'Ana\r');
    await shows(m, 'Password:');
    say(m, 'secret');
    await shows(m, '> ******');
    say(m, '\r');
    await shows(m, 'Welcome back.');
    say(m, 'hello there\r');
    await shows(m, 'You say: hello there');
    assert.deepEqual(log, ['Ana', 'secret', 'hello there']);
    say(m, '\x10');
    await shows(m, '> hello there');
    say(m, '\x10');
    await shows(m, '> Ana');
    assert.ok(!screen(m).some(r => r.includes('secret')));
    say(m, '\x1b[B');
    await shows(m, '> hello there');
    say(m, '\x15');
    await settle(m, 20);
    assert.equal(screen(m)[23].trimEnd(), '>');
    say(m, '\r');
    await shows(m, 'You say: ');
    assert.equal(log[3], '', 'an empty line goes too');
});

test('MUD: a flood of text keeps every line and leaves the line you are typing alone; the world hanging up', async () => {
    const log = [];
    const { m } = boot({ hosts: { 'world.example:4000': world(log) } });
    await run(m, 'MUD world.example:4000');
    await shows(m, 'By what name?');
    say(m, 'Ana\r');
    await shows(m, 'Password:');
    say(m, 'pw\r');
    await shows(m, 'Welcome back.');
    say(m, 'flood\r');
    await settle(m, 30);
    say(m, 'loo');                       // typed while the flood comes
    await shows(m, 'room line 120');
    const rows = screen(m);
    assert.equal(rows[23].trimEnd(), '> loo');
    for (let i = 100; i <= 120; i++) assert.ok(rows.some(r => r.trimEnd() === `room line ${i}`), `line ${i}:\n${rows.join('\n')}`);
    const text = m.out.replace(/\x1b\[[0-9;]*[A-Za-z]|\x1b[78]/g, '');
    for (let i = 1; i <= 120; i++) assert.ok(text.includes(`room line ${i}\r\n`), `line ${i} arrived`);
    say(m, '\x15quit\r');
    await shows(m, '*** Disconnected.');
    assert.ok(!screen(m).some(r => r.includes('NO CARRIER')));
    assert.match(screen(m)[0], /not connected/);
    say(m, '/bye\r');
    await until(m, 'B>', m.out.length - 5);
    assert.equal(m.modem.line.echo, true);
});
