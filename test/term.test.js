'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Machine } = require('../js/machine.js');
const { Disk } = require('../js/devices/fdc.js');
const { Hayes } = require('../js/devices/hayes.js');
const { Directory } = require('../js/devices/directory.js');
const { bbs, MemoryBoard, MemoryFiles } = require('../js/bbs.js');
const { CpmFs } = require('../js/cpmfs.js');
const net = require('node:net');
const { createBridge } = require('../tools/modem-bridge.js');
const { Gateway } = require('../js/devices/gateway.js');

function boot({ modem = true } = {}) {
    const m = new Machine();
    m.out = '';
    m.console.output = b => { m.out += String.fromCharCode(b); };
    m.fdc.mount(0, Disk.fromImage(new Uint8Array(fs.readFileSync(path.join(__dirname, '../disks/cpm22.dsk')))));
    if (modem) m.modem.attach(new Hayes({ dial: new Directory().dial, dialTime: 1 }));
    assert.ok(m.reset());
    return m;
}

/** Run until `text` has been printed (since `from`), letting dials resolve; fails after a while. */
async function until(m, text, from = 0) {
    for (let i = 0; i < 4000; i++) {
        m.run(100000);
        if (m.out.indexOf(text, from) >= 0) return;
        if (i % 4 === 0) await new Promise(r => setImmediate(r));
    }
    throw new Error(`never saw ${JSON.stringify(text)} in ${JSON.stringify(m.out.slice(from))}`);
}
const say = (m, text) => { const at = m.out.length; m.console.type(text); return at; };

test('TERM without a modem says so and leaves', async () => {
    const m = boot({ modem: false });
    await until(m, 'A>');
    const at = say(m, 'TERM\r');
    await until(m, 'No modem on this machine.', at);
    await until(m, 'A>', at + 20);
});

test('TERM: AT commands reach the modem, the echo service answers, +++ and ATH leave', async () => {
    const m = boot();
    await until(m, 'A>');
    let at = say(m, 'TERM\r');
    await until(m, 'Try ATDT', at);
    assert.equal(m.modem.dtr, true);

    at = say(m, 'AT\r');
    await until(m, 'OK', at);

    at = say(m, 'ATDT0\r');
    await until(m, 'CONNECT 1200', at);
    await until(m, 'What you type comes back', at);
    assert.equal(m.modem.carrier, true);

    at = say(m, 'hello\r');
    await until(m, 'hello\r\n', at);                      // TERM does not echo: this is the service sending it back, the CR as CR LF

    for (let i = 0; i < 60; i++) m.run(200000);          // a second of silence first
    at = m.out.length;
    m.console.type('+++');
    for (let i = 0; i < 60; i++) { m.run(200000); await new Promise(r => setImmediate(r)); }
    await until(m, 'OK', at);
    at = say(m, 'ATH\r');
    await until(m, 'OK', at);
    assert.equal(m.modem.carrier, false);
});

test('TERM: Ctrl-] Q leaves the call up; Ctrl-] H hangs it up', async () => {
    const m = boot();
    await until(m, 'A>');
    let at = say(m, 'TERM\r');
    await until(m, 'Try ATDT', at);
    at = say(m, 'ATDT0\r');
    await until(m, 'CONNECT 1200', at);
    at = say(m, '\x1dq');
    await until(m, 'A>', at);
    assert.equal(m.modem.carrier, true);
    at = say(m, 'TERM\r');
    await until(m, 'Try ATDT', at);
    at = say(m, '\x1dh');
    await until(m, 'Hung up.', at);
    assert.equal(m.modem.carrier, false);
});

test('TERM is on the system disk', () => {
    const { CpmFs } = require('../js/cpmfs.js');
const net = require('node:net');
const { createBridge } = require('../tools/modem-bridge.js');
const { Gateway } = require('../js/devices/gateway.js');
    const files = new CpmFs(Disk.fromImage(new Uint8Array(fs.readFileSync(path.join(__dirname, '../disks/cpm22.dsk'))))).list().map(f => f.name);
    assert.ok(files.includes('TERM.COM'));
});

