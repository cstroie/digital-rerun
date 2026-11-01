/*
 * storage.js: disks and settings kept in the browser (IndexedDB), so a
 * reload finds the drives as they were left.
 *
 *   disks:     key = drive number, value = { name, origin, format, data, readOnly }
 *   settings:  key = name, value = anything
 *   snapshots: key = id ('auto' or 'm{time}'), value = a snapshot (js/snapshot.js)
 *   snapmeta:  key = the same id, value = { id, kind, time, preview, version, size }: the list
 *   mydisks:   key = id ('d{time}'), value = { id, name, format, time, data }: the owner's shelf
 */
(function (root) {
    'use strict';

    const DB = 'DigitalRerun';
    const VERSION = 3;

    function open() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB, VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('disks')) db.createObjectStore('disks');
                if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
                if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots');
                if (!db.objectStoreNames.contains('snapmeta')) db.createObjectStore('snapmeta');
                if (!db.objectStoreNames.contains('mydisks')) db.createObjectStore('mydisks');
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    let dbPromise = null;
    const db = () => (dbPromise = dbPromise || open());

    function call(store, mode, fn) {
        return db().then(d => new Promise((resolve, reject) => {
            const tx = d.transaction(store, mode);
            const req = fn(tx.objectStore(store));
            tx.oncomplete = () => resolve(req && req.result);
            tx.onerror = () => reject(tx.error);
        }));
    }

    const Storage = {
        saveDisk(drive, disk) {
            return call('disks', 'readwrite', s => s.put({
                name: disk.name, origin: disk.origin, format: disk.format, readOnly: disk.readOnly, data: disk.data.slice()
            }, drive));
        },
        removeDisk(drive) { return call('disks', 'readwrite', s => s.delete(drive)); },
        loadDisks() {
            return db().then(d => new Promise((resolve, reject) => {
                const out = new Map();
                const tx = d.transaction('disks', 'readonly');
                const req = tx.objectStore('disks').openCursor();
                req.onsuccess = () => {
                    const c = req.result;
                    if (c) { out.set(c.key, c.value); c.continue(); }
                };
                tx.oncomplete = () => resolve(out);
                tx.onerror = () => reject(tx.error);
            }));
        },
        get(key) { return call('settings', 'readonly', s => s.get(key)); },

        saveSnapshot(id, snap, meta) {
            return db().then(d => new Promise((resolve, reject) => {
                const tx = d.transaction(['snapshots', 'snapmeta'], 'readwrite');
                tx.objectStore('snapshots').put(snap, id);
                tx.objectStore('snapmeta').put({ ...meta, id }, id);
                tx.oncomplete = () => resolve(id);
                tx.onerror = () => reject(tx.error);
            }));
        },
        saveMyDisk(d) { return call('mydisks', 'readwrite', s => s.put(d, d.id)); },
        getMyDisk(id) { return call('mydisks', 'readonly', s => s.get(id)); },
        deleteMyDisk(id) { return call('mydisks', 'readwrite', s => s.delete(id)); },
        /** My disks without their data, newest first. */
        listMyDisks() {
            return db().then(d => new Promise((resolve, reject) => {
                const out = [];
                const req = d.transaction('mydisks', 'readonly').objectStore('mydisks').openCursor();
                req.onsuccess = () => {
                    const c = req.result;
                    if (!c) return resolve(out.sort((a, b) => b.time - a.time));
                    const { data, ...meta } = c.value;
                    out.push({ ...meta, size: data.length });
                    c.continue();
                };
                req.onerror = () => reject(req.error);
            }));
        },
        getSnapshot(id) { return call('snapshots', 'readonly', s => s.get(id)); },
        listSnapshots() { return call('snapmeta', 'readonly', s => s.getAll()).then(list => (list || []).sort((a, b) => b.time - a.time)); },
        deleteSnapshot(id) {
            return db().then(d => new Promise((resolve, reject) => {
                const tx = d.transaction(['snapshots', 'snapmeta'], 'readwrite');
                tx.objectStore('snapshots').delete(id);
                tx.objectStore('snapmeta').delete(id);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            }));
        },
        set(key, value) { return call('settings', 'readwrite', s => s.put(value, key)); }
    };

    (root.DigitalRerun = root.DigitalRerun || {}).Storage = Storage;
})(typeof window !== 'undefined' ? window : globalThis);
