SIGNAL SEEKER
=============

You are the night operator of Relay Station Kettle-7, at the edge of
the Lantern Nebula. Signals drift across the band; catch them, clean
them, pass them on. There is no hurry and no game over.

  SIGSEEK          asks for your terminal (the first time)
  SIGSEEK /100     VT100      /52  VT52      /ADM  ADM-3A

The band (top) is 6.3 MHz around the dial, marked ^. A signal is a
bright peak; < or > at an edge means one is off the band that way.

  , .   or left, right     tune by 0.1 MHz
  < >   or up, down        tune by 1 MHz
  T                        AutoTune (cheerful; not very useful)
  C                        clean the packet in the buffer
  S                        the shop
  A                        the Archive
  W                        the postcard wall
  P                        pet PIXEL (or call her)
  Q                        quit (the station is saved)

The bottom line always shows the keys that work just then.

Hold the dial on a peak: LOCK lights up, the buffer fills, and the
packet comes in letter by letter. Let it slip and the letters scatter.
A full buffer is a packet. A strong signal may come in clean; if not,
press C. Some
bytes are noisy: one bit of each is wrong. The bottom line shows the
selected byte's bits and its ones against the ones it should have.
Keys 1-8 flip a bit, , . pick another byte. Wrong flips cost nothing.
A clean packet is delivered, for tokens.

Some packets come from people: a lost courier, an old lighthouse keeper,
a child with a toaster radio, a cargo AI with too many socks, and others
you will meet as the nights go by. A packet for one of them still has to
reach them: rotate the relays (SPACE, or R; the arrows move) until the
line runs from ANT on the left to their name on the right. The tiles
lit from the antenna (= and #) show how far it gets. Their letters show
when you deliver, and each one moves their story on. When a story
ends, they send a postcard: pin it up on the wall (the shop has one). Signals from nobody carry fragments
of the old Lantern beacons: they go in the Archive (A), to read again.

PIXEL does as she likes. Asleep on the heater, she purrs and the static
drops. At the antenna, her ears point at signals. On the keyboard...
She has opinions about the callers, too.
Leave the station for five minutes and she keeps a diary.

The weather changes through the night, and the title bar names it: a
clear night, solar wind (more static), a meteor shower (quick little
pings), a still night (clean packets), and now and then the nebula
hums. Some say the last lantern can be heard at 1420.0 MHz, once you
know to listen for it. And when the Archive is whole, read it to the
cat.

The station is kept in SIGSEEK.SAV. Delete it to start afresh.
SIGSEEK.DAT holds the letters and fragments; it must sit beside
SIGSEEK.COM.
