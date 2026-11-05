/*
 * scores.js: the board's high-score tables, one per game, kept through a
 * `store` ({ get(key), set(key, value) }: strings, like localStorage's).
 *
 *   add(game, name, score, low)   put a score in; low: smaller is better.
 *                                 Returns its place (1-based) in the top ten, or 0.
 *   top(game, n)                  [{ name, score, when }], best first
 *   games()                       the games that have scores
 */
(function (root) {
    'use strict';

    const KEEP = 10;

    class Scores {
        constructor(store, now = Date.now) {
            this.store = store;
            this.now = now;
        }

        load() {
            try { return JSON.parse(this.store.get('scores')) || {}; } catch (e) { return {}; }
        }

        add(game, name, score, low = false) {
            const all = this.load();
            const table = all[game] || (all[game] = { low, list: [] });
            const entry = { name: String(name || 'GUEST').slice(0, 12), score, when: this.now() };
            table.list.push(entry);
            table.list.sort((a, b) => (table.low ? a.score - b.score : b.score - a.score) || a.when - b.when);
            table.list = table.list.slice(0, KEEP);
            const place = table.list.indexOf(entry) + 1;
            try { this.store.set('scores', JSON.stringify(all)); } catch (e) { /* full: not kept */ }
            return place;
        }

        top(game, n = KEEP) {
            const t = this.load()[game];
            return t ? t.list.slice(0, n) : [];
        }

        games() { return Object.keys(this.load()); }
    }

    const api = { Scores };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else Object.assign(root.DigitalRerun = root.DigitalRerun || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
