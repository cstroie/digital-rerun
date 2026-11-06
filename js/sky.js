/*
 * sky.js: what is in the sky, worked out here, with no network: the planets
 * tonight (Astronomy Engine) and the passes of the ISS over a place (satellite.js,
 * on the station's orbital elements). The caller fetches the orbit; nothing else leaves.
 *
 *   planetsTonight(astronomy, when, lat, lon) -> { sunAlt, dark, planets: [{ name, alt, az, dark, best, bestAlt }] }
 *   issPasses(satellite, tle, lat, lon, from, days, minEl) -> [{ rise, riseAz, maxEl, maxAt, set, setAz }]
 *   parseTle(text) -> [line1, line2] | null
 *   compass(az) -> 'N', 'NE' ...
 *   loadAstronomy(), loadSatellite(): the libraries (js/vendor): the page's globals, or read in Node
 */
(function (root) {
    'use strict';

    const node = typeof module !== 'undefined' && module.exports;
    const DEG = Math.PI / 180;
    const NAKED_EYE = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'];
    const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

    /** The compass point of an azimuth in degrees (0 north, 90 east). */
    const compass = az => POINTS[Math.round((((az % 360) + 360) % 360) / 22.5) % 16];

    /**
     * The planets the eye can see, for the next twelve hours (every half hour). A planet is "dark" when it is
     * above 5 degrees while the sun is below -6 (the dark of the night); `best` is the time it is highest then.
     */
    function planetsTonight(A, when, lat, lon) {
        const obs = new A.Observer(lat, lon, 0);
        const altaz = (name, t) => {
            const eq = A.Equator(A.Body[name], t, obs, true, true);
            const h = A.Horizon(t, obs, eq.ra, eq.dec, 'normal');
            return { alt: h.altitude, az: h.azimuth };
        };
        const scan = [];
        for (let m = 0; m <= 12 * 60; m += 30) scan.push(new Date(when.getTime() + m * 60000));
        const sunDark = t => altaz('Sun', t).alt < -6;
        const darkTimes = scan.filter(sunDark);
        const planets = NAKED_EYE.map(name => {
            const now = altaz(name, when);
            let best = null, bestAlt = -90;
            for (const t of darkTimes) {
                const p = altaz(name, t);
                if (p.alt > 5 && p.alt > bestAlt) { bestAlt = p.alt; best = t; }
            }
            return { name, alt: now.alt, az: now.az, dark: best !== null, best, bestAlt };
        });
        const sun = altaz('Sun', when);
        return { sunAlt: sun.alt, dark: sun.alt < -6, planets };
    }

    /**
     * The passes of the satellite over a place: the times it is above `minEl` degrees, sampled every 30 seconds
     * over `days` days from `from`. Each pass: where it rises and sets (azimuth) and its highest point.
     */
    function issPasses(S, tle, lat, lon, from, days = 3, minEl = 10) {
        if (!tleLineOk(tle[0], 1) || !tleLineOk(tle[1], 2)) throw new Error('bad orbital elements');
        const rec = S.twoline2satrec(tle[0], tle[1]);
        if (rec.error) throw new Error('bad orbital elements');
        const obs = { latitude: lat * DEG, longitude: lon * DEG, height: 0 };
        const look = t => {
            const pv = S.propagate(rec, t);
            if (!pv || !pv.position) return null;
            const la = S.ecfToLookAngles(obs, S.eciToEcf(pv.position, S.gstime(t)));
            return { el: la.elevation / DEG, az: la.azimuth / DEG };
        };
        const passes = [];
        let cur = null;
        const end = from.getTime() + days * 86400000;
        for (let ms = from.getTime(); ms <= end; ms += 30000) {
            const t = new Date(ms), p = look(t);
            if (!p) continue;
            if (p.el >= minEl) {
                if (!cur) cur = { rise: t, riseAz: p.az, maxEl: p.el, maxAt: t, set: t, setAz: p.az };
                cur.set = t;
                cur.setAz = p.az;
                if (p.el > cur.maxEl) { cur.maxEl = p.el; cur.maxAt = t; }
            } else if (cur) { passes.push(cur); cur = null; }
        }
        if (cur) passes.push(cur);
        return passes;
    }

    /** A line of an element set is 69 characters, and its last digit is the checksum of the ones before (a minus sign counts 1). */
    function tleLineOk(line, n) {
        if (!line || line.length < 69 || !line.startsWith(n + ' ')) return false;
        let sum = 0;
        for (let i = 0; i < 68; i++) { const c = line[i]; if (c >= '0' && c <= '9') sum += c.charCodeAt(0) - 48; else if (c === '-') sum += 1; }
        return sum % 10 === line.charCodeAt(68) - 48;
    }

    /** The two lines of an orbital element set in a three-line text (name, line 1, line 2), or null when they do not check out. */
    function parseTle(text) {
        const lines = String(text).split('\n').map(l => l.trim()).filter(Boolean);
        const i = lines.findIndex(l => l.startsWith('1 '));
        if (i < 0 || !tleLineOk(lines[i], 1) || !tleLineOk(lines[i + 1], 2)) return null;
        return [lines[i], lines[i + 1]];
    }

    /** The libraries: the page's globals (the scripts of js/vendor), or those scripts read here in Node. */
    function loadAstronomy() {
        return node ? require('./vendor/astronomy.browser.min.js') : root.Astronomy;
    }
    function loadSatellite() {
        if (!node) return root.satellite;
        const vm = require('vm'), fs = require('fs'), path = require('path');
        const ctx = { Date, Math };                 // the host's Date: the orbit maths needs it (a context's own Date gives NaN)
        vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'vendor', 'satellite.min.js'), 'utf8') + ';this.satellite = satellite;', ctx);
        return ctx.satellite;
    }

    const api = { planetsTonight, issPasses, parseTle, compass, loadAstronomy, loadSatellite };
    if (node) module.exports = api;
    else Object.assign(root.DigitalRerun = root.DigitalRerun || {}, { skyCalc: api });   // not 'sky': that name is the K desk's
})(typeof window !== 'undefined' ? window : globalThis);
