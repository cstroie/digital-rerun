#!/usr/bin/env node
'use strict';
/*
 * mkdat.js: pack sigseek.txt into SIGSEEK.DAT for the game.
 *
 *   node mkdat.js [sigseek.txt] [SIGSEEK.DAT]
 *
 * SIGSEEK.DAT:
 *   0   'SDAT'
 *   4   version (1), messages, callers, chapters, fragments (bytes)
 *   9   (zeros to 16)
 *   16  a table of words: the offset of each string from the start of the file
 *   ..  the strings, 0-terminated
 * padded with ^Z to a whole 128-byte record.
 *
 * The strings, in order: the messages; then for each caller, its name and
 * for each chapter the packet text and the two letter lines (16 strings a
 * caller); then for each fragment the packet text and its line.
 */
const fs = require('fs');
const path = require('path');

const NMSG = 16, NCALL = 8, NCH = 5, NFRAG = 32;
const SHORT = 20, LINE = 60, NAME = 30;

function parse(text) {
    const msgs = [], callers = [], frags = [];
    let section = null;
    text.split(/\r?\n/).forEach((raw, i) => {
        const where = `line ${i + 1}`;
        const line = raw.replace(/\s+$/, '');
        if (!line.trim() || line.startsWith('#')) return;
        if (/[^\x20-\x7e]/.test(line)) throw new Error(`${where}: not 7-bit printable ASCII`);
        const at = line.match(/^@(\w+)\s*(.*)$/);
        if (at) {
            section = at[1];
            if (section === 'caller') callers.push({ name: at[2].trim(), chapters: [] });
            else if (section !== 'msg' && section !== 'frag') throw new Error(`${where}: unknown section @${section}`);
            return;
        }
        const parts = line.split('|').map(s => s.trim());
        const check = (s, max, what) => {
            if (!s.length) throw new Error(`${where}: empty ${what}`);
            if (s.length > max) throw new Error(`${where}: ${what} is ${s.length} characters, at most ${max}: ${s}`);
            return s;
        };
        if (section === 'msg') msgs.push(check(line.trim(), SHORT, 'message'));
        else if (section === 'caller') {
            if (parts.length !== 3) throw new Error(`${where}: a chapter is: text | line 1 | line 2`);
            callers[callers.length - 1].chapters.push([check(parts[0], SHORT, 'packet text'), check(parts[1], LINE, 'letter line'), check(parts[2], LINE, 'letter line')]);
        } else if (section === 'frag') {
            if (parts.length !== 2) throw new Error(`${where}: a fragment is: text | line`);
            frags.push([check(parts[0], SHORT, 'packet text'), check(parts[1], LINE, 'fragment line')]);
        } else throw new Error(`${where}: text before any section`);
    });
    if (msgs.length !== NMSG) throw new Error(`${msgs.length} messages, the game wants ${NMSG}`);
    if (callers.length !== NCALL) throw new Error(`${callers.length} callers, the game wants ${NCALL}`);
    for (const c of callers) {
        check(c.name);
        if (c.chapters.length !== NCH) throw new Error(`${c.name}: ${c.chapters.length} chapters, the game wants ${NCH}`);
    }
    if (frags.length !== NFRAG) throw new Error(`${frags.length} fragments, the game wants ${NFRAG}`);
    return { msgs, callers, frags };
    function check(name) { if (!name || name.length > NAME) throw new Error(`caller name "${name}": 1 to ${NAME} characters`); }
}

function pack({ msgs, callers, frags }) {
    const strings = [...msgs];
    for (const c of callers) { strings.push(c.name); for (const ch of c.chapters) strings.push(...ch); }
    for (const f of frags) strings.push(...f);
    const head = 16 + 2 * strings.length;
    const body = [];
    const offsets = [];
    let at = head;
    for (const s of strings) { offsets.push(at); for (const ch of s) body.push(ch.charCodeAt(0)); body.push(0); at += s.length + 1; }
    if (at > 0xFFFF) throw new Error('too big');
    const size = Math.ceil(at / 128) * 128;
    const out = new Uint8Array(size).fill(0x1A);
    out.set([0x53, 0x44, 0x41, 0x54, 1, NMSG, NCALL, NCH, NFRAG, 0, 0, 0, 0, 0, 0, 0]);
    offsets.forEach((o, i) => { out[16 + 2 * i] = o & 0xFF; out[17 + 2 * i] = o >> 8; });
    out.set(body, head);
    return out;
}

if (require.main === module) {
    const src = process.argv[2] || path.join(__dirname, 'sigseek.txt');
    const dst = process.argv[3] || path.join(__dirname, 'SIGSEEK.DAT');
    const dat = pack(parse(fs.readFileSync(src, 'latin1')));
    fs.writeFileSync(dst, dat);
    console.log(`${dst}: ${dat.length} bytes`);
}

module.exports = { parse, pack, NMSG, NCALL, NCH, NFRAG };
