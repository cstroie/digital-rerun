'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Sky = require('../js/sky.js');

// the ISS, from CelesTrak (catalog 25544), epoch 5 Nov 2026
const ISS = `ISS (ZARYA)
1 25544U 98067A   26309.85320381  .00006629  00000+0  12749-3 0  9998
2 25544  51.6327 319.0560 0007195 352.5747   7.5134 15.49194530593711`;

test('compass points, and the parse of an orbit text', () => {
    assert.equal(Sky.compass(0), 'N');
    assert.equal(Sky.compass(90), 'E');
    assert.equal(Sky.compass(225), 'SW');
    assert.equal(Sky.compass(359), 'N');
    assert.equal(Sky.compass(-90), 'W');
    const tle = Sky.parseTle(ISS);
    assert.equal(tle[0].slice(0, 2), '1 ');
    assert.equal(tle[1].slice(0, 2), '2 ');
    assert.equal(Sky.parseTle('no orbit here'), null);
});

test('planets tonight: the sun, the five planets, the dark hours', () => {
    const A = Sky.loadAstronomy();
    const night = Sky.planetsTonight(A, new Date('2026-11-06T21:00:00Z'), 44.43, 26.10);
    assert.equal(night.dark, true, 'the sun is down at 23:00 local');
    assert.deepEqual(night.planets.map(p => p.name), ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn']);
    for (const p of night.planets) {
        assert.ok(p.alt >= -90 && p.alt <= 90, p.name);
        assert.ok(p.az >= 0 && p.az < 360, p.name);
        if (p.dark) { assert.ok(p.best instanceof Date && p.bestAlt > 5, p.name); } else assert.equal(p.best, null);
    }
    assert.ok(night.planets.some(p => p.dark), 'at least one planet is up in the dark');
    const day = Sky.planetsTonight(A, new Date('2026-11-06T10:00:00Z'), 44.43, 26.10);
    assert.equal(day.dark, false, 'the sun is up at noon');
});

test('ISS passes: fixed date, every pass above 10 degrees, rise before the top before the set', () => {
    const S = Sky.loadSatellite();
    const from = new Date('2026-11-06T12:00:00Z');
    const passes = Sky.issPasses(S, Sky.parseTle(ISS), 44.43, 26.10, from, 3, 10);
    assert.ok(passes.length >= 5, `about 17 in three days, got ${passes.length}`);
    for (const p of passes) {
        assert.ok(p.rise <= p.maxAt && p.maxAt <= p.set, 'in order');
        assert.ok(p.maxEl >= 10, 'above 10 degrees');
        assert.ok(p.set - p.rise < 20 * 60000, 'a pass is under 20 minutes');
        assert.ok(p.riseAz >= 0 && p.riseAz < 360 && p.setAz >= 0 && p.setAz < 360);
        assert.ok(p.rise >= from && p.set <= new Date(from.getTime() + 3 * 86400000 + 60000));
    }
    assert.throws(() => Sky.issPasses(S, ['1 bad', '2 bad'], 0, 0, from), /bad orbital elements/);
    assert.equal(Sky.parseTle('1 25544U 98067A   26309.85320381  .00006629  00000+0  12749-3 0  9999\n2 25544  51.6327 319.0560 0007195 352.5747   7.5134 15.49194530593711'), null, 'a wrong checksum is refused');
});
