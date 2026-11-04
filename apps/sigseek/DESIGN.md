# Signal Seeker (SIGSEEK)

A cozy, endless night shift at a small relay station. Z80 assembly, CP/M 2.2, 4 MHz,
80x24, VT100 / VT52 / ADM-3A. No colour, no game over.

## Pitch

You are the night operator of **Relay Station Kettle-7**, a small listening post at the
edge of the Lantern Nebula. You sweep the dial and catch drifting signals, clean them up
and pass them on. The station keeps running when you step away, and so does the cat.

## Files

| File         | Role                                                             |
|--------------|------------------------------------------------------------------|
| `SIGSEEK.COM` | Engine: terminal driver, main loop, puzzles, procedural generator |
| `SIGSEEK.DAT` | Read-only content: word lists, message templates, cat lines, ASCII art, lore |
| `SIGSEEK.SAV` | Progress: seed, shift count, tokens, archive bitmap, upgrades, cat mood |

Built on the host (assembler TBD, see open questions); packed by a `tools/` script; shipped
as a disk on the shelf.

## Terminals

One driver with three back ends, picked on first run (and stored in the save):

| Feature        | VT100          | VT52        | ADM-3A        |
|----------------|----------------|-------------|---------------|
| Cursor address | `ESC[r;cH`     | `ESC Y r c` | `ESC = r c`   |
| Clear          | `ESC[2J`       | `ESC H ESC J` | `^Z`        |
| Erase to EOL   | `ESC[K`        | `ESC K`     | spaces        |
| Reverse        | `ESC[7m`       | —           | —             |
| Line drawing   | DEC `ESC(0`    | ASCII       | ASCII         |

DigitalRerun (js/terminal.js) **ignores** `ESC(0`, so there's no line drawing; reverse video works
on VT100 (`ESC[7m`) and ADM-3A (`ESC G4`/`ESC G0`), not on VT52. Arrows arrive as WordStar
`^E ^X ^S ^D` (the default) or as `ESC [ A`/`ESC A`; the game takes both. Never send a full
80-column line followed by CR LF: it wraps. Place each row with cursor addressing.

Rule: **everything must read well in plain ASCII** (`+ - | . : * # @`). VT100 adds
reverse video and box lines as garnish. The spectrogram uses a density ramp
` .:-=+*#%@` instead of block glyphs.

Only the parts of the screen that change get redrawn (dirty cells), because 9600 baud
gives about 960 chars/s.

## Real-time loop

```
loop:
  poll console (BDOS 6, non-blocking)  -> handle key
  tick++  (calibrated busy-wait, ~10 ticks/s at 4 MHz)
  every tick:    advance spectrogram one column, decay signals
  every ~10 s:   world events roll (new signal, caller, cat moves)
  every ~60 s:   "station minute" clock advances
  if idle > N:   operator "away" -> events queue up in the LOG
```

Away time is the heart of it: when you come back, the log reads like a little diary.

```
02:41  Faint ping at 1187.2. Didn't catch it.
02:43  PIXEL knocked the coffee mug off the console. Mug is fine.
02:44  PIXEL is now sitting on the mug's spot. It is warm there.
02:50  Courier MIRA left a voicemail. She sounds lost.
```

## The screen

```
+- KETTLE-7 RELAY ---------------------------- SHIFT 03 -- 02:14 -+ +- DECK ------+
| .:-=+*#%@%#*+=-:. .  .:-=+*#*+=-:.  . .:-+*#@#*+-:.  ..:-=+=-:. | | PWR ######..|
| ..:-=+*#*+=-:..  .  ..:-=+*#%#*+=-:.. .  ..:-=+*#*+=-:..  ..:-  | | BUF ###.....|
| . ..:-=+=-:.. . . ...:-=+*#*+=-:... . . ..:-=+*+=-:.. . .  ..:  | | HUM low     |
|                         ^                                       | +- PIXEL -----+
|  1420.4 MHz   [<< <  > >>]   lock: ****......                   | |  /\_/\      |
+- PACKET -------------------------------------------------------+ | ( -.- ) zz  |
|                                                                 | |  on: heater |
+- LOG -----------------------------------------------------------+ +-------------+
| 02:13 Signal brushed past 1420. Something's there.              |
+-----------------------------------------------------------------+
 [T]une [C]lean [R]oute [A]rchive [P]ixel [L]og [?]help          > _
```

## Gameplay loop (one shift is about 10-15 minutes)

