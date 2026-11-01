'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { Machine } = require('../js/machine.js');
const { Disk } = require('../js/devices/fdc.js');
const { CpmFs } = require('../js/cpmfs.js');
const Shelf = require('../js/shelf.js');
const { build, storyHeader, formatFor } = require('../tools/private-shelf.js');
const { server } = require('../tools/private-serve.js');

const ROOT = path.join(__dirname, '..');

/** A story file that is only a header: version `v`, a title screen that quits. */
function story(v, size) {
    const b = Buffer.alloc(size);
    b[0] = v; b.writeUInt16BE(1, 2); b.writeUInt16BE(0x0400, 4); b.writeUInt16BE(0x0400, 6);
    b.writeUInt16BE(0x0200, 8); b.writeUInt16BE(0x0100, 14); b.write('990101', 18, 'latin1');
    return b;
}

test('a Z-machine header is recognised, a stray file is not', () => {
    assert.deepEqual(storyHeader(story(4, 3000)), { version: 4, release: 1, serial: '990101' });
    assert.equal(storyHeader(Buffer.alloc(3000)), null);
    assert.equal(storyHeader(story(9, 3000)), null);
    assert.equal(storyHeader(story(3, 100)), null);       // high memory begins past the end
});

test('the disk is the smallest format that holds the files', () => {
    assert.equal(formatFor(100e3), 'sssd8');
    assert.equal(formatFor(300e3), 'dsdd5');
    assert.equal(formatFor(500e3), 'hd4mb');
});

test('catalog addresses: a folder gets shelf.json, a .json stays', () => {
    assert.equal(Shelf.catalogUrl('https://h/g', 'https://app/'), 'https://h/g/shelf.json');
    assert.equal(Shelf.catalogUrl('https://h/g/', 'https://app/'), 'https://h/g/shelf.json');
    assert.equal(Shelf.catalogUrl('https://h/g/list.json?x=1', 'https://app/'), 'https://h/g/list.json?x=1');
    assert.equal(Shelf.catalogUrl('/private/', 'https://app/x/'), 'https://app/private/shelf.json');
    assert.throws(() => Shelf.catalogUrl('  '));
});

test('a catalog is resolved against its own address and checked', () => {
    const list = Shelf.resolveCatalog([{ id: 'a', name: 'A', image: 'a.dsk', format: 'sssd8' }, { id: 'b', name: 'B', files: [{ name: 'X.COM' }], format: 'sssd8' }], 'https://h/g/shelf.json');
    assert.equal(list[0].image, 'https://h/g/a.dsk');
    assert.equal(list[1].files[0].path, 'https://h/g/X.COM');
    assert.equal(list[0].category, 'Private');
    assert.throws(() => Shelf.resolveCatalog([{ id: 'a' }], 'https://h/'));
    assert.throws(() => Shelf.resolveCatalog({}, 'https://h/'));
});

test('the tool builds a catalog; its disks play, served with a token', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drr-private-'));
    const src = path.join(tmp, 'src'), out = path.join(tmp, 'out');
    fs.mkdirSync(path.join(src, 'DISC'), { recursive: true });
    fs.writeFileSync(path.join(src, 'DISC', 'GAME3.DAT'), story(3, 20000));
    fs.writeFileSync(path.join(src, 'DISC', 'BIGGAME.DAT'), story(4, 250000));
    fs.writeFileSync(path.join(src, 'DISC', 'NOTES.DAT'), Buffer.alloc(5000));          // not a story
    fs.mkdirSync(path.join(src, 'disks', 'WordStar', '2'), { recursive: true });
    fs.writeFileSync(path.join(src, 'disks', 'WordStar', 'WS.COM'), Buffer.alloc(900, 5));
    fs.writeFileSync(path.join(src, 'disks', 'WordStar', 'My Doc.txt'), 'a\nb\n');
    fs.writeFileSync(path.join(src, 'disks', 'WordStar', '2', 'HELP.TXT'), 'help\n');
    fs.writeFileSync(path.join(src, 'disks', 'WordStar', 'INSIDE.DAT'), story(3, 20000));      // a story in a folder disk stays on it
    fs.writeFileSync(path.join(src, 'titles.json'), JSON.stringify({ 'game3.dat': { name: 'Game Three', category: 'Test' }, wordstar: { name: 'WordStar 4', category: 'Writing' } }));
    const entries = await build(src, out);
    assert.deepEqual(entries.map(e => [e.id, e.name, e.format, e.category]), [
        ['biggame', 'Biggame', 'dsdd5', 'Private'], ['game3', 'Game Three', 'sssd8', 'Test'], ['wordstar', 'WordStar 4', 'sssd8', 'Writing']]);
    assert.deepEqual(fs.readdirSync(out).filter(f => f.endsWith('.dsk')), []);                // no image is made
    const read = async p => new Uint8Array(fs.readFileSync(path.join(out, p)));
    const ws = new CpmFs(await Shelf.buildDisk(Shelf.resolveCatalog(entries, 'http://h/').find(e => e.id === 'wordstar'), async p => read(p.slice('http://h/'.length))));
    assert.deepEqual(ws.list().map(f => `${f.user}:${f.name}`).sort(), ['0:INSIDE.DAT', '0:MYDOC.TXT', '0:WS.COM', '2:HELP.TXT']);
    const files = new CpmFs(await Shelf.buildDisk(Shelf.resolveCatalog(entries, 'http://h/').find(e => e.id === 'biggame'), async p => read(p.slice('http://h/'.length))));
    assert.ok(files.find('BIGGAME.Z4') && files.find('PLAY.COM') && files.find('VEZZA.COM'));

    const srv = server(out, { token: 's3cret' });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${srv.address().port}/`;
    const get = (p, auth) => new Promise((resolve, reject) => http.get(base + p, { headers: auth ? { Authorization: 'Bearer ' + auth } : {} }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks), cors: res.headers['access-control-allow-origin'] }));
    }).on('error', reject));
    try {
        assert.equal((await get('shelf.json')).status, 401);
        assert.equal((await get('shelf.json', 'wrong')).status, 401);
        assert.equal((await get('../secret', 's3cret')).status, 404);
        const cat = await get('shelf.json', 's3cret');
        assert.equal(cat.status, 200);
        assert.equal(cat.cors, '*');
        const list = Shelf.resolveCatalog(JSON.parse(cat.body), base + 'shelf.json');
        const entry = list.find(e => e.id === 'game3');
        const disk = await Shelf.buildDisk(entry, async p => new Uint8Array((await get(p.slice(base.length), 's3cret')).body));
        const m = new Machine();
        m.out = '';
        m.console.output = b => { m.out += String.fromCharCode(b); };
        m.fdc.mount(0, Disk.fromImage(new Uint8Array(fs.readFileSync(path.join(ROOT, 'disks/cpm22.dsk')))));
        m.fdc.mount(2, disk);
        m.reset();
        const settle = () => { for (let i = 0; i < 40000; i++) { m.run(200000); if (m.waiting) return; } };
        settle();
        m.console.paste('C:\r'); settle();
        m.out = ''; m.console.paste('PLAY\r'); settle();
        assert.match(m.out, /Vezza - Release/);              // PLAY ran VEZZA GAME3.Z3 on a catalog disk
    } finally { srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
