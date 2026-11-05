/*
 * reference.js: the reference desk's tables and its number converter. Plain
 * data and pure functions; js/doors.js shows them.
 */
(function (root) {
    'use strict';

    const CONTROL = ['NUL', 'SOH', 'STX', 'ETX', 'EOT', 'ENQ', 'ACK', 'BEL', 'BS', 'HT', 'LF', 'VT', 'FF', 'CR', 'SO', 'SI', 'DLE', 'DC1', 'DC2', 'DC3', 'DC4', 'NAK', 'SYN', 'ETB', 'CAN', 'EM', 'SUB', 'ESC', 'FS', 'GS', 'RS', 'US'];

    /** The name of a character code: a control name, SP, DEL, or the character. */
    function charName(n) {
        if (n < 32) return CONTROL[n];
        if (n === 32) return 'SP';
        if (n === 127) return 'DEL';
        return String.fromCharCode(n);
    }

    /** The ASCII chart: 16 rows (low nibble) by 8 columns (high nibble). */
    function asciiChart() {
        const lines = ['     0    1    2    3    4    5    6    7'];
        for (let lo = 0; lo < 16; lo++) {
            let row = ' ' + lo.toString(16).toUpperCase() + '  ';
            for (let hi = 0; hi < 8; hi++) row += charName(hi * 16 + lo).padEnd(5);
            lines.push(row.trimEnd());
        }
        return lines;
    }

    const BDOS = [
        [0, 'SYSTEM RESET', '-'], [1, 'CONSOLE INPUT', 'A=char'], [2, 'CONSOLE OUTPUT', 'E=char'], [3, 'READER INPUT', 'A=char'],
        [4, 'PUNCH OUTPUT', 'E=char'], [5, 'LIST OUTPUT', 'E=char'], [6, 'DIRECT CONSOLE I/O', 'E=FFh in: A=char or 0'], [9, 'PRINT STRING', 'DE=addr of $-string'],
        [10, 'READ CONSOLE BUFFER', 'DE=buffer (max, len, text)'], [11, 'CONSOLE STATUS', 'A=FFh if a key waits'], [12, 'RETURN VERSION', 'HL=0022h for 2.2'],
        [13, 'RESET DISK SYSTEM', '-'], [14, 'SELECT DISK', 'E=0 for A:'], [15, 'OPEN FILE', 'DE=FCB; A=FFh fails'], [16, 'CLOSE FILE', 'DE=FCB'],
        [17, 'SEARCH FIRST', 'DE=FCB; A=0-3 found'], [18, 'SEARCH NEXT', '-'], [19, 'DELETE FILE', 'DE=FCB'], [20, 'READ SEQUENTIAL', 'DE=FCB; A=0 ok'],
        [21, 'WRITE SEQUENTIAL', 'DE=FCB; A=0 ok'], [22, 'MAKE FILE', 'DE=FCB; A=FFh fails'], [23, 'RENAME FILE', 'DE=FCB'], [25, 'RETURN CURRENT DISK', 'A=0 for A:'],
        [26, 'SET DMA ADDRESS', 'DE=addr (default 0080h)'], [32, 'GET/SET USER CODE', 'E=FFh gets, else sets'], [33, 'READ RANDOM', 'DE=FCB; A=0 ok'],
        [34, 'WRITE RANDOM', 'DE=FCB; A=0 ok'], [35, 'COMPUTE FILE SIZE', 'DE=FCB; r0-r2 set'], [36, 'SET RANDOM RECORD', 'DE=FCB']
    ];

    const BIOS = [['BOOT', 'cold start'], ['WBOOT', 'warm start'], ['CONST', 'console status'], ['CONIN', 'console in'], ['CONOUT', 'console out, C=char'],
        ['LIST', 'list out, C=char'], ['PUNCH', 'punch out, C=char'], ['READER', 'reader in'], ['HOME', 'track 0'], ['SELDSK', 'select disk, C=drive'],
        ['SETTRK', 'set track, BC'], ['SETSEC', 'set sector, BC'], ['SETDMA', 'set DMA, BC'], ['READ', 'read the sector'], ['WRITE', 'write the sector'],
        ['LISTST', 'list status'], ['SECTRAN', 'sector translate']];

    const AT = [['AT', 'attention: the modem answers OK'], ['ATZ', 'reset to the settings you stored'], ['AT&F', 'factory settings'], ['ATE0 / ATE1', 'echo off / on'],
        ['ATV0 / ATV1', 'numeric / word results'], ['ATQ1', 'no results at all'], ['ATX4', 'every result code'], ['ATI3', 'what modem is this'],
        ['ATDT 5550100', 'dial (tone); a host name with a gateway'], ['ATH', 'hang up'], ['ATO', 'back online after +++'], ['+++', 'wait a second, type it, wait a second: command mode'],
        ['ATS12=50', 'set a register (guard time in 1/50 s)'], ['ATS12?', 'read a register'], ['A/', 'again: repeat the last command']];

    const OPCODES = [['00', 'NOP', 'NOP'], ['01 nn nn', 'LXI B,nn', 'LD BC,nn'], ['06 n', 'MVI B,n', 'LD B,n'], ['3E n', 'MVI A,n', 'LD A,n'], ['3A nn nn', 'LDA nn', 'LD A,(nn)'],
        ['32 nn nn', 'STA nn', 'LD (nn),A'], ['21 nn nn', 'LXI H,nn', 'LD HL,nn'], ['7E', 'MOV A,M', 'LD A,(HL)'], ['77', 'MOV M,A', 'LD (HL),A'], ['3C', 'INR A', 'INC A'],
        ['3D', 'DCR A', 'DEC A'], ['AF', 'XRA A', 'XOR A'], ['FE n', 'CPI n', 'CP n'], ['E6 n', 'ANI n', 'AND n'], ['C3 nn nn', 'JMP nn', 'JP nn'], ['C2 nn nn', 'JNZ nn', 'JP NZ,nn'],
        ['CA nn nn', 'JZ nn', 'JP Z,nn'], ['CD nn nn', 'CALL nn', 'CALL nn'], ['C9', 'RET', 'RET'], ['C5', 'PUSH B', 'PUSH BC'], ['C1', 'POP B', 'POP BC'], ['DB n', 'IN n', 'IN A,(n)'],
        ['D3 n', 'OUT n', 'OUT (n),A'], ['EB', 'XCHG', 'EX DE,HL'], ['76', 'HLT', 'HALT'], ['FB / F3', 'EI / DI', 'EI / DI'], ['18 e', '-', 'JR e'], ['10 e', '-', 'DJNZ e'],
        ['ED B0', '-', 'LDIR'], ['CB xx', '-', 'bit, set, res, shifts']];

    const VT100 = [['ESC [ 2 J', 'clear the screen'], ['ESC [ H', 'cursor home'], ['ESC [ r ; c H', 'cursor to row r, column c'], ['ESC [ K', 'erase to end of line'],
        ['ESC [ A B C D', 'cursor up, down, right, left'], ['ESC [ 1 m', 'bold'], ['ESC [ 4 m', 'underline'], ['ESC [ 5 m', 'blink'], ['ESC [ 7 m', 'reverse'],
        ['ESC [ 0 m', 'all attributes off'], ['ESC 7  /  ESC 8', 'save / restore the cursor'], ['ESC [ t ; b r', 'scroll region, top and bottom rows']];

    /** A number as typed -> integer, or null. 255, 0xFF, $FF, FFh, 0b1010, %1010, 'A'. */
    function parseNumber(text) {
        const t = String(text).trim();
        if (!t) return null;
        let m;
        if ((m = /^'(.)'$/.exec(t))) return m[1].charCodeAt(0);
        if ((m = /^(?:0x|\$)([0-9a-f]+)$/i.exec(t)) || (m = /^([0-9a-f]+)h$/i.exec(t))) return parseInt(m[1], 16);
        if ((m = /^(?:0b|%)([01]+)$/i.exec(t))) return parseInt(m[1], 2);
        if ((m = /^(?:0o|@)([0-7]+)$/i.exec(t))) return parseInt(m[1], 8);
        if (/^\d+$/.test(t)) return parseInt(t, 10);
        return null;
    }

    /** The lines that show one number every way. */
    function showNumber(n) {
        const bits = n > 0xFFFF ? 32 : n > 0xFF ? 16 : 8;
        const hex = n.toString(16).toUpperCase().padStart(bits / 4, '0');
        const bin = n.toString(2).padStart(bits, '0').replace(/(.{4})(?=.)/g, '$1 ');
        const lines = [`DEC ${n}`, `HEX ${hex}h  (0x${hex})`, `BIN ${bin}`, `OCT ${n.toString(8)}`];
        if (n < 128) lines.push(`CHR ${charName(n)}`);
        const signed = n >= 1 << (bits - 1) ? n - 2 ** bits : n;
        if (signed < 0) lines.push(`SIGNED ${signed} (${bits}-bit)`);
        return lines;
    }

    const api = { charName, asciiChart, BDOS, BIOS, AT, OPCODES, VT100, parseNumber, showNumber, CONTROL };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else Object.assign(root.DigitalRerun = root.DigitalRerun || {}, { reference: api });
})(typeof window !== 'undefined' ? window : globalThis);
