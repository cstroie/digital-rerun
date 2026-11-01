#!/usr/bin/env node
/*
 * private-shelf.js: build a private catalog from software you may not share.
 *
 *   node tools/private-shelf.js <sources> <out> [--category=<name>] [--vezza=<VEZZA.COM>]
 *
 * Every Z-machine story file found under <sources> (.z1-.z8, or the .dat
 * files of the DOS releases: recognised by their header) becomes a game
 * disk of <out>/<id>/: the story, VEZZA.COM, its licence, PLAY.COM and a
 * README.TXT, as the shelf's own game disks. <out>/shelf.json lists them
 * in the shelf's format; no disk image is made, the app builds the disk
 * from those files when it is inserted, as for the public shelf. Put <out> on your own web server (docs/private-shelf.md)
 * and give the app its address: nothing of it is kept in the repository.
 *
 * Every folder inside <sources>/disks/, and every folder one level down in any
 * other folder of <sources> (OFFICE/WS40) that holds no story and is named in titles.json, becomes one disk of its files, as the
 * app's FROM FOLDER does (js/folderdisk.js): the files in it go to user 0,
 * subfolders named 1 to 15 to those user areas, names are made 8.3, and the
 * smallest disk format that holds it is used. For software that is no story
 * (WordStar, a compiler …). Story files inside disks/ stay on that disk.
 *
 * <sources>/titles.json (optional) names them:
 *   { "zork1.dat": { "name": "Zork I", "description": "…", "category": "…" },
 *     "wordstar":  { "name": "WordStar 4", "credit": "…", "licence": "public domain" } }
 * (name, description, category, credit and licence are all optional; the licence
 * is "private" unless given.)
 * keyed by the story's file name, or the folder's name, lower case. Without
 * it a name is made from the file name. Nothing is read from the story's text.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { playCom } = require('./play.js');
const { fromFolder } = require('../js/folderdisk.js');

const ROOT = path.join(__dirname, '..');
const STORY = /\.(z[1-8]|dat)$/i;

/** The header of a Z-machine story, or null when the bytes are not one. */
function storyHeader(b) {
    if (b.length < 64 || b[0] < 1 || b[0] > 8) return null;
    const w = i => (b[i] << 8) | b[i + 1];
    const high = w(4), pc = w(6), stat = w(14);
    if (high < 64 || high > b.length || stat < 64 || stat > b.length) return null;
    if (b[0] !== 6 && b[0] !== 7 && pc >= b.length) return null;
    return { version: b[0], release: w(2), serial: Buffer.from(b.subarray(18, 24)).toString('latin1') };
}

function* walk(dir, skip) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const p = path.join(dir, e.name);
        if (p === skip) continue;
        if (e.isDirectory()) yield* walk(p, skip);
        else if (e.isFile()) yield p;
    }
}

/** The smallest disk format that holds `bytes` of files with room to spare. */
function formatFor(bytes) {
    for (const [format, size] of [['sssd8', 240e3], ['dsdd5', 390e3]]) if (bytes + 16e3 <= size) return format;
    return 'hd4mb';
}

const humanize = s => s.toLowerCase().replace(/\.[^.]*$/, '').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

/** Every file under `dir`, for fromFolder: paths relative to it, with `/`. */
function folderItems(dir) {
    return [...walk(dir)].map(file => ({ path: path.relative(dir, file).split(path.sep).join('/'), read: async () => fs.readFileSync(file) }));
}

async function build(sources, out, { category = 'Private', vezza = path.join(ROOT, 'disks/shelf/zork2/VEZZA.COM'), vezzaLic = path.join(ROOT, 'disks/shelf/zork2/VEZZA.LIC') } = {}) {
    const titlesFile = path.join(sources, 'titles.json');
    const titles = fs.existsSync(titlesFile) ? JSON.parse(fs.readFileSync(titlesFile, 'utf8')) : {};
    fs.mkdirSync(out, { recursive: true });
    const vezzaCom = fs.readFileSync(vezza);
    const lic = fs.existsSync(vezzaLic) ? fs.readFileSync(vezzaLic) : null;
    const used = new Set();
    const entries = [];
    const disksDir = path.join(sources, 'disks');
    const seen = new Set();
    for (const file of walk(sources, disksDir)) {
        if (!STORY.test(file)) continue;
        if (path.relative(sources, file).split(path.sep).some(d => /^saves?$/i.test(d))) continue;   // saved games
        const bytes = fs.readFileSync(file);
        const head = storyHeader(bytes);
        if (!head) continue;
        const sum = require('crypto').createHash('sha1').update(bytes).digest('hex');
        if (seen.has(sum)) continue;                                                              // the same story twice
        seen.add(sum);
        const base = path.basename(file);
        const stem = path.basename(file, path.extname(file)).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'GAME';
        let id = stem;
        for (let n = 2; used.has(id); n++) id = stem.slice(0, 8 - String(n).length) + n;
        used.add(id);
        const story = `${id}.Z${head.version}`;
        const meta = titles[base.toLowerCase()] || {};
        const name = meta.name || humanize(base);
        const text = [
            name.toUpperCase(), '='.repeat(name.length), '',
            `Play it:      PLAY      (types VEZZA ${story} for you)`,
            'Save and restore inside the game with SAVE and RESTORE (give a file',
            'name). QUIT leaves the game.', '',
            `${story.padEnd(11)}the story, release ${head.release}, serial ${head.serial}, Z-machine version ${head.version}.`,
            'PLAY.COM   types the line above at the CP/M prompt.',
            'VEZZA.COM  Vezza by Shawn Sijnstra, GPL-2.0-or-later: see VEZZA.LIC.', ''
        ].join('\n');
        const files = [[story, bytes], ['VEZZA.COM', vezzaCom], ['PLAY.COM', playCom(`VEZZA ${story}`)], ['README.TXT', Buffer.from(text)]];
        if (lic) files.push(['VEZZA.LIC', lic]);
        const format = formatFor(files.reduce((t, [, d]) => t + d.length, 0));
        const dir = path.join(out, id.toLowerCase());
        fs.mkdirSync(dir, { recursive: true });
        for (const [n, d] of files) fs.writeFileSync(path.join(dir, n), d);
        entries.push({
            id: id.toLowerCase(), name, format, category: meta.category || category,
            description: meta.description || `Z-machine version ${head.version}, release ${head.release}. Type PLAY, or VEZZA ${story}.`,
            credit: meta.credit || '', licence: meta.licence || 'private',
            size: files.reduce((t, [, d]) => t + d.length, 0),
            files: files.map(([n]) => ({ name: n, path: `${id.toLowerCase()}/${n}` }))
        });
    }
    return buildFolders(sources, out, entries, titles, used, category).then(all => {
        all.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
        fs.writeFileSync(path.join(out, 'shelf.json'), JSON.stringify(all, null, 1) + '\n');
        return all;
    });
}

