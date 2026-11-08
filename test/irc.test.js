'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Machine } = require('../js/machine.js');
const { Disk } = require('../js/devices/fdc.js');
const { Hayes } = require('../js/devices/hayes.js');
const { Directory } = require('../js/devices/directory.js');
const { Terminal } = require('../js/terminal.js');
const { CpmFs } = require('../js/cpmfs.js');
const { shelfDisk } = require('./shelfdisk.js');
const net = require('node:net');
const { createBridge } = require('../tools/modem-bridge.js');
const { Gateway } = require('../js/devices/gateway.js');

/**
 * A machine booted from the system disk, the Online shelf disk (IRC and TERM) in B:, with a toy IRC server at ATDT0150: it
 * answers NICK/USER with 001, JOIN with the join, topic and names, LIST with two
 * channels, PING with PONG, and QUIT by closing. `server.got` is every line it was
 * sent; `server.say(text)` makes it say something (CRLF added).
 */
function boot({ modem = true, server = true } = {}) {
    const m = new Machine();
    m.out = '';
    m.console.output = b => { m.out += String.fromCharCode(b); };
    m.fdc.mount(0, Disk.fromImage(new Uint8Array(fs.readFileSync(path.join(__dirname, '../disks/cpm22.dsk')))));
    m.fdc.mount(1, shelfDisk('online'));
    const srv = { got: [], say: () => {} };
    const dir = new Directory();
    if (server) {
        dir.add('5550150', link => {
            let buf = '';
            let nick = '*';
            const say = text => link.receive(text + '\r\n');
            srv.say = say;
            srv.link = link;
            return {
                send(byte) {
                    if (byte !== 10) { if (byte !== 13) buf += String.fromCharCode(byte); return; }
                    const line = buf; buf = '';
                    srv.got.push(line);
                    const [cmd, ...rest] = line.split(' ');
                    if (cmd === 'NICK') nick = rest[0];
                    if (cmd === 'USER' && !srv.noWelcome) {
                        say(`:irc.test 001 ${nick} :Welcome to the test network ${nick}`);
                        say(`:irc.test 005 ${nick} CHANTYPES=# :are supported by this server`);
                    }
                    if (cmd === 'JOIN') {
                        say(`:${nick}!u@h JOIN :${rest[0]}`);
                        say(`:irc.test 332 ${nick} ${rest[0]} :The topic of the day`);
                        say(`:irc.test 353 ${nick} = ${rest[0]} :${nick} @bob`);
                    }
                    if (cmd === 'LIST') { say(`:irc.test 322 ${nick} #one 12 :first`); say(`:irc.test 322 ${nick} #two 3 :second`); say(`:irc.test 323 ${nick} :End of /LIST`); }
                    if (cmd === 'PING') say(`:irc.test PONG irc.test ${rest[0]}`);
                    if (cmd === 'NICK' && nick !== '*' && srv.confirmNick) say(`:old!u@h NICK :${rest[0]}`);
                },
                close() { srv.closed = true; }
            };
        });
    }
    if (modem) m.modem.attach(new Hayes({ dial: dir.dial, dialTime: 0.2 }));
    assert.ok(m.reset());
    return { m, srv };
}

async function until(m, text, from = 0) {
    for (let i = 0; i < 6000; i++) {
        m.run(100000);
        if (m.out.indexOf(text, from) >= 0) return;
        if (i % 4 === 0) await new Promise(r => setImmediate(r));
    }
    throw new Error(`never saw ${JSON.stringify(text)} in ${JSON.stringify(m.out.slice(from))}`);
}
/** Run until the condition holds. */
async function untilTrue(m, fn, what) {
    for (let i = 0; i < 6000; i++) {
        m.run(100000);
        if (fn()) return;
        if (i % 4 === 0) await new Promise(r => setImmediate(r));
    }
    throw new Error(`never: ${what}`);
}
const say = (m, text) => { const at = m.out.length; m.console.type(text); return at; };
/** What the screen shows: the output so far through a VT100, row by row (the tail of the output since the program started). */
function screen(m) {
    const t = new Terminal();
    t.writeString(m.out.slice(m.out.lastIndexOf('IRC') > -1 ? m.out.indexOf('\x1b[0m\x1b[r\x1b[2J') : 0));
    return t.text().split('\n');
}
const has = (m, text) => screen(m).some(row => row.includes(text));

