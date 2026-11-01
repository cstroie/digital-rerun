/*
 * folderdisk.js: a disk made from a folder on this device (the software
 * you own but may not share: WordStar, MBASIC …). The files directly in the
 * folder go to user 0; a subfolder named 1 to 15 (or user1 to user15) goes
 * to that CP/M user area; anything else is left out and reported. Names
 * CP/M cannot hold are made into 8.3 ones; text files get CP/M line ends
 * as when files are dropped on a drive. The smallest of the 8", 5¼" 400K
 * and hard disk formats that holds it is used.
 */
(function (root) {
    'use strict';

    const node = typeof module !== 'undefined' && module.exports;
    const { Disk } = node ? require('./devices/fdc.js') : root.DigitalRerun;
    const { CpmFs, isTextFile, toCpmText } = node ? require('./cpmfs.js') : root.DigitalRerun;

    const FORMATS = ['sssd8', 'dsdd5', 'hd4mb'];
    const JUNK = /^(\.|thumbs\.db$|desktop\.ini$)/i;

    /** 'My Letter.text' -> 'MYLETTER.TEX': what CP/M can name. */
    function cpmName(fileName) {
        const clean = s => s.toUpperCase().replace(/[^\x21-\x7e]/g, '').replace(/[<>.,;:=?*[\]|()/\\"]/g, '');
        const i = fileName.lastIndexOf('.');
        const base = clean(i > 0 ? fileName.slice(0, i) : fileName).slice(0, 8) || 'FILE';
        const ext = clean(i > 0 ? fileName.slice(i + 1) : '').slice(0, 3);
        return ext ? `${base}.${ext}` : base;
    }

    /**
     * `items`: [{ path: 'WS.COM' | '2/NOTES.TXT', read: () => Promise<Uint8Array> }], paths relative
     * to the folder. Returns { disk, format, files, renamed: [[from, to]], skipped: [[path, why]],
     * plan: [{ user, name, path }] (what went where) }.
     */
    async function fromFolder(items, name) {
        const plan = [];
        const skipped = [];
        const renamed = [];
        const taken = new Set();
        for (const item of [...items].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
            const parts = item.path.split('/');
            const file = parts[parts.length - 1];
            if (JUNK.test(file)) continue;
            let user = 0;
            if (parts.length > 1) {
                const m = /^(?:user)?(\d{1,2})$/i.exec(parts[0]);
                if (parts.length > 2 || !m || Number(m[1]) < 1 || Number(m[1]) > 15) { skipped.push([item.path, 'in a subfolder that is not a user area (1 to 15)']); continue; }
                user = Number(m[1]);
            }
            let want = cpmName(file);
            let got = want;
            for (let n = 2; taken.has(`${user}:${got}`); n++) {
                const [b, e] = want.split('.');
                got = b.slice(0, 8 - String(n).length) + n + (e ? '.' + e : '');
            }
            taken.add(`${user}:${got}`);
            if (got !== file) renamed.push([item.path, got]);
            plan.push({ user, name: got, item });
        }
        if (!plan.length) throw new Error('the folder holds no file to put on a disk');
        const data = [];
        for (const p of plan) {
            let bytes = new Uint8Array(await p.item.read());
            if (isTextFile(p.name, bytes)) bytes = toCpmText(bytes);
            data.push(bytes);
        }
        let last;
        for (const format of FORMATS) {
            try {
                const disk = new Disk(format, null, { name });
                const fsys = new CpmFs(disk);
                plan.forEach((p, i) => fsys.write(p.name, data[i], p.user));
                disk.dirty = false;
                return { disk, format, files: plan.length, renamed, skipped, plan: plan.map(p => ({ user: p.user, name: p.name, path: p.item.path })) };
            } catch (e) { last = e; }              // too big or too many files: the next size
        }
        throw new Error(`it does not fit on any disk: ${last.message}`);
    }

    const api = { fromFolder, cpmName };
    if (node) module.exports = api;
    else (root.DigitalRerun = root.DigitalRerun || {}).FolderDisk = api;
})(typeof window !== 'undefined' ? window : globalThis);
