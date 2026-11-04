/*
 * version.js: the app's version, read by the page and by the service
 * worker (importScripts), so a new version is a new service worker.
 *
 * VERSION is raised by hand with each release (semver). BUILD is a hash
 * of every file the service worker caches, written by tools/stamp.js; a
 * test fails when it is stale, so no change ships under an old cache.
 * This file should not be edited manually; use tools/stamp.js instead.
 */
(function (root) {
    'use strict';
    const info = { VERSION: '1.29.0', BUILD: '3fffc3fceabc' };
    if (typeof module !== 'undefined' && module.exports) module.exports = info;
    else Object.assign(root.DigitalRerun = root.DigitalRerun || {}, info);
})(typeof window !== 'undefined' ? window : globalThis);
