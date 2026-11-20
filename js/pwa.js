/*
 * pwa.js: the app side of the PWA. Registers the service worker, offers
 * a new version when one is waiting, suggests installing the app, and
 * shows the version.
 *
 *   DigitalRerun.PWA.init({ beforeReload })   beforeReload: save what must survive a reload
 *
 * Messages appear as banners at the bottom of the page (lasting, with
 * buttons) or toasts (passing). An update never reloads by itself: the
 * machine would restart under the user's hands.
 */
(function (root) {
    'use strict';

    const NS = root.DigitalRerun;
    const DISMISS_KEY = 'digitalrerun.install.dismissed';
    const DISMISS_DAYS = 30;
    const HOUR = 60 * 60 * 1000;
    const $ = id => document.getElementById(id);

    let registration = null;
    let deferredPrompt = null;
    let reloading = false;
    let beforeReload = async () => {};

    const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    /* ---------- banners and toasts ---------- */

    function box() {
        let el = $('banners');
        if (!el) {
            el = document.createElement('div');
            el.id = 'banners';
            el.setAttribute('aria-live', 'polite');
            document.body.appendChild(el);
        }
        return el;
    }

    /** A lasting message with buttons: [{ label, primary, action }]. Returns a close function. */
    function banner(id, text, buttons) {
        closeBanner(id);
        const el = document.createElement('div');
        el.className = 'banner';
        el.dataset.id = id;
        const p = document.createElement('p');
        p.textContent = text;
        el.appendChild(p);
        const acts = document.createElement('div');
        acts.className = 'acts';
        for (const b of buttons) {
            const btn = document.createElement('button');
            btn.textContent = b.label;
            if (b.primary) btn.className = 'primary';
            btn.addEventListener('click', () => b.action(() => el.remove()));
            acts.appendChild(btn);
        }
        el.appendChild(acts);
        box().appendChild(el);
        return () => el.remove();
    }

    function closeBanner(id) {
        const el = box().querySelector(`.banner[data-id="${id}"]`);
        if (el) el.remove();
    }

    function toast(text) {
        const el = document.createElement('div');
        el.className = 'banner toast';
        el.textContent = text;
        box().appendChild(el);
        setTimeout(() => el.remove(), 4000);
    }

    /* ---------- versions and updates ---------- */

    const label = (v, b) => `${v} (${b})`;

    /** Ask a service worker which version it carries. */
    function workerVersion(worker) {
        return new Promise(resolve => {
            const ch = new MessageChannel();
            const timer = setTimeout(() => resolve(null), 2000);
            ch.port1.onmessage = e => { clearTimeout(timer); resolve(e.data); };
            worker.postMessage({ type: 'version' }, [ch.port2]);
        });
    }

    async function offerUpdate(worker) {
        const info = await workerVersion(worker);
        if (info && info.build === NS.BUILD) {           // the same build: let it take over quietly
            worker.postMessage({ type: 'skip-waiting' });
            return;
        }
        const name = info ? label(info.version, info.build) : 'A new version';
        banner('update', `DigitalRerun ${name} is ready. Reloading restarts the machine; your disks are kept.`, [
            {
                label: 'RELOAD', primary: true, action: async close => {
                    close();
                    try { await beforeReload(); } catch (e) { /* reload anyway */ }
                    reloading = true;
                    worker.postMessage({ type: 'skip-waiting' });
                    setTimeout(() => location.reload(), 3000);   // in case controllerchange never comes
                }
            },
            { label: 'LATER', action: close => close() }
        ]);
    }

    function watch(reg) {
        if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
        reg.addEventListener('updatefound', () => {
            const w = reg.installing;
            if (!w) return;
            w.addEventListener('statechange', () => {
                if (w.state !== 'installed') return;
                if (navigator.serviceWorker.controller) offerUpdate(w);
                else toast('DigitalRerun is ready to work offline.');
            });
        });
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (reloading) location.reload();
        });
        const check = () => reg.update().catch(() => {});
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
        addEventListener('online', check);
        setInterval(check, HOUR);
    }

    async function checkNow() {
        if (!registration) { toast('Updates need the app served over HTTPS.'); return; }
        try {
            await registration.update();
            const pending = registration.installing || registration.waiting;
            if (!pending) toast(`DigitalRerun ${label(NS.VERSION, NS.BUILD)} is the latest version.`);
            else if (registration.waiting) offerUpdate(registration.waiting);
            else toast('Downloading a new version…');
        } catch (e) {
            toast('Could not check for updates: offline?');
        }
    }

    /* ---------- install ---------- */

    function dismissedRecently() {
        const t = Number(localStorage.getItem(DISMISS_KEY) || 0);
        return Date.now() - t < DISMISS_DAYS * 24 * HOUR;
    }

    function dismiss(close) {
        try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch (e) { /* private mode */ }
        close();
    }

    async function install() {
        if (deferredPrompt) {
            const p = deferredPrompt;
            deferredPrompt = null;
            closeBanner('install');
            try {
                await p.prompt();
                await p.userChoice;
            } catch (e) { /* refused or not allowed: the menu item stays */ }
            updateInstallButton();
        } else if (isIos()) {
            toast('Tap Share, then Add to Home Screen.');
        } else {
            toast('Use the install icon in the address bar, or the browser menu, Install.');
        }
    }

    function offerInstall() {
        if (standalone() || dismissedRecently()) return;
        if (deferredPrompt) {
            banner('install', 'Install DigitalRerun as an app: its own window, and it works offline.', [
                { label: 'INSTALL', primary: true, action: () => install() },
                { label: 'NOT NOW', action: dismiss }
            ]);
        } else if (isIos()) {
            banner('install', 'Install DigitalRerun: tap Share, then Add to Home Screen. It works offline.', [
                { label: 'NOT NOW', action: dismiss }
            ]);
        }
    }

    function updateInstallButton() {
        const btn = $('installBtn');
        if (btn) btn.hidden = standalone() || !(deferredPrompt || isIos() || 'onbeforeinstallprompt' in window);
    }

    /* ---------- start ---------- */

    function init(options = {}) {
        if (options.beforeReload) beforeReload = options.beforeReload;
        const v = $('version');
        if (v) v.textContent = label(NS.VERSION, NS.BUILD);

        addEventListener('beforeinstallprompt', e => {
            e.preventDefault();
            deferredPrompt = e;
            updateInstallButton();
            offerInstall();
        });
        addEventListener('appinstalled', () => {
            deferredPrompt = null;
            closeBanner('install');
            updateInstallButton();
            toast('DigitalRerun is installed.');
        });
        if ($('installBtn')) $('installBtn').addEventListener('click', install);
        if ($('updateBtn')) $('updateBtn').addEventListener('click', checkNow);
        updateInstallButton();
        if (isIos()) setTimeout(offerInstall, 4000);

        if ('serviceWorker' in navigator && location.protocol !== 'file:') {
            navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
                .then(reg => { registration = reg; watch(reg); })
                .catch(() => {});
        }
    }

    NS.PWA = { init, toast, banner };
})(window);
