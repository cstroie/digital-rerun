ONLINE
======

Two programs for the modem port (ports 6 and 7), each with a directory
of places to go. Put this disk in B:, then type B: and the program. Name
a place after it to call at once: TERM TELEHACK, IRC LIBERA (a word of a
line of its directory, a number, or a host).

  TERM       a terminal. AT commands go to the modem: ATDT0 is the echo
             service, ATDT0100 the Digital Rerun BBS. Ctrl-] opens the
             modem menu (D dials from TERM.DIR, R and S are XMODEM).

  IRC        an IRC client. /connect dials a server (no argument lists
             IRC.DIR), /join #chan, then type to talk. /help lists the
             commands, /quit hangs up, /bye leaves.

The sources are here too: with the system disk in A:, SUBMIT B:MAKEALL
assembles both with ASM and LOAD (SUBMIT B:MAKE TERM for one).

TERM.DIR and IRC.DIR are plain text, one place per line: edit them with
ED. IRC.DIR holds host[:port] and a name; TERM.DIR a number or host and a
name. Telnet hosts and IRC servers need the bridge (DEVICES, MODEM; see
docs/modem.md); IRC servers must take plain TCP on a port of 6660-6669.
