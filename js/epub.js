/*
 * epub.js: an EPUB book as plain text, with no library. An EPUB is a zip of
 * XHTML files; this reads the zip (stored or deflated entries), follows
 * META-INF/container.xml to the package file, and takes the chapters in the
 * order of its spine, with the tags stripped and the text wrapped to CP/M
 * width.
 *
 *   epubToText(bytes) -> Promise<{ title, text }>   text: paragraphs, LF ends, ASCII only
 *   unzip(bytes) -> Promise<Map<name, Uint8Array>>
 *   htmlToText(html) -> string
 *   toAscii(text), wrap(text, width) -> string
 *
 * Browsers inflate with DecompressionStream('deflate-raw'); Node (the tests)
 * with zlib. Nothing else is needed.
 */
(function (root) {
    'use strict';

    const node = typeof module !== 'undefined' && module.exports;
    const zlib = node ? require('zlib') : null;

    const u16 = (b, at) => b[at] | (b[at + 1] << 8);
    const u32 = (b, at) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16)) + b[at + 3] * 0x1000000;
    const text = b => new TextDecoder('utf-8').decode(b);

    /** Inflate a raw deflate stream (a zip entry). */
    async function inflateRaw(data) {
        if (zlib) return new Uint8Array(zlib.inflateRawSync(data));
        const out = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(out).arrayBuffer());
    }

    /** Every file of a zip, by its name. Only stored (0) and deflated (8) entries occur in books. */
    async function unzip(bytes) {
        const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        let eocd = -1;
        for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
            if (u32(b, i) === 0x06054b50) { eocd = i; break; }
        }
        if (eocd < 0) throw new Error('not a zip file');
        const count = u16(b, eocd + 10);
        let at = u32(b, eocd + 16);
        const files = new Map();
        for (let n = 0; n < count; n++) {
            if (u32(b, at) !== 0x02014b50) throw new Error('bad zip directory');
            const method = u16(b, at + 10), size = u32(b, at + 20);
            const nameLen = u16(b, at + 28), extraLen = u16(b, at + 30), commentLen = u16(b, at + 32);
            const local = u32(b, at + 42);
            const name = text(b.subarray(at + 46, at + 46 + nameLen));
            at += 46 + nameLen + extraLen + commentLen;
            if (name.endsWith('/')) continue;                            // a folder
            if (u32(b, local) !== 0x04034b50) throw new Error('bad zip entry');
            const start = local + 30 + u16(b, local + 26) + u16(b, local + 28);
            const data = b.subarray(start, start + size);
            if (method === 0) files.set(name, data.slice());
            else if (method === 8) files.set(name, await inflateRaw(data));
            else throw new Error(`zip method ${method} is not supported`);
        }
        return files;
    }

    /** The value of an attribute in a tag's text, or ''. */
    const attr = (tag, name) => { const m = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag); return m ? m[1] : ''; };

    /** A path inside the zip, joined to the folder of `base` and with ./ and ../ resolved. */
    function resolve(base, href) {
        const dir = base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : '';
        const parts = [];
        for (const p of decodeURIComponent(dir + href).split('/')) {
            if (p === '..') parts.pop(); else if (p !== '.' && p !== '') parts.push(p);
        }
        return parts.join('/');
    }

    const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', shy: '' };
    /** The accents of the Latin letters (eacute, Ouml ...): the letter and its combining mark, which toAscii folds to the letter. */
    const ACCENT = { acute: '\u0301', grave: '\u0300', circ: '\u0302', uml: '\u0308', tilde: '\u0303', cedil: '\u0327', ring: '\u030a', caron: '\u030c', slash: '' };
    const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
        if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
        const accent = /^([a-z])(acute|grave|circ|uml|tilde|cedil|ring|caron|slash)$/i.exec(e);
        if (accent) return accent[1] + ACCENT[accent[2].toLowerCase()];
        return e.toLowerCase() in NAMED ? NAMED[e.toLowerCase()] : m;
    });

    /** An XHTML chapter as paragraphs: the tags gone, the source's own line breaks as spaces. */
    function htmlToText(html) {
        let s = html.replace(/<\?xml[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>/gi, '')
            .replace(/<(script|style|head|svg)\b[\s\S]*?<\/\1\s*>/gi, '')
            .replace(/\s+/g, ' ')                                           // the source's layout means nothing
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/?(p|div|h[1-6]|li|tr|blockquote|section|article|header|footer|hr|ul|ol|table|title)\b[^>]*>/gi, '\n\n')
            .replace(/<[^>]+>/g, '');
        s = decode(s);
        return s.split(/\n{2,}/)
            .map(par => par.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n'))
            .filter(Boolean).join('\n\n');
    }

    /** Plain ASCII: the curly quotes and dashes as their plain forms, the rest of the accents as their letters. */
    function toAscii(s) {
        return String(s).normalize('NFKD')
            .replace(/[‘’‚]/g, "'").replace(/[“”„]/g, '"')
            .replace(/[–—]/g, '-').replace(/…/g, '...').replace(/ /g, ' ')
            .replace(/[^\x09\x0a\x20-\x7e]/g, '');
    }

    /** Paragraphs wrapped to `width` columns; a line that is already short (verse, a list) stays as it is. */
    function wrap(s, width = 78) {
        return s.split('\n').map(line => {
            if (line.length <= width) return line;
            const out = [];
            let cur = '';
            for (const w of line.split(' ')) {
                if (cur && cur.length + 1 + w.length > width) { out.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
            }
            if (cur) out.push(cur);
            return out.join('\n');
        }).join('\n');
    }

    /** The book: its title, and its chapters in reading order. */
    async function epubToText(bytes) {
        const files = await unzip(bytes);
        const get = name => {
            const f = files.get(name);
            if (!f) throw new Error(`the book has no ${name}`);
            return text(f);
        };
        const container = get('META-INF/container.xml');
        const rootfile = /<rootfile\b[^>]*>/i.exec(container);
        if (!rootfile) throw new Error('the book has no package file');
        const opfName = attr(rootfile[0], 'full-path');
        const opf = get(opfName);
        const title = (/<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/i.exec(opf) || [, ''])[1];
        const manifest = new Map();
        for (const item of opf.match(/<item\b[^>]*>/gi) || []) manifest.set(attr(item, 'id'), attr(item, 'href'));
        const chapters = [];
        for (const ref of opf.match(/<itemref\b[^>]*>/gi) || []) {
            const href = manifest.get(attr(ref, 'idref'));
            if (!href) continue;
            const file = files.get(resolve(opfName, href));
            if (!file) continue;
            const body = htmlToText(text(file));
            if (body) chapters.push(body);
        }
        if (!chapters.length) throw new Error('the book has no readable chapters');
        return { title: toAscii(decode(title)).trim(), text: wrap(toAscii(chapters.join('\n\n'))) };
    }

    const api = { epubToText, unzip, htmlToText, toAscii, wrap, decode };
    if (node) module.exports = api;
    else Object.assign(root.DigitalRerun = root.DigitalRerun || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
