'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, until, run, speaksFirst, cpm3Disk } = require('./net.js');

/** A NIST daytime line for the UTC moment `d`. */
function nist(d) {
    const mjd = Math.floor(d.getTime() / 86400000) + 40587;
    const p = n => String(n).padStart(2, '0');
    return `\n${mjd} ${p(d.getUTCFullYear() % 100)}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} 00 0 0 123.4 UTC(NIST) * \n`;
}

/** The machine's clock as NETTIME printed it, read as if it were UTC (ms). */
function printedMachine(out) {
    const [, y, mo, d, h, mi, s] = /This machine: (\d+)-(\d+)-(\d+) (\d+):(\d+):(\d+)/.exec(out);
    return Date.UTC(+y, mo - 1, +d, +h, +mi, +s);
}

test('NETTIME asks time.nist.gov:13, shows its UTC time and how far this machine is from it', async () => {
    const when = new Date(Date.UTC(2026, 10, 19, 4, 24, 0));
    const holder = {};
    const { m, dialed } = boot({ hosts: { 'time.nist.gov:13': link => holder.make(link) } });
    holder.make = speaksFirst(m, nist(when));
    const at = await run(m, 'NETTIME');
    await until(m, 'B>', at + 10);
    const out = m.out.slice(at);
    assert.deepEqual(dialed, ['time.nist.gov:13']);
    assert.ok(out.includes('Asking time.nist.gov ...'), out);
    assert.ok(out.includes('time.nist.gov: 2026-11-19 04:24:00 UTC'), out);
    const diff = Math.round((printedMachine(out) - when.getTime()) / 1000);
    const a = Math.abs(diff);
    const said = /, (.*)\r\n/.exec(out.slice(out.indexOf('This machine:')))[1];
    if (a === 0) assert.equal(said, 'the same, to the second.');
    else if (a >= 0x20000) assert.equal(said, 'more than a day apart.');   // nettime.asm: from 20000h seconds (36:24:32) on
    else {
        const p = n => String(n).padStart(2, '0');
        assert.equal(said, `${Math.floor(a / 3600)}:${p(Math.floor(a / 60) % 60)}:${p(a % 60)} ${diff > 0 ? 'ahead' : 'behind'}.`);
    }
    assert.ok(!out.includes('CP/M 3'), 'CP/M 2.2 has no date to set');
});

test('NETTIME: the machine an hour and a bit ahead; and behind', async () => {
    for (const [secs, word] of [[3723, 'ahead'], [-45296, 'behind']]) {
        const holder = {};
        const { m } = boot({ hosts: { 'clock.example:13': link => holder.make(link) } });
        // the machine's clock, read as UTC, at about the moment NETTIME looks (a few seconds after boot)
        const local = new Date(m.clock.base);
        const machineAsUtc = Date.UTC(local.getFullYear(), local.getMonth(), local.getDate(), local.getHours(), local.getMinutes(), local.getSeconds());
        holder.make = link => speaksFirst(m, nist(new Date(machineAsUtc + (m.clock.sync() | 0) - secs * 1000)))(link);
        const at = await run(m, 'NETTIME clock.example');
        await until(m, 'B>', at + 10);
        const out = m.out.slice(at);
        const said = /This machine: .*, (\d+):(\d\d):(\d\d) (\w+)\./.exec(out);
        assert.ok(said, out);
        const got = (+said[1]) * 3600 + (+said[2]) * 60 + (+said[3]);
        assert.ok(Math.abs(got - Math.abs(secs)) <= 2, `${got} vs ${secs}`);
        assert.equal(said[4], word);
    }
});

test('NETTIME: an answer that is no NIST time; a host that does not answer; a bad offset', async () => {
    const holder = {};
    const { m } = boot({ hosts: { 'odd.example:13': link => holder.make(link) } });
    holder.make = speaksFirst(m, 'Thursday, November 19, 2026 04:24:00-UTC\r\n');
    let at = await run(m, 'NETTIME odd.example');
    await until(m, 'Not a time I can read: Thursday, November 19', at);
    await until(m, 'B>', at + 10);
    at = (m.console.type('NETTIME gone.example\r'), m.out.length);
    await until(m, 'NO CARRIER', at);
    await until(m, 'B>', at + 10);
    at = (m.console.type('NETTIME +99\r'), m.out.length);
    await until(m, 'NETTIME [host[:port]]', at);
});

test('NETTIME under CP/M 3 sets the date and time with the offset, and sees whether the BIOS keeps them', { timeout: 300000 }, async () => {
    const system = await cpm3Disk();
    const holder = {};
    const { m } = boot({ system, hosts: { 'time.nist.gov:13': link => holder.make(link) } });
    holder.make = speaksFirst(m, nist(new Date(Date.UTC(2026, 10, 19, 4, 24, 0))));
    const at = await run(m, 'NETTIME +5:30');
    await until(m, 'B>', at + 10);
    const out = m.out.slice(at);
    assert.ok(out.includes('time.nist.gov: 2026-11-19 04:24:00 UTC'), out);
    // this machine's BIOS takes the host's clock and ignores a set
    assert.ok(out.includes('The BIOS keeps its own clock: CP/M 3 was not set.'), out);
});
