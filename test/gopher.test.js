'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Terminal } = require('../js/terminal.js');
const { CpmFs } = require('../js/cpmfs.js');
const { boot, until, settle, say, run, oneShot } = require('./net.js');

/** The screen as a VT100 shows it, row by row. */
function screen(m) {
    const t = new Terminal();
    t.writeString(m.out);
    return t.text().split('\n');
}
/** Run until the screen shows `text` on some row. */
async function shows(m, text, frames = 20000) {
    for (let i = 0; i < frames; i += 50) {
        await settle(m, 50);
        if (screen(m).some(r => r.includes(text))) return;
    }
    throw new Error(`the screen never showed ${JSON.stringify(text)}:\n${screen(m).join('\n')}`);
}

const MENU = [
    'iWelcome to the test hole\t\terror.host\t1',
    '1Software\t/software\tgopher.example\t70',
    '0About this place\t/about.txt\tgopher.example\t70',
    '7Search the hole\t/search\tgopher.example\t70',
    'hA web page\tURL:http://example.org/\tgopher.example\t70',
    '1Elsewhere\t/x\tother.example\t7070',
    '.'
].join('\r\n') + '\r\n';
const ABOUT = 'About this place\r\n\r\n\tIt is a test.\r\n' + 'y'.repeat(100) + '\r\n.\r\n';

function hole(asked) {
    return {
        'gopher.example:70': oneShot(sel => {
            if (sel === '' || sel === '/') return MENU;
            if (sel === '/about.txt') return ABOUT;
            if (sel === '/long.txt') return Array.from({ length: 50 }, (_, i) => `text line ${i + 1}`).join('\r\n') + '\r\n';
            if (sel.startsWith('/search\t')) return `0Found: ${sel.split('\t')[1]}\t/found\tgopher.example\t70\r\n.\r\n`;
            return '3Not here\t\terror.host\t1\r\n.\r\n';
        }, asked),
        'other.example:7070': oneShot(() => 'iThe other hole\t\terror.host\t1\r\n.\r\n', asked)
    };
}

test('GOPHER host: the menu, items numbered, the bar and the bottom row', async () => {
    const asked = [];
    const { m, dialed } = boot({ hosts: hole(asked) });
    await run(m, 'GOPHER gopher.example');
    await shows(m, 'Software/');
    const rows = screen(m);
    assert.match(rows[0], /^ GOPHER {2}gopher\.example\/1/);
    assert.equal(rows[1].trimEnd(), '      Welcome to the test hole');
    assert.equal(rows[2].trimEnd(), '   2  Software/');
    assert.equal(rows[3].trimEnd(), '   3  About this place');
    assert.equal(rows[4].trimEnd(), '   4  Search the hole <?>');
    assert.equal(rows[5].trimEnd(), '      A web page  (h)');
    assert.match(rows[23], /^\[1-6\/6\]/);
    assert.deepEqual(dialed, ['gopher.example:70']);
    assert.deepEqual(asked, ['']);
});

test('GOPHER: a number follows an item (a text, cut at 79 columns), B goes back, another port too', async () => {
    const asked = [];
    const { m, dialed } = boot({ hosts: hole(asked) });
    await run(m, 'GOPHER gopher.example');
    await shows(m, 'Software/');
    say(m, '3\r');
    await shows(m, 'It is a test.');
    let rows = screen(m);
    assert.match(rows[0], /gopher\.example\/0\/about\.txt/);
    assert.equal(rows[1].trimEnd(), 'About this place');
    assert.equal(rows[3].trimEnd(), '        It is a test.');
    assert.equal(rows[4], 'y'.repeat(79));
    assert.equal(rows[5].trimEnd(), 'y'.repeat(21));
    assert.ok(!rows.some(r => r.trim() === '.'), 'the dot at the end is not shown');
    say(m, 'b');
    await shows(m, 'Search the hole');
    say(m, '6\r');
    await shows(m, 'The other hole');
    assert.deepEqual(dialed, ['gopher.example:70', 'gopher.example:70', 'gopher.example:70', 'other.example:7070']);
    assert.deepEqual(asked.slice(0, 3), ['', '/about.txt', '']);
    say(m, '1\r');
    await shows(m, 'No such item.');
});

test('GOPHER: a search asks for the words and sends them after a tab', async () => {
    const asked = [];
    const { m } = boot({ hosts: hole(asked) });
    await run(m, 'GOPHER gopher.example');
    await shows(m, 'Software/');
    say(m, '4\r');
    await shows(m, 'Search for:');
    say(m, 'Retro Things\r');
    await shows(m, 'Found: Retro Things');
    assert.equal(asked[1], '/search\tRetro Things');
});

test('GOPHER: a long text a page at a time; G goes to an address typed; W saves the text', async () => {
    const asked = [];
    const { m } = boot({ hosts: hole(asked) });
    await run(m, 'GOPHER gopher.example');
    await shows(m, 'Software/');
    say(m, 'g');
    await shows(m, 'Go to');
    say(m, 'gopher://Gopher.Example/0/long.txt\r');
    await shows(m, 'text line 22');
    assert.ok(!screen(m).some(r => r.includes('text line 23')));
    assert.match(screen(m)[23], /^\[1-22\/50\]/);
    say(m, ' ');
    await shows(m, 'text line 44');
    assert.match(screen(m)[23], /^\[23-44\/50\]/);
    say(m, '-');
    await shows(m, '[1-22/50]');
    assert.equal(asked[1], '/long.txt', 'the selector keeps its case');
    say(m, 'w');
    await shows(m, 'Save as');
    say(m, 'long.txt\r');
    await shows(m, 'Saved.');
    const saved = Buffer.from(new CpmFs(m.fdc.drives[1]).read('LONG.TXT')).toString('latin1');
    assert.ok(saved.startsWith('text line 1\r\ntext line 2\r\n'), saved.slice(0, 40));
    assert.ok(saved.includes('text line 50\r\n\x1a'));
});

test('GOPHER alone: the home menu from GOPHER.DIR; Q leaves with the echo back on', async () => {
    const asked = [];
    const { m, dialed } = boot({ hosts: hole(asked), files: { 'GOPHER.DIR': 'gopher.example The test hole\r\nother.example:7070/1/x Another\r\n' } });
    await run(m, 'GOPHER');
    await shows(m, 'The test hole/');
    const rows = screen(m);
    assert.match(rows[0], /home \(GOPHER\.DIR\)/);
    assert.ok(rows.some(r => r.trimEnd() === '   3  The test hole/'), rows.join('\n'));
    assert.ok(rows.some(r => r.trimEnd() === '   4  Another/'), rows.join('\n'));
    say(m, '4\r');
    await shows(m, 'The other hole');
    assert.deepEqual(dialed, ['other.example:7070']);
    assert.deepEqual(asked, ['/x'], 'RFC 4266: the selector is what follows the type');
    say(m, 'b');
    await shows(m, 'The test hole/');
    say(m, 'q');
    await until(m, 'B>', m.out.length - 5);
    assert.equal(m.modem.line.echo, true);
});

test('GOPHER: no GOPHER.DIR, Floodgap; a host that does not answer says so and the page stays', async () => {
    const { m } = boot({ hosts: {} });
    await run(m, 'GOPHER');
    await shows(m, 'Floodgap/');
    say(m, '3\r');
    await shows(m, 'NO CARRIER');
    assert.ok(screen(m).some(r => r.includes('Floodgap/')));
});
