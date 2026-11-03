#!/usr/bin/env node
/*
 * stamp.js: write the build stamp into js/version.js.
 *
 *   node tools/stamp.js            write it
 *   node tools/stamp.js --check    exit 1 when it is stale
 *
 * This tool maintains DigitalRerun's versioning and cache consistency:
 *
 * The BUILD stamp is the first 12 hex digits of a SHA-256 hash over every file
 * that the service worker caches (listed in `sw.js`). The hash includes
 * js/version.js but with the BUILD field temporarily set to '000000000000'
 * to avoid it being part of the hash of itself (a circular dependency).
 *
 * The SHELL array in sw.js lists all files that the app caches for offline use:
 * - The main page and static assets (HTML, CSS, icons)
 * - Core application files (js/*.js)
 * - Disk images and configuration (disks/*.dsk, disks/*.json)
 * - Service worker files (sw.js)
 *
 * This tool should be run after any change to files in the SHELL list or
 * to js/version.js. A test in the test suite fails when the stamp is stale,
 * ensuring that no change ships under an old cache.
 *
 * For releases:
 *   1. Raise VERSION in js/version.js (using semantic versioning: MAJOR.MINOR.PATCH)
 *   2. Run node tools/stamp.js to update the BUILD stamp
 *
 * The cache naming follows the pattern: digitalrerun-{VERSION}-{BUILD}
 * so that new releases have a completely new cache, ensuring consistency.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const VERSION_FILE = path.join(ROOT, 'js/version.js');
const STAMP = /BUILD: '([0-9a-f]{12})'/;

function shell() {
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const list = /const SHELL = \[([\s\S]*?)\];/.exec(sw)[1];
    return [...list.matchAll(/'([^']+)'/g)].map(m => m[1]).filter(f => f !== './');
}

function build() {
    const h = crypto.createHash('sha256');
    for (const f of shell()) {
        let data = fs.readFileSync(path.join(ROOT, f));
        if (f === 'js/version.js') data = Buffer.from(data.toString('utf8').replace(STAMP, "BUILD: '000000000000'"));
        h.update(f + '\0').update(data);
    }
    return h.digest('hex').slice(0, 12);
}

function current() {
    return STAMP.exec(fs.readFileSync(VERSION_FILE, 'utf8'))[1];
}

if (require.main === module) {
    const stamp = build();
    if (process.argv.includes('--check')) {
        if (stamp !== current()) { console.error(`js/version.js: build ${current()} is stale, run node tools/stamp.js (${stamp})`); process.exit(1); }
        console.log(`build ${stamp} is current`);
    } else {
        fs.writeFileSync(VERSION_FILE, fs.readFileSync(VERSION_FILE, 'utf8').replace(STAMP, `BUILD: '${stamp}'`));
        console.log(`js/version.js: build ${stamp}`);
    }
}

module.exports = { shell, build, current };
