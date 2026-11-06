'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const E = require('../js/epub.js');

/** A zip of { name: [text, deflate?] }: local headers, the central directory, the end record. */
function zip(files) {
    const parts = [], central = [];
    let at = 0;
    for (const [name, [body, deflate]] of Object.entries(files)) {
        const raw = Buffer.from(body, 'utf8');
        const data = deflate ? zlib.deflateRawSync(raw) : raw;
        const method = deflate ? 8 : 0;
        const nameB = Buffer.from(name, 'utf8');
        const head = Buffer.alloc(30);
        head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(method, 8); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(raw.length, 22); head.writeUInt16LE(nameB.length, 26);
        parts.push(head, nameB, data);
        const dir = Buffer.alloc(46);
        dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(method, 10); dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(raw.length, 24);
        dir.writeUInt16LE(nameB.length, 28); dir.writeUInt32LE(at, 42);
        central.push(dir, nameB);
        at += 30 + nameB.length + data.length;
    }
    const cdBuf = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(at, 16);
    return new Uint8Array(Buffer.concat([...parts, cdBuf, end]));
}

const CONTAINER = '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
const OPF = `<?xml version="1.0"?><package><metadata><dc:title>The Moon &amp; Back</dc:title></metadata>
<manifest><item id="c1" href="text/one.xhtml"/><item id="c2" href="two%20b.xhtml"/><item id="css" href="s.css"/></manifest>
<spine><itemref idref="c2"/><itemref idref="c1"/></spine></package>`;
const ONE = '<?xml version="1.0"?><html><head><title>One</title><style>p{}</style></head><body><h1>Chapter One</h1><p>It was a  <i>bright</i> cold day,\n  and the clocks   struck.</p><p>Caf&eacute; &mdash; &#8220;quoted&#8221;&nbsp;here.<br/>Second line.</p><script>x()</script></body></html>';
const TWO = '<html><body><p>Chapter Two is in a folder: <a href="../text/one.xhtml">back</a>.</p></body></html>';

test('unzip: stored and deflated entries, by name', async () => {
    const files = await E.unzip(zip({ 'a.txt': ['hello', false], 'dir/b.txt': ['deflated text, deflated text', true] }));
    assert.equal(Buffer.from(files.get('a.txt')).toString(), 'hello');
    assert.equal(Buffer.from(files.get('dir/b.txt')).toString(), 'deflated text, deflated text');
    assert.equal(files.size, 2);
});

test('unzip: not a zip is said so', async () => {
    await assert.rejects(E.unzip(new Uint8Array(100)), /not a zip/);
});

test('an EPUB: the title, and the chapters in spine order, the folders resolved', async () => {
    const bytes = zip({
        'mimetype': ['application/epub+zip', false],
        'META-INF/container.xml': [CONTAINER, true],
        'OEBPS/content.opf': [OPF, true],
        'OEBPS/text/one.xhtml': [ONE, true],
        'OEBPS/two b.xhtml': [TWO, false],
        'OEBPS/s.css': ['p{}', false]
    });
    const book = await E.epubToText(bytes);
    assert.equal(book.title, 'The Moon & Back');
    const parts = book.text.split('\n\n');
    assert.equal(parts[0], 'Chapter Two is in a folder: back.');          // c2 is first in the spine
    assert.equal(parts[1], 'Chapter One');
    assert.match(book.text, /It was a bright cold day, and the clocks struck\./);
    assert.match(book.text, /Cafe - "quoted" here\.\nSecond line\./);      // accent folded, dash and quotes plain, br kept
    assert.ok(!/p\{\}|x\(\)|<|&/.test(book.text), 'no style, script, tags or entities left');
    assert.ok(/^[\x09\x0a\x20-\x7e]*$/.test(book.text), 'plain ASCII');
});

test('an EPUB with no package file, or no chapters, is said so', async () => {
    await assert.rejects(E.epubToText(zip({ 'x.txt': ['nothing', false] })), /no META-INF\/container\.xml/);
    const empty = zip({ 'META-INF/container.xml': [CONTAINER, false], 'OEBPS/content.opf': ['<package><manifest/><spine/></package>', false] });
    await assert.rejects(E.epubToText(empty), /no readable chapters/);
});

test('htmlToText: paragraphs by blank lines, breaks kept, the head and scripts gone', () => {
    assert.equal(E.htmlToText('<html><head><title>T</title></head><body><p>One</p>\n<p>Two<br/>three</p></body></html>'), 'One\n\nTwo\nthree');
    assert.equal(E.htmlToText('<div>a &lt;b&gt; &amp; c&#x21;</div>'), 'a <b> & c!');
});

test('toAscii and wrap: plain text at CP/M width, verse left as it is', () => {
    assert.equal(E.toAscii('“Naïve” — café…'), '"Naive" - cafe...');
    const long = Array.from({ length: 30 }, (_, i) => 'word' + i).join(' ');
    const wrapped = E.wrap(long, 40).split('\n');
    assert.ok(wrapped.every(l => l.length <= 40), 'no line over 40');
    assert.equal(wrapped.join(' '), long);
    assert.equal(E.wrap('a short line\nand another'), 'a short line\nand another');
});