1. **Tune.** A live spectrogram scrolls across the top. Signals show up as bright
   vertical streaks at random frequencies and drift slowly. Sweep the dial with `< >`
   (coarse `,` `.`, fine `[` `]`). The closer you are, the brighter the streak and the
   fuller the lock meter. Holding on the peak fills the buffer.
2. **Clean.** The captured packet appears as hex and ASCII with noisy bytes. Pick one of
   two puzzles depending on the noise:
   - **Bit-flip**: the noisy byte shows as 8 bits; toggle bits `1`-`8` until the parity
     LED and the checksum agree. The ASCII preview updates live, so you can see the word
     forming.
   - **Hex patch**: fill a `??` byte so the text reads right, with the checksum as a hint.
3. **Route** (only for messages addressed to someone): a 5x3 relay grid; rotate tiles so
   the signal runs from the antenna to the recipient. Small, always solvable.
4. **Deliver / Archive.** Messages to people: a reply and some tokens. Messages from
   nowhere: a **fragment** in the Archive (poetry from the old Lantern beacons).
5. **Spend tokens** on conveniences: a finer tuner, auto-parity hints, a better heater
   (PIXEL approves), a kettle, a second buffer, a star chart that marks old signals.

A wrong move only adds a little static. Signals that drift away come back on another
night.

## PIXEL, the station cat

Independent, warm, a little absurd. She is **not** a pet you manage; she is a colleague
with her own agenda. Her narration is in the spirit of a childlike, earnest companion
(Floyd-like innocence, but feline and her own character).

- **Moods**: sleepy, curious, smug, needy, zoomies, offended. Mood drifts with time,
  warmth, and how much attention she gets.
- **Spots**: heater, console, keyboard, antenna hatch, mug, your chair, the archive
  shelf. Wherever she sits changes something:
  - on the **keyboard**: random keys get pressed (harmless, very funny in the log)
  - on the **console**: the spectrogram dims ("she is blocking the screen with her
    whole self")
  - near the **antenna**: she sometimes *hears* signals before you do. Her ears point
    at a frequency, which is a free hint
  - on the **heater**: purring, which calms the static (fewer noisy bytes)
- **`[P]ixel`**: pet / call / offer a treat. She may ignore you. That is allowed.
- **Gifts**: when happy and you are away, she brings things: a bolt, a moth, a
  "very important" chip that turns out to be an upgrade.
- She has a few opinions about callers. She dislikes Freight Hauler 9.

Sample lines:

```
PIXEL looks at the signal, then at you, then at the signal. She has decided it is a bird.
PIXEL is helping. (She is lying on the manual.)
You pet PIXEL. She permits this, for now.
PIXEL brought you a gift: one (1) screw, slightly chewed. It might go somewhere.
PIXEL has walked across the keyboard. The deck is now tuned to 0000.0 MHz. Thank you, PIXEL.
```

## Procedural content

A single 16-bit seed in the save, plus an LFSR or xorshift PRNG.

- **Signals**: frequency, drift, strength, noise level, kind (personal, cargo, weather,
  beacon, mystery).
- **Messages**: template + word slots, filled from lists in the `.DAT`:
  `"{greeting}, Kettle-7! {name} here, {situation}. {request}"`.
- **Callers**: about 8 recurring archetypes, generated with a name and a few traits, each
  with a tiny state machine (1-5 "chapters") so they come back with a story. Examples:
  a lost courier, a lonely lighthouse keeper on an asteroid, a kid with a homemade radio,
  a sleepy cargo AI, a botanist whose plants are singing.
- **Archive fragments**: assembled from line fragments into small poems. Each one is
  stamped with a constellation glyph on the star chart.
- **Weather**: solar wind (more noise), quiet nights (crisp signals), meteor showers
  (lots of short pings), "the nebula is humming" (rare, special signals).

## Save

About 64-128 bytes: magic, version, terminal type, seed, shift #, tokens, upgrades
bitmask, archive bitmap (256 bits), caller chapter nibbles, PIXEL mood and affinity,
counters.

## Milestones

1. **M0, skeleton**: the terminal driver (3 back ends), the frame layout, the clock and
   tick loop, quitting.
2. **M1, the dial**: live spectrogram, tuning, lock meter, capture.
3. **M2, PIXEL**: moves between spots, mood, log lines, away events.
4. **M3, clean**: the bit-flip puzzle, delivery, tokens.
5. **M4, content**: the `.DAT` packer, templates, callers, archive.
6. **M5, the rest**: routing puzzle, upgrades shop, save/load, the shelf disk.
