/*
 * terminal.js: an 80x24 terminal for the console, a VT100 (subset), a
 * VT52 or an ADM-3A (mode 'vt100' | 'vt52' | 'adm3a', switchable at any
 * time).
 *
 * Terminal holds the screen as cells and interprets the bytes the
 * machine sends; TerminalView draws it into an element. They are apart
 * so the parser can be tested without a browser.
 *
 * Understood:
 *   C0      BEL BS HT LF VT FF CR, ESC; CAN/SUB cancel a sequence
 *   ESC     7 8 (save/restore cursor), D (index), M (reverse index),
 *           E (next line), c (reset), = > (keypad, ignored),
 *           ( ) charset (ignored), # 8 (screen of E)
 *   CSI     A B C D (move), H f (position), J K (erase; K's blanks keep reverse
 *           video, so a bar of reverse text and spaces stays one bar), m (bold, dim,
 *           underline, blink, reverse), r (scroll region), s u (save,
 *           restore), L M (insert, delete lines), @ P (insert, delete
 *           characters), X (erase characters), n (status/cursor report),
 *           c (device attributes), h l (?7 wrap, ?25 cursor, 4 insert)
 *
 * VT52 mode:
 *   C0      BEL BS HT LF CR; no autowrap: the 80th column is overwritten
 *   ESC     A B C D (move, stopping at the edges), H (home), I (reverse
 *           line feed, scrolls down at the top), J K (erase to end of
 *           screen, of line), Y row+32 col+32 (cursor address), Z (identify:
 *           answers ESC / Z), < (enter ANSI mode: the terminal becomes a
 *           VT100); F G (graphics set) and = > (keypad) are ignored
 *   and the cursor codes of VT52-like terminals (the VT52 itself has
 *   none): f e (off, on: Atari ST), x 5 / y 5 (off, on: Heath H19)
 *
 * ADM-3A mode:
 *   C0      BEL, BS (left), LF (down, scrolls), VT (up), FF (right),
 *           CR, SUB (clear and home), RS (home), ESC
 *   ESC =   row+32 col+32: cursor address
 *   and the extensions later ADM-compatible terminals added, which CP/M
 *   programs installed for them send:
 *   ESC T t (erase to end of line), Y y (to end of screen), * : + ;
 *   (clear), E (insert line), R (delete line), Q (insert character),
 *   W (delete character), ) ( (half intensity on, off), G n (attribute
 *   n: 2 blink, 4 reverse, 8 underline, 0 off), B n / C n (attribute on /
 *   off: 0 reverse, 1 half intensity, 2 blink, 3 underline, 4 cursor),
 *   . n (TeleVideo cursor: 0 invisible, 1-4 a visible shape)
 */
