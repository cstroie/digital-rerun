# The modem bridge in C: tools/coupler.js for a machine without Node.js.
#   make            build ./coupler (no TLS: no dependencies)
#   make TLS=1      with TLS for Gemini (needs OpenSSL: libssl-dev, openssl-devel)
#   make install    copy it to $(PREFIX)/bin (PREFIX=/usr/local)
#   make clean
CC ?= cc
CFLAGS ?= -O2 -Wall -Wextra
LDLIBS = -lpthread
PREFIX ?= /usr/local
ifeq ($(TLS),1)
CFLAGS += -DWITH_TLS
LDLIBS += -lssl -lcrypto
endif

coupler: coupler.c
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ $< $(LDLIBS)

install: coupler
	install -d $(DESTDIR)$(PREFIX)/bin
	install -m 755 coupler $(DESTDIR)$(PREFIX)/bin/coupler

clean:
	rm -f coupler

.PHONY: install clean
