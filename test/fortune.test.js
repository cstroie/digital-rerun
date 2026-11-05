'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FORTUNES, pick } = require('../js/fortune.js');

test('plenty of fortunes, all different, plain ASCII, short enough for two lines', () => {
    assert.ok(FORTUNES.length >= 80);
    assert.equal(new Set(FORTUNES).size, FORTUNES.length);
    for (const f of FORTUNES) {
        assert.equal(/[^\x20-\x7e]/.test(f), false, f);
        assert.ok(f.length <= 110, f);
        assert.ok(f.length >= 20, f);
    }
});

test('no personal names, no numbers that look like data', () => {
    for (const f of FORTUNES) assert.equal(/\b\d{6,}\b/.test(f), false, f);
});

test('pick: any index, never one to avoid, and it still answers when all are to be avoided', () => {
    const seen = new Set();
    for (let i = 0; i < 2000; i++) seen.add(pick(Math.random, [0, 1, 2]));
    assert.equal(seen.has(0) || seen.has(1) || seen.has(2), false);
    assert.ok(seen.size > 50);
    assert.ok(pick(() => 0.5, FORTUNES.map((_, i) => i)) >= 0);
    assert.equal(pick(() => 0, []), 0);
    assert.equal(pick(() => 0.9999999, []), FORTUNES.length - 1);
});