async function start(opts) {
    const b = boot(opts);
    await until(b.m, 'A>');
    const sw = say(b.m, 'B:\r');
    await until(b.m, 'B>', sw);
    const at = say(b.m, 'IRC\r');
    await until(b.m, 'IRC for CP/M', at);
    return b;
}

/** Type a line, wait for the effect given. */
async function type(m, text) { const at = say(m, text + '\r'); for (let i = 0; i < 30; i++) m.run(200000); return at; }

test('the Online shelf disk holds IRC and TERM with their directories (the boot disk has no room for IRC)', () => {
    const files = new CpmFs(shelfDisk('online')).list().map(f => f.name);
    for (const n of ['IRC.COM', 'IRC.DIR', 'TERM.COM', 'TERM.DIR', 'README.TXT']) assert.ok(files.includes(n), n);
    const sys = new CpmFs(Disk.fromImage(new Uint8Array(fs.readFileSync(path.join(__dirname, '../disks/cpm22.dsk'))))).list().map(f => f.name);
    assert.ok(!sys.includes('IRC.COM'), 'the system disk keeps its room for rebuilding the BIOS');
    assert.ok(new CpmFs(shelfDisk('online')).freeBytes() > 100 * 1024);
});

test('IRC without a modem says so and leaves', async () => {
    const { m } = boot({ modem: false });
    await until(m, 'A>');
    const sw = say(m, 'B:\r');
    await until(m, 'B>', sw);
    const at = say(m, 'IRC\r');
    await until(m, 'No modem on this machine.', at);
    await until(m, 'B>', at + 20);
});

test('TERM runs from the Online disk too, and dials from the TERM.DIR beside it', async () => {
    const { m } = boot();
    await until(m, 'A>');
    const sw = say(m, 'B:\r');
    await until(m, 'B>', sw);
    let at = say(m, 'TERM\r');
    await until(m, 'for the menu', at);
    at = say(m, '\x1dd');
    await until(m, 'Which?', at);
    assert.ok(m.out.slice(at).includes('\x1b[15;1H1 0100 Digital Rerun BBS'));
});

test('IRC draws its screen: status bar, message region, prompt; /help; unknown commands', async () => {
    const { m } = await start();
    let rows = screen(m);
    assert.match(rows[0], /^ IRC {2}rerun\d\d {2}not connected {2}talking to nobody/);
    assert.equal(rows[23].trimEnd(), '>');
    assert.ok(m.out.includes('\x1b[2;23r'), 'the messages scroll in rows 2 to 23');
    for (let i = 0; i < 10; i++) m.run(200000);          // the rest of the welcome
    assert.ok(has(m, '/connect 1       dial the first one'), 'the welcome shows how to start');
    await type(m, '/help');
    for (const group of ['CONNECTING', 'CHANNELS', 'PEOPLE', 'OTHER']) assert.ok(has(m, group), group);
    assert.ok(has(m, '/connect [host[:port]|n]'));
    assert.ok(has(m, '/join #chan [key]'));
    assert.ok(has(m, 'IRC for CP/M') && has(m, 'Plain TCP only'), 'the welcome and the whole help are on the screen together');
    await type(m, '/foo');
    assert.ok(has(m, '*** Unknown command'));
    await type(m, 'hello');                                // no target, no connection
    assert.ok(has(m, '*** Not connected: use /connect first.'));
});

test('IRC editing: backspace, Ctrl-U, the line limit', async () => {
    const { m } = await start();
    say(m, 'abcd\x7f\x08X');
    for (let i = 0; i < 30; i++) m.run(200000);
    assert.equal(screen(m)[23].trimEnd(), '> abX');
    say(m, '\x15');
    for (let i = 0; i < 30; i++) m.run(200000);
    assert.equal(screen(m)[23].trimEnd(), '>');
    say(m, 'x'.repeat(90));
    for (let i = 0; i < 60; i++) m.run(200000);
    assert.equal(screen(m)[23].trimEnd(), '> ' + 'x'.repeat(76));
});

