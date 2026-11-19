# modem-bridge (C)

The modem bridge of [`../modem-bridge.js`](../modem-bridge.js), in C, for a machine without Node.js: a small
Linux box, a Raspberry Pi, a router. It lets the browser's modem dial telnet hosts, IRC servers and gopher
holes (a page cannot open a TCP connection itself). Same options, same protocol, same close codes and the
same token as the JavaScript one, so DEVICES does not change. One file, no dependencies, POSIX (Linux, the
BSDs, macOS): about 35K on disk, 2 MB in memory, where Node takes about 45.

```
make                     build ./modem-bridge  (or: cc -O2 -o modem-bridge modem-bridge.c -lpthread)
make TLS=1               with TLS to the host, for Gemini (OpenSSL: libssl-dev, openssl-devel)
make install             to /usr/local/bin  (PREFIX=, DESTDIR=)
../bridge.sh             runs it, with the board's directory allowed, once it is built
```

```
modem-bridge --allow=<hosts> [--port=1984] [--bind=127.0.0.1] [--token=<secret> | --seed=<salt>]
             [--show-token] [--origin=<page origin>[,...]] [--timeout=10] [--max=8] [--allow-private]
             [--known=<file>] [--ping=30] [--cgi]
```

- `--allow`: what may be dialed, comma separated: `host`, `host:port`, `*.domain`, an IPv4 block such as
  `192.168.0.0/16` (literal addresses only, no DNS), `*` for any public host. Required.
- `--token`: the secret the page sends. By default it is worked out from this machine's name, your user name
  and the port (and `--seed`): three words and four hex digits, the same every run. `--show-token` prints it.
- `--origin` limits the pages that may connect; `--max` the connections at once; `--timeout` the seconds to
  connect; `--allow-private` lets `*` reach private and loopback addresses. `--port=0` takes a free port.
- `--ping`: a WebSocket ping after so many seconds of a quiet call (30; 0 none), so proxies and NATs keep long calls.
- Every option may also come from the environment: `MODEM_BRIDGE_` and its name (`MODEM_BRIDGE_ALLOW`,
  `MODEM_BRIDGE_ALLOW_PRIVATE` ...); the command line wins.

**As a CGI** (`--cgi`, or found by itself when the web server sets `GATEWAY_INTERFACE`): no daemon. The web server
runs it for each call, with the request in the environment and the WebSocket on stdin and stdout; lighttpd does this
with `cgi.upgrade = "enable"`. It then takes its options from the environment (`MODEM_BRIDGE_TOKEN` is required: a
CGI without one refuses every call) and logs to stderr (lighttpd's `server.breakagelog`). The recipe is in
[docs/modem.md](../../docs/modem.md#behind-https-lighttpd); `test/lighttpd.test.js` runs it under a real lighttpd
(the WebSocket upgrade of HTTP/1.1; a browser's HTTP/2 WebSocket over https is not tested).

The page connects to `ws://<bind>:<port>/connect?host=<h>&port=<p>&token=<t>`; the bridge makes the TCP
connection, says `connected`, then passes bytes both ways untouched. It closes with 4001 (not allowed),
4002 (refused), 4003 (no answer in time), 4004 (anything else) or 4005 (a changed certificate).

**TLS** (`make TLS=1`): with `&tls=1` it speaks TLS to the host and plain bytes to the page; the page's gateway
asks for it on Gemini's port, 1965. Capsules sign their own certificates, so none is checked against authorities:
the first one a host shows is kept in `--known` (default `~/.modem-bridge-known`, a line `host:port sha256`, the
same file as the JavaScript bridge's) and another one later is refused with 4005, as ssh does. Built without TLS,
such a call is refused (4004) and the log says to build with `TLS=1`. It speaks `ws:`: an https page reaches
it on localhost only, or through a TLS reverse proxy (the lighttpd recipe is in
[docs/modem.md](../../docs/modem.md#behind-https-lighttpd)). It logs the host dialed, never what is said.

A thread per connection, blocking sockets (the TLS one non-blocking once it is up: a TLS record without data
must not stall it); SHA-1 (the handshake) and SHA-256 (the token) are in the file, TLS is OpenSSL's.
`test/bridge-c.test.js` builds it and runs the checks the JavaScript bridge passes (it is skipped without a C
compiler).
