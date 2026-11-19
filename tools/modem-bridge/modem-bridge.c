/*
 * modem-bridge.c: the modem bridge of tools/modem-bridge.js in C, for a machine without
 * Node.js (a small Linux box, a Raspberry Pi, a router). The same options, the same
 * protocol, the same close codes, the same token: the page cannot tell them apart.
 *
 *   make -C tools/modem-bridge        (or: cc -O2 -o modem-bridge modem-bridge.c -lpthread)
 *   tools/modem-bridge/modem-bridge --allow=<hosts> [--port=1984] [--bind=127.0.0.1]
 *        [--token=<secret> | --seed=<salt>] [--show-token] [--origin=<page origin>[,...]]
 *        [--timeout=10] [--max=8] [--allow-private] [--known=<file>] [--ping=30] [--cgi]
 *
 * See tools/modem-bridge.js for what each option means. The page connects to
 * ws://<bind>:<port>/connect?host=<h>&port=<p>&token=<t>; the bridge makes the TCP
 * connection, sends the text message "connected", then passes bytes both ways as binary
 * messages, untouched. If it cannot connect it closes the WebSocket with 4001 not
 * allowed, 4002 refused, 4003 no answer in time, 4004 other. It logs the host dialed
 * and nothing of what is said. --port=0 takes any free port (the line it prints says which).
 *
 * With &tls=1 it speaks TLS to the host (Gemini, port 1965) and plain bytes to the page:
 * built with `make TLS=1` (OpenSSL), else such a call is refused (4004). The certificate
 * is trusted the first time and kept in the --known file (default ~/.modem-bridge-known,
 * `host:port sha256` a line); another one later is refused with 4005.
 *
 * As a CGI (lighttpd with cgi.upgrade = "enable", or --cgi): no daemon; the web server runs it for
 * each call, the request in the environment, the WebSocket on stdin and stdout, the options as
 * MODEM_BRIDGE_ALLOW, MODEM_BRIDGE_TOKEN (required), MODEM_BRIDGE_ORIGIN ... (docs/modem.md).
 * A quiet call gets a ping every --ping seconds (30; 0 none), so proxies and NATs keep it.
 *
 * POSIX only (Linux, the BSDs, macOS): a thread for each connection, blocking sockets.
 * No dependencies; SHA-1 (the handshake) and SHA-256 (the token) are here.
 *
 * Copyright (c) 2026 Costin Stroie, MIT licence.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <arpa/inet.h>
#include <netdb.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <poll.h>
#include <pthread.h>
#include <pwd.h>
#include <signal.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <time.h>
#include <fcntl.h>
#include <unistd.h>
#ifdef WITH_TLS
#include <openssl/ssl.h>
#include <openssl/x509.h>
#include <openssl/evp.h>
#endif

#define DEFAULT_PORT 1984
#define MAX_FRAME (1 << 20)
#define MAX_HEAD 8192
#define GUID "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

static const char *WORDS[64] = { "relay", "comet", "lantern", "signal", "carrier", "phosphor", "beacon", "orbit", "kettle", "pixel", "cipher", "vector", "static", "ghost", "neon", "quartz",
    "binary", "socket", "packet", "modem", "daemon", "kernel", "buffer", "tensor", "photon", "plasma", "nebula", "zenith", "cobalt", "amber", "raven", "ember",
    "falcon", "harbor", "island", "jungle", "lumen", "matrix", "nimbus", "onyx", "prism", "radar", "sonar", "tundra", "umbra", "valve", "warp", "xenon",
    "yonder", "zephyr", "argon", "bishop", "copper", "dynamo", "echo", "fusion", "gravity", "helix", "ion", "jade", "krypton", "laser", "meteor", "nova" };

/* ---------- the options ---------- */

static char **allow_list = NULL;   /* the --allow entries, lower case */
static int allow_n = 0;
static char **origin_list = NULL;  /* --origin, or NULL for any */
static int origin_n = 0;
static char token[256] = "";
static int timeout_s = 10, max_conn = 8, allow_private = 0;
static int ping_s = 30;             /* a ping after so many seconds of a quiet call (0: none) */
static int cgi_mode = 0;            /* run by a web server as a CGI: the call on stdin and stdout */
static char known_file[1024] = "";  /* the certificates of TLS hosts; empty: none kept */
#ifdef WITH_TLS
static pthread_mutex_t known_lock = PTHREAD_MUTEX_INITIALIZER;
#endif

static int active = 0;
static pthread_mutex_t active_lock = PTHREAD_MUTEX_INITIALIZER;

/* ---------- logging: HH:MM:SS (UTC) and the text, on stderr ---------- */

static void logf_(const char *fmt, ...) {
    char when[16];
    time_t t = time(NULL);
    struct tm tm;
    gmtime_r(&t, &tm);
    strftime(when, sizeof when, "%H:%M:%S", &tm);
    va_list ap;
    va_start(ap, fmt);
    flockfile(stderr);
    fprintf(stderr, "%s ", when);
    vfprintf(stderr, fmt, ap);
    fputc('\n', stderr);
    funlockfile(stderr);
    va_end(ap);
}

/* ---------- SHA-1 and SHA-256 ---------- */

#define ROL(x, n) (((x) << (n)) | ((x) >> (32 - (n))))
#define ROR(x, n) (((x) >> (n)) | ((x) << (32 - (n))))

