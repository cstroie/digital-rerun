/*
 * gateway.js: the way out to a telnet host, through tools/coupler.js
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
 * Ports 6660-6669 (IRC), 13 (daytime), 37 (time), 70 (gopher), 79 (finger) and 119 (NNTP) are
 * no telnet hosts: there the bytes go through raw, with no telnet in between (no
 * CR NUL, no doubled 255, no negotiation) and no local echo. What the program
 * sends there goes out a line at a time (at LF, or after QUIET ms with nothing
 * more, or LINE_MAX bytes): the modem gives it a byte at a time, and a small
 * server (graph.no's finger, a gopher hole) reads its question with one read, so
 * a question in pieces would be a question cut short. Telnet ports go a byte at
 * a time: a key of a game or a menu must go at once.
 *
 * Port 1965 is Gemini's: raw too, and the bridge is asked to speak TLS to the host
 * (&tls=1), since the 8080 cannot; the page and the program see plain bytes.
 * Port 563 (NNTP over TLS, Usenet) is the same.
 */
(function (root) {
    'use strict';

    const node = typeof module !== 'undefined' && module.exports;
    const { Telnet } = node ? require('./telnet.js') : root.DigitalRerun;

    const REASONS = { 4002: 'BUSY', 4003: 'NO ANSWER' };      // 4001 not allowed, 4004 failed, 4005 a changed certificate: NO CARRIER
    const QUIET = 50, LINE_MAX = 1024;
    const TLS_PORTS = [563, 1965];
    const RAW_PORTS = [13, 37, 70, 79, 119, 563, 1965, 6660, 6661, 6662, 6663, 6664, 6665, 6666, 6667, 6668, 6669];

    class Gateway {
        /** `url`: the bridge, e.g. ws://localhost:1984; `token`: its secret; `rawPorts`: the ports whose bytes go through untouched (IRC, daytime, time, gopher, finger, NNTP). */
        constructor({ url, token = '', WebSocketClass = root.WebSocket, rawPorts = RAW_PORTS, tlsPorts = TLS_PORTS } = {}) {
            this.url = url;
            this.rawPorts = rawPorts;
            this.tlsPorts = tlsPorts;
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
                    u.search = new URLSearchParams({ host, port: String(port), ...(this.token ? { token: this.token } : {}), ...(this.tlsPorts.includes(Number(port)) ? { tls: '1' } : {}) }).toString();
                    ws = new this.WebSocketClass(u.href);
                } catch (e) { return resolve('NO DIALTONE'); }
                ws.binaryType = 'arraybuffer';
                const raw = this.rawPorts.includes(Number(port));
                const telnet = new Telnet({ send: bytes => { if (ws.readyState === 1) ws.send(Uint8Array.from(bytes)); } });
                let reached = false, up = false;
                let held = [], timer = null;
                const flush = () => {
                    if (timer) { clearTimeout(timer); timer = null; }
                    if (held.length && ws.readyState === 1) ws.send(Uint8Array.from(held));
                    held = [];
                };
                const remote = {
                    send: byte => {
                        if (ws.readyState !== 1) return;
                        if (raw) {
                            held.push(byte);
                            if (byte === 10 || held.length >= LINE_MAX) return flush();
                            if (timer) clearTimeout(timer);
                            timer = setTimeout(flush, QUIET);
                            return;
                        }
                        ws.send(Uint8Array.from(telnet.encode(byte)));
                        // a server that has not taken over the echo (a MUD such as Aardwolf) leaves it to us
                        if (!telnet.serverEchoes()) link.receive(byte === 13 ? [13, 10] : [byte]);
                    },
                    close: () => { flush(); try { ws.close(1000); } catch (e) { /* gone */ } }
                };
                ws.onopen = () => { reached = true; };
                ws.onmessage = ev => {
                    if (typeof ev.data === 'string') { if (ev.data === 'connected' && !up) { up = true; resolve(remote); } return; }
                    const data = raw ? new Uint8Array(ev.data) : telnet.feed(new Uint8Array(ev.data));
                    if (data.length) link.receive(data);
                };
                ws.onclose = ev => {
                    if (timer) { clearTimeout(timer); timer = null; }
                    if (up) link.hangup();
                    else resolve(!reached ? 'NO DIALTONE' : REASONS[ev.code] || 'NO CARRIER');
                };
                // before it opened: no bridge there (some WebSockets never send the close after it); after, the close says it
                ws.onerror = () => { if (!reached) resolve('NO DIALTONE'); };
            });
        }
    }

    const api = { Gateway };
    if (node) module.exports = api;
    else Object.assign(root.DigitalRerun = root.DigitalRerun || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
