/*
 * app.js: the page. Builds the machine, connects the terminal, the
 * printer and the drives, runs the CPU in animation-frame slices, and
 * keeps the disks in IndexedDB.
 */
(function () {
    'use strict';

    const { Machine, Disk, CpmFs, FORMATS, diskFromImage, ALTAIR_SIZE, altairFiles, Terminal, TerminalView, FX80, PaperView, Storage,
        isTextFile, looksText, toCpmText, fromCpmText, Hayes, Directory, bbs, StoredBoard, StoredFiles, SerialLine, Gateway, Sysop } = window.DigitalRerun;

    const $ = id => document.getElementById(id);
    const DRIVES = [0, 1, 2, 3, 8];                 // A: B: C: D: I:
    const LETTER = d => String.fromCharCode(65 + d);
    const FLOPPY = 'sssd8', HARD = 'hd4mb';
    const formatFor = d => (d === 8 ? HARD : FLOPPY);

    const machine = new Machine();
    const term = new Terminal(80, 24);
    const view = new TerminalView(term, $('screen'));
    const paper = new PaperView($('paper'));
    const printer = new FX80(paper);

    const sound = new window.DigitalRerun.Sound();
    machine.console.output = b => term.write(b);
    // the modem on ports 6 and 7 (TERM, ATDT): 0 is the echo service, 5550100 the bulletin board
    const directory = new Directory().add('5550100', bbs({
        now: () => new Date(),
        board: new StoredBoard(localStorage),
        files: new StoredFiles(localStorage),
        store: { get: k => localStorage.getItem('digitalrerun.bbs.' + k), set: (k, v) => localStorage.setItem('digitalrerun.bbs.' + k, v) },
        online: () => settings.online,
        sysop: new Sysop({ online: () => settings.online, config: () => ({ url: settings.sysopUrl, model: settings.sysopModel, key: settings.sysopKey }) }),
        fetchJson: url => fetch(url, { signal: AbortSignal.timeout(8000), referrerPolicy: 'no-referrer' }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    }));
    const hayes = new Hayes({ dial: directory.dial });
    machine.modem.attach(hayes);
    let serial = null;                       // a real modem on a serial port, when one is plugged in
    term.reply = bytes => machine.console.type(bytes);
    term.bell = () => { $('crt').animate([{ filter: 'brightness(1.8)' }, { filter: 'none' }], 120); sound.bell(); };
    let lineChars = 0;                       // characters struck since the last CR, for the sound
    machine.printer.output = b => {
        const inText = !printer.esc;
        printer.write(b);
        if (inText && (b & 0x7F) >= 0x20 && (b & 0x7F) < 0x7F) lineChars++;
        else if (inText && b === 0x0D) { sound.printLine(lineChars); lineChars = 0; }
        else if (inText && b === 0x0A) sound.feed(1);
        else if (inText && b === 0x0C) { sound.printLine(lineChars); lineChars = 0; sound.feed(20); }
        leds.prn = performance.now();
        paperOut();
    };

    /* ---------- settings ---------- */

    const settings = { speed: 4, terminal: 'vt100', arrows: 'wordstar', phosphor: 'green', tab: 'drives', resume: true, sound: true, online: false, baud: 1200, serialSignals: false, gateway: '', gatewayToken: '', sysopUrl: '', sysopModel: '', sysopKey: '' };

    function applySettings() {
        $('speed').value = String(settings.speed);
        $('terminal').value = settings.terminal;
        term.mode = settings.terminal;
        $('arrows').value = settings.arrows;
        $('phosphor').value = settings.phosphor;
        $('resume').checked = settings.resume;
        $('sound').checked = settings.sound;
        $('online').checked = settings.online;
        $('baud').value = String(settings.baud);
        machine.modem.baud = settings.baud;
        $('serialSignals').checked = settings.serialSignals;
        $('gateway').value = settings.gateway;
        $('gatewayToken').value = settings.gatewayToken;
        $('sysopUrl').value = settings.sysopUrl;
        $('sysopModel').value = settings.sysopModel;
        $('sysopKey').value = settings.sysopKey;
        directory.gateway = settings.gateway ? new Gateway({ url: settings.gateway, token: settings.gatewayToken }) : null;
        sound.enabled = settings.sound;
        machine.clock.hz = (settings.speed || 4) * 1000000;      // the machine's seconds follow its speed
        $('crt').classList.toggle('amber', settings.phosphor === 'amber');
        $('crt').classList.toggle('white', settings.phosphor === 'white');
    }

    /* ---------- tabs (phones: one panel at a time) ---------- */

    const phone = matchMedia('(max-width: 900px)');

    function showTab(name) {
        settings.tab = name;
        if (name === 'paper' && !phone.matches) name = 'drives';      // the desktop has no PAPER tab
        for (const b of document.querySelectorAll('#tabs [data-for]')) b.setAttribute('aria-selected', String(b.dataset.for === name));
        for (const el of document.querySelectorAll('[data-tab]')) el.classList.toggle('active', el.dataset.tab === name);
        if (name === 'paper') markSeen();
    }

    phone.addEventListener('change', () => { placeTray(); showTab(settings.tab); });

    $('tabs').addEventListener('click', e => {
        const b = e.target.closest('[data-for]');
        if (!b) return;
        showTab(b.dataset.for);
        Storage.set('settings', settings).catch(() => {});
    });

    /*
     * The paper: on a phone it is the PAPER tab, after the side panels; on a
     * desktop a drawer over the screen. While printing with the drawer shut
     * it stays shut: the PRN led lights and the PAPER button counts the sheets
     * not seen yet.
     */
    let seenSheets = 0, headPending = false;
    const drawerOpen = () => $('tray').classList.contains('open');

    function placeTray() {
        const tray = $('tray');
        if (phone.matches) {
            tray.classList.remove('open');
            document.querySelector('.layout').appendChild(tray);
        } else $('bay').appendChild(tray);
        $('paperBtn').setAttribute('aria-pressed', 'false');
    }

    function countUnseen() {
        const sheets = paper.printed().length;
        const n = Math.max(0, sheets - seenSheets);
        $('paper-badge').textContent = n || '';
        $('paper-badge').hidden = !n;
    }

    function markSeen() { seenSheets = paper.printed().length; countUnseen(); }

    /** Scroll the paper so the print head's line is in view (near the top when the drawer is shut). */
    function showHead() {
        if (headPending) return;
        headPending = true;
        requestAnimationFrame(() => {
            headPending = false;
            const box = $('paper');
            const i = Math.floor(printer.y / paper.pageLength) - paper.first;
            const s = paper.sheets[Math.min(Math.max(i, 0), paper.sheets.length - 1)];
            if (!s) return;
            const frac = (printer.y - Math.floor(printer.y / paper.pageLength) * paper.pageLength) / paper.pageLength;
            const y = s.canvas.offsetTop + frac * s.canvas.clientHeight;
            box.scrollTop = Math.max(0, y - (drawerOpen() ? box.clientHeight * 0.6 : 36));
        });
    }

    function openPaper(open) {
        if (open) paper.sheet(paper.first);                  // nothing printed yet: a clean sheet
        if (phone.matches) { showTab('paper'); $('tray').scrollIntoView({ block: 'start' }); markSeen(); return; }
        const tray = $('tray');
        tray.classList.toggle('open', open);
        $('paperBtn').setAttribute('aria-pressed', String(open));
        if (open) { markSeen(); $('paper').scrollTop = 0; } else focusScreen();   // the paper opens at its top; while it stays open, it follows the head
    }

    /** Paper came out of the printer. */
    function paperOut() {
        const tray = $('tray');
        if (tray.hidden || !tray.classList.contains('printed')) {
            tray.hidden = false;
            tray.classList.add('printed');
        }
        if (phone.matches) {
            if (settings.tab === 'paper') markSeen(); else countUnseen();
            return;
        }
        if (drawerOpen()) { markSeen(); showHead(); return; }
        countUnseen();
        showHead();
    }

    $('paperBtn').addEventListener('click', () => openPaper(phone.matches || !drawerOpen()));
    $('paperClose').addEventListener('click', () => openPaper(false));
    $('tray').addEventListener('click', e => {
        const b = e.target.closest('[data-paper]');
        if (b) $(b.dataset.paper).click();
    });

    for (const key of ['speed', 'terminal', 'arrows', 'phosphor']) {
        $(key).addEventListener('change', () => {
            settings[key] = key === 'speed' ? Number($(key).value) : $(key).value;
            // Terminal arrow keys follow the terminal; WordStar keys stay.
            if (key === 'terminal' && settings.arrows !== 'wordstar') settings.arrows = settings.terminal;
            applySettings();
            Storage.set('settings', settings).catch(() => {});
            focusScreen();
        });
    }

    /* ---------- LEDs ---------- */

    const leds = { disk: {}, prn: 0, busy: false };
    machine.fdc.onActivity = drive => {
        leds.disk[drive] = performance.now();
        sound.disk(drive, machine.fdc.track);
    };

    function updateLeds(now) {
        for (const d of DRIVES) {
            const on = now - (leds.disk[d] || 0) < 90;
            $('led-' + d).classList.toggle('on', on);
            const small = document.querySelector(`.drive[data-drive="${d}"] .led`);
            if (small) small.classList.toggle('on', on);
        }
        $('led-prn').classList.toggle('on', now - leds.prn < 90);
        const running = machine.state === 'running';
        $('led-run').classList.toggle('on', running && leds.busy);
        $('led-run').classList.toggle('idle', running && !leds.busy);
    }

    /* ---------- drives ---------- */

    let selected = 0;
    const saveTimers = {};

    function persist(drive) {
        clearTimeout(saveTimers[drive]);
        saveTimers[drive] = setTimeout(() => {
            const disk = machine.fdc.drives[drive];
            if (disk) Storage.saveDisk(drive, disk).then(() => { disk.dirty = false; }).catch(() => {});
        }, 700);
    }
    machine.fdc.onWrite = drive => persist(drive);

    function mount(drive, disk, save = true) {
        machine.fdc.mount(drive, disk);
        if (save) persist(drive);
        renderDrives();
    }

    function eject(drive) {
        machine.fdc.eject(drive);
        Storage.removeDisk(drive).catch(() => {});
        renderDrives();
    }

    function download(name, bytes, type = 'application/octet-stream') {
        const url = URL.createObjectURL(new Blob([bytes], { type }));
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function note(text, ok = true) {
        const el = $('drive-note');
        el.textContent = text;
        el.style.color = ok ? '' : 'var(--err)';
        clearTimeout(note.timer);
        note.timer = setTimeout(() => { el.textContent = ''; }, 4000);
    }

    function pickFile(input, accept) {
        return new Promise(resolve => {
            input.accept = accept || '';
            input.value = '';
            input.onchange = () => resolve([...input.files]);
            input.click();
        });
    }

    async function loadImage(drive) {
        const [file] = await pickFile($('fileInput'), '.dsk,.img,.bin');
        if (!file) return;
        try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            if (bytes.length === ALTAIR_SIZE) { importAltair(drive, file.name, bytes); return; }
            const disk = diskFromImage(bytes, { name: file.name });
            if ((disk.format === HARD) !== (drive === 8)) throw new Error(`${LETTER(drive)}: takes ${drive === 8 ? 'a 4 MB hard disk' : 'a floppy: 8" or 5¼"'}`);
            mount(drive, disk);
            note(`${file.name} in ${LETTER(drive)}:`);
        } catch (e) { note(e.message, false); }
    }

    /** An AltairZ80 disk is no machine of ours: its files go onto the disk in the drive, or a new blank one. */
    function importAltair(drive, name, bytes) {
        const files = altairFiles(bytes);
        let disk = machine.fdc.drives[drive];
        const fresh = !disk;
        if (fresh) disk = new Disk(drive === 8 ? HARD : 'dsdd5', null, { name: name.replace(/\.[^.]*$/, '') });
        const fsys = new CpmFs(disk);
        let n = 0;
        const failed = [];
        for (const f of files) {
            try { fsys.write(f.name, f.data, f.user); n++; } catch (e) { failed.push(f.name); }
        }
        if (fresh) mount(drive, disk); else persist(drive);
        selected = drive;
        renderDrives();
        renderFiles();
        note(`${n} of ${files.length} files from ${name} on ${LETTER(drive)}:${failed.length ? `; no room for ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''} (try I:)` : ' press ^C'}`, !failed.length);
    }

    /** Write a system tracks image (loader + CCP + BDOS + BIOS, like system/cpm22.bin) onto a floppy. */
    async function writeSystem(drive) {
        const [file] = await pickFile($('fileInput'), '.bin,.sys,.img');
        if (!file) return;
        try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            new CpmFs(machine.fdc.drives[drive]).writeSystem(bytes);
            persist(drive);
            note(`system written to ${LETTER(drive)}:${drive === 0 ? ' press RESET' : ''}`);
        } catch (e) { note(e.message, false); }
    }

    async function newDisk(drive, ask = true) {
        let label = drive === 8 ? 'hard disk' : 'blank';
        if (ask) {
            const answer = prompt(`A label for the new disk in ${LETTER(drive)}:`, label);
            if (answer === null) return;                              // cancelled
            label = answer.trim().slice(0, 32) || label;
        }
        let format = formatFor(drive);
        if (ask && drive !== 8) {
            const floppies = Object.keys(FORMATS).filter(f => f !== HARD);
            const answer = prompt(`Format for ${LETTER(drive)}:\n${floppies.map((f, i) => `${i + 1}  ${FORMATS[f].name}${i ? '' : ' (bootable)'}`).join('\n')}`, '1');
            if (answer === null) return;
            format = floppies[Number(answer) - 1] || FLOPPY;
        }
        const disk = new Disk(format, null, { name: label });
        if (format === FLOPPY && machine.fdc.drives[0] && machine.fdc.drives[0].format === FLOPPY) {
            // make it bootable: a copy of A:'s system tracks
            new CpmFs(disk).writeSystem(new CpmFs(machine.fdc.drives[0]).readSystem());
        }
        mount(drive, disk);
        note(`new disk in ${LETTER(drive)}:`);
    }

    async function shippedDisk(file, name) {
        const res = await fetch(file);
        if (!res.ok) throw new Error(`${file}: ${res.status}`);
        return new Disk(FLOPPY, new Uint8Array(await res.arrayBuffer()), { name });
    }

    const systemDisk = () => shippedDisk('disks/cpm22.dsk', 'CP/M 2.2');

    function renderDrives() {
        const box = $('drives');
        box.textContent = '';
        for (const d of DRIVES) {
            const disk = machine.fdc.drives[d];
            const row = document.createElement('div');
            row.className = 'drive' + (d === selected ? ' sel' : '');
            row.dataset.drive = d;
            row.innerHTML = `<span class="led disk"><i></i></span><span class="letter">${LETTER(d)}:</span>` +
                `<span class="name${disk ? '' : ' empty'}"></span><span class="acts"></span>`;
            row.querySelector('.name').textContent = disk ? disk.name || '(disk)' : (d === 8 ? 'no hard disk' : 'empty');
            row.querySelector('.name').title = disk ? `${disk.name} (${FORMATS[disk.format].name})` : '';
            const acts = row.querySelector('.acts');
            const btn = (label, title, fn) => {
                const b = document.createElement('button');
                b.className = 'small';
                b.textContent = label;
                b.title = title;
                b.addEventListener('click', e => { e.stopPropagation(); fn(); });
                acts.appendChild(b);
            };
            btn('LOAD', 'Insert a disk image (.dsk)', () => loadImage(d));
            if (disk) {
                btn('SAVE', 'Download the disk image', () => download(`${(disk.name || LETTER(d)).replace(/[^\w.-]+/g, '_').replace(/\.dsk$/i, '')}.dsk`, disk.data));
                if (d !== 8) btn('SYS', 'Write a system tracks image (.bin, up to 6656 bytes: loader, CCP, BDOS, BIOS) onto this disk', () => writeSystem(d));
                btn('⏏', 'Eject', () => eject(d));
            } else btn('NEW', 'Insert a new, empty disk', () => newDisk(d));
            row.addEventListener('click', () => { selected = d; renderDrives(); });
            box.appendChild(row);
        }
        renderFiles();
        markInserted();
    }

    function renderFiles() {
        const box = $('files');
        box.textContent = '';
        const disk = machine.fdc.drives[selected];
        if (!disk) return;
        let fsys;
        try { fsys = new CpmFs(disk); } catch (e) { return; }
        const files = fsys.list().sort((a, b) => a.user - b.user || a.name.localeCompare(b.name));
        for (const f of files) {
            const a = document.createElement('a');
            const user = f.user ? `${f.user}/` : '';
            a.innerHTML = `<span></span><small>${Math.ceil(f.size / 1024)}K</small>`;
            a.firstChild.textContent = user + f.name;
            a.title = `${f.name}, user ${f.user}, ${f.records} records${f.system ? ', SYS' : ''}${f.readOnly ? ', R/O' : ''}: click to download`;
            a.addEventListener('click', () => {
                const data = fsys.read(f.name, f.user);
                if (isTextFile(f.name, data)) download(f.name, fromCpmText(data), 'text/plain');
                else download(f.name, data);
            });
            box.appendChild(a);
        }
        const free = document.createElement('div');
        free.className = 'free';
        free.textContent = `${files.length} file${files.length === 1 ? "" : "s"}, ${fsys.freeBytes() >> 10}K free on ${LETTER(selected)}:`;
        box.appendChild(free);
    }

    async function putFiles(fileList) {
        const disk = machine.fdc.drives[selected];
        if (!disk) { note(`no disk in ${LETTER(selected)}:`, false); return; }
        const fsys = new CpmFs(disk);
        let n = 0;
        for (const file of fileList) {
            try {
                let data = new Uint8Array(await file.arrayBuffer());
                if (isTextFile(file.name, data)) data = toCpmText(data);
                fsys.write(file.name, data);
                n++;
            } catch (e) { note(e.message, false); }
        }
        if (n) {
            persist(selected);
            renderFiles();
            note(`${n} file${n > 1 ? 's' : ''} on ${LETTER(selected)}: press ^C`);
        }
    }

    $('addFilesBtn').addEventListener('click', async () => {
        const files = await pickFile($('filesInput'));
        if (files.length) putFiles(files);
    });

    const panel = $('drives-panel');
    panel.addEventListener('dragover', e => { e.preventDefault(); panel.classList.add('drop'); });
    panel.addEventListener('dragleave', () => panel.classList.remove('drop'));
    panel.addEventListener('drop', e => {
        e.preventDefault();
        panel.classList.remove('drop');
        if (e.dataTransfer.files.length) putFiles([...e.dataTransfer.files]);
    });

    /* ---------- the shelf: disk collections ---------- */

    const { Shelf } = window.DigitalRerun;
    let shelf = [];
    const kindOf = format => (format === HARD ? '4 MB hard disk, goes into I:' : FORMATS[format].name);

    async function fetchBytes(path) {
        const res = await fetch(path);
        if (!res.ok) throw new Error(`${path}: ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
    }

    /* The private shelf: a catalog on the owner's own server. Its address and
       token are kept in this browser; its disks are fetched when inserted. */
    const PRIVATE_KEY = 'digitalrerun.private';
    let privateShelf = [];
    const privateConf = () => { try { return JSON.parse(localStorage.getItem(PRIVATE_KEY)) || {}; } catch (e) { return {}; } };
    const privateNote = (text, ok = true) => { const el = $('private-note'); el.textContent = text; el.style.color = ok ? '' : 'var(--err)'; };

    /** A fetch of the private server: no-store (neither the browser nor the service worker keeps it), the token as a bearer. */
    async function fetchPrivate(path, token) {
        const res = await fetch(path, { cache: 'no-store', headers: token ? { Authorization: 'Bearer ' + token } : {} });
        if (res.status === 401 || res.status === 403) throw new Error('the server wants a token, or refused this one');
        if (!res.ok) throw new Error(`${res.status} from the server`);
        return res;
    }

    async function connectPrivate(url, token) {
        privateNote('connecting…');
        try {
            const at = Shelf.catalogUrl(url, location.href);
            privateShelf = Shelf.resolveCatalog(await (await fetchPrivate(at, token)).json(), at);
            localStorage.setItem(PRIVATE_KEY, JSON.stringify({ url, token }));
            privateNote(`${privateShelf.length} disk${privateShelf.length === 1 ? '' : 's'}`);
        } catch (e) {
            privateShelf = [];
            // a network failure says nothing useful by itself: name the usual causes
            privateNote(e instanceof TypeError ? 'not reachable (address, https certificate or CORS)' : e.message, false);
        }
        renderPrivate();
    }

    function renderPrivate() {
        const box = $('privshelf');
        box.textContent = '';
        const { token } = privateConf();
        const floppy = LETTER(Number($('shelfDrive').value));
        for (const category of [...new Set(privateShelf.map(e => e.category))]) {
            const h = document.createElement('h3');
            h.textContent = category.toUpperCase();
            box.appendChild(h);
            for (const e of privateShelf.filter(x => x.category === category)) {
                const where = e.format === HARD ? 'I' : floppy;
                card(box, {
                    title: e.name, desc: e.description, meta: `${kindOf(e.format)}${e.credit ? ' · ' + e.credit : ''}`,
                    origin: `private:${e.id}`,
                    buttons: [[`INSERT IN ${where}:`, `Put a fresh copy in ${where}:`,
                        () => insertDisk(() => Shelf.buildDisk(e, async p => new Uint8Array(await (await fetchPrivate(p, token)).arrayBuffer())), e.name, e.format, `private:${e.id}`)]]
                });
            }
        }
        markInserted();
    }

    $('privateConnectBtn').addEventListener('click', () => connectPrivate($('privateUrl').value, $('privateToken').value.trim()));
    $('privateUrl').addEventListener('keydown', e => { if (e.key === 'Enter') $('privateConnectBtn').click(); });
    $('privateToken').addEventListener('keydown', e => { if (e.key === 'Enter') $('privateConnectBtn').click(); });
    $('privateForgetBtn').addEventListener('click', () => {
        localStorage.removeItem(PRIVATE_KEY);
        $('privateUrl').value = $('privateToken').value = '';
        privateShelf = [];
        privateNote('');
        renderPrivate();
    });

    /** Which drive a disk of this format goes into: I: for a hard disk, else the one chosen. */
    const targetFor = format => (format === HARD ? 8 : Number($('shelfDrive').value));

    async function insertDisk(make, label, format, origin) {
        const drive = targetFor(format);
        const old = machine.fdc.drives[drive];
        if (old && !confirm(`Replace "${old.name}" in ${LETTER(drive)}: with ${label}? Keep it on My disks first if you need it.`)) return;
        note(`inserting ${label}…`);
        try {
            const disk = await make();
            disk.name = label;
            disk.origin = origin;
            mount(drive, disk);
            selected = drive;
            renderDrives();
            note(`${label} in ${LETTER(drive)}: press ^C`);
            PWA.toast(`${label} is in ${LETTER(drive)}:. Press ^C at the prompt, then ${LETTER(drive)}: and DIR.`);
        } catch (e) { note(e.message, false); }
        focusScreen();
    }

    /** Mark the shelf cards whose disk is in a drive now (the disk remembers where it came from). */
    function markInserted() {
        const where = new Map();
        for (const d of DRIVES) {
            const disk = machine.fdc.drives[d];
            if (disk && disk.origin) where.set(disk.origin, [...(where.get(disk.origin) || []), LETTER(d) + ':']);
        }
        for (const el of document.querySelectorAll('.disk-card[data-origin]')) {
            const drives = where.get(el.dataset.origin);
            el.classList.toggle('in', !!drives);
            let tag = el.querySelector('.inside');
            if (!drives) { if (tag) tag.remove(); continue; }
            if (!tag) {
                tag = document.createElement('span');
                tag.className = 'inside';
                el.querySelector('.title').appendChild(tag);
            }
            tag.textContent = `in ${drives.join(' ')}`;
        }
    }

    function card(box, { title, desc, meta, buttons, origin }) {
        const el = document.createElement('div');
        el.className = 'disk-card';
        el.dataset.origin = origin;
        el.innerHTML = '<span class="title"></span><span class="acts"></span><span class="desc"></span><span class="meta"></span>';
        el.querySelector('.title').textContent = title;
        el.querySelector('.desc').textContent = desc;
        el.querySelector('.meta').textContent = meta;
        for (const [label, tip, fn] of buttons) {
            const b = document.createElement('button');
            b.className = 'small';
            b.textContent = label;
            b.title = tip;
            b.addEventListener('click', fn);
            el.querySelector('.acts').appendChild(b);
        }
        box.appendChild(el);
    }

    function renderShelf() {
        const box = $('shelf');
        box.textContent = '';
        const floppy = LETTER(Number($('shelfDrive').value));
        for (const category of [...new Set(shelf.map(e => e.category))]) {
            const h = document.createElement('h3');
            h.textContent = category.toUpperCase();
            box.appendChild(h);
            for (const e of shelf.filter(x => x.category === category)) {
                const where = e.format === HARD ? 'I' : floppy;
                card(box, {
                    title: e.name, desc: e.description, meta: `${kindOf(e.format)} · ${e.credit}`,
                    origin: `shelf:${e.id}`,
                    buttons: [[`INSERT IN ${where}:`, `Put a fresh copy in ${where}:`,
                        () => insertDisk(() => Shelf.buildDisk(e, fetchBytes), e.name, e.format, `shelf:${e.id}`)]]
                });
            }
        }
        markInserted();
    }

    async function renderMyDisks() {
        const box = $('mydisks');
        box.textContent = '';
        let list = [];
        try { list = await Storage.listMyDisks(); } catch (e) { /* no storage */ }
        if (!list.length) {
            const p = document.createElement('p');
            p.className = 'hint';
            p.textContent = 'None yet: KEEP A DISK puts a copy of a drive\'s disk here.';
            box.appendChild(p);
        }
        const floppy = LETTER(Number($('shelfDrive').value));
        for (const d of list) {
            const where = d.format === HARD ? 'I' : floppy;
            card(box, {
                title: d.name, desc: `Kept ${when(d.time)}`, meta: kindOf(d.format), origin: `my:${d.id}`,
                buttons: [
                    [`INSERT IN ${where}:`, `Put a copy in ${where}:`, () => insertDisk(async () => {
                        const rec = await Storage.getMyDisk(d.id);
                        return new Disk(rec.format, rec.data.slice(), { name: rec.name });
                    }, d.name, d.format, `my:${d.id}`)],
                    ['SAVE', 'Download the disk image', async () => {
                        const rec = await Storage.getMyDisk(d.id);
                        download(`${rec.name.replace(/[^\w.-]+/g, '_')}.dsk`, rec.data);
                    }],
                    ['✕', 'Remove it from My disks', () => {
                        if (confirm(`Remove "${d.name}" from My disks?`)) Storage.deleteMyDisk(d.id).then(renderMyDisks);
                    }]
                ]
            });
        }
        markInserted();
    }

    async function keepDisk(disk, name) {
        await Storage.saveMyDisk({ id: 'd' + Date.now(), name, format: disk.format, time: Date.now(), data: disk.data.slice() });
        renderMyDisks();
        PWA.toast(`"${name}" is on My disks.`);
    }

    $('keepDiskBtn').addEventListener('click', () => {
        const full = DRIVES.filter(d => machine.fdc.drives[d]);
        if (!full.length) { note('no disk in any drive', false); return; }
        const answer = prompt(`Keep the disk of which drive? (${full.map(LETTER).join(', ')})`, LETTER(full.includes(selected) ? selected : full[0]));
        if (answer === null) return;
        const drive = answer.trim().toUpperCase().charCodeAt(0) - 65;
        const disk = machine.fdc.drives[drive];
        if (!disk) { note(`no disk in ${answer.trim().toUpperCase()}:`, false); return; }
        const name = prompt('A name for it on My disks:', disk.name || LETTER(drive));
        if (name === null) return;
        keepDisk(disk, name.trim().slice(0, 40) || disk.name).catch(e => note(e.message, false));
    });
    $('importDiskBtn').addEventListener('click', async () => {
        const [file] = await pickFile($('fileInput'), '.dsk,.img,.bin');
        if (!file) return;
        try {
            const disk = diskFromImage(new Uint8Array(await file.arrayBuffer()), { name: file.name.replace(/\.[^.]*$/, '') });
            await keepDisk(disk, disk.name);
        } catch (e) { note(e.message, false); }
    });
    $('folderDiskBtn').addEventListener('click', async () => {
        const files = await pickFile($('folderInput'));
        if (!files.length) return;
        const folder = files[0].webkitRelativePath.split('/')[0] || 'Folder';
        try {
            const items = files.map(f => ({ path: f.webkitRelativePath.split('/').slice(1).join('/') || f.name, read: () => f.arrayBuffer() }));
            const r = await window.DigitalRerun.FolderDisk.fromFolder(items, folder);
            await keepDisk(r.disk, folder);
            const more = [r.renamed.length && `${r.renamed.length} renamed to fit CP/M`, r.skipped.length && `${r.skipped.length} left out (not in a user area folder)`].filter(Boolean);
            PWA.toast(`${r.files} file${r.files === 1 ? '' : 's'} on "${folder}" (${kindOf(r.format)})${more.length ? ': ' + more.join(', ') : ''}.`);
        } catch (e) { note(e.message, false); }
    });
    $('shelfDrive').addEventListener('change', () => { renderShelf(); renderPrivate(); renderMyDisks(); });

    async function loadShelf() {
        try {
            const res = await fetch('disks/shelf.json');
            shelf = await res.json();
            renderShelf();
        } catch (e) { $('shelf-note').textContent = 'not available offline yet'; }
        renderMyDisks();
        const conf = privateConf();
        if (conf.url) {            // a catalog connected before: ask again, quietly (it may be unreachable from here)
            $('privateUrl').value = conf.url;
            $('privateToken').value = conf.token || '';
            connectPrivate(conf.url, conf.token || '');
        }
    }

    /* ---------- debugger ---------- */

    const { Disz80 } = window.DigitalRerun;
    const h4 = v => v.toString(16).toUpperCase().padStart(4, '0');
    const h2 = v => v.toString(16).toUpperCase().padStart(2, '0');
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const readMem = a => machine.memory[a & 0xFFFF];
    const debugOpen = () => settings.tab === 'debug';
    const hexOf = id => { const v = parseInt($(id).value, 16); return Number.isNaN(v) ? null : v & 0xFFFF; };

    function renderDebug() {
        if (!debugOpen()) return;
        const s = machine.cpu.getState();
        const flag = (on, ch) => (on ? `<span class="on">${ch}</span>` : `<i>${ch}</i>`);
        const f = s.flags, fp = s.flags_prime;
        const F = o => (o.S << 7) | (o.Z << 6) | (o.Y << 5) | (o.H << 4) | (o.X << 3) | (o.P << 2) | (o.N << 1) | o.C;
        const pair = (hi, lo) => h4((hi << 8) | lo);
        $('dbg-regs').innerHTML =
            `PC <b>${h4(s.pc)}</b>  SP <b>${h4(s.sp)}</b>  IX ${h4(s.ix)}  IY ${h4(s.iy)}\n` +
            `AF <b>${pair(s.a, F(f))}</b>  BC <b>${pair(s.b, s.c)}</b>  DE <b>${pair(s.d, s.e)}</b>  HL <b>${pair(s.h, s.l)}</b>\n` +
            `AF'${pair(s.a_prime, F(fp))}  BC'${pair(s.b_prime, s.c_prime)}  DE'${pair(s.d_prime, s.e_prime)}  HL'${pair(s.h_prime, s.l_prime)}\n` +
            `${flag(f.S, 'S')}${flag(f.Z, 'Z')}${flag(f.Y, '5')}${flag(f.H, 'H')}${flag(f.X, '3')}${flag(f.P, 'P')}${flag(f.N, 'N')}${flag(f.C, 'C')}` +
            `  I ${h2(s.i)}  R ${h2(s.r)}  IM ${s.imode}  IFF ${s.iff1 ? 1 : 0}${s.halted ? '  HALT' : ''}`;
        let a = hexOf('dbg-at') ?? s.pc;
        const lines = [];
        for (let k = 0; k < 14; k++) {
            const ins = Disz80.disassemble(readMem, a);
            const bp = machine.breakpoints.has(a), here = a === s.pc;
            const bytes = ins.bytes.map(h2).join(' ').padEnd(12);
            lines.push(`<div data-addr="${a}" class="${here ? 'pc' : ''}${bp ? ' bp' : ''}"><u>${bp ? '●' : ' '}</u><u>${here ? '▶' : ' '}</u>${h4(a)}  ${bytes}${esc(ins.text)}</div>`);
            a = (a + ins.length) & 0xFFFF;
        }
        $('dbg-code').innerHTML = lines.join('');
        const m0 = hexOf('dbg-mem') ?? 0x100;
        const rows = [];
        for (let r = 0; r < 12; r++) {
            const at = (m0 + r * 8) & 0xFFFF;
            const b = [...Array(8)].map((_, k) => readMem(at + k));
            rows.push(`${h4(at)}  ${b.map(h2).join(' ')}  <b>${esc(b.map(c => (c >= 32 && c < 127 ? String.fromCharCode(c) : '.')).join(''))}</b>`);
        }
        $('dbg-memv').innerHTML = rows.join('\n');
        const st = machine.state;
        $('dbg-state').textContent = st === 'paused' ? `PAUSED AT ${h4(s.pc)}` : st.toUpperCase();
        $('dbgPause').textContent = st === 'paused' ? 'CONTINUE' : 'PAUSE';
        $('dbgStep').disabled = $('dbgOver').disabled = st !== 'paused';
    }

    machine.onBreak = pc => { showTab('debug'); renderDebug(); PWA.toast(`Breakpoint at ${h4(pc)}.`); };
    $('dbgPause').addEventListener('click', () => {
        if (machine.state === 'paused') machine.resume(); else machine.pause();
        renderDebug();
    });
    $('dbgStep').addEventListener('click', () => { machine.step(); view.render(); renderDebug(); });
    $('dbgOver').addEventListener('click', () => {
        const pc = machine.pc;
        if (Disz80.isCall(readMem, pc)) {
            // run until the instruction after the call: a breakpoint there, kept only for this
            const next = (pc + Disz80.disassemble(readMem, pc).length) & 0xFFFF;
            const had = machine.breakpoints.has(next);
            machine.breakpoints.add(next);
            const done = machine.onBreak;
            machine.onBreak = at => {
                machine.onBreak = done;
                if (!had) machine.breakpoints.delete(next);
                if (at !== next) done(at); else renderDebug();
            };
            machine.resume();
        } else machine.step();
        view.render();
        renderDebug();
    });
    $('dbgClear').addEventListener('click', () => { machine.breakpoints.clear(); renderDebug(); });
    $('dbg-code').addEventListener('click', e => {
        const line = e.target.closest('[data-addr]');
        if (!line) return;
        const a = Number(line.dataset.addr);
        if (machine.breakpoints.has(a)) machine.breakpoints.delete(a); else machine.breakpoints.add(a);
        renderDebug();
    });
    for (const id of ['dbg-at', 'dbg-mem']) $(id).addEventListener('input', renderDebug);
    let debugTick = 0;

    /* ---------- paper tape ---------- */

    function renderTape() {
        const r = machine.reader, p = machine.punch.bytes.length;
        $('tape-reader').textContent = r.tape.length ? `${r.name}, ${r.left} of ${r.tape.length} bytes left` : 'no tape';
        $('tape-punch').textContent = p ? `${p} bytes punched` : 'nothing yet';
    }
    let tapeDirty = false;
    machine.reader.onRead = machine.punch.onWrite = () => { tapeDirty = true; };

    $('tapeLoadBtn').addEventListener('click', async () => {
        const [file] = await pickFile($('fileInput'));
        if (!file) return;
        let bytes = new Uint8Array(await file.arrayBuffer());
        // Text gets CP/M line ends and ^Z; anything else is read as it is, then ^Z.
        if (isTextFile(file.name, bytes) || (file.type.startsWith('text/') && looksText(bytes))) bytes = toCpmText(bytes);
        else { const t = new Uint8Array(bytes.length + 1); t.set(bytes); t[bytes.length] = 0x1A; bytes = t; }
        machine.reader.load(bytes, file.name);
        renderTape();
        focusScreen();
    });
    $('tapeSaveBtn').addEventListener('click', () => {
        let bytes = Uint8Array.from(machine.punch.bytes);
        let a = 0, b = bytes.length;
        while (a < b && bytes[a] === 0) a++;                  // PIP's leader and trailer of nulls
        while (b > a && bytes[b - 1] === 0) b--;
        bytes = bytes.subarray(a, b);
        if (!bytes.length) { note('nothing punched yet', false); return; }
        const text = bytes.includes(0x1A) && bytes.subarray(0, bytes.indexOf(0x1A)).every(c => c >= 0x20 || c === 9 || c === 10 || c === 13 || c === 12);
        if (text) download('punched.txt', fromCpmText(bytes), 'text/plain');
        else download('punched.bin', bytes);
    });
    $('tapeClearBtn').addEventListener('click', () => { machine.punch.clear(); renderTape(); focusScreen(); });

    /* ---------- keyboard ---------- */

    const kbd = $('kbd');
    const ARROWS = {
        wordstar: { ArrowUp: [5], ArrowDown: [24], ArrowLeft: [19], ArrowRight: [4], PageUp: [18], PageDown: [3], Home: [17, 83], End: [17, 68], Delete: [7], Insert: [22] },
        vt100: { ArrowUp: [27, 91, 65], ArrowDown: [27, 91, 66], ArrowRight: [27, 91, 67], ArrowLeft: [27, 91, 68], Delete: [127] },
        vt52: { ArrowUp: [27, 65], ArrowDown: [27, 66], ArrowRight: [27, 67], ArrowLeft: [27, 68], Home: [27, 72], Delete: [127] },
        adm3a: { ArrowUp: [11], ArrowDown: [10], ArrowLeft: [8], ArrowRight: [12], Home: [30], Delete: [127] }
    };

    function keyBytes(e) {
        if (e.metaKey) return null;
        const map = ARROWS[settings.arrows];
        if (map[e.key]) return map[e.key];
        if (e.ctrlKey && !e.altKey) {
            if (e.key.length === 1) {
                const c = e.key.toUpperCase().charCodeAt(0);
                if (c >= 64 && c <= 95) return [c & 0x1F];
                if (e.key === ' ' || e.key === '2') return [0];
            }
            return null;
        }
        switch (e.key) {
            case 'Enter': return [13];
            case 'Backspace': return [8];
            case 'Tab': return [9];
            case 'Escape': return [27];
            case 'Delete': return [127];
        }
        if (e.key.length === 1 && !e.ctrlKey) {
            const c = e.key.charCodeAt(0);
            return c < 128 ? [c] : null;
        }
        return null;
    }

    function focusScreen() { kbd.focus({ preventScroll: true }); }

    /* The phone key row: CTRL holds for the next key; the buttons never take the focus,
       so the on-screen keyboard stays open. */
    let ctrlArmed = false;
    const armCtrl = on => { ctrlArmed = on; document.querySelector('#keyrow [data-key="ctrl"]').classList.toggle('on', on); };
    const ctrlOf = ch => { const c = ch.toUpperCase().charCodeAt(0); return c >= 64 && c <= 95 ? c & 0x1F : null; };
    const KEYROW = { Escape: [27], Tab: [9], 'ctrl-c': [3] };
    $('keyrow').addEventListener('pointerdown', e => e.preventDefault());
    $('keyrow').addEventListener('click', e => {
        const b = e.target.closest('[data-key]');
        if (!b) return;
        const key = b.dataset.key;
        if (key === 'ctrl') { armCtrl(!ctrlArmed); focusScreen(); return; }
        const bytes = KEYROW[key] || ARROWS[settings.arrows][key] || ARROWS.vt100[key];
        if (bytes) { machine.console.type(bytes); kick(); }
        armCtrl(false);
        focusScreen();
    });

    kbd.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V') && e.shiftKey) return;   // let paste happen
        if (ctrlArmed && e.key.length === 1 && ctrlOf(e.key) !== null) {
            e.preventDefault();
            machine.console.type([ctrlOf(e.key)]);
            armCtrl(false);
            kick();
            return;
        }
        const bytes = keyBytes(e);
        if (!bytes) return;
        e.preventDefault();
        machine.console.type(bytes);
        kick();
    });
    // Keys typed while something else on the page has the focus go to the machine too,
    // except into form fields, and Enter or Space on a button or link.
    document.addEventListener('keydown', e => {
        const t = e.target;
        if (t === kbd || e.defaultPrevented || e.metaKey || e.altKey) return;
        if (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
        if (['BUTTON', 'A', 'SUMMARY'].includes(t.tagName) && (e.key === 'Enter' || e.key === ' ')) return;
        if (e.key === 'Tab') return;                                   // keyboard navigation of the page
        if (e.ctrlKey && getSelection().toString()) return;            // copying a selection
        const bytes = keyBytes(e);
        if (!bytes) return;
        e.preventDefault();
        machine.console.type(bytes);
        kick();
        focusScreen();
    });

    // Mobile keyboards send text through input events.
    kbd.addEventListener('input', () => {
        if (kbd.value) {
            let text = kbd.value.replace(/\n/g, '\r');
            if (ctrlArmed && ctrlOf(text[0]) !== null) {
                machine.console.type([ctrlOf(text[0])]);
                text = text.slice(1);
                armCtrl(false);
            }
            // One key types at once; a word from the keyboard's suggestions is pasted, paced.
            if (text.length === 1) machine.console.type(text); else if (text) machine.console.paste(text);
            kbd.value = '';
            kick();
        }
    });
    kbd.addEventListener('paste', e => {
        e.preventDefault();
        typeText(e.clipboardData.getData('text'));
    });
    $('crt').addEventListener('mouseup', () => { if (!getSelection().toString()) focusScreen(); });
    $('crt').addEventListener('focus', focusScreen);

    function typeText(text) {
        machine.console.paste(text.replace(/\r?\n/g, '\r').replace(/[^\x00-\x7f]/g, '?'));
        kick();
        focusScreen();
    }

    // The clipboard can be read only on HTTPS or localhost, and only with
    // the browser's leave; without it, a box to paste into instead.
    $('pasteBtn').addEventListener('click', async () => {
        let text = null;
        try { if (navigator.clipboard && navigator.clipboard.readText) text = await navigator.clipboard.readText(); } catch (e) { text = null; }
        if (text === null) text = prompt('The browser does not let the page read the clipboard here. Paste the text below (Ctrl+V), then OK:', '');
        if (text) typeText(text); else focusScreen();
    });

    /* ---------- the screen: 80 columns across, and pictures of it ---------- */

    const COLS = 80, LINE = 1.06, MIN_PX = 11, MAX_PX = 44;      // LINE: the rows' line height, as in the CSS

    /**
     * The font size at which the screen shows 80 x 24 as large as it can:
     * on a phone 80 columns across its width; on a desktop as large as both
     * the width and the height of the screen's place allow (measured: fonts
     * differ).
     */
    function fitScreen() {
        const screen = $('screen'), crt = $('crt'), wrap = $('screen-wrap');
        const cs = getComputedStyle(crt);
        const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) * 2;
        const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) * 2;
        const width = phone.matches ? screen.clientWidth : wrap.clientWidth - padX;
        if (!width) return;
        const probe = document.createElement('span');
        probe.textContent = 'M'.repeat(COLS);
        probe.style.cssText = 'position:absolute;visibility:hidden;font-size:100px;white-space:pre';
        screen.appendChild(probe);
        const at100 = probe.getBoundingClientRect().width;
        probe.remove();
        if (!at100) return;
        let px = width * 100 / at100;
        if (!phone.matches) px = Math.min(px, (wrap.clientHeight - padY) / (term.rows * LINE));
        px = Math.max(MIN_PX, Math.min(MAX_PX, Math.floor(px * 100) / 100));
        screen.style.fontSize = `${px}px`;
    }
    new ResizeObserver(fitScreen).observe($('screen-wrap'));
    if (document.fonts) document.fonts.ready.then(fitScreen);
    // show the screen only once VT323 is in and the size fitted (or after 2 s, if the font never comes)
    const fontSheet = document.querySelector('link[rel="stylesheet"][href*="fonts.googleapis"]');
    const sheetIn = new Promise(r => {   // VT323 is not known to document.fonts until its stylesheet is in
        if (!fontSheet || fontSheet.sheet) r();
        else { fontSheet.addEventListener('load', r); fontSheet.addEventListener('error', r); }
    });
    Promise.race([sheetIn.then(() => document.fonts && document.fonts.load('16px VT323')).catch(() => {}), new Promise(r => setTimeout(r, 2000))])
        .then(() => {
            fitScreen();
            requestAnimationFrame(() => { fitScreen(); $('crt').classList.add('fitted'); });   // the header changes height with the font: fit again
        });

    /** A PNG of the screen as it looks: phosphor colour, glow, attributes, cursor, scan lines. */
    async function screenShot() {
        const crtStyle = getComputedStyle($('crt'));
        const fg = crtStyle.getPropertyValue('--fg').trim() || '#9dff8a';
        const glow = crtStyle.getPropertyValue('--glow').trim() || 'rgba(157,255,138,0.35)';
        const bg = '#050805';
        const scale = 2, px = 20 * scale, lineH = Math.round(px * 1.06), pad = 18 * scale;
        const font = `${px}px VT323, ui-monospace, monospace`;
        if (document.fonts) await document.fonts.load(font).catch(() => {});
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.font = font;
        const cw = ctx.measureText('M').width;
        canvas.width = Math.ceil(pad * 2 + COLS * cw);
        canvas.height = Math.ceil(pad * 2 + term.rows * lineH);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.font = font;
        ctx.textBaseline = 'top';
        const { BOLD, UNDERLINE, REVERSE, DIM } = window.DigitalRerun.ATTR;
        for (let r = 0; r < term.rows; r++) {
            for (let c = 0; c < term.cols; c++) {
                const code = term.chars[r][c], attr = term.attrs[r][c];
                const cursor = term.cursorVisible && r === term.y && c === term.x;
                const x = pad + c * cw, y = pad + r * lineH;
                const inverse = !!(attr & REVERSE) !== cursor;
                if (inverse) { ctx.shadowBlur = 0; ctx.fillStyle = fg; ctx.fillRect(x, y, Math.ceil(cw), lineH); }
                if (code === 32 && !(attr & UNDERLINE)) continue;
                ctx.globalAlpha = attr & DIM ? 0.6 : 1;
                ctx.fillStyle = inverse ? bg : attr & BOLD ? '#e8ffe0' : fg;
                ctx.shadowColor = glow;
                ctx.shadowBlur = inverse ? 0 : (attr & BOLD ? 9 : 6) * scale;
                ctx.fillText(String.fromCharCode(code), x, y + (lineH - px) / 2);
                if (attr & UNDERLINE) ctx.fillRect(x, y + lineH - 2 * scale, Math.ceil(cw), scale);
                ctx.globalAlpha = 1;
            }
        }
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        for (let y = 0; y < canvas.height; y += 3 * scale) ctx.fillRect(0, y, canvas.width, scale);
        const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
        canvas.toBlob(b => download(`digitalrerun-screen-${stamp}.png`, b, 'image/png'));
        focusScreen();
    }
    $('shotBtn').addEventListener('click', () => screenShot().catch(() => {}));

    /* ---------- printer panel ---------- */

    $('onlineBtn').addEventListener('click', () => {
        machine.printer.online = !machine.printer.online;
        $('onlineBtn').classList.toggle('on', machine.printer.online);
        $('onlineBtn').textContent = machine.printer.online ? 'ON LINE' : 'OFF LINE';
    });
    $('ffBtn').addEventListener('click', () => { printer.formFeed(); paperOut(); });
    $('tearBtn').addEventListener('click', () => {
        printer.tearOff();
        paper.clear(printer.y);
        $('tray').hidden = true;
        $('tray').classList.remove('printed');
        seenSheets = 0;
        countUnseen();
    });
    $('pngBtn').addEventListener('click', () => {
        paper.printed().forEach((c, i) => c.toBlob(b => download(`digitalrerun-page-${i + 1}.png`, b, 'image/png')));
    });
    $('printBtn').addEventListener('click', () => window.print());

    /* ---------- running ---------- */

    let last = 0, raf = 0, rate = { t: 0, cycles: 0 };

    function frame(now) {
        raf = 0;
        const dt = Math.min(50, last ? now - last : 16);
        last = now;
        if (machine.state === 'running') {
            const before = machine.cycles;
            if (settings.speed > 0) {
                machine.run(settings.speed * 1000 * dt);
            } else {
                const until = performance.now() + 12;
                while (performance.now() < until && machine.state === 'running') {
                    machine.run(200000);
                    if (machine.idle) break;
                }
            }
            leds.busy = !machine.idle;
            rate.cycles += machine.cycles - before;
        }
        if (now - rate.t > 500) {
            const mhz = rate.cycles / ((now - rate.t) * 1000);
            $('mhz').textContent = machine.state === 'halted' ? 'HALT' : machine.state === 'paused' ? 'PAUSE' : leds.busy ? `${mhz.toFixed(1)} MHz` : 'idle';
            rate = { t: now, cycles: 0 };
        }
        view.render();
        updateLeds(now);
        if (tapeDirty) { tapeDirty = false; renderTape(); }
        if (debugOpen() && now - debugTick > 250) { debugTick = now; renderDebug(); }
        raf = requestAnimationFrame(frame);
    }

    function kick() { if (!raf) raf = requestAnimationFrame(frame); }

    function coldStart() {
        term.reset();
        if (!machine.fdc.drives[0]) {
            term.writeString('\r\nNo disk in A:. Insert one in DRIVES and press RESET.\r\n');
            machine.state = 'stopped';
            return;
        }
        if (!machine.reset()) term.writeString('\r\nA: does not read. Press RESET to try again.\r\n');
        focusScreen();
    }

    $('resetBtn').addEventListener('click', coldStart);

    /* ---------- snapshots ---------- */

    const { Snapshot, PWA } = window.DigitalRerun;
    const MAX_SNAPSHOTS = 12;
    const parts = { machine, terminal: term, printer };
    let lastAuto = { time: 0, cycles: -1 };

    const when = t => new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

    async function saveSnapshot(kind = 'manual') {
        const snap = Snapshot.take(parts, { kind, version: window.DigitalRerun.VERSION });
        const id = kind === 'auto' ? 'auto' : 'm' + snap.time;
        await Storage.saveSnapshot(id, snap, { kind, time: snap.time, preview: snap.preview, version: snap.version, size: Snapshot.size(snap) });
        if (kind !== 'auto') {
            const manual = (await Storage.listSnapshots()).filter(s => s.kind !== 'auto');
            for (const old of manual.slice(MAX_SNAPSHOTS)) await Storage.deleteSnapshot(old.id);
        }
        renderSnapshots();
        return snap;
    }

    async function restoreSnapshot(id, { quiet = false } = {}) {
        const snap = await Storage.getSnapshot(id);
        if (!snap) throw new Error('that snapshot is gone');
        Snapshot.restore(snap, parts);
        term.mode = settings.terminal;                    // the SETUP choice wins over the snapshot's
        // The disks are now the snapshot's: keep them as the current ones.
        for (const d of DRIVES) {
            const disk = machine.fdc.drives[d];
            if (disk) await Storage.saveDisk(d, disk); else await Storage.removeDisk(d);
        }
        lastAuto = { time: Date.now(), cycles: machine.cycles };
        renderDrives();
        view.render();
        kick();
        focusScreen();
        if (!quiet) PWA.toast(`Restored the snapshot of ${when(snap.time)}.`);
        return snap;
    }

    async function renderSnapshots() {
        const box = $('snapshots');
        let list = [];
        try { list = await Storage.listSnapshots(); } catch (e) { /* no storage */ }
        box.textContent = '';
        for (const s of list) {
            const row = document.createElement('div');
            row.className = 'snap';
            row.innerHTML = '<span class="when"></span><span class="acts"></span><span class="what"></span>';
            row.querySelector('.when').innerHTML = (s.kind === 'auto' ? '<b>AUTO</b>' : '') + when(s.time);
            row.querySelector('.what').textContent = s.preview || ' ';
            row.title = `${s.kind === 'auto' ? 'Saved when you left' : 'Saved by hand'}, version ${s.version || '?'}, ${Math.round(s.size / 1024)}K`;
            const acts = row.querySelector('.acts');
            const btn = (label, title, fn) => {
                const b = document.createElement('button');
                b.className = 'small';
                b.textContent = label;
                b.title = title;
                b.addEventListener('click', fn);
                acts.appendChild(b);
            };
            btn('RESTORE', 'Put the machine back to this moment', () => {
                if (!confirm(`Restore the snapshot of ${when(s.time)}? The machine as it is now is replaced (save a snapshot first to keep it).`)) return;
                restoreSnapshot(s.id).catch(e => PWA.toast(`Could not restore: ${e.message}`));
            });
            btn('✕', 'Delete this snapshot', () => Storage.deleteSnapshot(s.id).then(renderSnapshots));
            box.appendChild(row);
        }
        $('snap-note').textContent = list.length ? `${list.length}` : '';
    }

    function manualSnapshot() {
        if (machine.state === 'stopped') { PWA.toast('Nothing to save: the machine is not running.'); return; }
        saveSnapshot('manual')
            .then(s => PWA.toast(`Snapshot saved: ${when(s.time)}.`))
            .catch(e => PWA.toast(`Could not save the snapshot: ${e.message}`));
        focusScreen();
    }
    $('snapBtn').addEventListener('click', manualSnapshot);
    $('snapSaveBtn').addEventListener('click', manualSnapshot);

    $('sound').addEventListener('change', () => {
        settings.sound = $('sound').checked;
        applySettings();
        if (settings.sound) sound.unlock();
        Storage.set('settings', settings).catch(() => {});
    });
    /* ---------- the modem line: the built-in one, or a real modem on a serial port ---------- */

    function showSerial() {
        const on = !!serial;
        $('serialBtn').textContent = on ? 'BUILT-IN MODEM' : 'REAL MODEM…';
        $('serial-state').textContent = on ? 'REAL, ' + settings.baud + ' BAUD' : '';
        $('serialBtn').disabled = !on && !SerialLine.supported();
        $('serialBtn').title = SerialLine.supported() ? 'Use a real modem on a USB serial port instead of the built-in one' : 'This browser has no Web Serial (try Chrome or Edge)';
        $('serialSignals').disabled = on;
    }

    /** Open `port` as the modem line (the call, if any, is dropped). */
    async function openSerial(port) {
        const line = new SerialLine(port, {
            baud: settings.baud, signals: settings.serialSignals,
            onClose: error => { if (serial === line) { leaveSerial(); PWA.toast(error ? `The modem port stopped: ${error.message}` : 'The modem port was unplugged.'); } }
        });
        await line.open();
        serial = line;
        machine.modem.attach(line);
        showSerial();
    }

    function leaveSerial() {
        const line = serial;
        serial = null;
        machine.modem.attach(hayes);
        if (line) line.close();
        showSerial();
    }

    $('serialBtn').addEventListener('click', async () => {
        if (serial) { leaveSerial(); focusScreen(); return; }
        try {
            await openSerial(await SerialLine.request());
            focusScreen();
        } catch (e) {
            if (e.name !== 'NotFoundError') PWA.toast(`Could not open the modem port: ${e.message}`);   // NotFoundError: the chooser was closed
        }
    });
    $('baud').addEventListener('change', async () => {
        settings.baud = Number($('baud').value);
        machine.modem.baud = settings.baud;
        Storage.set('settings', settings).catch(() => {});
        if (serial) {                         // a port's speed is set when it is opened: open it again
            const line = serial, port = line.port;
            serial = null;
            machine.modem.attach(hayes);
            try { await line.close(); await openSerial(port); } catch (e) { showSerial(); PWA.toast(`Could not reopen the modem port: ${e.message}`); }
        } else showSerial();
    });
    for (const key of ['sysopUrl', 'sysopModel', 'sysopKey']) {
        $(key).addEventListener('change', () => {
            settings[key] = $(key).value.trim();
            Storage.set('settings', settings).catch(() => {});
        });
    }
    for (const key of ['gateway', 'gatewayToken']) {
        $(key).addEventListener('change', () => {
            settings[key] = $(key).value.trim();
            directory.gateway = settings.gateway ? new Gateway({ url: settings.gateway, token: settings.gatewayToken }) : null;
            Storage.set('settings', settings).catch(() => {});
        });
    }
    $('serialSignals').addEventListener('change', () => {
        settings.serialSignals = $('serialSignals').checked;
        Storage.set('settings', settings).catch(() => {});
    });
    if (SerialLine.supported()) navigator.serial.addEventListener('disconnect', e => { if (serial && serial.port === e.target) { leaveSerial(); PWA.toast('The modem port was unplugged.'); } });
    showSerial();

    $('online').addEventListener('change', () => {
        settings.online = $('online').checked;
        Storage.set('settings', settings).catch(() => {});
    });
    // Audio may start only after a key or a tap.
    for (const ev of ['keydown', 'pointerdown']) addEventListener(ev, () => sound.unlock(), { capture: true });

    $('resume').addEventListener('change', () => {
        settings.resume = $('resume').checked;
        Storage.set('settings', settings).catch(() => {});
        if (!settings.resume) Storage.deleteSnapshot('auto').then(renderSnapshots).catch(() => {});
    });

    /**
     * One automatic snapshot (id 'auto', replaced each time) when the page is
     * left (hidden or closed: at once) or the window loses focus (at most every
     * 15 s), and only if the machine ran since the last one.
     */
    function autoSnapshot(leaving) {
        if (!settings.resume || machine.state === 'stopped' || machine.cycles === lastAuto.cycles) return;
        if (!leaving && Date.now() - lastAuto.time < 15000) return;
        lastAuto = { time: Date.now(), cycles: machine.cycles };
        saveSnapshot('auto').catch(() => {});
    }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') autoSnapshot(true); });
    addEventListener('pagehide', () => autoSnapshot(true));
    addEventListener('blur', () => autoSnapshot(false));
    // A safety net: a page being closed may not finish writing, so also once a minute while it runs.
    setInterval(() => { if (document.visibilityState === 'visible') autoSnapshot(false); }, 60000);

    /* ---------- start ---------- */

    async function start() {
        try {
            const saved = await Storage.get('settings');
            if (saved) Object.assign(settings, saved);
        } catch (e) { /* private mode: no storage */ }
        applySettings();
        showTab(settings.tab);
        let disks = new Map();
        try { disks = await Storage.loadDisks(); } catch (e) { /* none */ }
        for (const [drive, d] of disks) {
            try { machine.fdc.mount(drive, new Disk(d.format, new Uint8Array(d.data), { name: d.name, readOnly: d.readOnly, origin: d.origin || '' })); } catch (e) { /* skip */ }
        }
        if (!machine.fdc.drives[0]) {
            try {
                mount(0, await systemDisk());
                if (!machine.fdc.drives[1]) await newDisk(1, false);
            } catch (e) { note(e.message, false); }
        }
        placeTray();
        renderDrives();
        renderSnapshots();
        loadShelf();
        let resumed = null;
        if (settings.resume) {
            try { resumed = await Storage.getSnapshot('auto') ? await restoreSnapshot('auto', { quiet: true }) : null; } catch (e) { resumed = null; }
        }
        if (resumed) PWA.toast(`Resumed where you left off (${when(resumed.time)}). RESET starts afresh.`);
        else coldStart();
        kick();
    }

    start();

    /** Save every changed disk now (before a reload for an update). */
    function flushDisks() {
        return Promise.all(DRIVES.map(d => {
            const disk = machine.fdc.drives[d];
            clearTimeout(saveTimers[d]);
            return disk && disk.dirty ? Storage.saveDisk(d, disk).then(() => { disk.dirty = false; }) : null;
        }));
    }

    window.DigitalRerun.PWA.init({ beforeReload: flushDisks });
})();