test('TERM: dial the bulletin board, read the time, leave a bulletin, say goodbye', async () => {
    const m = boot();
    const board = new MemoryBoard();
    const dir = new Directory().add('5550100', bbs({
        now: () => new Date(2026, 10, 5, 14, 3), board, store: { get: () => null, set() {} }, online: () => false, fetchJson: () => Promise.reject(new Error('x'))
    }));
    m.modem.attach(new Hayes({ dial: dir.dial, dialTime: 1 }));
    await until(m, 'A>');
    let at = say(m, 'TERM\r');
    await until(m, 'Try ATDT0100', at);
    at = say(m, 'ATDT555-0100\r');
    await until(m, 'DIGITAL RERUN BBS', at);
    await until(m, 'uit', at);
    at = say(m, 't');
    await until(m, 'Thursday 5 November 2026', at);
    await until(m, 'press any key', at);
    at = say(m, ' ');
    await until(m, 'uit', at);
    at = say(m, 'b');
    await until(m, 'P', at + 5);
    await until(m, 'ost a message', at);
    at = say(m, 'p');
    await until(m, 'Your name?', at);
    at = say(m, 'Ana\r');
    await until(m, 'Your message', at);
    at = say(m, 'hello\r');
    await until(m, 'bulletin posted', at);
    assert.deepEqual((await board.list()).map(p => [p.name, p.text]), [['Ana', 'hello']]);
    at = say(m, 'q');
    await until(m, 'NO CARRIER', at);
    assert.equal(m.modem.carrier, false);
    assert.ok(m.out.includes('\x1b[r\x1b[0m\x1b[?25h'), 'the BBS put the terminal right again');
});

/** A machine on the BBS, its timers ours (a list to fire by hand). */
function onBbs() {
    const m = boot();
    const timers = [];
    const files = new MemoryFiles();
    const dir = new Directory().add('5550100', bbs({
        now: () => new Date(2026, 10, 5, 14, 3), board: new MemoryBoard(), files, store: { get: () => null, set() {} },
        online: () => false, fetchJson: () => Promise.reject(new Error('x')),
        after: fn => { timers.push(fn); return timers.length; }, cancel: h => { timers[h - 1] = null; }
    }));
    m.modem.attach(new Hayes({ dial: dir.dial, dialTime: 1 }));
    return { m, files, timers, fire: () => { const t = timers.filter(Boolean).pop(); if (t) t(); } };
}

test('TERM: XMODEM download from the BBS (Ctrl-] R), and the program runs', async () => {
    const { m } = onBbs();
    await until(m, 'A>');
    let at = say(m, 'TERM\r');
    await until(m, 'Try ATDT', at);
    at = say(m, 'ATDT5550100\r');
    await until(m, 'uit', at);
    at = say(m, 'f');
    await until(m, 'ownload, ', at);
    at = say(m, 'd');
    await until(m, 'File?', at);
    at = say(m, 'hello.com\r');
    await until(m, 'Start your XMODEM receive now', at);
    at = say(m, '\x1dr');
    await until(m, 'File name?', at);
    at = say(m, 'got.com\r');
    await until(m, 'Receiving', at);
    await until(m, 'Done.', at);
    await until(m, 'HELLO.COM: sent', at);
    at = say(m, '\x1dq');
    await until(m, 'A>', at);
    const file = new CpmFs(m.fdc.drives[0]).read('GOT.COM');
    assert.equal(file.length, 128);
    assert.deepEqual([...file.slice(0, 9)], [0x11, 0x09, 0x01, 0x0E, 0x09, 0xCD, 0x05, 0x00, 0xC9]);
    at = say(m, 'GOT\r');
    await until(m, 'Hello from the BBS!', at);
});

test('TERM: XMODEM upload to the BBS (Ctrl-] S)', async () => {
    const { m, files, fire } = onBbs();
    const text = Array.from({ length: 300 }, (_, i) => 'abcdefghij'.charCodeAt(i % 10));
    new CpmFs(m.fdc.drives[0]).write('UP.TXT', Uint8Array.from(text));
    await until(m, 'A>');
    let at = say(m, 'TERM\r');
    await until(m, 'Try ATDT', at);
    at = say(m, 'ATDT5550100\r');
    await until(m, 'uit', at);
    at = say(m, 'f');
    await until(m, 'ownload, ', at);
    at = say(m, 'u');
    await until(m, '(8.3)?', at);
    at = say(m, 'mine.txt\r');
    await until(m, 'Start your XMODEM send now', at);
    at = say(m, '\x1ds');
    await until(m, 'File name?', at);
    at = say(m, 'up.txt\r');
    await until(m, 'Sending: waiting', at);
    for (let i = 0; i < 40; i++) m.run(200000);          // the BBS's first NAK went by while TERM was not listening
    fire();                                               // it asks again
    await until(m, 'Done.', at);
    await until(m, 'received, ', at);
    const got = await files.get('MINE.TXT');
    assert.equal(got.length, 384);
    assert.deepEqual([...got.slice(0, 300)], text);
});

