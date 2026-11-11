LEDGER
======

The lighthouse keeper's logbook.

You keep a coastal light for a village. You never see the sea, only the
logbook. Each night you decide how the lamp burns and you choose the words
you write; the sea does what it does, and what it did is only in the log.
There is no combat and nothing to lose: the tension is whether to light the
lamp early or save the oil. The game is noticing. After a few weeks the
patterns in your own writing predict the storms and the ships.

  LEDGER          asks for your terminal (the first time)
  LEDGER /100     VT100      /52  VT52      /ADM  ADM-3A
  LEDGER /S1234   (new log only) the sea of a given number

The clock
  A night is three hours of the machine's clock (eight a day). Leave the
  screen open and a bell rings when a night begins; the page slides up
  four lines and the new night waits, blank, for you. Close it and come
  back in a week: the nights that went by were kept by the relief hand.
  He lights the lamp frugally (at dark when the oil is plentiful, late
  when it is not, not at all when it is low) and writes plain entries
  ("Night 41 (relief hand). Fog. Lamp late. No ships."). Nothing is
  owed and nothing is lost. At most a month of nights is worked out for
  one absence. On a machine without a clock every start is the next night.

A night
  The lamp, with the oil it burns:
      E  early, from sundown (3)      D  at dark (2)
      L  late, after midnight (1)     S  not at all (0)
  Fog and storm burn one more. A boat brings 24 oil on every twelfth
  night (the store holds 30).
  Then the night passes along the horizon (row 2: the beam crosses it if
  the lamp was lit) and you write the entry: three choices, 1 2 or 3
  (Enter takes the first), among three ways of saying what happened: the
  weather, the lamp, the ships. The sentence builds on the page as you
  choose.
  A ship passes at sundown, at midnight or in the small hours. Your lamp
  shows her if it was lit no later than she passed; fog hides a lamp lit
  late. An answered light is entered as "seen", a missed one "unseen";
  neither costs anything. A ship whose light is answered often enough
  writes to you (H).

The book
  Left: four nights to a page. Arrow keys (or , and .) turn the pages.
  Right: the calendar. The nights are folded into rows, the same place in
  the cycle in the same column. W changes the width, 5 to 12. Find the
  width at which something lines up: a ship that came on the 3rd, the
  10th and the 17th is a column at width 7. V changes what the calendar
  shows (weather: . fair - haze = fog > wind ~ swell # storm; ships:
  the first letter of the ship, bold if she was seen; lamp: E D L S).
  F finds one thing (storms, swells, wind, fog, each ship): it is lit in
  reverse on the calendar and starred on the page. The current night is a
  blinking underscore.

Keys
  E D L S    light the lamp (only while the night is open)
  1 2 3      choose the words
  <- ->      turn the page      W  wrap      V  show      F  find
  H          the harbour book: the ships, how often their light was
             answered, and their letters
  M          the bell on/off    ?  this introduction      Q  leave

The diary
  Whenever a night is written, LEDGER.LOG is rewritten: the last 128
  nights as plain text, one paragraph a night, with the harbour book at
  the end. TYPE LEDGER.LOG. The save is LEDGER.SAV, next to it; delete
  both to start a new log.

Terminals
  On a VT100 the book is drawn with the line-drawing set, the calendar
  uses reverse video and blinking, and the page slides in a scroll
  region. A VT52 or an ADM-3A gets the same screen in plain characters
  (the find is then shown by the stars on the page only).
