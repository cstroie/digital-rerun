'use strict';
/* A shelf disk built the way the page builds it, but at once (for tests that need one in a drive). */
const fs = require('node:fs');
const path = require('node:path');
const { Disk } = require('../js/devices/fdc.js');
const { CpmFs, toCpmText } = require('../js/cpmfs.js');
const { isText } = require('../js/shelf.js');

const ROOT = path.join(__dirname, '..');
const shelf = JSON.parse(fs.readFileSync(path.join(ROOT, 'disks/shelf.json'), 'utf8'));

function shelfDisk(id) {
    const entry = shelf.find(e => e.id === id);
    const disk = new Disk(entry.format, null, { name: entry.name });
    const fsys = new CpmFs(disk);
    for (const f of entry.files) {
        const data = new Uint8Array(fs.readFileSync(path.join(ROOT, f.path)));
        fsys.write(f.name, isText(entry, f.name, data) ? toCpmText(data) : data);
    }
    disk.dirty = false;
    return disk;
}

module.exports = { shelfDisk };
