# The modem bridge in C: tools/modem-bridge.js for a machine without Node.js.
#   make            build ./modem-bridge
#   make install    copy it to $(PREFIX)/bin (PREFIX=/usr/local)
#   make clean
CC ?= cc
CFLAGS ?= -O2 -Wall -Wextra
LDLIBS = -lpthread
PREFIX ?= /usr/local

modem-bridge: modem-bridge.c
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ $< $(LDLIBS)

install: modem-bridge
	install -d $(DESTDIR)$(PREFIX)/bin
	install -m 755 modem-bridge $(DESTDIR)$(PREFIX)/bin/modem-bridge

clean:
	rm -f modem-bridge

.PHONY: install clean