const subdirs = dir => fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));

/** True when a story file is somewhere under `dir`. */
const hasStory = dir => [...walk(dir)].some(f => STORY.test(f) && storyHeader(fs.readFileSync(f)));

/** The folders that make a disk each: those of <sources>/disks/, and those one
 *  level down in any other folder of <sources> (OFFICE/WS40) that hold no story
 *  and are named in titles.json. */
function diskFolders(sources, titles) {
    const found = [];
    const disksDir = path.join(sources, 'disks');
    if (fs.existsSync(disksDir)) for (const d of subdirs(disksDir)) found.push(path.join(disksDir, d.name));
    for (const group of subdirs(sources)) {
        if (group.name === 'disks' || /^saves?$/i.test(group.name)) continue;
        for (const d of subdirs(path.join(sources, group.name))) {
            const folder = path.join(sources, group.name, d.name);
            if (titles[d.name.toLowerCase()] && !/^saves?$/i.test(d.name) && !hasStory(folder)) found.push(folder);
        }
    }
    return found;
}

/** The folders of diskFolders(), one disk each, added to `entries`. */
async function buildFolders(sources, out, entries, titles, used, category) {
    for (const folder of diskFolders(sources, titles)) {
        const dir = { name: path.basename(folder) };
        const meta = titles[dir.name.toLowerCase()] || {};
        const name = meta.name || humanize(dir.name);
        const r = await fromFolder(folderItems(folder), name);
        let id = dir.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'disk';
        for (let n = 2; used.has(id.toUpperCase()); n++) id = `${id.replace(/-\d+$/, '')}-${n}`;
        used.add(id.toUpperCase());
        // The files themselves, under their disk names; the page builds the disk when it is inserted.
        const dest = path.join(out, id);
        const files = [];
        for (const p of r.plan) {
            const rel = `${p.user ? p.user + '/' : ''}${p.name}`;
            fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
            fs.copyFileSync(path.join(folder, ...p.path.split('/')), path.join(dest, rel));
            files.push({ name: p.name, path: `${id}/${rel}`, ...(p.user ? { user: p.user } : {}) });
        }
        entries.push({
            id, name, format: r.format, category: meta.category || category,
            description: meta.description || `${r.files} file${r.files === 1 ? '' : 's'} from a folder.`,
            credit: meta.credit || '', licence: meta.licence || 'private',
            size: files.reduce((t, f) => t + fs.statSync(path.join(out, f.path)).size, 0), files
        });
        if (r.renamed.length) console.log(`  ${dir.name}: ${r.renamed.length} name${r.renamed.length === 1 ? '' : 's'} made 8.3`);
        for (const [file, why] of r.skipped) console.log(`  ${dir.name}: ${file} left out (${why})`);
    }
    return entries;
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const opt = k => (args.find(a => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || undefined;
    const [sources, out] = args.filter(a => !a.startsWith('--'));
    if (!sources || !out) {
        console.error('usage: node tools/private-shelf.js <sources> <out> [--category=<name>] [--vezza=<VEZZA.COM>]');
        process.exit(2);
    }
    console.log(`private shelf: reading ${sources}, writing ${out}`);
    build(sources, out, { category: opt('category'), vezza: opt('vezza') }).then(entries => {
        for (const e of entries) console.log(`  ${e.id}: ${e.name} (${e.format}, ${e.size >> 10}K)`);
        console.log(`${entries.length} disk${entries.length === 1 ? '' : 's'} and shelf.json written`);
    }, e => { console.error(e.message); process.exit(1); });
}

module.exports = { build, storyHeader, formatFor };