test('TERM: Ctrl-X stops a transfer', async () => {
    const { m } = onBbs();
    await until(m, 'A>');
    let at = say(m, 'TERM\r');
    await until(m, 'Try ATDT', at);
    at = say(m, '\x1dr');
    await until(m, 'File name?', at);
    at = say(m, 'none.dat\r');
    await until(m, 'Receiving', at);
    for (let i = 0; i < 20; i++) m.run(200000);
    at = say(m, '\x18');
    await until(m, 'Transfer stopped.', at);
    assert.equal(new CpmFs(m.fdc.drives[0]).list().some(f => f.name === 'NONE.DAT'), true, 'the empty file made for it is still there');
});

/** Like until(), but waiting in real time too: for a test with sockets. */
async function untilReal(m, text, from = 0) {
    for (let i = 0; i < 3000; i++) {
        m.run(100000);
        if (m.out.indexOf(text, from) >= 0) return;
        await new Promise(r => setTimeout(r, 2));
    }
    throw new Error(`never saw ${JSON.stringify(text)} in ${JSON.stringify(m.out.slice(from))}`);
}

test('TERM: ATDT a telnet host through the bridge: negotiation answered, text both ways, hang up', async () => {
    const IAC = 255;
    const got = [];
    let theirs;
    const tcp = net.createServer(s => {
        theirs = s;
        s.write(Buffer.from([IAC, 251, 1, IAC, 253, 24]));                 // WILL ECHO, DO TERMINAL-TYPE
        s.write('Welcome to the test board.\r\n? ');
        s.on('data', d => { got.push(...d); });
        s.on('error', () => {});
    });
    await new Promise(r => tcp.listen(0, '127.0.0.1', r));
    const tport = tcp.address().port;
    const bridge = createBridge({ allow: [`127.0.0.1:${tport}`], token: 't0k' });
    await new Promise(r => bridge.listen(0, '127.0.0.1', r));
    try {
        const m = boot();
        const dir = new Directory();
        dir.gateway = new Gateway({ url: `ws://127.0.0.1:${bridge.address().port}`, token: 't0k' });
        m.modem.attach(new Hayes({ dial: dir.dial, dialTime: 0.1 }));
        await until(m, 'A>');
        let at = say(m, 'TERM\r');
        await untilReal(m, 'Try ATDT', at);
        at = say(m, `ATDT127.0.0.1:${tport}\r`);
        await untilReal(m, 'CONNECT 1200', at);
        await untilReal(m, 'Welcome to the test board.', at);
        assert.equal(m.out.slice(at).includes('\xff'), false, 'no telnet commands on the screen');
        assert.deepEqual(got.slice(0, 3), [IAC, 253, 1]);                    // DO ECHO, answering the server's WILL ECHO
        at = say(m, 'hi\r');
        for (let i = 0; i < 200 && got.length < 9; i++) { m.run(200000); await new Promise(r => setTimeout(r, 5)); }
        assert.deepEqual(got.slice(-4), [104, 105, 13, 0], 'hi, and CR as CR NUL');
        theirs.write('Bye.\r\n');
        theirs.end();
        await untilReal(m, 'NO CARRIER', at);
        assert.equal(m.modem.carrier, false);
    } finally {
        bridge.closeAllConnections?.();
        await new Promise(r => bridge.close(r));
        tcp.close();
    }
});

test('TERM: leaving it (Ctrl-] Q, or H) sets the terminal right: no scroll region, plain, cursor shown', async () => {
    const m = boot();
    await until(m, 'A>');
    let at = say(m, 'TERM\r');
    await until(m, 'Try ATDT', at);
    at = say(m, '\x1dq');
    await until(m, 'A>', at);
    assert.ok(m.out.slice(at).includes('\x1b[r\x1b[0m\x1b[?25h'));
});