static void sha1(const unsigned char *msg, size_t len, unsigned char out[20]) {
    uint32_t h[5] = { 0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0 };
    size_t total = ((len + 8) / 64 + 1) * 64;
    unsigned char *m = calloc(total, 1);
    if (!m) abort();
    memcpy(m, msg, len);
    m[len] = 0x80;
    uint64_t bits = (uint64_t)len * 8;
    for (int i = 0; i < 8; i++) m[total - 1 - i] = (unsigned char)(bits >> (8 * i));
    for (size_t off = 0; off < total; off += 64) {
        uint32_t w[80];
        for (int i = 0; i < 16; i++) w[i] = (uint32_t)m[off + 4 * i] << 24 | (uint32_t)m[off + 4 * i + 1] << 16 | (uint32_t)m[off + 4 * i + 2] << 8 | m[off + 4 * i + 3];
        for (int i = 16; i < 80; i++) w[i] = ROL(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
        uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4];
        for (int i = 0; i < 80; i++) {
            uint32_t f, k;
            if (i < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
            else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
            else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
            else { f = b ^ c ^ d; k = 0xCA62C1D6; }
            uint32_t t = ROL(a, 5) + f + e + k + w[i];
            e = d; d = c; c = ROL(b, 30); b = a; a = t;
        }
        h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e;
    }
    free(m);
    for (int i = 0; i < 5; i++) for (int j = 0; j < 4; j++) out[4 * i + j] = (unsigned char)(h[i] >> (24 - 8 * j));
}

static void sha256(const unsigned char *msg, size_t len, unsigned char out[32]) {
    static const uint32_t K[64] = {
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2 };
    uint32_t h[8] = { 0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19 };
    size_t total = ((len + 8) / 64 + 1) * 64;
    unsigned char *m = calloc(total, 1);
    if (!m) abort();
    memcpy(m, msg, len);
    m[len] = 0x80;
    uint64_t bits = (uint64_t)len * 8;
    for (int i = 0; i < 8; i++) m[total - 1 - i] = (unsigned char)(bits >> (8 * i));
    for (size_t off = 0; off < total; off += 64) {
        uint32_t w[64];
        for (int i = 0; i < 16; i++) w[i] = (uint32_t)m[off + 4 * i] << 24 | (uint32_t)m[off + 4 * i + 1] << 16 | (uint32_t)m[off + 4 * i + 2] << 8 | m[off + 4 * i + 3];
        for (int i = 16; i < 64; i++) {
            uint32_t s0 = ROR(w[i - 15], 7) ^ ROR(w[i - 15], 18) ^ (w[i - 15] >> 3);
            uint32_t s1 = ROR(w[i - 2], 17) ^ ROR(w[i - 2], 19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16] + s0 + w[i - 7] + s1;
        }
        uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
        for (int i = 0; i < 64; i++) {
            uint32_t S1 = ROR(e, 6) ^ ROR(e, 11) ^ ROR(e, 25), ch = (e & f) ^ (~e & g);
            uint32_t t1 = hh + S1 + ch + K[i] + w[i];
            uint32_t S0 = ROR(a, 2) ^ ROR(a, 13) ^ ROR(a, 22), maj = (a & b) ^ (a & c) ^ (b & c);
            uint32_t t2 = S0 + maj;
            hh = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
        }
        h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
    }
    free(m);
    for (int i = 0; i < 8; i++) for (int j = 0; j < 4; j++) out[4 * i + j] = (unsigned char)(h[i] >> (24 - 8 * j));
}

static void base64(const unsigned char *in, size_t len, char *out) {
    static const char T[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    size_t o = 0;
    for (size_t i = 0; i < len; i += 3) {
        uint32_t v = (uint32_t)in[i] << 16 | (i + 1 < len ? (uint32_t)in[i + 1] << 8 : 0) | (i + 2 < len ? in[i + 2] : 0);
        out[o++] = T[(v >> 18) & 63];
        out[o++] = T[(v >> 12) & 63];
        out[o++] = i + 1 < len ? T[(v >> 6) & 63] : '=';
        out[o++] = i + 2 < len ? T[v & 63] : '=';
    }
    out[o] = 0;
}

/* ---------- the token: worked out from the machine's name, the user, the port and a salt ---------- */

static void seed_token(int port, const char *salt, char *out, size_t size) {
    char host[256] = "", buf[1024];
    if (gethostname(host, sizeof host) != 0) strcpy(host, "localhost");
    host[sizeof host - 1] = 0;
    const char *user = "user";
    struct passwd *pw = getpwuid(getuid());
    if (pw && pw->pw_name) user = pw->pw_name;
    int n = snprintf(buf, sizeof buf, "digitalrerun|%s|%s|%d|%s", host, user, port, salt);
    unsigned char h[32];
    sha256((const unsigned char *)buf, (size_t)(n < (int)sizeof buf ? n : (int)sizeof buf - 1), h);
    snprintf(out, size, "%s-%s-%s-%02x%02x", WORDS[h[0] & 63], WORDS[h[1] & 63], WORDS[h[2] & 63], h[3], h[4]);
}

/* ---------- the allow list ---------- */

/* a dotted IPv4 literal into *v; 0 if it is not one */
static int ipv4(const char *s, uint32_t *v) {
    unsigned a[4];
    char tail;
    if (sscanf(s, "%u.%u.%u.%u%c", &a[0], &a[1], &a[2], &a[3], &tail) != 4) return 0;
    for (int i = 0; i < 4; i++) if (a[i] > 255) return 0;
    for (const char *p = s; *p; p++) if (!(*p >= '0' && *p <= '9') && *p != '.') return 0;
    *v = a[0] << 24 | a[1] << 16 | a[2] << 8 | a[3];
    return 1;
}

static int ends_with(const char *s, const char *tail) {
    size_t n = strlen(s), m = strlen(tail);
    return n >= m && strcmp(s + n - m, tail) == 0;
}

/* a private, loopback or link-local address, or a local name (literally: no DNS) */
static int is_private(const char *host) {
    if (!strcmp(host, "localhost") || ends_with(host, ".localhost") || ends_with(host, ".local") || ends_with(host, ".internal")) return 1;
    uint32_t v;
    if (ipv4(host, &v)) {
        unsigned a = v >> 24, b = (v >> 16) & 255;
        return a == 10 || a == 127 || a == 0 || (a == 169 && b == 254) || (a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168) || (a == 100 && b >= 64 && b <= 127);
    }
    return strchr(host, ':') != NULL;
}

/* host (lower case) and port named by the allow list? */
static int allowed(const char *host, int port) {
    for (int i = 0; i < allow_n; i++) {
        char pat[300];
        snprintf(pat, sizeof pat, "%s", allow_list[i]);
        /* a port at the end: digits after the last colon, with something before it */
        char *colon = strrchr(pat, ':');
        if (colon && colon > pat && colon[1]) {
            char *p = colon + 1;
            while (*p >= '0' && *p <= '9') p++;
            if (!*p) {
                if (atoi(colon + 1) != port) continue;
                *colon = 0;
            }
        }
        char *slash = strchr(pat, '/');
        if (slash) {                                   /* an IPv4 block: a literal address inside it */
            *slash = 0;
            const char *b = slash + 1;
            uint32_t h, n;
            int bits = (b[0] >= '0' && b[0] <= '9' && (!b[1] || (b[1] >= '0' && b[1] <= '9' && !b[2]))) ? atoi(b) : -1;
            if (bits < 0 || bits > 32 || !ipv4(pat, &n) || !ipv4(host, &h)) continue;
            uint32_t mask = bits == 0 ? 0 : 0xFFFFFFFFu << (32 - bits);
            if ((h & mask) == (n & mask)) return 1;
            continue;
        }
        if (!strcmp(pat, "*")) { if (is_private(host) && !allow_private) continue; return 1; }
        if (pat[0] == '*' && pat[1] == '.') { if (ends_with(host, pat + 1) && !(is_private(host) && !allow_private)) return 1; continue; }
        if (!strcmp(pat, host)) return 1;
    }
    return 0;
}

/* ---------- sockets ---------- */

static int write_all(int fd, const void *buf, size_t len) {
    const unsigned char *p = buf;
    while (len) {
        ssize_t n = write(fd, p, len);              /* a socket, or a CGI's stdout (SIGPIPE is ignored) */
        if (n < 0) { if (errno == EINTR) continue; return -1; }
        p += n;
        len -= (size_t)n;
    }
    return 0;
}

/* a WebSocket frame from the bridge (unmasked) */
static int send_frame(int fd, int opcode, const unsigned char *data, size_t len) {
    unsigned char head[10];
    size_t h = 0;
    head[h++] = (unsigned char)(0x80 | opcode);
    if (len < 126) head[h++] = (unsigned char)len;
    else if (len < 65536) { head[h++] = 126; head[h++] = (unsigned char)(len >> 8); head[h++] = (unsigned char)len; }
    else { head[h++] = 127; for (int i = 7; i >= 0; i--) head[h++] = (unsigned char)((uint64_t)len >> (8 * i)); }
    if (write_all(fd, head, h) < 0) return -1;
    return len ? write_all(fd, data, len) : 0;
}

static void refuse(int fd, int status, const char *text) {
    char buf[128];
    int n = snprintf(buf, sizeof buf, "HTTP/1.1 %d %s\r\nConnection: close\r\n\r\n", status, text);
    write_all(fd, buf, (size_t)n);
}

/* the value of a header (case does not matter) in the request head, into out; 0 if absent */
static int header(const char *head, const char *name, char *out, size_t size) {
    size_t n = strlen(name);
    for (const char *line = strstr(head, "\r\n"); line && line[2]; line = strstr(line + 2, "\r\n")) {
        const char *l = line + 2;
        if (!strncasecmp(l, name, n) && l[n] == ':') {
            const char *v = l + n + 1, *end = strstr(v, "\r\n");
            while (*v == ' ' || *v == '\t') v++;
            size_t len = end ? (size_t)(end - v) : strlen(v);
            while (len && (v[len - 1] == ' ' || v[len - 1] == '\t')) len--;
            if (len >= size) len = size - 1;
            memcpy(out, v, len);
            out[len] = 0;
            return 1;
        }
    }
    return 0;
}

static int hexval(int c) { return c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1; }

/* the parameter `name` of the query (URLSearchParams' way: + is a blank, %xx a byte) into out; 0 if absent */
static int param(const char *query, const char *name, char *out, size_t size) {
    size_t n = strlen(name);
    for (const char *p = query; p && *p; p = strchr(p, '&') ? strchr(p, '&') + 1 : NULL) {
        if (strncmp(p, name, n) || (p[n] != '=' && p[n] != '&' && p[n])) continue;
        const char *v = p[n] == '=' ? p + n + 1 : p + n;
        size_t o = 0;
        while (*v && *v != '&' && o + 1 < size) {
            if (*v == '+') { out[o++] = ' '; v++; }
            else if (*v == '%' && hexval(v[1]) >= 0 && hexval(v[2]) >= 0) { out[o++] = (char)(hexval(v[1]) << 4 | hexval(v[2])); v += 3; }
            else out[o++] = *v++;
        }
        out[o] = 0;
        return 1;
    }
    out[0] = 0;
    return 0;
}

/* connect to host:port within the timeout: the socket, or -1 and the close code */
static int dial(const char *host, int port, int *code, char *why, size_t whysize) {
    struct addrinfo hints = { 0 }, *res = NULL;
    char ports[8];
    snprintf(ports, sizeof ports, "%d", port);
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;
    time_t until = time(NULL) + timeout_s;
    int e = getaddrinfo(host, ports, &hints, &res);
    if (e) { *code = 4004; snprintf(why, whysize, "ENOTFOUND"); return -1; }
    int fd = -1;
    *code = 4004;
    snprintf(why, whysize, "EFAIL");
    for (struct addrinfo *ai = res; ai; ai = ai->ai_next) {
        fd = socket(ai->ai_family, ai->ai_socktype, ai->ai_protocol);
        if (fd < 0) continue;
        int fl = fcntl(fd, F_GETFL, 0);
        fcntl(fd, F_SETFL, fl | O_NONBLOCK);
        int r = connect(fd, ai->ai_addr, ai->ai_addrlen);
        if (r < 0 && errno == EINPROGRESS) {
            long left = (long)(until - time(NULL)) * 1000;
            struct pollfd pf = { fd, POLLOUT, 0 };
            r = left > 0 ? poll(&pf, 1, (int)left) : 0;
            if (r == 0) { close(fd); fd = -1; *code = 4003; snprintf(why, whysize, "ETIMEDOUT"); break; }
            int err = 0;
            socklen_t el = sizeof err;
            getsockopt(fd, SOL_SOCKET, SO_ERROR, &err, &el);
            r = err ? -1 : 0;
            errno = err;
        }
        if (r == 0) { fcntl(fd, F_SETFL, fl); break; }
        if (errno == ECONNREFUSED) { *code = 4002; snprintf(why, whysize, "ECONNREFUSED"); }
        else { *code = 4004; snprintf(why, whysize, "%s", strerror(errno)); }
        close(fd);
        fd = -1;
    }
    freeaddrinfo(res);
    return fd;
}

/* ---------- a connection ---------- */

struct conn {
    int ws, wsout, tcp;             /* the page's side: in and out (one socket, or a CGI's stdin and stdout) */
#ifdef WITH_TLS
    SSL *ssl;                       /* TLS to the host, if asked for */
#endif
    int counted;                    /* it holds one of the `max` places */
    unsigned char *buf;             /* what the page sent, not yet a whole frame */
    size_t len, cap;
    int part_op;                    /* the opcode of a message coming in pieces */
};

/* ---------- the host's side: plain TCP, or TLS ---------- */

/* bytes from the host: their count, 0 or -1 when it is gone, -2 when TLS had nothing for us yet
   (a record of its own, such as a session ticket: the socket is non-blocking then) */
static ssize_t tcp_read(struct conn *c, void *buf, size_t len) {
#ifdef WITH_TLS
    if (c->ssl) {
        int n = SSL_read(c->ssl, buf, (int)len);
        if (n > 0) return n;
        int e = SSL_get_error(c->ssl, n);
        return e == SSL_ERROR_WANT_READ || e == SSL_ERROR_WANT_WRITE ? -2 : -1;
    }
#endif
    return recv(c->tcp, buf, len, 0);
}

static int tcp_write(struct conn *c, const void *buf, size_t len) {
#ifdef WITH_TLS
    if (c->ssl) {
        const unsigned char *p = buf;
        while (len) {
            int n = SSL_write(c->ssl, p, (int)len);
            if (n > 0) { p += n; len -= (size_t)n; continue; }
            int e = SSL_get_error(c->ssl, n);
            if (e != SSL_ERROR_WANT_READ && e != SSL_ERROR_WANT_WRITE) return -1;
            struct pollfd pf = { c->tcp, e == SSL_ERROR_WANT_READ ? POLLIN : POLLOUT, 0 };
            if (poll(&pf, 1, timeout_s * 1000) <= 0) return -1;
        }
        return 0;
    }
#endif
    return write_all(c->tcp, buf, len);
}

/* bytes TLS has decrypted already, which poll() cannot see */
static int tcp_pending(struct conn *c) {
#ifdef WITH_TLS
    if (c->ssl) return SSL_pending(c->ssl) > 0;
#endif
    (void)c;
    return 0;
}

#ifdef WITH_TLS
/* 'n' new (now kept), 's' the same, 'c' changed: the fingerprint of host:port in the known file */
static int known_host(const char *hostport, const char *fp) {
    if (!known_file[0]) return 'n';
    int r = 'n';
    pthread_mutex_lock(&known_lock);
    FILE *f = fopen(known_file, "r");
    if (f) {
        char line[512], hp[300], kfp[200];
        while (fgets(line, sizeof line, f))
            if (sscanf(line, "%299s %199s", hp, kfp) == 2 && !strcmp(hp, hostport)) { r = strcmp(kfp, fp) ? 'c' : 's'; break; }
        fclose(f);
    }
    if (r == 'n') {
        int fd = open(known_file, O_WRONLY | O_CREAT | O_APPEND, 0600);
        if (fd >= 0) { dprintf(fd, "%s %s\n", hostport, fp); close(fd); }
    }
    pthread_mutex_unlock(&known_lock);
    return r;
}

static SSL_CTX *tls_ctx;

/* TLS over the connected socket within the timeout: 0, or the close code (4004 failed, 4005 another certificate) */
static int tls_start(struct conn *c, const char *host, int port, char *fp, size_t fpsize) {
    c->ssl = SSL_new(tls_ctx);
    if (!c->ssl) return 4004;
    SSL_set_fd(c->ssl, c->tcp);
    struct in6_addr a6;
    struct in_addr a4;
    if (inet_pton(AF_INET, host, &a4) != 1 && inet_pton(AF_INET6, host, &a6) != 1) SSL_set_tlsext_host_name(c->ssl, host);
    struct timeval tv = { timeout_s, 0 }, none = { 0, 0 };
    setsockopt(c->tcp, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof tv);
    setsockopt(c->tcp, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof tv);
    int ok = SSL_connect(c->ssl) == 1;
    setsockopt(c->tcp, SOL_SOCKET, SO_RCVTIMEO, &none, sizeof none);
    setsockopt(c->tcp, SOL_SOCKET, SO_SNDTIMEO, &none, sizeof none);
    if (!ok) return 4004;
    X509 *cert = SSL_get_peer_certificate(c->ssl);
    unsigned char md[EVP_MAX_MD_SIZE];
    unsigned int mdlen = 0;
    if (!cert || !X509_digest(cert, EVP_sha256(), md, &mdlen)) { if (cert) X509_free(cert); return 4004; }
    X509_free(cert);
    for (unsigned i = 0; i < mdlen && 2 * i + 2 < fpsize; i++) snprintf(fp + 2 * i, 3, "%02x", md[i]);
    char hp[300];
    snprintf(hp, sizeof hp, "%s:%d", host, port);
    int seen = known_host(hp, fp);
    if (seen == 'c') return 4005;
    fcntl(c->tcp, F_SETFL, fcntl(c->tcp, F_GETFL, 0) | O_NONBLOCK);       /* see tcp_read */
    return seen == 'n' ? 1 : 0;
}
#endif

static void release(struct conn *c) {
    if (!c->counted) return;
    c->counted = 0;
    pthread_mutex_lock(&active_lock);
    active--;
    pthread_mutex_unlock(&active_lock);
}

/* the WebSocket closed with `code`, the TCP connection with it */
static void finish(struct conn *c, int code) {
    if (code) {
        unsigned char b[2] = { (unsigned char)(code >> 8), (unsigned char)code };
        send_frame(c->wsout, 8, b, 2);
    }
#ifdef WITH_TLS
    if (c->ssl) { SSL_shutdown(c->ssl); SSL_free(c->ssl); c->ssl = NULL; }
#endif
    if (c->tcp >= 0) close(c->tcp);
    c->tcp = -1;
    shutdown(c->wsout, SHUT_WR);
    close(c->ws);
    if (c->wsout != c->ws) close(c->wsout);
    release(c);
    free(c->buf);
    free(c);
}

/*
 * The frames of what the page sent: data to the host, a ping answered, a close.
 * Returns 0 to go on, or the close code (1000 the page closed, 1002 a protocol error, 1009 too big).
 */
static int frames(struct conn *c) {
    for (;;) {
        unsigned char *b = c->buf;
        if (c->len < 2) return 0;
        int fin = (b[0] & 0x80) != 0, op = b[0] & 0x0F, masked = (b[1] & 0x80) != 0;
        uint64_t len = b[1] & 0x7F;
        size_t at = 2;
        if (!masked || (b[0] & 0x70)) return 1002;
        if (len == 126) { if (c->len < 4) return 0; len = (uint64_t)b[2] << 8 | b[3]; at = 4; }
        else if (len == 127) { if (c->len < 10) return 0; len = 0; for (int i = 0; i < 8; i++) len = len << 8 | b[2 + i]; at = 10; }
        if (len > MAX_FRAME) return 1009;
        if (c->len < at + 4 + len) return 0;
        unsigned char *mask = b + at, *data = b + at + 4;
        for (uint64_t i = 0; i < len; i++) data[i] ^= mask[i & 3];
        int code = 0;
        if (op >= 8) {
            if (!fin || len > 125) return 1002;
            if (op == 8) code = 1000;
            else if (op == 9) send_frame(c->wsout, 10, data, (size_t)len);
        } else {
            if (op != 0) c->part_op = op;
            else if (!c->part_op) return 1002;
            if ((c->part_op == 1 || c->part_op == 2) && c->tcp >= 0 && len) tcp_write(c, data, (size_t)len);
            if (fin) c->part_op = 0;
        }
        size_t used = at + 4 + (size_t)len;
        memmove(c->buf, c->buf + used, c->len - used);
        c->len -= used;
        if (code) return code;
    }
}

/* read what the page sent into the buffer: 0 on the end or an error */
static int take(struct conn *c) {
    if (c->cap - c->len < 65536) {
        size_t cap = c->cap * 2 + 65536;
        unsigned char *nb = realloc(c->buf, cap);
        if (!nb) return 0;
        c->buf = nb;
        c->cap = cap;
    }
    ssize_t n = read(c->ws, c->buf + c->len, c->cap - c->len);
    if (n <= 0) return 0;
    c->len += (size_t)n;
    return 1;
}

/*
 * The checks of a request, the same for the daemon and the CGI: 0 to take it, or the HTTP status
 * that refuses it. `path` is NULL for a CGI (the web server chose it).
 */
static int check(const char *path, const char *query, const char *up, const char *key, const char *version, const char *origin) {
    if ((path && strcmp(path, "/connect")) || !key || !key[0] || !up || strcasecmp(up, "websocket") || !version || strcmp(version, "13")) return 400;
    if (origin_list) {
        int ok = 0;
        for (int i = 0; i < origin_n && origin; i++) if (!strcmp(origin_list[i], origin)) ok = 1;
        if (!ok) return 403;
    }
    if (!token[0]) return cgi_mode ? 500 : 0;          /* a CGI without a token takes nobody */
    char given[512];
    param(query, "token", given, sizeof given);
    size_t a = strlen(given), b = strlen(token);
    unsigned diff = (unsigned)(a != b);
    for (size_t i = 0; i < b; i++) diff |= (unsigned)(unsigned char)(i < a ? given[i] : 0) ^ (unsigned char)token[i];
    return diff ? 403 : 0;
}

static const char *reason(int status) {
    return status == 400 ? "Bad Request" : status == 403 ? "Forbidden" : status == 426 ? "Upgrade Required" : status == 503 ? "Service Unavailable" : "Internal Server Error";
}

/* Sec-WebSocket-Accept for a key */
static void accept_for(const char *key, char *accept) {
    unsigned char digest[20];
    char both[200];
    snprintf(both, sizeof both, "%s%s", key, GUID);
    sha1((const unsigned char *)both, strlen(both), digest);
    base64(digest, 20, accept);
}

/* the call, once the WebSocket is up: the host dialed, then the bytes both ways */
static void relay(struct conn *c, const char *query) {
    int one = 1;
    char host[300], portstr[16];
    param(query, "host", host, sizeof host);
    param(query, "port", portstr, sizeof portstr);
    int ok = strlen(host) >= 1 && strlen(host) <= 253;
    for (const char *p = host; *p && ok; p++) ok = (*p >= 'A' && *p <= 'Z') || (*p >= 'a' && *p <= 'z') || (*p >= '0' && *p <= '9') || *p == '.' || *p == '-';
    int port = 0;
    ok = ok && portstr[0];
    for (const char *p = portstr; *p && ok; p++) ok = *p >= '0' && *p <= '9';
    if (ok) { port = atoi(portstr); ok = strlen(portstr) <= 5 && port >= 1 && port <= 65535; }
    char lower[300];
    for (size_t i = 0; i <= strlen(host); i++) lower[i] = (char)(host[i] >= 'A' && host[i] <= 'Z' ? host[i] + 32 : host[i]);
    if (!ok || !allowed(lower, port)) {
        logf_("refused %s:%s", host, portstr[0] ? portstr : "0");
        finish(c, 4001);
        return;
    }
    int code;
    char why[128];
    c->tcp = dial(host, port, &code, why, sizeof why);
    if (c->tcp < 0) {
        if (code == 4003) logf_("no answer %s:%d", host, port);
        else logf_("failed %s:%d %s", host, port, why);
        finish(c, code);
        return;
    }
    char tlsq[8];
    param(query, "tls", tlsq, sizeof tlsq);
    if (!strcmp(tlsq, "1")) {
#ifdef WITH_TLS
        char fp[2 * EVP_MAX_MD_SIZE + 1] = "";
        int r = tls_start(c, host, port, fp, sizeof fp);
        if (r == 4005) { logf_("certificate changed %s:%d %.16s", host, port, fp); finish(c, 4005); return; }
        if (r > 1) { logf_("failed %s:%d tls", host, port); finish(c, r); return; }
        logf_("connected %s:%d tls %.16s%s", host, port, fp, r == 1 ? " (new)" : "");
#else
        logf_("failed %s:%d tls: not built in (make TLS=1)", host, port);
        finish(c, 4004);
        return;
#endif
    } else logf_("connected %s:%d", host, port);
    setsockopt(c->tcp, IPPROTO_TCP, TCP_NODELAY, &one, sizeof one);
    if (send_frame(c->wsout, 1, (const unsigned char *)"connected", 9) < 0) { finish(c, 0); return; }
    if (c->len) { int r = frames(c); if (r) { finish(c, r); return; } }

    /* the bytes both ways; a ping when the call has been quiet for ping_s seconds (proxies and NATs then
       see it alive; the browser answers on its own) */
    static __thread unsigned char data[65536];
    for (;;) {
        struct pollfd pf[2] = { { c->ws, POLLIN, 0 }, { c->tcp, POLLIN, 0 } };
        int pending = tcp_pending(c);
        int r = poll(pf, 2, pending ? 0 : ping_s > 0 ? ping_s * 1000 : -1);
        if (r < 0) { if (errno == EINTR) continue; finish(c, 1011); return; }
        if (r == 0 && !pending) {
            if (send_frame(c->wsout, 9, NULL, 0) < 0) { finish(c, 0); return; }
            continue;
        }
        if (pending || (pf[1].revents & (POLLIN | POLLHUP | POLLERR))) {
            ssize_t n = tcp_read(c, data, sizeof data);
            if (n == -2) n = 0;                                 /* TLS: nothing for the page this time */
            else if (n <= 0) { finish(c, 1000); return; }       /* the far end hung up */
            if (n && send_frame(c->wsout, 2, data, (size_t)n) < 0) { finish(c, 0); return; }
        }
        if (pf[0].revents & (POLLIN | POLLHUP | POLLERR)) {
            if (!take(c)) { finish(c, 0); return; }             /* the page went */
            int f = frames(c);
            if (f) { finish(c, f); return; }
        }
    }
}

/* a call to the daemon: the HTTP request read from the socket, checked, answered, then relayed */
static void *serve(void *arg) {
    struct conn *c = arg;
    char head[MAX_HEAD + 1];
    size_t hl = 0;
    char *end = NULL;
    /* the request: its head, within 30 seconds */
    while (!end) {
        struct pollfd pf = { c->ws, POLLIN, 0 };
        if (hl >= MAX_HEAD || poll(&pf, 1, 30000) <= 0) { close(c->ws); free(c); return NULL; }
        ssize_t n = recv(c->ws, head + hl, MAX_HEAD - hl, 0);
        if (n <= 0) { close(c->ws); free(c); return NULL; }
        hl += (size_t)n;
        head[hl] = 0;
        end = strstr(head, "\r\n\r\n");
    }
    size_t headlen = (size_t)(end + 4 - head);
    char method[16] = "", target[4096] = "";
    if (sscanf(head, "%15s %4095s", method, target) != 2) { refuse(c->ws, 400, "Bad Request"); close(c->ws); free(c); return NULL; }
    char up[64] = "", key[128] = "", version[16] = "", origin[512] = "";
    int has_up = header(head, "Upgrade", up, sizeof up);
    if (!has_up) {                                   /* no WebSocket: say what this is */
        const char *msg = "This is a modem bridge: connect with a WebSocket.\n";
        char buf[256];
        int n = snprintf(buf, sizeof buf, "HTTP/1.1 426 Upgrade Required\r\nContent-Type: text/plain\r\nContent-Length: %zu\r\nConnection: close\r\n\r\n%s", strlen(msg), msg);
        write_all(c->ws, buf, (size_t)n);
        close(c->ws);
        free(c);
        return NULL;
    }
    int has_key = header(head, "Sec-WebSocket-Key", key, sizeof key);
    header(head, "Sec-WebSocket-Version", version, sizeof version);
    int has_origin = header(head, "Origin", origin, sizeof origin);
    char *q = strchr(target, '?');
    const char *query = q ? q + 1 : "";
    if (q) *q = 0;
    char *hash = strchr((char *)query, '#');
    if (hash) *hash = 0;
    int st = check(target, query, up, has_key ? key : NULL, version, has_origin ? origin : NULL);
    if (st) { refuse(c->ws, st, reason(st)); close(c->ws); free(c); return NULL; }
    pthread_mutex_lock(&active_lock);
    int full = active >= max_conn;
    if (!full) active++;
    pthread_mutex_unlock(&active_lock);
    if (full) { refuse(c->ws, 503, "Service Unavailable"); close(c->ws); free(c); return NULL; }
    c->counted = 1;

    char accept[40], reply[256];
    accept_for(key, accept);
    int rn = snprintf(reply, sizeof reply, "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n", accept);
    if (write_all(c->ws, reply, (size_t)rn) < 0) { finish(c, 0); return NULL; }
    int one = 1;
    setsockopt(c->ws, IPPROTO_TCP, TCP_NODELAY, &one, sizeof one);
    if (hl > headlen) {                              /* frames sent before the answer came */
        c->cap = hl - headlen + 65536;
        c->buf = malloc(c->cap);
        if (!c->buf) { finish(c, 1011); return NULL; }
        memcpy(c->buf, head + headlen, hl - headlen);
        c->len = hl - headlen;
    }
    relay(c, query);
    return NULL;
}

/* ---------- as a CGI ---------- */

/* a CGI answer with no WebSocket: a status and a line of text */
static void cgi_reply(int status, const char *text) {
    char buf[512];
    int n = snprintf(buf, sizeof buf, "Status: %d %s\r\nContent-Type: text/plain\r\n\r\n%s\n", status, reason(status), text);
    write_all(1, buf, (size_t)n);
}

/*
 * Run by a web server as a CGI that may take the WebSocket upgrade (lighttpd: cgi.upgrade = "enable"):
 * the request is in the environment; the answer, then the call, on stdout; what the page sends on stdin.
 */
static int cgi_main(void) {
    const char *up = getenv("HTTP_UPGRADE"), *query = getenv("QUERY_STRING");
    if (!query) query = "";
    if (!up) { cgi_reply(426, "This is a modem bridge: connect with a WebSocket."); return 0; }
    if (!token[0]) {
        logf_("no MODEM_BRIDGE_TOKEN (or --token): every call is refused");
        cgi_reply(500, "The modem bridge has no token set.");
        return 0;
    }
    const char *key = getenv("HTTP_SEC_WEBSOCKET_KEY");
    int st = check(NULL, query, up, key, getenv("HTTP_SEC_WEBSOCKET_VERSION"), getenv("HTTP_ORIGIN"));
    if (st) { cgi_reply(st, reason(st)); return 0; }
    char accept[40], reply[256];
    accept_for(key, accept);
    int rn = snprintf(reply, sizeof reply, "Status: 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n", accept);
    if (write_all(1, reply, (size_t)rn) < 0) return 0;
    struct conn *c = calloc(1, sizeof *c);
    if (!c) return 1;
    c->ws = 0;
    c->wsout = 1;
    c->tcp = -1;
    relay(c, query);
    return 0;
}

/* ---------- the command line ---------- */

/* split a comma separated list (blanks trimmed, empty entries left out), in lower case if asked */
static char **split(const char *s, int *n, int lower) {
    char **out = NULL;
    *n = 0;
    char *copy = strdup(s), *save = NULL;
    for (char *t = strtok_r(copy, ",", &save); t; t = strtok_r(NULL, ",", &save)) {
        while (*t == ' ' || *t == '\t') t++;
        size_t l = strlen(t);
        while (l && (t[l - 1] == ' ' || t[l - 1] == '\t')) t[--l] = 0;
        if (!l) continue;
        if (lower) for (char *p = t; *p; p++) if (*p >= 'A' && *p <= 'Z') *p += 32;
        out = realloc(out, sizeof *out * (size_t)(*n + 1));
        out[(*n)++] = strdup(t);
    }
    free(copy);
    return out;
}

/*
 * An option: --name=value or --name (a flag) on the command line, else MODEM_BRIDGE_NAME in the
 * environment (as a CGI is given them: - becomes _; 0, no or false means unset)
 */
static const char *opt(int argc, char **argv, const char *name, int *flag) {
    size_t n = strlen(name);
    const char *v = NULL;
    for (int i = 1; i < argc; i++) {
        if (strncmp(argv[i], "--", 2) || strncmp(argv[i] + 2, name, n)) continue;
        if (argv[i][2 + n] == '=') { v = argv[i] + 3 + n; if (flag) *flag = 0; }
        else if (!argv[i][2 + n]) { v = ""; if (flag) *flag = 1; }
    }
    if (v) return v;
    char env[64] = "MODEM_BRIDGE_";
    size_t e = strlen(env);
    for (size_t i = 0; i < n && e < sizeof env - 1; i++) env[e++] = name[i] == '-' ? '_' : (char)(name[i] >= 'a' && name[i] <= 'z' ? name[i] - 32 : name[i]);
    env[e] = 0;
    v = getenv(env);
    if (v && (!strcmp(v, "0") || !strcasecmp(v, "no") || !strcasecmp(v, "false"))) v = NULL;
    if (v && flag) *flag = 0;
    return v;
}

int main(int argc, char **argv) {
    int flag = 0;
    cgi_mode = opt(argc, argv, "cgi", NULL) != NULL || getenv("GATEWAY_INTERFACE") != NULL;
    const char *p = opt(argc, argv, "port", NULL);
    int port = p && *p ? atoi(p) : DEFAULT_PORT;
    int listen_port = port;
    if (port <= 0) port = DEFAULT_PORT;               /* the token's port, as the JavaScript bridge has it */
    if (p && !strcmp(p, "0")) listen_port = 0;       /* any free port */
    const char *tok = opt(argc, argv, "token", &flag);
    const char *seed = opt(argc, argv, "seed", NULL);
    if (tok && !flag) snprintf(token, sizeof token, "%s", tok);
    else if (!cgi_mode) seed_token(port, seed ? seed : "", token, sizeof token);   /* a CGI's token must be given */
    if (opt(argc, argv, "show-token", NULL)) { printf("%s\n", token); return 0; }
    const char *allow = opt(argc, argv, "allow", &flag);
    int help = opt(argc, argv, "help", NULL) != NULL;
    if (help || !allow || flag) {
        if (cgi_mode && !help) { logf_("no MODEM_BRIDGE_ALLOW (or --allow): every call is refused"); cgi_reply(500, "The modem bridge allows no host."); return 0; }
        fprintf(stderr, "usage: modem-bridge --allow=<host[:port],*.domain,*> [--port=1984] [--bind=127.0.0.1] [--token=<secret> | --seed=<salt>] [--show-token] [--origin=<origin>] [--timeout=10] [--max=8] [--allow-private] [--known=<file>] [--ping=30] [--cgi]\n");
        fprintf(stderr, "       every option may come from the environment instead: MODEM_BRIDGE_ALLOW, MODEM_BRIDGE_TOKEN ...\n");
        return help ? 0 : 2;
    }
    allow_list = split(allow, &allow_n, 1);
    const char *o = opt(argc, argv, "origin", &flag);
    if (o && !flag) origin_list = split(o, &origin_n, 0);
    const char *t = opt(argc, argv, "timeout", NULL);
    if (t && atoi(t) > 0) timeout_s = atoi(t);
    const char *m = opt(argc, argv, "max", NULL);
    if (m && atoi(m) > 0) max_conn = atoi(m);
    allow_private = opt(argc, argv, "allow-private", NULL) != NULL;
    const char *pg = opt(argc, argv, "ping", NULL);
    if (pg && *pg) ping_s = atoi(pg) > 0 ? atoi(pg) : 0;
    const char *k = opt(argc, argv, "known", &flag);
    if (k && !flag) snprintf(known_file, sizeof known_file, "%s", k);                 /* --known= (empty) keeps none */
    else if (getenv("HOME")) snprintf(known_file, sizeof known_file, "%s/.modem-bridge-known", getenv("HOME"));
#ifdef WITH_TLS
    tls_ctx = SSL_CTX_new(TLS_client_method());
    SSL_CTX_set_min_proto_version(tls_ctx, TLS1_2_VERSION);
    SSL_CTX_set_verify(tls_ctx, SSL_VERIFY_NONE, NULL);       /* Gemini hosts sign their own: the known file is the check */
    SSL_CTX_clear_mode(tls_ctx, SSL_MODE_AUTO_RETRY);
#endif
    signal(SIGPIPE, SIG_IGN);
    if (cgi_mode) return cgi_main();
    const char *b = opt(argc, argv, "bind", &flag);
    const char *bind_to = b && !flag && *b ? b : "127.0.0.1";

    struct addrinfo hints = { 0 }, *res = NULL;
    char ports[8];
    snprintf(ports, sizeof ports, "%d", listen_port);
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;
    hints.ai_flags = AI_PASSIVE | AI_NUMERICSERV;
    if (getaddrinfo(bind_to, ports, &hints, &res)) { fprintf(stderr, "modem-bridge: cannot use the address %s\n", bind_to); return 1; }
    int lfd = socket(res->ai_family, res->ai_socktype, res->ai_protocol);
    int one = 1;
    setsockopt(lfd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
    if (lfd < 0 || bind(lfd, res->ai_addr, res->ai_addrlen) < 0 || listen(lfd, 16) < 0) {
        fprintf(stderr, "modem-bridge: cannot listen on %s:%d: %s\n", bind_to, listen_port, strerror(errno));
        return 1;
    }
    freeaddrinfo(res);
    struct sockaddr_storage sa;
    socklen_t sl = sizeof sa;
    getsockname(lfd, (struct sockaddr *)&sa, &sl);
    int real = ntohs(sa.ss_family == AF_INET6 ? ((struct sockaddr_in6 *)&sa)->sin6_port : ((struct sockaddr_in *)&sa)->sin_port);
    fprintf(stderr, "modem bridge on ws://%s:%d  allowing: %s\n", bind_to, real, allow);
    fprintf(stderr, "token: %s\n", token);
    fprintf(stderr, "In DigitalRerun: DEVICES, MODEM: put the URL and the token there, then ATDT host:port in TERM.\n");
    int star = 0;
    for (int i = 0; i < allow_n; i++) if (!strcmp(allow_list[i], "*")) star = 1;
    if (star && allow_private) fprintf(stderr, "warning: * with --allow-private reaches every address this machine can.\n");
    fflush(stderr);

    pthread_attr_t attr;
    pthread_attr_init(&attr);
    pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED);
    pthread_attr_setstacksize(&attr, 256 * 1024);
    for (;;) {
        int fd = accept(lfd, NULL, NULL);
        if (fd < 0) { if (errno == EINTR || errno == ECONNABORTED || errno == EMFILE || errno == ENFILE) { if (errno == EMFILE || errno == ENFILE) sleep(1); continue; } perror("accept"); return 1; }
        struct conn *c = calloc(1, sizeof *c);
        if (!c) { close(fd); continue; }
        c->ws = c->wsout = fd;
        c->tcp = -1;
        pthread_t th;
        if (pthread_create(&th, &attr, serve, c)) { close(fd); free(c); }
    }
}