test('IRC: /connect dials, registers, shows the welcome; /join, talk, and what others say', async () => {
    const { m, srv } = await start();
    await type(m, '/nick tester');
    assert.match(screen(m)[0], /tester {2}not connected/);
    await type(m, '/connect 0150');
    await untilTrue(m, () => srv.got.length >= 2, 'the server got NICK and USER');
    assert.deepEqual(srv.got.slice(0, 2), ['NICK tester', 'USER rerun 0 * :DigitalRerun IRC']);
    await untilTrue(m, () => has(m, 'Welcome to the test network tester'), 'the welcome');
    assert.ok(has(m, '*** Connected.'));
    assert.ok(!has(m, 'CHANTYPES'), '005 is not shown');
    assert.match(screen(m)[0], /tester {2}on 0150 {2}talking to nobody/);

    await type(m, '/join test');
    await untilTrue(m, () => has(m, 'You joined #test'), 'the join');
    assert.ok(srv.got.includes('JOIN #test'), 'the # is added');
    assert.ok(has(m, 'Topic of #test: The topic of the day'));
    assert.ok(has(m, '= #test tester @bob'));
    assert.match(screen(m)[0], /talking to #test/);

    await type(m, 'hello there');
    assert.ok(srv.got.includes('PRIVMSG #test :hello there'));
    assert.ok(has(m, '<tester> hello there'));

    srv.say(':bob!b@h PRIVMSG #test :hi tester');
    await untilTrue(m, () => has(m, '<bob> hi tester'), 'bob speaks');
    srv.say(':bob!b@h PRIVMSG #test :\x01ACTION waves\x01');
    await untilTrue(m, () => has(m, '* bob waves'), 'an action');
    srv.say(':bob!b@h PRIVMSG tester :psst');
    await untilTrue(m, () => has(m, '*bob* psst'), 'a private message');
    srv.say(':bob!b@h PRIVMSG #other :elsewhere');
    await untilTrue(m, () => has(m, '#other <bob> elsewhere'), 'another channel is named');
    srv.say(':irc.test NOTICE tester :server notice');
    await untilTrue(m, () => has(m, '-irc.test- server notice'), 'a notice');
    srv.say(':bob!b@h PRIVMSG #test :\x02bold\x02 \x0304,12red\x03 plain é');
    await untilTrue(m, () => has(m, '<bob> bold red plain'), 'control codes are stripped');
    assert.ok(has(m, 'plain ?'), 'a UTF-8 character becomes one ?');
});

test('IRC: joins, parts, quits, nick changes, kicks, topics, PING and CTCP VERSION', async () => {
    const { m, srv } = await start();
    await type(m, '/nick tester');
    await type(m, '/connect 0150');
    await untilTrue(m, () => has(m, 'Welcome to'), 'welcome');
    await type(m, '/join #test');
    await untilTrue(m, () => has(m, 'You joined #test'), 'join');
    srv.say(':carl!c@h JOIN #test');
    await untilTrue(m, () => has(m, '--> carl joined #test'), 'carl joins');
    srv.say(':carl!c@h NICK :carlos');
    await untilTrue(m, () => has(m, '-- carl is now known as carlos'), 'carl renames');
    srv.say(':carlos!c@h PART #test :gone fishing');
    await untilTrue(m, () => has(m, '<-- carlos left #test (gone fishing)'), 'carlos parts');
    srv.say(':dan!d@h QUIT :Ping timeout');
    await untilTrue(m, () => has(m, '<-- dan quit (Ping timeout)'), 'dan quits');
    srv.say(':bob!b@h TOPIC #test :new topic');
    await untilTrue(m, () => has(m, '-- bob set the topic of #test: new topic'), 'topic');
    srv.say(':bob!b@h KICK #test carlos :behave');
    await untilTrue(m, () => has(m, '<-- carlos was kicked from #test by bob (behave)'), 'kick');
    srv.say('PING :abc123');
    await untilTrue(m, () => srv.got.includes('PONG :abc123'), 'the PONG');
    srv.say(':bob!b@h PRIVMSG tester :\x01VERSION\x01');
    await untilTrue(m, () => srv.got.some(l => l.startsWith('NOTICE bob :\x01VERSION DigitalRerun')), 'the CTCP VERSION reply');
    srv.say(':irc.test MODE #test +o bob');
    await untilTrue(m, () => has(m, '-- MODE #test +o bob'), 'mode shown');
    // our own nick changes
    srv.confirmNick = false;
    await type(m, '/nick newbie');
    assert.ok(srv.got.includes('NICK newbie'));
    srv.say(':tester!u@h NICK :newbie');
    await untilTrue(m, () => /newbie {2}on/.test(screen(m)[0]), 'the status shows the new nick');
    // kicked ourselves: no target
    srv.say(':bob!b@h KICK #test newbie :out');
    await untilTrue(m, () => /talking to nobody/.test(screen(m)[0]), 'no target after a kick');
});

test('IRC: /msg /query /me /list /names /whois /topic /mode /raw /part, and // sends a slash', async () => {
    const { m, srv } = await start();
    await type(m, '/nick tester');
    await type(m, '/connect 0150');
    await untilTrue(m, () => has(m, 'Welcome to'), 'welcome');
    await type(m, '/join #test');
    await untilTrue(m, () => has(m, 'You joined #test'), 'join');

    await type(m, '/msg bob see you');
    assert.ok(srv.got.includes('PRIVMSG bob :see you'));
    assert.ok(has(m, '-> bob: see you'));
    await type(m, '/query bob');
    assert.match(screen(m)[0], /talking to bob/);
    await type(m, 'now in a query');
    assert.ok(srv.got.includes('PRIVMSG bob :now in a query'));
    srv.say(':bob!b@h PRIVMSG tester :reply');
    await untilTrue(m, () => has(m, '<bob> reply'), 'a query message shows like a channel message');
    await type(m, '/query #test');
    await type(m, '/me shrugs');
    assert.ok(srv.got.includes('PRIVMSG #test :\x01ACTION shrugs\x01'));
    assert.ok(has(m, '* tester shrugs'));
    await type(m, '/list');
    await untilTrue(m, () => has(m, '#two 3 second'), 'the list');
    assert.ok(has(m, '#one 12 first'));
    await type(m, '/names');
    await type(m, '/names #elsewhere');
    await type(m, '/whois bob');
    await type(m, '/topic');
    await type(m, '/topic a new one');
    await type(m, '/mode +m');
    await type(m, '/mode #chan +i');
    await type(m, '/who *.org');
    await type(m, '/away gone');
    await type(m, '/raw  PING :x');
    await type(m, '//shrug');
    for (const line of ['LIST', 'NAMES #test', 'NAMES #elsewhere', 'WHOIS bob', 'TOPIC #test', 'TOPIC #test :a new one', 'MODE #test +m', 'MODE #chan +i', 'WHO *.org', 'AWAY gone', 'PING :x', 'PRIVMSG #test :/shrug']) {
        assert.ok(srv.got.includes(line), `${line} in ${JSON.stringify(srv.got)}`);
    }
    await type(m, '/part');
    assert.ok(srv.got.includes('PART #test'));
    assert.match(screen(m)[0], /talking to nobody/);
    await type(m, '/part #zzz');
    assert.ok(srv.got.includes('PART #zzz'));
});

test('IRC: a taken nick gets an underscore; the call dropping is shown', async () => {
    const { m, srv } = await start();
    srv.noWelcome = true;
    await type(m, '/nick tester');
    await type(m, '/connect 0150');
    await untilTrue(m, () => srv.got.length >= 2, 'registered');
    srv.say(':irc.test 433 * tester :Nickname is already in use');
    await untilTrue(m, () => srv.got.includes('NICK tester_'), 'tries another');
    await untilTrue(m, () => has(m, '*** That nick is taken') && /tester_ {2}on/.test(screen(m)[0]), 'the nick shown');
    srv.link.hangup();
    await untilTrue(m, () => has(m, '*** Disconnected.'), 'the drop');
    assert.match(screen(m)[0], /not connected/);
    await untilTrue(m, () => has(m, '-- NO CARRIER'), 'the modem says so too');
});

test('IRC: /quit says goodbye and hangs up; /connect again; /bye leaves and sets the modem echo right', async () => {
    const { m, srv } = await start();
    await type(m, '/nick tester');
    await type(m, '/connect 0150');
    await untilTrue(m, () => has(m, 'Welcome to'), 'welcome');
    await type(m, '/connect 0150');
    assert.ok(has(m, '*** Already connected'));
    await type(m, '/quit so long');
    await untilTrue(m, () => has(m, '*** Disconnected.'), 'hung up');
    assert.ok(srv.got.includes('QUIT :so long'));
    assert.equal(m.modem.carrier, false);
    await type(m, '/quit');
    assert.ok(has(m, '*** Not connected'));
    const users = () => srv.got.filter(l => l.startsWith('USER')).length;
    await type(m, '/connect 0150');
    await untilTrue(m, () => users() === 2 && has(m, '*** Connected.'), 'connected again');
    for (let i = 0; i < 60; i++) m.run(200000);
    const at = say(m, '/bye\r');
    await until(m, 'B>', at);
    assert.equal(m.modem.carrier, false);
    assert.ok(srv.got.includes('QUIT :Bye'));
    assert.equal(m.modem.dtr, true);
    assert.ok(m.out.slice(at).includes('\x1b[r\x1b[0m\x1b[?25h'), 'the terminal is put right');
    // the modem echoes again (IRC turned it off for itself and put it right on leaving)
    let at2 = say(m, 'TERM\r');
    await until(m, 'Try ATDT', at2);
    at2 = say(m, 'AT\r');
    await until(m, 'OK', at2);
    assert.ok(m.out.slice(at2).includes('AT\r\r\nOK'), 'the echo is on');
});

test('IRC: a failed dial is told and the status goes back; /connect with no argument lists IRC.DIR; a number picks one', async () => {
    const { m } = await start({ server: false });
    await type(m, '/connect nowhere.example.org');
    await untilTrue(m, () => has(m, 'NO CARRIER') || has(m, 'NO DIALTONE'), 'refused');
    await untilTrue(m, () => /not connected/.test(screen(m)[0]), 'the status is back');
    await type(m, '/connect');
    assert.ok(has(m, ' 1  irc.libera.chat:6667 Libera.Chat'));
    assert.ok(has(m, ' 7  irc.quakenet.org:6667 QuakeNet'));
    assert.ok(has(m, '/connect n dials one of these'));
    await type(m, '/connect 3');
    assert.ok(has(m, '*** Dialing irc.rizon.net:6667'));
    await untilTrue(m, () => /not connected/.test(screen(m)[0]), 'no gateway: it fails');
    await type(m, '/connect 99');
    assert.ok(has(m, '*** No such entry in IRC.DIR.'));
});

test('IRC: a host with no port gets 6667; a number is dialed as it is', async () => {
    const calls = [];
    const { m } = await start({ server: false });
    m.modem.line.dial = (number, link, typed) => { calls.push([number, typed]); return 'BUSY'; };
    await type(m, '/connect irc.example.org');
    await untilTrue(m, () => calls.length >= 1, 'dialed');
    assert.equal(calls[0][1], 'irc.example.org:6667');
    await untilTrue(m, () => has(m, 'BUSY') && /not connected/.test(screen(m)[0]), 'busy');
    await type(m, '/connect irc.example.org:6697');
    await untilTrue(m, () => calls.length >= 2, 'dialed again');
    assert.equal(calls[1][1], 'irc.example.org:6697');
    await untilTrue(m, () => screen(m).filter(r => r.includes('BUSY')).length >= 2 && /not connected/.test(screen(m)[0]), 'busy again');
    await type(m, '/connect 5551234');
    await untilTrue(m, () => calls.length >= 3, 'dialed a number');
    assert.equal(calls[2][1], '5551234');
});

test('IRC keeps up with a burst at any baud rate: no byte is ever overrun, every line arrives whole', async () => {
    for (const baud of [1200, 4800, 19200]) {
        const { m, srv } = await start();
        m.modem.baud = baud;
        await type(m, '/nick tester');
        await type(m, '/connect 0150');
        await untilTrue(m, () => has(m, 'Welcome to the test network tester'), 'welcome');
        // a byte the program did not read before the next came is lost: count those (the flag itself is cleared by every read)
        let lost = 0;
        const pump = m.modem.pump.bind(m.modem);
        m.modem.pump = () => { const was = m.modem.ready; const n = m.modem.inbox.length; pump(); if (was && m.modem.inbox.length < n) lost++; };
        const lines = Array.from({ length: 40 }, (_, i) => `- line ${i} of the message of the day, with some filler text to make it longer`);
        for (const l of lines) srv.say(`:irc.test 372 tester :${l}`);
        srv.say(':bob!b@h PRIVMSG tester :the last one');
        await untilTrue(m, () => has(m, '*bob* the last one'), `all arrived at ${baud}`);
        assert.equal(lost, 0, `${baud} baud: bytes overrun`);
        const shown = m.out.slice(m.out.indexOf('Welcome to the test'));
        for (const l of lines) assert.ok(shown.includes(`\n-- ${l}\x1b8`), `${baud} baud: ${l} whole`);
    }
});

test('IRC through the bridge to a real TCP server: plain CRLF on the wire (no NUL), no echo of what we send, the answers come back', async () => {
    const got = [];
    let theirs;
    const tcp = net.createServer(s => {
        theirs = s;
        let buf = '';
        s.on('data', d => {
            got.push(...d);
            buf += d.toString('latin1');
            if (/USER [^\n]*\n/.test(buf) && !buf.welcomed) { buf = ''; s.write(':irc.test 001 tester :Welcome through the bridge\r\n'); }
        });
        s.on('error', () => {});
    });
    await new Promise(r => tcp.listen(0, '127.0.0.1', r));
    const tport = tcp.address().port;
    const bridge = createBridge({ allow: [`127.0.0.1:${tport}`], token: 't0k' });
    await new Promise(r => bridge.listen(0, '127.0.0.1', r));
    let machine;
    try {
        const { m } = await start({ server: false });
        machine = m;
        const dir = new Directory();
        dir.gateway = new Gateway({ url: `ws://127.0.0.1:${bridge.address().port}`, token: 't0k', rawPorts: [tport] });
        m.modem.attach(new Hayes({ dial: dir.dial, dialTime: 0.1 }));
        const waitReal = async (fn, what) => { for (let i = 0; i < 3000 && !fn(); i++) { m.run(100000); await new Promise(r => setTimeout(r, 2)); } assert.ok(fn(), what); };
        await type(m, '/nick tester');
        await type(m, `/connect 127.0.0.1:${tport}`);
        await waitReal(() => has(m, 'Welcome through the bridge'), 'the welcome came back');
        assert.equal(Buffer.from(got).toString('latin1'), 'NICK tester\r\nUSER rerun 0 * :DigitalRerun IRC\r\n', 'plain CRLF, no NUL');
        assert.ok(!has(m, 'NICK tester') && !has(m, 'USER rerun'), 'what we sent did not come back as input');
        got.length = 0;
        await type(m, '/join #bridge');
        await waitReal(() => got.length >= 14, 'the join was sent');
        assert.equal(Buffer.from(got).toString('latin1'), 'JOIN #bridge\r\n');
        theirs.write(':bob!b@h PRIVMSG tester :hello over tcp\r\n');
        await waitReal(() => has(m, '*bob* hello over tcp'), 'a message arrived');
        theirs.end();
        await waitReal(() => /not connected/.test(screen(m)[0]), 'the server hung up');
    } finally {
        if (machine) machine.modem.line.reset();           // the sockets must close even when the test failed
        if (theirs) theirs.destroy();
        bridge.closeAllConnections?.();
        await new Promise(r => bridge.close(r));
        tcp.close();
    }
});

test('IRC with a name on the command line connects at once: a number, a word of IRC.DIR, a host', async () => {
    const dialing = async arg => {
        const b = boot({ server: false });
        await until(b.m, 'A>');
        const sw = say(b.m, 'B:\r');
        await until(b.m, 'B>', sw);
        say(b.m, `IRC ${arg}\r`);
        await untilTrue(b.m, () => has(b.m, '*** Dialing'), 'dialing');
        return screen(b.m).find(row => row.includes('*** Dialing'));
    };
    assert.match(await dialing('3'), /\*\*\* Dialing irc\.rizon\.net:6667/);
    assert.match(await dialing('OFTC'), /\*\*\* Dialing irc\.oftc\.net:6667/);
    assert.match(await dialing('Libera.Chat'), /\*\*\* Dialing irc\.libera\.chat:6667/);
    assert.match(await dialing('Some.Host.Example:6668'), /\*\*\* Dialing some\.host\.example:6668/);
});

test('IRC /connect takes a word of IRC.DIR too', async () => {
    const { m } = await start({ server: false });
    await type(m, '/connect efnet');
    assert.ok(has(m, '*** Dialing irc.efnet.org:6667'));
});
