'use strict';
/*
 * The machine for the tests of dialtone's network programs (system/dialtone: GOPHER, MUD, FINGER, NETTIME): the system disk in A:,
 * in B: the programs assembled from their sources (and any files given), a Hayes modem
 * whose directory sends every host to `hosts[host:port]`: a function of the link that
 * returns the other end, as the gateway would (or a reason, 'BUSY' ...).
 */
const fs = require('node:fs');
const path = require('node:path');
const { Machine } = require('../js/machine.js');
const { Disk } = require('../js/devices/fdc.js');
const { Hayes } = require('../js/devices/hayes.js');
const { Directory } = require('../js/devices/directory.js');
const { CpmFs, toCpmText } = require('../js/cpmfs.js');
const { assemble } = require('../js/asm8080.js');

const ROOT = path.join(__dirname, '..');

/** The .COM of system/dialtone/<name>.asm. */
function com(name) {
    const r = assemble(fs.readFileSync(path.join(ROOT, 'system/dialtone', `${name}.asm`), 'latin1'), {});
    return { image: r.image(0x100, r.high), high: r.high, symbols: r.symbols };
}

/** A machine running at the frame size of the page, the network programs on B:. `files`: {NAME: text}. */
function boot({ hosts = {}, files = {}, modem = true, system = null } = {}) {
    const m = new Machine();
    m.out = '';
    m.console.output = b => { m.out += String.fromCharCode(b); };
    m.fdc.mount(0, system || Disk.fromImage(new Uint8Array(fs.readFileSync(path.join(ROOT, 'disks/cpm22.dsk')))));
    const b = new Disk('sssd8');
    const fsys = new CpmFs(b);
    for (const n of ['finger', 'nettime', 'gopher', 'mud']) {
        fsys.write(`${n.toUpperCase()}.COM`, com(n).image);
    }
    for (const [n, text] of Object.entries(files)) fsys.write(n, toCpmText(Buffer.from(text, 'latin1')));
    m.fdc.mount(1, b);
    const dir = new Directory();
    const dialed = [];
    dir.gateway = {
        dial(host, port, link) {
            dialed.push(`${host}:${port}`);
            const make = hosts[`${host}:${port}`];
            return make ? make(link) : 'NO CARRIER';
        }
    };
    if (modem) m.modem.attach(new Hayes({ dial: dir.dial, dialTime: 0.2 }));
    if (!m.reset()) throw new Error('no boot');
    return { m, dialed };
}

/** Run in 16 ms frames until `text` appears after `from`. */
async function until(m, text, from = 0, frames = 20000) {
    for (let i = 0; i < frames; i++) {
        m.run(64000);
        if (m.out.indexOf(text, from) >= 0) return;
        if (i % 8 === 0) await new Promise(r => setImmediate(r));
    }
    throw new Error(`never saw ${JSON.stringify(text)} in ${JSON.stringify(m.out.slice(from).slice(-600))}`);
}

/** Run a while (frames of 16 ms). */
async function settle(m, frames = 100) {
    for (let i = 0; i < frames; i++) {
        m.run(64000);
        if (i % 8 === 0) await new Promise(r => setImmediate(r));
    }
}

/** The CP/M 3 system disk of the shelf (for boot's `system`). */
async function cpm3Disk() {
    const { buildDisk, resolveCatalog } = require('../js/shelf.js');
    const list = JSON.parse(fs.readFileSync(path.join(ROOT, 'disks/shelf.json'), 'utf8'));
    const entry = resolveCatalog(list, 'http://h/').find(e => e.id === 'cpm3');
    return buildDisk(entry, async p => new Uint8Array(fs.readFileSync(path.join(ROOT, p.slice('http://h/'.length)))));
}

const say = (m, text) => { const at = m.out.length; m.console.type(text); return at; };

/** Boot, go to B:, type a command; returns the place in the output where it starts. */
async function run(m, command) {
    await until(m, 'A>');
    let at = say(m, 'B:\r');
    await until(m, 'B>', at);
    at = say(m, command + '\r');
    return at;
}

/**
 * A host that answers once: what it is sent until CR LF is `asked` (a list), then it says
 * `answer(line)` (a string) and hangs up, as finger, daytime and gopher servers do.
 */
function oneShot(answer, log = []) {
    return link => {
        let buf = '';
        return {
            send(byte) {
                if (byte === 10) {
                    log.push(buf);
                    const text = answer(buf);
                    buf = '';
                    link.receive(text);
                    link.hangup();
                    return;
                }
                if (byte !== 13) buf += String.fromCharCode(byte);
            },
            close() { log.closed = true; }
        };
    };
}

/** A host that speaks first (a daytime server): says `text` once the call is up on `m`, then hangs up. */
function speaksFirst(m, text) {
    return link => {
        const go = () => { if (!m.modem.carrier) return setImmediate(go); link.receive(text); link.hangup(); };
        setImmediate(go);
        return { send() {}, close() {} };
    };
}

module.exports = { cpm3Disk, boot, until, settle, say, run, oneShot, speaksFirst, com };
