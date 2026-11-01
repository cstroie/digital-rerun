/*
 * shelf.js: the disk collection. A shelf entry is a prebuilt image
 * ({ image }) or a list of files ({ files: [{ name, path, user? }] }) put on a
 * fresh disk when it is inserted, so the repository holds no mostly empty
 * images. disks/shelf.json lists the shipped entries (tools/build.js
 * writes it); the owner's own disks live in the browser (Storage). A
 * private catalog is the same list served from the owner's own web server.
 */
(function (root) {
    'use strict';

    const node = typeof module !== 'undefined' && module.exports;
    const { Disk } = node ? require('./devices/fdc.js') : root.DigitalRerun;
    const { CpmFs, isTextFile, toCpmText } = node ? require('./cpmfs.js') : root.DigitalRerun;

    /** Is this file text on the disk (CP/M line ends and ^Z)? By name and content, or listed. */
    function isText(entry, name, bytes) {
        return (entry.text || []).includes(name) || isTextFile(name, bytes);
    }

    /**
     * Make the disk of a shelf entry. `fetchBytes(path)` returns a
     * Uint8Array (fetch in the page, readFileSync in Node).
     */
    async function buildDisk(entry, fetchBytes) {
        if (entry.image) {
            const bytes = await fetchBytes(entry.image);
            // 200K 5¼" disks come in two layouts of one size: a catalog says which
            return entry.format ? new Disk(entry.format, bytes, { name: entry.name }) : Disk.fromImage(bytes, { name: entry.name });
        }
        const disk = new Disk(entry.format, null, { name: entry.name });
        const fsys = new CpmFs(disk);
        const data = await Promise.all(entry.files.map(f => fetchBytes(f.path)));
        entry.files.forEach((f, i) => fsys.write(f.name, isText(entry, f.name, data[i]) ? toCpmText(data[i]) : data[i], f.user || 0));
        disk.dirty = false;
        return disk;
    }

    /** The address of a private catalog: a folder (shelf.json inside) or the .json itself. */
    function catalogUrl(input, base) {
        let s = String(input || '').trim();
        if (!s) throw new Error('enter the address of the catalog');
        if (!/\.json([?#]|$)/i.test(s)) s = s.replace(/[?#].*$/, '').replace(/\/*$/, '/') + 'shelf.json';
        return new URL(s, base || undefined).href;
    }

    /**
     * A private catalog's entries, ready for buildDisk: every path made
     * absolute against the catalog's own address, the category defaulted.
     */
    function resolveCatalog(list, url) {
        if (!Array.isArray(list)) throw new Error('the catalog is not a list of disks');
        return list.map(e => {
            if (!e || !e.id || !e.name || !(e.image || e.files)) throw new Error('a catalog entry needs id, name and image or files');
            const at = p => new URL(p, url).href;
            const out = { ...e, category: e.category || 'Private', credit: e.credit || '', description: e.description || '' };
            if (e.image) out.image = at(e.image);
            if (e.files) out.files = e.files.map(f => ({ ...f, path: at(f.path || f.name) }));
            return out;
        });
    }

    const api = { buildDisk, isText, catalogUrl, resolveCatalog };
    if (node) module.exports = api;
    else (root.DigitalRerun = root.DigitalRerun || {}).Shelf = api;
})(typeof window !== 'undefined' ? window : globalThis);
