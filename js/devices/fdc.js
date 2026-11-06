/*
 * fdc.js: the disk controller, on the z80pack port map.
 *
 *   OUT 10  drive (0 = A: … 15 = P:)
 *   OUT 11  track
 *   OUT 12  sector (1-based), low byte
 *   OUT 17  sector, high byte
 *   OUT 15  DMA address, low byte
 *   OUT 16  DMA address, high byte
 *   OUT 13  command: 0 = read a sector into DMA, 1 = write it from DMA
 *   IN  14  status of the last command (0 = ok)
 *   IN  10  0FFh when the selected drive holds a disk, else 0
 *   IN  18  the format of that disk: 0 8" SSSD, 1 5¼" SSDD 512, 2 5¼" DSDD 512,
 *           3 5¼" SSDD 1K, 4 hard disk (ports 10 in and 18: this machine's own)
 *
 * A sector is 128 bytes. A disk is a flat image, track after track,
 * sectors 1..spt in order (no skew in the image: the BIOS translates).
 */
(function (root) {
    'use strict';

    const SECTOR = 128;

    /**
     * Formats the machine knows. `code` is what IN 18 reports to the BIOS;
     * `sectors` x `seclen` is a track as the image stores it (raw, in
     * physical order, like cpmtools' images); `spt` counts 128-byte
     * records, the unit the BIOS asks for.
     */
    const FORMATS = {
        // 8" single sided, single density: CP/M's distribution format (the BIOS does the skew).
        'sssd8': { code: 0, name: '8" SSSD 250K', tracks: 77, sectors: 26, seclen: 128 },
        // 5 1/4" double density data disks, the common archive formats.
        'ssdd5': { code: 1, name: '5¼" SSDD 200K, 512-byte sectors', tracks: 40, sectors: 10, seclen: 512 },
        'dsdd5': { code: 2, name: '5¼" DSDD 400K, 512-byte sectors', tracks: 80, sectors: 10, seclen: 512 },
        'ssdd5k': { code: 3, name: '5¼" SSDD 200K, 1K sectors', tracks: 40, sectors: 5, seclen: 1024 },
        // z80pack's 4 MB hard disk.
        'hd4mb': { code: 4, name: '4 MB hard disk', tracks: 255, sectors: 128, seclen: 128 }
    };
    for (const f of Object.values(FORMATS)) {
        f.spt = f.sectors * f.seclen / SECTOR;
        f.size = f.tracks * f.sectors * f.seclen;
    }

    const STATUS = { OK: 0, NO_DRIVE: 1, BAD_TRACK: 2, BAD_SECTOR: 3, READ_ERROR: 5, WRITE_ERROR: 6, BAD_COMMAND: 7 };

    /** The formats an image of this size may be (two 200K formats share a size). */
    function formatsOfSize(size) {
        return Object.keys(FORMATS).filter(id => FORMATS[id].size === size);
    }

    function formatOfSize(size) {
        const ids = formatsOfSize(size);
        return ids.length === 1 ? ids[0] : null;
    }

    /** A disk: an image plus its format. `data` is used in place. */
    class Disk {
        constructor(format, data = null, { name = '', readOnly = false, origin = '' } = {}) {
            const f = FORMATS[format];
            if (!f) throw new Error(`unknown disk format '${format}'`);
            this.format = format;
            this.code = f.code;
            this.tracks = f.tracks;
            this.spt = f.spt;
            this.seclen = f.seclen;
            this.sectors = f.sectors;
            this.data = data || new Uint8Array(f.size).fill(0xE5);
            if (this.data.length !== f.size) throw new Error(`a ${format} image is ${f.size} bytes, not ${this.data.length}`);
            this.name = name;
            this.readOnly = readOnly;
            /** Where it came from in SHELF ('shelf:id', 'private:id', 'my:id'), else ''. */
            this.origin = origin;
            this.dirty = false;
        }

        /** An image whose size names one format (cpmfs.diskFromImage also settles the others). */
        static fromImage(data, options) {
            const format = formatOfSize(data.length);
            if (!format) {
                if (formatsOfSize(data.length).length) throw new Error(`${data.length} bytes fits more than one format`);
                throw new Error(`no disk format is ${data.length} bytes`);
            }
            return new Disk(format, data, options);
        }

        /** Byte offset of 128-byte record `sector` (1-based) of `track`, in the image. */
        offset(track, sector) {
            const rec = sector - 1;
            if (this.seclen === SECTOR) return (track * this.sectors + rec) * SECTOR;
            const per = this.seclen / SECTOR;
            return (track * this.sectors + Math.floor(rec / per)) * this.seclen + (rec % per) * SECTOR;
        }
    }

    class FDC {
        constructor(memory) {
            this.memory = memory;
            this.drives = new Array(16).fill(null);
            this.drive = 0;
            this.track = 0;
            this.sector = 1;
            this.dma = 0x80;
            this.status = STATUS.OK;
            /** Called with (drive, 'read' | 'write') on every transfer: for the LEDs. */
            this.onActivity = null;
            /** Called with (drive) after a write changed a disk: for saving. */
            this.onWrite = null;
        }

        mount(drive, disk) { this.drives[drive] = disk; }
        eject(drive) { this.drives[drive] = null; }

        out(port, value) {
            switch (port) {
                case 10: this.drive = value & 0x0F; break;
                case 11: this.track = value; break;
                case 12: this.sector = (this.sector & 0xFF00) | value; break;
                case 17: this.sector = (this.sector & 0x00FF) | (value << 8); break;
                case 15: this.dma = (this.dma & 0xFF00) | value; break;
                case 16: this.dma = (this.dma & 0x00FF) | (value << 8); break;
                case 13: this.status = this.command(value); break;
            }
        }

        in(port) {
            if (port === 14) return this.status;
            if (port === 10) return this.drives[this.drive] ? 0xFF : 0x00;
            if (port === 18) return this.drives[this.drive] ? this.drives[this.drive].code : 0xFF;
            return 0xFF;
        }

        command(cmd) {
            const disk = this.drives[this.drive];
            if (!disk) return STATUS.NO_DRIVE;
            if (this.track >= disk.tracks) return STATUS.BAD_TRACK;
            if (this.sector < 1 || this.sector > disk.spt) return STATUS.BAD_SECTOR;
            const off = disk.offset(this.track, this.sector);
            const mem = this.memory;
            if (cmd === 0) {
                for (let i = 0; i < SECTOR; i++) mem[(this.dma + i) & 0xFFFF] = disk.data[off + i];
                if (this.onActivity) this.onActivity(this.drive, 'read');
                return STATUS.OK;
            }
            if (cmd === 1) {
                if (disk.readOnly) return STATUS.WRITE_ERROR;
                for (let i = 0; i < SECTOR; i++) disk.data[off + i] = mem[(this.dma + i) & 0xFFFF];
                disk.dirty = true;
                if (this.onActivity) this.onActivity(this.drive, 'write');
                if (this.onWrite) this.onWrite(this.drive);
                return STATUS.OK;
            }
            return STATUS.BAD_COMMAND;
        }
    }

    const api = { FDC, Disk, FORMATS, STATUS, SECTOR, formatOfSize, formatsOfSize };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else Object.assign(root.DigitalRerun = root.DigitalRerun || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
