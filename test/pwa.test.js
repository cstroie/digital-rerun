'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { shell, build, current } = require('../tools/stamp.js');
const { VERSION, BUILD } = require('../js/version.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('the version is semver and the build stamp is current (run node tools/stamp.js)', () => {
    assert.match(VERSION, /^\d+\.\d+\.\d+$/);
    assert.equal(BUILD, current());
    assert.equal(BUILD, build(), 'js/version.js is stale: run node tools/stamp.js');
});

test('the service worker caches every file the page loads, and they exist', () => {
    const cached = new Set(shell());
    const html = read('index.html');
    const local = [...html.matchAll(/(?:src|href)="([^":#]+)"/g)].map(m => m[1]);
    assert.ok(local.length > 10);
    for (const f of local) assert.ok(cached.has(f), `${f} is loaded by index.html but not cached by sw.js`);
    for (const f of cached) assert.ok(fs.existsSync(path.join(ROOT, f)), `sw.js caches ${f}, which does not exist`);
    for (const f of ['disks/cpm22.dsk']) assert.ok(cached.has(f), `${f} is fetched by the app`);
});

test('manifest icons exist at their stated sizes, with a maskable one', () => {
    const manifest = JSON.parse(read('manifest.webmanifest'));
    assert.equal(manifest.start_url, './');
    const cached = new Set(shell());
    for (const icon of manifest.icons) {
        const png = fs.readFileSync(path.join(ROOT, icon.src));
        const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
        assert.equal(`${w}x${h}`, icon.sizes, icon.src);
        assert.ok(cached.has(icon.src), `${icon.src} not cached`);
    }
    assert.ok(manifest.icons.some(i => i.purpose === 'maskable'));
});

test('the service worker only removes its own caches', () => {
    const sw = read('sw.js');
    assert.match(sw, /k\.startsWith\('digitalrerun-'\)/);
    assert.doesNotMatch(sw, /skipWaiting\(\)\)\s*;?\s*\}\);\s*\n\s*self\.addEventListener\('activate'/, 'install must not skip waiting');
});
