/*
 * Service worker: keeps the app for offline use.
 *
 * Every file of the app is cached under the version's own name
 * (digitalrerun-{VERSION}-{BUILD}) and served from there, so a page
 * always runs one consistent version. A new version installs beside the
 * old one and waits; the page offers to reload, then sends
 * 'skip-waiting'. The old cache is removed when the new worker takes over.
 */
importScripts('js/version.js');
const { VERSION, BUILD } = self.DigitalRerun;
const CACHE = `digitalrerun-${VERSION}-${BUILD}`;
const SHELL = [
    './',
    'index.html',
    'css/digitalrerun.css',
    'fonts/Web437_IBM_VGA_9x16.woff',
    'fonts/Web437_IBM_DOS_ISO9.woff',
    'js/version.js',
    'js/z80.js',
    'js/devices/fdc.js',
    'js/devices/serial.js',
    'js/devices/clock.js',
    'js/devices/modem.js',
    'js/devices/hayes.js',
    'js/devices/directory.js',
    'js/devices/webserial.js',
    'js/devices/telnet.js',
    'js/devices/gateway.js',
    'js/vt.js',
    'js/sysop.js',
    'js/fortune.js',
    'js/wopr.js',
    'js/scores.js',
    'js/records.js',
    'js/reference.js',
    'js/doors.js',
    'js/sky.js',
    'js/epub.js',
    'js/vendor/astronomy.browser.min.js',
    'js/vendor/satellite.min.js',
    'js/games.js',
    'js/gibson.js',
    'js/twentyq.js',
    'js/adventure.js',
    'js/bbs.js',
    'js/machine.js',
    'js/cpmfs.js',
    'js/altair.js',
    'js/terminal.js',
    'js/font9.js',
    'js/fx80.js',
    'js/storage.js',
    'js/disz80.js',
    'js/shelf.js',
    'js/folderdisk.js',
    'js/sound.js',
    'js/snapshot.js',
    'js/pwa.js',
    'js/app.js',
    'disks/cpm22.dsk',
    'disks/shelf.json',
    'manifest.webmanifest',
    'icons/icon-32.png',
    'icons/icon-180.png',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/icon-maskable-512.png'
];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
    // Fetch past the HTTP cache, so the new version is really new. No skipWaiting: the page decides.
    event.waitUntil(caches.open(CACHE).then(cache =>
        cache.addAll(SHELL.map(url => new Request(url, { cache: 'reload' })))));
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            // Only our own caches: the origin (cstroie.github.io) is shared with other apps.
            .then(keys => Promise.all(keys
                .filter(k => (k.startsWith('digitalrerun-') || k.startsWith('jscpm-')) && k !== CACHE && k !== 'digitalrerun-fonts')
                .map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('message', event => {
    const msg = event.data || {};
    if (msg.type === 'skip-waiting') self.skipWaiting();
    if (msg.type === 'version' && event.ports[0]) event.ports[0].postMessage({ version: VERSION, build: BUILD });
});

self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET' || req.cache === 'no-store') return;     // (a private shelf is fetched no-store: never kept)
    const url = new URL(req.url);
    if (FONT_HOSTS.includes(url.hostname)) {
        // Fonts: cached once, kept across versions.
        event.respondWith(caches.open('digitalrerun-fonts').then(async cache => {
            const hit = await cache.match(req);
            if (hit) return hit;
            const res = await fetch(req);
            if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
            return res;
        }));
        return;
    }
    if (url.origin !== location.origin) return;
    // The app: this version's copy, else the network. Shelf disks' files are kept
    // in this version's cache when first fetched, so an inserted disk works offline.
    const keep = url.pathname.includes('/disks/shelf/');
    event.respondWith(caches.open(CACHE).then(cache =>
        cache.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
            if (keep && res.ok) cache.put(req, res.clone());
            return res;
        }))));
});
