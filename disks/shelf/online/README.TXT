ONLINE
======

The programs for the modem port (ports 6 and 7), most with a directory
of places to go. Put this disk in B:, then type B: and the program. Name
a place after it to call at once: TERM TELEHACK, IRC LIBERA, MUD
AARDWOLF (a word of a line of its directory, a number, or a host).

  TERM       a terminal. AT commands go to the modem: ATDT0 is the echo
             service, ATDT0100 the Digital Rerun BBS. Ctrl-] opens the
             modem menu (D dials from TERM.DIR, R and S are XMODEM).

  IRC        an IRC client. /connect dials a server (no argument lists
             IRC.DIR), /join #chan, then type to talk. /help lists the
             commands, /quit hangs up, /bye leaves.

  GOPHER     a Gopher client. Alone it shows GOPHER.DIR as a menu;
             GOPHER host[:port][/type/selector] goes there. A number and
             Return follows an item; Space and - page, B back, G go to an
             address, H home, R again, W saves the page to a file, Q quits.

  GEMINI     a Gemini client, as GOPHER: alone GEMINI.DIR as a home page;
             GEMINI host[:port][/path] goes there. Links are numbered
             (a number and Return); headings, lists and quotes laid out,
             paragraphs wrapped. The bridge speaks TLS for it (port 1965).

  MUD        a client for text worlds: what the world says above, your
             line below. /connect (no argument lists MUD.DIR), then type;
             Ctrl-P and Ctrl-N bring back lines, /quit hangs up, /bye
             leaves. A password is shown as stars.

  FINGER     FINGER user@host or FINGER @host: who is there, or what
             someone's plan says, a page at a time. Alone it lists
             FINGER.DIR; FINGER 2 asks its second line.

  NETTIME    the time from a clock on the net (time.nist.gov unless one
             is named), and how far this machine's clock is from it.
             NETTIME +2 under CP/M 3 sets the date and time, UTC+2.

The sources are here too: with the system disk in A:, SUBMIT B:MAKEALL
assembles all seven with ASM and LOAD (SUBMIT B:MAKE GOPHER for one).

The .DIR files are plain text, one place per line: edit them with ED.
IRC.DIR, GOPHER.DIR and MUD.DIR hold host[:port] and a name (GOPHER.DIR
may add /type/selector); GEMINI.DIR a gemini:// address and a name;
FINGER.DIR user@host and a name; TERM.DIR a number or host and a name.
All but the BBS need the bridge (DEVICES, MODEM; see docs/modem.md). It
passes the ports of IRC (6660-6669), gopher (70), finger (79), daytime
(13) and Gemini (1965, TLS) raw; the others are telnet, as a MUD wants.
