/*
 * vt.js: the board's screen furniture for a VT100: a title bar on row 1, a
 * status bar on row 24, the 22 rows between them a scroll region, so that what
 * scrolls never touches the bars. Pure strings: the BBS session sends them.
 *
 * A line is drawn the way a terminal draws one cheaply: reverse video on, the text,
 * "erase to end of line" (the blanks it leaves are reverse too, so it fills the
 * row), and only a short right-hand text positioned over the end: not eighty spaces
 * sent down a 1200 baud line.
 *
 *   frame({ title, titleRight, status, statusRight })   clear the screen, draw both bars,
 *                                                       set the region, cursor to its top
 *   statusBar(left, right)    redraw the status bar only (cursor kept)
 *   bar(row, left, right)     a full-width reverse bar    rule(row, labels)  a bar with
 *                             texts at columns, [[col, text], ...]
 *   at(row, col)  forward(n)  big(text)  RESET
 *
 * ASCII only: no line-drawing set, no colour. Every line stays within 79 columns.
 */
(function (root) {
    'use strict';

    const ESC = '\x1b';
    const BOLD = `${ESC}[1m`, DIM = `${ESC}[2m`, REV = `${ESC}[7m`, OFF = `${ESC}[0m`;
    const WIDTH = 80, TOP = 2, BOTTOM = 23;

    const at = (row, col = 1) => `${ESC}[${row};${col}H`;

    /** `n` columns to the right (a few bytes, where an absolute move would be seven). */
    const forward = n => (n > 0 ? `${ESC}[${n}C` : '');

    /** A reverse bar across the row: `left` from column 1, `right` ending at column 80; the rest by "erase to end of line". */
    function bar(row, left = '', right = '') {
        const r = right.slice(0, Math.max(0, WIDTH - 2));
        const l = left.slice(0, Math.max(0, WIDTH - r.length - (r ? 1 : 0)));
        return `${at(row, 1)}${REV}${l}${ESC}[K${r ? at(row, WIDTH - r.length + 1) + r : ''}${OFF}`;
    }

    /** A reverse bar with labels at columns: rule(3, [[3, 'MAIN'], [47, 'SYSTEM']]): filled by erase-to-end-of-line, then the labels written over it. */
    const rule = (row, labels) => `${at(row, 1)}${REV}${ESC}[K${labels.map(([col, text]) => at(row, col) + text).join('')}${OFF}`;

    /** A new page: both bars, the region between them, the cursor at its top. */
    function frame({ title = '', titleRight = '', status = '', statusRight = '' } = {}) {
        return `${ESC}[r${ESC}[0m${ESC}[?25h${ESC}[2J` + bar(1, title, titleRight) + bar(24, status, statusRight) + `${ESC}[${TOP};${BOTTOM}r` + at(TOP, 1);
    }

    /** The status bar again, the cursor where it was (save, draw, restore). */
    const statusBar = (left, right) => `${ESC}7${bar(24, left, right)}${ESC}8`;

    /** Back to a plain terminal: no region, no attributes, the cursor shown and at the bottom. */
    const RESET = `${ESC}[r${ESC}[0m${ESC}[?25h${at(24, 1)}`;

    /* ---- big digits, 3 by 5, for the clock ---- */

    const GLYPHS = {
        '0': ['###', '# #', '# #', '# #', '###'], '1': [' ##', '  #', '  #', '  #', '  #'], '2': ['###', '  #', '###', '#  ', '###'],
        '3': ['###', '  #', '###', '  #', '###'], '4': ['# #', '# #', '###', '  #', '  #'], '5': ['###', '#  ', '###', '  #', '###'],
        '6': ['###', '#  ', '###', '# #', '###'], '7': ['###', '  #', '  #', '  #', '  #'], '8': ['###', '# #', '###', '# #', '###'],
        '9': ['###', '# #', '###', '  #', '###'], ':': [' ', '#', ' ', '#', ' '], ' ': ['  ', '  ', '  ', '  ', '  ']
    };

    /** Five lines of big characters for a string of digits, colons and spaces. */
    function big(text) {
        return Array.from({ length: 5 }, (_, row) => [...text].map(c => (GLYPHS[c] || GLYPHS[' '])[row]).join(' '));
    }

    const api = { ESC, BOLD, DIM, REV, OFF, WIDTH, TOP, BOTTOM, at, forward, bar, rule, frame, statusBar, RESET, big };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else Object.assign(root.DigitalRerun = root.DigitalRerun || {}, { vt: api });
})(typeof window !== 'undefined' ? window : globalThis);