(function (root) {
    'use strict';

    const BOLD = 1, UNDERLINE = 2, BLINK = 4, REVERSE = 8, DIM = 16;

    class Terminal {
        constructor(cols = 80, rows = 24, mode = 'vt100') {
            this.cols = cols;
            this.rows = rows;
            /** 'vt100', 'vt52' or 'adm3a': which codes the terminal answers to. */
            this.mode = mode;
            /** Called with an array of bytes to send back (status reports). */
            this.reply = null;
            /** Called on BEL. */
            this.bell = null;
            this.reset();
        }

        reset() {
            this.chars = Array.from({ length: this.rows }, () => new Uint8Array(this.cols).fill(32));
            this.attrs = Array.from({ length: this.rows }, () => new Uint8Array(this.cols));
            this.dirty = new Set(Array.from({ length: this.rows }, (_, i) => i));
            this.x = 0;
            this.y = 0;
            this.attr = 0;
            this.top = 0;
            this.bottom = this.rows - 1;
            this.wrapPending = false;
            this.autowrap = true;
            this.insertMode = false;
            this.cursorVisible = true;
            this.saved = { x: 0, y: 0, attr: 0 };
            this.state = 'ground';
            this.params = '';
            this.tabs = new Set();
            for (let c = 8; c < this.cols; c += 8) this.tabs.add(c);
        }

        write(byte) {
            const b = byte & 0x7F;
            if (this.mode === 'adm3a') return this.writeAdm(b);
            if (this.mode === 'vt52') return this.writeVt52(b);
            if (this.state.startsWith('vt52') || this.state.startsWith('adm')) this.state = 'ground';   // left over from another mode
            if (b === 0x18 || b === 0x1A) { this.state = 'ground'; return; }
            if (b === 0x1B) { this.state = 'esc'; this.params = ''; return; }
            switch (this.state) {
                case 'esc': return this.escape(b);
                case 'csi': return this.csi(b);
                case 'charset': this.state = 'ground'; return;
                case 'hash':
                    this.state = 'ground';
                    if (b === 0x38) this.fill(69);
                    return;
            }
            if (b < 0x20) return this.control(b);
            if (b === 0x7F) return;
            this.print(b);
        }

        /* ---------- VT52 ---------- */

        writeVt52(b) {
            switch (this.state) {
                case 'vt52-esc': return this.vt52Escape(b);
                case 'vt52-row': this.admRow = b - 32; this.state = 'vt52-col'; return;
                case 'vt52-x': case 'vt52-y':                       // H19 set / reset mode: 5 is cursor off
                    if (b === 0x35) this.cursorVisible = this.state === 'vt52-y';
                    this.state = 'ground';
                    return;
                case 'vt52-col':
                    this.state = 'ground';
                    this.y = Math.max(0, Math.min(this.rows - 1, this.admRow));
                    this.x = Math.max(0, Math.min(this.cols - 1, b - 32));
                    this.dirty.add(this.y);
                    return;
            }
            if (this.state !== 'ground') this.state = 'ground';     // left over from another mode
            this.wrapPending = false;
            if (b === 0x1B) { this.state = 'vt52-esc'; return; }
            if (b >= 0x20 && b < 0x7F) {
                this.chars[this.y][this.x] = b;
                this.attrs[this.y][this.x] = this.attr;
                this.dirty.add(this.y);
                if (this.x < this.cols - 1) this.x++;               // no wrap: the last column is overwritten
                return;
            }
            switch (b) {
                case 0x07: if (this.bell) this.bell(); break;
                case 0x08: if (this.x > 0) this.x--; break;
                case 0x09: this.control(b); break;
                case 0x0A: this.lineFeed(); break;
                case 0x0D: this.x = 0; break;
            }
            this.dirty.add(this.y);
        }

        vt52Escape(b) {
            this.state = 'ground';
            switch (String.fromCharCode(b)) {
                case 'A': if (this.y > 0) this.y--; break;
                case 'B': if (this.y < this.rows - 1) this.y++; break;
                case 'C': if (this.x < this.cols - 1) this.x++; break;
                case 'D': if (this.x > 0) this.x--; break;
                case 'H': this.x = 0; this.y = 0; break;
                case 'I': this.y === 0 ? this.scrollDown(0, this.rows - 1, 1) : this.y--; break;
                case 'J':
                    this.erase(this.y, this.x, this.cols);
                    for (let r = this.y + 1; r < this.rows; r++) this.erase(r, 0, this.cols);
                    break;
                case 'K': this.erase(this.y, this.x, this.cols); break;
                case 'Y': this.state = 'vt52-row'; break;
                case 'Z': this.send('\x1b/Z'); break;
                case '<': this.mode = 'vt100'; break;
                case 'f': this.cursorVisible = false; break;      // Atari ST: cursor off
                case 'e': this.cursorVisible = true; break;       // and on
                case 'x': this.state = 'vt52-x'; break;           // Heath H19: set mode (x 5: cursor off)
                case 'y': this.state = 'vt52-y'; break;           // reset mode (y 5: cursor on)
                // F G (graphics), = > (keypad) and anything else: ignored
            }
            this.dirty.add(this.y);
        }

        /* ---------- ADM-3A ---------- */

        writeAdm(b) {
            switch (this.state) {
                case 'adm-esc': return this.admEscape(b);
                case 'adm-row': this.admRow = b - 32; this.state = 'adm-col'; return;
                case 'adm-col':
                    this.state = 'ground';
                    this.y = Math.max(0, Math.min(this.rows - 1, this.admRow));
                    this.x = Math.max(0, Math.min(this.cols - 1, b - 32));
                    this.dirty.add(this.y);
                    return;
                case 'adm-g': this.state = 'ground'; this.attr = this.admAttrG(b - 0x30); return;
                case 'adm-dot':                                     // TeleVideo: 0 invisible, 1-4 a shape
                    this.state = 'ground';
                    if (b >= 0x30 && b <= 0x34) this.cursorVisible = b !== 0x30;
                    return;
                case 'adm-on': case 'adm-off': {
                    const on = this.state === 'adm-on';
                    this.state = 'ground';
                    const bit = { 0x30: REVERSE, 0x31: DIM, 0x32: BLINK, 0x33: UNDERLINE }[b];
                    if (bit) this.attr = on ? this.attr | bit : this.attr & ~bit;
                    else if (b === 0x34) this.cursorVisible = on;
                    return;
                }
            }
            if (this.state !== 'ground') this.state = 'ground';     // left over from VT100 mode
            if (b >= 0x20 && b < 0x7F) return this.printAdm(b);
            switch (b) {
                case 0x07: if (this.bell) this.bell(); break;
                case 0x08: if (this.x > 0) this.x--; break;
                case 0x0A: this.lineFeed(); break;
                case 0x0B: if (this.y > 0) this.y--; break;
                case 0x0C: if (this.x < this.cols - 1) this.x++; break;
                case 0x0D: this.x = 0; break;
                case 0x1A: this.clearAll(); break;
                case 0x1E: this.x = 0; this.y = 0; break;
                case 0x1B: this.state = 'adm-esc'; break;
            }
            this.dirty.add(this.y);
        }

        /** The ADM-3A has no deferred wrap: the 80th character moves to the next line at once. */
        printAdm(b) {
            this.chars[this.y][this.x] = b;
            this.attrs[this.y][this.x] = this.attr;
            this.dirty.add(this.y);
            if (++this.x === this.cols) { this.x = 0; this.lineFeed(); }
        }

        admEscape(b) {
            this.state = 'ground';
            const ch = String.fromCharCode(b);
            switch (ch) {
                case '=': this.state = 'adm-row'; break;
                case 'T': case 't': this.erase(this.y, this.x, this.cols, this.attr & REVERSE); break;   // blanks keep reverse, as CSI K does
                case 'Y': case 'y':
                    this.erase(this.y, this.x, this.cols);
                    for (let r = this.y + 1; r < this.rows; r++) this.erase(r, 0, this.cols);
                    break;
                case '*': case ':': case '+': case ';': this.clearAll(); break;
                case 'E': this.scrollDown(this.y, this.rows - 1, 1); break;
                case 'R': this.scrollUp(this.y, this.rows - 1, 1); break;
                case 'Q':
                    this.chars[this.y].copyWithin(this.x + 1, this.x, this.cols - 1);
                    this.attrs[this.y].copyWithin(this.x + 1, this.x, this.cols - 1);
                    this.erase(this.y, this.x, this.x + 1);
                    break;
                case 'W':
                    this.chars[this.y].copyWithin(this.x, this.x + 1);
                    this.attrs[this.y].copyWithin(this.x, this.x + 1);
                    this.erase(this.y, this.cols - 1, this.cols);
                    break;
                case ')': this.attr |= DIM; break;
                case '(': this.attr &= ~DIM; break;
                case 'G': this.state = 'adm-g'; break;
                case 'B': this.state = 'adm-on'; break;
                case 'C': this.state = 'adm-off'; break;
                case '.': this.state = 'adm-dot'; break;
                // anything else: ignored, as a terminal without the feature would
            }
        }

        admAttrG(n) {
            let a = 0;
            if (n & 2) a |= BLINK;
            if (n & 4) a |= REVERSE;
            if (n & 8) a |= UNDERLINE;
            return a;
        }

        clearAll() {
            for (let r = 0; r < this.rows; r++) this.erase(r, 0, this.cols);
            this.x = 0;
            this.y = 0;
            this.attr = 0;
        }

        writeString(s) {
            for (const ch of s) this.write(ch.charCodeAt(0));
        }

        control(b) {
            switch (b) {
                case 0x07: if (this.bell) this.bell(); break;
                case 0x08: this.wrapPending = false; if (this.x > 0) this.x--; break;
                case 0x09: {
                    this.wrapPending = false;
                    let x = this.x + 1;
                    while (x < this.cols - 1 && !this.tabs.has(x)) x++;
                    this.x = Math.min(x, this.cols - 1);
                    break;
                }
                case 0x0A: case 0x0B: case 0x0C: this.lineFeed(); break;
                case 0x0D: this.wrapPending = false; this.x = 0; break;
            }
        }

        print(b) {
            if (this.wrapPending) {
                this.wrapPending = false;
                this.x = 0;
                this.lineFeed();
            }
            if (this.insertMode) {
                const row = this.chars[this.y], at = this.attrs[this.y];
                row.copyWithin(this.x + 1, this.x, this.cols - 1);
                at.copyWithin(this.x + 1, this.x, this.cols - 1);
            }
            this.chars[this.y][this.x] = b;
            this.attrs[this.y][this.x] = this.attr;
            this.dirty.add(this.y);
            if (this.x === this.cols - 1) {
                if (this.autowrap) this.wrapPending = true;
            } else this.x++;
        }

        lineFeed() {
            this.wrapPending = false;
            if (this.y === this.bottom) this.scrollUp(this.top, this.bottom, 1);
            else if (this.y < this.rows - 1) this.y++;
        }

        reverseIndex() {
            this.wrapPending = false;
            if (this.y === this.top) this.scrollDown(this.top, this.bottom, 1);
            else if (this.y > 0) this.y--;
        }

        blankRow() { return new Uint8Array(this.cols).fill(32); }

        scrollUp(top, bottom, n) {
            for (let i = 0; i < n; i++) {
                this.chars.splice(top, 1);
                this.attrs.splice(top, 1);
                this.chars.splice(bottom, 0, this.blankRow());
                this.attrs.splice(bottom, 0, new Uint8Array(this.cols));
            }
            for (let r = top; r <= bottom; r++) this.dirty.add(r);
        }

        scrollDown(top, bottom, n) {
            for (let i = 0; i < n; i++) {
                this.chars.splice(bottom, 1);
                this.attrs.splice(bottom, 1);
                this.chars.splice(top, 0, this.blankRow());
                this.attrs.splice(top, 0, new Uint8Array(this.cols));
            }
            for (let r = top; r <= bottom; r++) this.dirty.add(r);
        }

        /** `attr`: what the blanks carry (a line erase keeps reverse video, see CSI K). */
        erase(row, from, to, attr = 0) {
            this.chars[row].fill(32, from, to);
            this.attrs[row].fill(attr, from, to);
            this.dirty.add(row);
        }

        fill(ch) {
            for (let r = 0; r < this.rows; r++) { this.chars[r].fill(ch); this.attrs[r].fill(0); this.dirty.add(r); }
        }

        escape(b) {
            const ch = String.fromCharCode(b);
            this.state = 'ground';
            switch (ch) {
                case '[': this.state = 'csi'; this.params = ''; break;
                case '7': this.saved = { x: this.x, y: this.y, attr: this.attr }; break;
                case '8': ({ x: this.x, y: this.y, attr: this.attr } = this.saved); this.wrapPending = false; break;
                case 'D': this.lineFeed(); break;
                case 'M': this.reverseIndex(); break;
                case 'E': this.x = 0; this.lineFeed(); break;
                case 'c': this.reset(); break;
                case 'H': this.tabs.add(this.x); break;
                case '(': case ')': this.state = 'charset'; break;
                case '#': this.state = 'hash'; break;
                // '=' '>' keypad modes and anything else: ignored
            }
        }

        csi(b) {
            const ch = String.fromCharCode(b);
            if (b >= 0x20 && b < 0x40) { this.params += ch; return; }   // parameters and intermediates
            this.state = 'ground';
            const priv = this.params.startsWith('?');
            const list = (priv ? this.params.slice(1) : this.params).split(';').map(p => (p === '' ? NaN : parseInt(p, 10)));
            const p = (i, def) => (Number.isNaN(list[i]) || list[i] === undefined || list[i] === 0 ? def : list[i]);
            const clampY = y => Math.max(0, Math.min(this.rows - 1, y));
            const clampX = x => Math.max(0, Math.min(this.cols - 1, x));
            this.wrapPending = false;
            switch (ch) {
                case 'A': this.y = Math.max(this.y >= this.top ? this.top : 0, this.y - p(0, 1)); break;
                case 'B': this.y = Math.min(this.y <= this.bottom ? this.bottom : this.rows - 1, this.y + p(0, 1)); break;
                case 'C': this.x = clampX(this.x + p(0, 1)); break;
                case 'D': this.x = clampX(this.x - p(0, 1)); break;
                case 'H': case 'f': this.y = clampY(p(0, 1) - 1); this.x = clampX(p(1, 1) - 1); break;
                case 'J': {
                    const mode = Number.isNaN(list[0]) ? 0 : list[0];
                    if (mode === 0) { this.erase(this.y, this.x, this.cols); for (let r = this.y + 1; r < this.rows; r++) this.erase(r, 0, this.cols); }
                    else if (mode === 1) { this.erase(this.y, 0, this.x + 1); for (let r = 0; r < this.y; r++) this.erase(r, 0, this.cols); }
                    else for (let r = 0; r < this.rows; r++) this.erase(r, 0, this.cols);
                    break;
                }
                case 'K': {
                    const mode = Number.isNaN(list[0]) ? 0 : list[0];
                    const keep = this.attr & REVERSE;    // erased blanks stay reverse: a status bar is "reverse, text, erase to end of line"
                    if (mode === 0) this.erase(this.y, this.x, this.cols, keep);
                    else if (mode === 1) this.erase(this.y, 0, this.x + 1, keep);
                    else this.erase(this.y, 0, this.cols, keep);
                    break;
                }
                case 'm':
                    for (const v of list.length ? list : [0]) {
                        const n = Number.isNaN(v) ? 0 : v;
                        if (n === 0) this.attr = 0;
                        else if (n === 1) this.attr |= BOLD;
                        else if (n === 2) this.attr |= DIM;
                        else if (n === 4) this.attr |= UNDERLINE;
                        else if (n === 5) this.attr |= BLINK;
                        else if (n === 7) this.attr |= REVERSE;
                        else if (n === 22) this.attr &= ~(BOLD | DIM);
                        else if (n === 24) this.attr &= ~UNDERLINE;
                        else if (n === 25) this.attr &= ~BLINK;
                        else if (n === 27) this.attr &= ~REVERSE;
                    }
                    break;
                case 'r': {
                    const top = p(0, 1) - 1, bottom = p(1, this.rows) - 1;
                    if (top < bottom && bottom < this.rows) { this.top = top; this.bottom = bottom; }
                    this.x = 0; this.y = 0;
                    break;
                }
                case 's': this.saved = { x: this.x, y: this.y, attr: this.attr }; break;
                case 'u': ({ x: this.x, y: this.y, attr: this.attr } = this.saved); break;
                case 'L': if (this.y >= this.top && this.y <= this.bottom) this.scrollDown(this.y, this.bottom, Math.min(p(0, 1), this.bottom - this.y + 1)); break;
                case 'M': if (this.y >= this.top && this.y <= this.bottom) this.scrollUp(this.y, this.bottom, Math.min(p(0, 1), this.bottom - this.y + 1)); break;
                case '@': {
                    const n = Math.min(p(0, 1), this.cols - this.x);
                    this.chars[this.y].copyWithin(this.x + n, this.x, this.cols - n);
                    this.attrs[this.y].copyWithin(this.x + n, this.x, this.cols - n);
                    this.erase(this.y, this.x, this.x + n);
                    break;
                }
                case 'P': {
                    const n = Math.min(p(0, 1), this.cols - this.x);
                    this.chars[this.y].copyWithin(this.x, this.x + n);
                    this.attrs[this.y].copyWithin(this.x, this.x + n);
                    this.erase(this.y, this.cols - n, this.cols);
                    break;
                }
                case 'X': this.erase(this.y, this.x, Math.min(this.cols, this.x + p(0, 1))); break;
                case 'g':
                    if ((list[0] || 0) === 3) this.tabs.clear(); else this.tabs.delete(this.x);
                    break;
                case 'n':
                    if (list[0] === 5) this.send('\x1b[0n');
                    else if (list[0] === 6) this.send(`\x1b[${this.y + 1};${this.x + 1}R`);
                    break;
                case 'c': this.send('\x1b[?1;0c'); break;
                case 'h': case 'l': {
                    const on = ch === 'h';
                    for (const v of list) {
                        if (priv && v === 7) this.autowrap = on;
                        else if (priv && v === 25) this.cursorVisible = on;
                        else if (!priv && v === 4) this.insertMode = on;
                    }
                    break;
                }
            }
            this.dirty.add(this.y);
        }

        send(s) {
            if (this.reply) this.reply([...s].map(c => c.charCodeAt(0)));
        }

        getState() {
            return {
                cols: this.cols, rows: this.rows, mode: this.mode, admRow: this.admRow,
                chars: this.chars.map(r => r.slice()), attrs: this.attrs.map(r => r.slice()),
                x: this.x, y: this.y, attr: this.attr, top: this.top, bottom: this.bottom,
                wrapPending: this.wrapPending, autowrap: this.autowrap, insertMode: this.insertMode,
                cursorVisible: this.cursorVisible, saved: { ...this.saved },
                state: this.state, params: this.params, tabs: [...this.tabs]
            };
        }

        setState(s) {
            Object.assign(this, s, {
                chars: s.chars.map(r => r.slice()), attrs: s.attrs.map(r => r.slice()),
                saved: { ...s.saved }, tabs: new Set(s.tabs)
            });
            for (let r = 0; r < this.rows; r++) this.dirty.add(r);
        }

        /** The screen as text, one line per row (for tests). */
        text() {
            return this.chars.map(r => String.fromCharCode(...r).trimEnd()).join('\n');
        }
    }

    /** Draws a Terminal into `element`: one div per row, spans per attribute run. */
    class TerminalView {
        constructor(terminal, element) {
            this.term = terminal;
            this.el = element;
            this.el.textContent = '';
            this.lines = [];
            for (let r = 0; r < terminal.rows; r++) {
                const div = document.createElement('div');
                div.className = 'row';
                this.el.appendChild(div);
                this.lines.push(div);
            }
            this.cursorShown = null;
            this.terminal = terminal;
        }

        static escape(code) {
            if (code === 60) return '&lt;';
            if (code === 62) return '&gt;';
            if (code === 38) return '&amp;';
            if (code < 32 || code === 127) return ' ';
            return String.fromCharCode(code);
        }

        renderRow(r) {
            const t = this.term;
            const chars = t.chars[r], attrs = t.attrs[r];
            const cursorHere = t.cursorVisible && r === t.y;
            let html = '', run = '', runAttr = -1, runCursor = false;
            const flush = () => {
                if (!run) return;
                const cls = [];
                if (runAttr & BOLD) cls.push('b');
                if (runAttr & DIM) cls.push('d');
                if (runAttr & UNDERLINE) cls.push('u');
                if (runAttr & BLINK) cls.push('k');
                if (runAttr & REVERSE) cls.push('r');
                if (runCursor) cls.push('cur');
                html += cls.length ? `<span class="${cls.join(' ')}">${run}</span>` : run;
                run = '';
            };
            for (let c = 0; c < t.cols; c++) {
                const cur = cursorHere && c === t.x;
                if (attrs[c] !== runAttr || cur || runCursor) {
                    flush();
                    runAttr = attrs[c];
                    runCursor = cur;
                }
                run += TerminalView.escape(chars[c]);
            }
            flush();
            this.lines[r].innerHTML = html;
        }

        render() {
            const t = this.term;
            const cursor = `${t.x},${t.y},${t.cursorVisible}`;
            if (cursor !== this.cursorShown) {
                if (this.cursorShown) t.dirty.add(+this.cursorShown.split(',')[1]);
                t.dirty.add(t.y);
                this.cursorShown = cursor;
            }
            for (const r of t.dirty) if (r >= 0 && r < t.rows) this.renderRow(r);
            t.dirty.clear();
        }
    }

    const api = { Terminal, TerminalView, ATTR: { BOLD, UNDERLINE, BLINK, REVERSE, DIM } };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else Object.assign(root.DigitalRerun = root.DigitalRerun || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