test('TERM menu: Ctrl-] draws a screen with the state; Z resets and OK shows below; I names the modem; Esc is back to the terminal', async () => {
    const m = boot();
    await until(m, 'A>');
    let at = say(m, 'TERM\r');
    await until(m, 'Ctrl-] for the menu', at);
    at = say(m, '\x1d');
    await until(m, 'Auto-answer: off', at);
    const screen = m.out.slice(at);
    assert.match(screen, /D {2}Dial from directory/);
    assert.match(screen, /STATUS/);
    assert.match(screen, /THE MODEM SAYS/);
    assert.match(screen, /Line: off line {5}Last number: /);
    assert.match(screen, /Speaker: on {3}Echo: on {3}Auto-answer: off/);
    at = say(m, 'z');
    await until(m, 'OK', at);
    assert.match(m.out.slice(at), /ATZ/, 'the command went to the modem, its echo and answer show');
    at = say(m, 'i');
    await until(m, 'DIGITAL RERUN MODEM', at);
    at = say(m, '7');                                              // a key the menu has no use for
    at = say(m, '\x1b');
    await until(m, '\x1b[2J', at);
    at = say(m, 'AT\r');
    await until(m, 'OK', at);
});

test('TERM menu: D lists TERM.DIR in two columns and dials the chosen entry; # types a number; L redials', async () => {
    const m = boot();
    await until(m, 'A>');
    let at = say(m, 'TERM\r');
    await until(m, 'for the menu', at);
    at = say(m, '\x1dd');
    await until(m, 'Which?', at);
    const list = m.out.slice(at);
    assert.ok(list.includes('\x1b[15;1H1 0100 Digital Rerun BBS'));
    assert.ok(list.includes('\x1b[16;1H2 0101 telehack.com'));
    assert.ok(list.includes('\x1b[15;41H9 0108 aardmud.org:4000'));
    assert.ok(list.includes('\x1b[17;41HB 0110 sdf.org'));
    at = say(m, '1');
    await until(m, 'ATDT0100', at);
    await until(m, 'NO CARRIER', at);                  // no board in this rig: the dial was sent, and answered
    at = say(m, '\x1dd');
    await until(m, 'Which?', at);
    at = say(m, '#');
    await until(m, 'Number or host?', at);
    at = say(m, '0\r');
    await until(m, 'CONNECT 1200', at);
    assert.match(m.out.slice(at), /ATDT0\r/);
    at = say(m, '\x1dl');
    await until(m, 'On line: use E', at);
    assert.match(m.out.slice(at), /ON LINE|Line:/);
    at = say(m, 'h');
    await until(m, 'Hung up.', at);
    at = say(m, 'l');
    await until(m, 'ATDT0\r', at);
    await until(m, 'CONNECT 1200', at);
});

test('TERM menu: E escapes to command mode with the call up, O goes back; M K A toggle and show', async () => {
    const m = boot();
    await until(m, 'A>');
    let at = say(m, 'TERM\r');
    await until(m, 'for the menu', at);
    at = say(m, '\x1de');
    await until(m, 'Not on line', at);
    at = say(m, '\x1b');
    await until(m, '\x1b[2J', at);
    at = say(m, 'ATDT0\r');
    await until(m, 'What you type comes back', at);
    at = say(m, '\x1de');
    await until(m, 'OK', at);
    assert.equal(m.modem.carrier, true, 'the call is still up');
    assert.match(m.out.slice(at), /COMMAND MODE/);
    at = say(m, 'm');
    await until(m, 'OK', at);
    assert.match(m.out.slice(at), /ATM0/);
    assert.match(m.out.slice(at), /Speaker: off/);
    at = say(m, 'a');
    await until(m, 'OK', at);
    assert.match(m.out.slice(at), /ATS0=1/);
    assert.match(m.out.slice(at), /Auto-answer: on/);
    at = say(m, 'o');
    await until(m, 'ATO\r', at);
    at = say(m, 'abc\r');
    await until(m, 'abc', at);               // online again: the echo service answers (the modem itself no longer echoes)
});

test('TERM menu: D without a TERM.DIR offers to type a number', async () => {
    const m = boot();
    await until(m, 'A>');
    let at = say(m, 'ERA TERM.DIR\r');
    await until(m, 'A>', at + 5);
    at = say(m, 'TERM\r');
    await until(m, 'for the menu', at);
    at = say(m, '\x1dd');
    await until(m, 'No TERM.DIR', at);
    await until(m, 'Number or host?', at);
});
