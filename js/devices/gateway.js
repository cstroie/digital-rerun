/*
 * gateway.js: the way out to a telnet host, through tools/modem-bridge.js
 * (a browser cannot open a TCP connection itself). `ATDT host:port` on the
 * modem comes here when the host is no number of the built-in directory.
 *
 * The page opens a WebSocket to the bridge (`/connect?host=..&port=..&token=..`).
 * The bridge makes the TCP connection and says "connected" as a text message;
 * after that binary messages carry the bytes both ways, through Telnet
 * (js/devices/telnet.js). If it cannot connect it closes with a code that
 * says why, and the modem answers as a phone would:
 *   no bridge at the URL        NO DIALTONE
 *   4001 refused by the bridge  NO CARRIER
 *   4002 connection refused     BUSY
 *   4003 no answer in time      NO ANSWER
 *   4004 anything else          NO CARRIER
 * An https page can reach only wss:// or ws://localhost.
 *
 * Ports 6660-6669 are IRC's: there the bytes go through raw, with no telnet in
 * between (no CR NUL, no doubled 255, no negotiation) and no local echo, since
 * an IRC server is no telnet host and never offers to echo.
 */
(function (root) {
    'use strict';

    const node = typeof module !== 'undefined' && module.exports;
    const { Telnet } = node ? require('./telnet.js') : root.DigitalRerun;

    const REASONS = { 4002: 'BUSY', 4003: 'NO ANSWER' };
    const RAW_PORTS = [6660, 6661, 6662, 6663, 6664, 6665, 6666, 6667, 6668, 6669];

    class Gateway {
        /** `url`: the bridge, e.g. ws://localhost:1984; `token`: its secret; `rawPorts`: the ports whose bytes go through untouched (IRC's). */
        constructor({ url, token = '', WebSocketClass = root.WebSocket, rawPorts = RAW_PORTS } = {}) {
            this.url = url;
            this.rawPorts = rawPorts;
            this.token = token;
            this.WebSocketClass = WebSocketClass;
        }

        /** Same shape as a directory entry's answer: a Promise of the other end, or of the reason it did not answer. */
        dial(host, port, link) {
            return new Promise(resolve => {
                let ws;
                try {
                    const u = new URL(this.url);
                    u.pathname = '/connect';
                    u.search = new URLSearchParams({ host, port: String(port), ...(this.token ? { token: this.token } : {}) }).toString();
                    ws = new this.WebSocketClass(u.href);
                } catch (e) { return resolve('NO DIALTONE'); }
                ws.binaryType = 'arraybuffer';
                const raw = this.rawPorts.includes(Number(port));
                const telnet = new Telnet({ send: bytes => { if (ws.readyState === 1) ws.send(Uint8Array.from(bytes)); } });
                let reached = false, up = false;
                const remote = {
                    send: byte => {
                        if (ws.readyState !== 1) return;
                        if (raw) { ws.send(Uint8Array.of(byte)); return; }
                        ws.send(Uint8Array.from(telnet.encode(byte)));
                        // a server that has not taken over the echo (a MUD such as Aardwolf) leaves it to us
                        if (!telnet.serverEchoes()) link.receive(byte === 13 ? [13, 10] : [byte]);
                    },
                    close: () => { try { ws.close(1000); } catch (e) { /* gone */ } }
                };
                ws.onopen = () => { reached = true; };
                ws.onmessage = ev => {
                    if (typeof ev.data === 'string') { if (ev.data === 'connected' && !up) { up = true; resolve(remote); } return; }
                    const data = raw ? new Uint8Array(ev.data) : telnet.feed(new Uint8Array(ev.data));
                    if (data.length) link.receive(data);
                };
                ws.onclose = ev => {
                    if (up) link.hangup();
                    else resolve(!reached ? 'NO DIALTONE' : REASONS[ev.code] || 'NO CARRIER');
                };
                ws.onerror = () => { /* the close that follows says it */ };
            });
        }
    }

    const api = { Gateway };
    if (node) module.exports = api;
    else Object.assign(root.DigitalRerun = root.DigitalRerun || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
