'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, until, settle, say, run, oneShot } = require('./net.js');

test('FINGER: no argument and no FINGER.DIR shows how; no modem says so', async () => {
    let { m } = boot();
    let at = await run(m, 'FINGER');
    await until(m, 'FINGER user@host', at);
    ({ m } = boot({ modem: false }));
    at = await run(m, 'FINGER bob@example.org');
    await until(m, 'No modem on this machine.', at);
});

test('FINGER user@host asks host:79 for the user and shows the answer, then the modem echoes again', async () => {
    const asked = [];
    const { m, dialed } = boot({ hosts: { 'example.org:79': oneShot(u => `Login: ${u}\r\nPlan:\r\n\tHacking CP/M.\r\n`, asked) } });
    const at = await run(m, 'FINGER Bob@Example.org');
    await until(m, 'B>', at + 10);
    const out = m.out.slice(at);
    assert.deepEqual(dialed, ['example.org:79']);
    assert.deepEqual(asked, ['bob'], 'the user, in lower case (the CCP makes it upper)');
    assert.ok(out.includes('[example.org]\r\n'), out);
    assert.ok(out.includes('Login: bob\r\nPlan:\r\n        Hacking CP/M.\r\n'), out);
    assert.ok(!out.includes('CONNECT'), 'the modem\'s CONNECT is not the host\'s');
    assert.ok(!out.includes('NO CARRIER'), 'the hang-up is not shown');
    assert.equal(m.modem.line.echo, true, 'ATE1 again at the end');
});

test('FINGER @host:port asks for nobody on another port; a host that is not there says so', async () => {
    const asked = [];
    const { m, dialed } = boot({ hosts: { 'example.org:7979': oneShot(() => 'nobody here\r\n', asked) } });
    let at = await run(m, 'FINGER @example.org:7979');
    await until(m, 'nobody here', at);
    await until(m, 'B>', at + 10);
    assert.deepEqual(asked, ['']);
    at = say(m, 'FINGER x@nowhere.org\r');
    await until(m, 'NO CARRIER', at);
    await until(m, 'B>', at + 10);
    assert.deepEqual(dialed, ['example.org:7979', 'nowhere.org:79']);
});

test('FINGER pages a long answer: --More--, Space a page, Q stops and hangs up', async () => {
    const lines = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join('\r\n') + '\r\n';
    const { m } = boot({ hosts: { 'example.org:79': oneShot(() => lines) } });
    let at = await run(m, 'FINGER @example.org');
    await until(m, '--More--', at);
    assert.ok(m.out.slice(at).includes('line 22\r\n') && !m.out.slice(at).includes('line 23'), 'a page: 22 lines and --More--');
    at = say(m, ' ');
    await until(m, '--More--', at);
    assert.ok(m.out.slice(at).includes('line 44\r\n') && !m.out.slice(at).includes('line 45'));
    at = say(m, 'q');
    await until(m, 'B>', at);
    await settle(m);
    assert.equal(m.modem.carrier, false);
});

test('FINGER: long lines wrap at 80 columns, UTF-8 shows as ?, control characters go', async () => {
    const { m } = boot({ hosts: { 'example.org:79': oneShot(() => 'x'.repeat(85) + '\r\ncaf\xc3\xa9\x07!\r\n') } });
    const at = await run(m, 'FINGER @example.org');
    await until(m, 'B>', at + 10);
    const out = m.out.slice(at);
    assert.ok(out.includes('x'.repeat(80) + '\r\nxxxxx\r\n'), out);
    assert.ok(out.includes('caf?!\r\n'), out);
});

test('FINGER alone lists FINGER.DIR, numbered (no modem needed); FINGER n asks that line', async () => {
    const { FINGERBOOK } = require('../js/devices/directory.js');
    const dir = FINGERBOOK.map(e => `${e.ask} ${e.text}`).join('\r\n') + '\r\n';
    const asked = [];
    let { m } = boot({ modem: false, files: { 'FINGER.DIR': dir } });
    let at = await run(m, 'FINGER');
    await until(m, 'FINGER n asks one of these', at);
    const out = m.out.slice(at);
    FINGERBOOK.forEach((e, i) => assert.ok(out.includes(` ${i + 1}  ${e.ask} ${e.text}\r\n`), out));
    ({ m } = boot({ files: { 'FINGER.DIR': dir }, hosts: { 'graph.no:79': oneShot(u => `Weather for ${u}: rain.\r\n`, asked) } }));
    at = await run(m, 'FINGER 2');
    await until(m, 'Weather for oslo: rain.', at);
    await until(m, 'B>', at + 10);
    assert.ok(m.out.slice(at).includes('[graph.no]'));
    assert.deepEqual(asked, ['oslo']);
    at = say(m, 'FINGER 9\r');
    await until(m, 'No such line in FINGER.DIR.', at);
});
