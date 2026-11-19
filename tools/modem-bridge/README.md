# modem-bridge (C)

The modem bridge of [`../modem-bridge.js`](../modem-bridge.js), in C, for a machine without Node.js: a small
Linux box, a Raspberry Pi, a router. It lets the browser's modem dial telnet hosts, IRC servers and gopher
holes (a page cannot open a TCP connection itself). Same options, same protocol, same close codes and the
same token as the JavaScript one, so DEVICES does not change. One file, no dependencies, POSIX (Linux, the
BSDs, macOS): about 35K on disk, 2 MB in memory, where Node takes about 45.

```
make                     build ./modem-bridge  (or: cc -O2 -o modem-bridge modem-bridge.c -lpthread)
make install             to /usr/local/bin  (PREFIX=, DESTDIR=)
../bridge.sh             runs it, with the board's directory allowed, once it is built
```

```
modem-bridge --allow=<hosts> [--port=1984] [--bind=127.0.0.1] [--token=<secret> | --seed=<salt>]
             [--show-token] [--origin=<page origin>[,...]] [--timeout=10] [--max=8] [--allow-private]
```

- `--allow`: what may be dialed, comma separated: `host`, `host:port`, `*.domain`, an IPv4 block such as
  `192.168.0.0/16` (literal addresses only, no DNS), `*` for any public host. Required.
- `--token`: the secret the page sends. By default it is worked out from this machine's name, your user name
  and the port (and `--seed`): three words and four hex digits, the same every run. `--show-token` prints it.
- `--origin` limits the pages that may connect; `--max` the connections at once; `--timeout` the seconds to
  connect; `--allow-private` lets `*` reach private and loopback addresses. `--port=0` takes a free port.

The page connects to `ws://<bind>:<port>/connect?host=<h>&port=<p>&token=<t>`; the bridge makes the TCP
connection, says `connected`, then passes bytes both ways untouched. It closes with 4001 (not allowed),
4002 (refused), 4003 (no answer in time) or 4004 (anything else). It speaks `ws:`: an https page reaches
it on localhost only, or through a TLS reverse proxy. It logs the host dialed, never what is said.

A thread per connection, blocking sockets; SHA-1 (the handshake) and SHA-256 (the token) are in the file.
`test/bridge-c.test.js` builds it and runs the checks the JavaScript bridge passes (it is skipped without a C
compiler).
