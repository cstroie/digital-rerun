# Signal Seeker (SIGSEEK)

A cozy, endless night shift at a small relay station. Z80 assembly, CP/M 2.2,
4 MHz, 80x24, VT100 / VT52 / ADM-3A. No colour, no hurry, no game over.

You are the night operator of **Relay Station Kettle-7**, at the edge of the
**Lantern Nebula**. Signals drift across the band; you catch them, clean them and
pass them on. Eight callers tell their stories a letter at a time, signals from
nobody carry the fragments of a lost civilization, and **PIXEL**, the station cat,
does as she pleases. The station keeps running when you step away.

## Files

| File | Role |
|------|------|
| `sigseek.asm` | Main: start, the main loop, keys, the terminal driver, the band, signals, lock and capture, receiving, AutoTune, the screen, the log |
| `cat.asm` | PIXEL: moods, poses, walks, spots, petting, gifts, the away diary |
| `clean.asm` | The packet: noise, the bit-flip puzzle, delivery, tokens |
| `route.asm` | The relay routing puzzle |
| `shop.asm` | The shop, the shelf of decorations, the save file |
| `story.asm` | `SIGSEEK.DAT`: loading, the callers, the Archive |
| `weather.asm` | Weather, the last lantern at 1420.0 MHz, the Archive's end |
| `cards.asm` | Postcards from the callers, the postcard wall |
| `title.asm` | The title screen, timing by the clock device, the night's tally, dawn |
| `sigseek.txt` | The content: messages, callers' letters, Archive fragments |
| `mkdat.js` | Packs `sigseek.txt` into `SIGSEEK.DAT`, checking every length against the screen |
| `build.sh` | pasmo, then mkdat, then copies both onto the shelf disk |

Shipped: `SIGSEEK.COM` (about 16K) and `SIGSEEK.DAT` (about 8K, read whole into
memory after the program) on the **Signal Seeker** shelf disk
(`disks/shelf/sigseek/`, with `README.TXT` and `PLAY.COM`). Progress is kept in
`SIGSEEK.SAV` beside them.

Build: `sh apps/sigseek/build.sh` (needs pasmo; `PASMO=` points at another copy),
then `node tools/build.js` for `shelf.json` and `node tools/stamp.js`.

## Terminals

Picked on first run (a menu) or with `SIGSEEK /100`, `/52`, `/ADM`; the save file
remembers it.

| | VT100 | VT52 | ADM-3A |
|---|---|---|---|
| Cursor address | `ESC [ r ; c H` | `ESC Y r c` | `ESC = r c` |
| Clear | `ESC [ H ESC [ 2 J` | `ESC H ESC J` | `^Z` |
| Looks | bold, dim, blink, reverse (`ESC [ 0;1;2;5;7 m`) | none | reverse, blink (`ESC G n`), half intensity (`ESC )` `ESC (`) |
| Cursor off / on | `ESC [ ?25 l` / `h` | none: parked at row 24, column 80 | `ESC C 4` / `ESC B 4` |

Rules:

- **Plain ASCII everywhere.** DigitalRerun ignores the DEC graphics set, so frames
  are `+ - |` and the band is the ramp ` .:-=+*#%@`. Looks are garnish; on a VT52
  the words carry the meaning (`lock` / `LOCK`, `>` before the newest log line).
- **Every row is placed by cursor address.** An 80-column line followed by CR LF
  wraps.
- **Never write column 80 of row 24.** The ADM-3A wraps at once, and on the last row
  that scrolls the screen. The keys line stops at column 79.
- Only what changes is redrawn: one band row a tick, the meters, the keys line when
  it changes.
- Arrows come as WordStar `^E ^X ^S ^D` (DigitalRerun's default) or as
  `ESC [ A`-`D` / `ESC A`-`D`; both work.

## The screen

```
 KETTLE-7 RELAY  :  a clear night                  SHIFT 01    22:01  TOK    0    title bar, reversed
+- BAND  1415.2 MHz --------------------------------------------+ +- DECK -----+
|.  .  .  .   .....  . ....  =++#*+=. ...  . .... . ..    . ..  | | PWR ######.|  the band: 4 rows,
|.  .   ..   .    . .....  . ==**+==..      . .. . .    .      .| | BUF ##.... |  6.3 MHz around
|.. .  .  . .  ... ..   .  ..-=+#++-...   ..... . . .... .. . . | | AUTO   off |  the dial
|. .. ..  ..    .   ......   =+***+- ... .  .....  ..   .   . ..| | HISS   low |
|<                              ^      LOCK ******             >| | PKTS     0 |  the dial row
+---------------------------------------------------------------+ +------------+
+- PACKET ------------------------------------------------------+ +- PIXEL ----+
| RECEIVING  at 1415.2 MHz                                      | |   /\_/\    |  packet box: 5 rows
| .. .. 73 .. 2E 20 .. .. 6C .. ..                              | |  ( -.- ) zz|  (receiving, cleaning,
| _  _  s  _  .     _  _  l  _  _                               | |   > ^ <    |   routing, letters,
|                                                               | |  heater    |   shop, Archive,
|                                                               | |  (sleepy)  |   the diary, the end)
+---------------------------------------------------------------+ +------------+
+- LOG ------------------------------------------------------------------------+
|  Shift begins. Kettle warm. PIXEL asleep on the heater.                      |  the last 4 lines:
|  Something stirs on the band.                                                |  oldest dim,
|> Locked on. A packet is coming in...                                         |  newest reversed
+------------------------------------------------------------------------------+
                                                                                  PIXEL's lane
  shelf: c[_]  \|/                               keyboard [::::::::::]            the floor
 [,.] tune  [<>] coarse  [T] AutoTune  [S]hop  [A]rchive  [P]et  [Q]uit           keys line, reversed
```

- **Title bar** (row 1): `*` for a Lantern Keeper, the weather, the shift number,
  the station clock (one station minute every 6 s), tokens.
- **Band** (rows 2-7): the frequency in its top border. The dial row has `<` and `>`
  for signals off the band, `^` for the dial, and LOCK with its meter.
- **Deck** (rows 2-8): PWR (for show), BUF (the buffer), AUTO, HISS (low while
  PIXEL purrs), PKTS (packets captured).
- **Packet box** (rows 9-15) and **PIXEL's box** beside it: three rows of pose, the
  spot she is on, and her mood.
- **Log** (rows 16-21).
- **Floor** (rows 22-23): the lane PIXEL walks along; the shelf of things bought; the
  keyboard, one of her spots.
- **Keys line** (row 24): only the keys that work now. It follows the mode, and
  `[C]LEAN THE PACKET` leads it when a packet waits.

## The main loop

Ten ticks a second. With DigitalRerun's clock device (port 20: `OUT` latches a
record, 15 `IN`s read it, bytes 11-14 are milliseconds of machine time) a tick is
100 ms of it, at any speed setting; more than a second behind, it starts afresh
rather than racing to catch up. Without the device (a real Z80, another emulator),
a busy-wait calibrated for 4 MHz. Each tick:

```
key?  (BDOS 6, no wait)  -> by mode: dial, cleaning, shop, Archive, routing, the end
the keys line            (if the mode or the buffer changed)
spawn, age, stamp        signals come, drift, fade; their peaks on the band
AutoTune                 (if on)
weather, the end scene
PIXEL                    a step of a walk, or a decision now and then
one band row
lock, buffer, receiving, meters
clock, away?             (5 min without a key)
park the cursor, wait
```

Modes: 0 the dial, 1 cleaning, 2 the shop, 3 the Archive, 4 routing, 5 the
Archive's end, 6 the postcard wall, 7 dawn.

## A shift

A **title screen** first: the station, PIXEL, the name, the shift number, stars
that twinkle, and "press any key" blinking; the wait stirs the random seed.

The shift begins at **22:00**; a station minute is 3 s, so **dawn at 06:00** comes
24 minutes on. At the dial, the band stops: the sun comes up over it in three
frames, and the packet box tallies the night (packets in, delivered, letters,
fragments, tokens earned, PIXEL's gifts). Once the sun is up, any key ends the
shift, saved, back to CP/M; the next run is the next shift. `Q` ends it early. `P` (pet) and `Q` (quit, saving) work in every mode.

## Playing

1. **Tune.** Up to three signals at a time, 3..6 strong, drifting or still, living
   30-80 s; a new one about every 26 s (the first one at once). `,` `.` or
   left/right move the dial 0.1 MHz, `<` `>` or up/down 1 MHz. The band pans: the
   peak slides toward the `^` as you near it.
2. **Lock.** LOCK is dim `lock` with nothing under the dial, bold `LOCK` one step off
   (half the meter), reversed `LOCK` dead on, blinking when the buffer is nearly
   full. Dead on, the buffer fills in 10 s (5 s with the big buffer); off, it
   drains slowly.
3. **Receive.** From the first moment of the lock, the packet comes in letter by
   letter, in no order, noise and all: hex over the text, `..` and `_` for what has
   not come yet. If the buffer drains to nothing, the letters scatter and the
   packet is lost. A full buffer is a captured packet (and a bell). One packet at a
   time: the buffer waits, full, until it is dealt with.
4. **Clean.** `C`. A packet is up to 20 characters with 0-3 noisy bytes, each with
   one of bits 0-6 flipped. The noise: 0-1 bytes, one more for a weak signal (4 or
   less), one less for the strongest (6), one more when PIXEL is not purring, one
   more in solar wind, one less on a still night. **A strong signal on a good night
   comes in clean.** The box shows hex over the text: a noisy byte's hex in bold
   and its letter reversed (on a VT52, which has no looks, a `*` after it), and `>`
   at the selected one; and the selected byte's bits with its ones against the ones
   it should have. `1`-`8` flip a bit (wrong flips cost nothing), `,` `.` pick,
   `C` or `ESC` put it aside.
5. **Route** (a caller's packet only). Six by three relays, straights and corners,
   each turned at random; the grid is made from a path first, so there is always a
   way, and never solved already. `SPACE` or `R` turn the selected relay, the arrows
   move. The relays lit from the antenna show as `=` and `#`. When the line runs
   from `ANT` to the caller's name, it is delivered.
6. **Deliver.** Tokens: 5, plus 3 a noisy byte, plus 4 for routing, plus 20 for the
   last lantern. A caller's letter shows in the packet box; a fragment goes to the
   Archive.

### AutoTune

`T` turns it on and off. Every 0.8 s it steps toward the strongest signal it hears,
ten at a time when far. A quarter of the time it hunts the wrong way ("AutoTune is
quite sure it is this way. It is not."). Two steps from the peak it is satisfied
("close enough!") and only now and then goes on. Not very useful, most nights. On
purpose.

### The shop

`S`; `1`-`8` buy, once each. All 585 tokens' worth takes a few shifts.

| # | | Price | |
|---|---|---|---|
| 1 | Fine tuner | 60 | one step off the peak counts as dead on |
| 2 | Bit hints | 120 | the wrong bits show as `!` |
| 3 | Good heater | 75 | PIXEL purrs at home in any mood |
| 4 | Big buffer | 105 | the buffer fills twice as fast |
| 5 | Kettle | 45 | on the shelf: `c[_]` |
| 6 | Small plant | 30 | `\|/` |
| 7 | Desk lamp | 60 | `(*)` |
| 8 | Postcard wall | 90 | the callers' postcards, `W`; on the shelf `wall:[#.......]` |

Nothing makes anything harder.

## PIXEL

An independent colleague, not a pet to manage: warm, earnest, a little absurd.

- **Moods:** sleepy (the most often), curious, smug, needy, zoomies, huffy. Each has
  a pose in her box, and the mood is named under her name.
- **Decisions** every 8-20 s: maybe a new mood, maybe a walk. Curious and zoomy cats
  go out; sleepy ones come home.
- **Walks:** out of her box she is `=^.^=`, walking along the floor's lane to a spot,
  and her box shows the empty bed.

| Spot | Where | What happens |
|------|-------|--------------|
| heater | her box (home) | asleep, she purrs: HISS low, less static, fewer noisy bytes |
| antenna | the band's top border | her ears point at signals off the dial ("left", "right", "left, right, left") |
| keyboard | the floor's keyboard | she walks across it: the dial jumps |
| console | on the band | in the way. "She is helping." |
| mug | the log's bottom border | "The mug is fine." |

- **`P`:** at home, a petting answered by her mood (it mends a huffy or needy cat).
  Out on a spot, she comes when called only if needy.
- **Opinions:** after each caller's letter she says what she thinks of them, dim
  in the packet box's last row and in the log: one line for the early chapters,
  another for the later two. Barry (BARGE-9) makes her huffy at first (too many
  CAPITALS), until she decides he is all right, for a barge; Pip's and Hum's
  letters make her curious, and in the end she makes room on the heater for Hum.
  She is wary of Dr Wen's humming ferns, sits up straight for Captain Ruth, and
  would like to sit on Tobin's lamp, just once.
- **Away** (5 minutes without a key): her doings go in a diary, shown in the packet
  box when you come back (the last four, with the time, and a count of the signals
  that drifted by). While you are away she brings gifts: a chewed screw, a grateful
  moth, a Z80 chip, a sock that belongs to nobody.
- **Useful gifts:** a quarter of her away-gifts, and one time in eight a thank-you
  for petting her when needy, turn out to fit: one of the four useful upgrades not
  yet in (a brass knob for the dial, a chip marked HINTS, a heating coil, a memory
  chip), installed free and saved at once. When all four are in, she brings the
  ordinary kind.

## The story (`SIGSEEK.DAT`)

`sigseek.txt` is the source, 7-bit ASCII:

```
@msg                    32 messages from nobody in particular (<= 20 characters)
@caller Name, what      8 callers, 5 chapters each:
  packet text | letter line 1 | letter line 2      (<= 20, <= 60, <= 60)
@frag                   32 fragments:  packet text | the line   (<= 20, <= 60)
@card Name              8 postcards, in caller order: a caption (<= 50), then
                        four lines of picture (<= 58, spaces kept)
```

`mkdat.js` refuses anything too long for the screen, and packs it as: `SDAT`,
version 2 and the six counts, a table of word offsets, then the strings. String
numbers: messages 0-31; caller *i* at 32 + 16*i* (the name), then chapter *j*'s
three at 32 + 16*i* + 1 + 3*j*; fragment *k*'s two at 160 + 2*k*; postcard *c*'s five at 224 + 5*c*. A test keeps
`SIGSEEK.DAT` current with `sigseek.txt`.

- **Who sends a packet:** a caller half the time, an Archive fragment a quarter,
  nobody a quarter; the last lantern when the lock is on it.
- **Callers** arrive slowly: two at first, one more every four packets. Each delivery
  moves a caller's story on a chapter and shows the letter; after the fifth they
  keep writing in their later voice. Mira, a lost courier; Old Tobin at Lighthouse
  Seven; Pip, age nine, and the toaster radio; BARGE-9, a cargo AI with too many
  socks (later Barry); Dr Wen and the humming ferns; Sol & Dee, newlyweds; Captain
  Ruth, retired; and Nobody, from Nowhere, who becomes Hum.
- **Postcards:** when a caller's story reaches its fifth chapter, they send a
  postcard too (a bell, and the log says so). `W` shows the postcard wall, if the
  shop's wall is up: a card at a time, its caption in bold and who it is from, the
  picture under it; `,` `.` turn. Mira from Port Hollow, Tobin's lighthouse, Pip's
  drawing of PIXEL, Barry's 400 crates, Dr Wen's ferns, Sol & Dee's slow shuttle,
  Captain Ruth's old route, and Hum's first address.
- **The Archive** (`A`): the fragments of the Lantern beacons, a sky of 32 stars
  (`*` kept, `.` not yet, `@` the one shown), the kept ones to read with `,` `.`. A
  fragment packet brings one not yet kept while there is one. When whole, the title
  says COMPLETE, and (read to PIXEL) after the end.

## Weather

At the start of each shift and every 90 s or so, a roll: often the same weather
again. Named in the title bar, told in the log.

| Weather | Chance | |
|---|---|---|
| a clear night | 5/16 | as it is |
| solar wind | 4/16 | more static on the band, one more noisy byte |
| meteor shower | 2/16 | a signal about every 3 s, weak (3-4) and short (8-20 s) |
| a still night | 3/16 | less static, one fewer noisy byte |
| STATIC STORM | 1/16 | static floods the band, the peaks hide in it; two more noisy bytes; PIXEL slinks under the console |
| THE NEBULA HUMS | 1/16 | the band glows; new signals one stronger |

## The last lantern

Fragment 19 says: *Our last lantern is still burning. Look for it at 1420.* Once it
is in the Archive, a steady signal can come at exactly **1420.0 MHz**: strength 6,
no drift, 90 s. It always comes on a humming night, and at one weather roll in
eight otherwise (one at a time). Its packet, `~ the last lantern ~`, is the Lantern
people's own words, one letter the first time and another after, and is worth 20
tokens more.

## The Archive's end

Keeping the 32nd fragment starts a scene in the packet box, a line every two
seconds: you read the Archive aloud to PIXEL, as fragment 31 asks; she listens, ears
forward, then falls asleep; the nebula hums. Then any key. It happens once: 100
tokens, and a `*` in the title bar for a Lantern Keeper.

## The save file (`SIGSEEK.SAV`)

One 128-byte record, written on quit and after each purchase:

| Offset | |
|---|---|
| 0 | `SG` |
| 2 | version (4) |
| 3 | terminal |
| 4 | the random seed (word) |
| 6 | tokens (word) |
| 8 | upgrades (a bit for each shop item) |
| 9 | packets captured (stops at 255) |
| 10 | the shift number (the next run is one more) |
| 11 | PIXEL's mood |
| 12 | each caller's next chapter (8 bytes) |
| 20 | the Archive, a bit for each fragment (4 bytes) |
| 24 | flags: 1 the last lantern found, 2 a Lantern Keeper |
| 25 | the postcards, a bit for each caller |

Versions 1 (before the story), 2 (before the flags) and 3 (before the
postcards) still load. No room on the
disk: no save, no fuss. Delete the file to start afresh.

## Testing

Everything was tested headless on DigitalRerun's own Z80 core, terminal and CP/M
2.2, booted from the system disk, by scripted operators that read the game's memory
(from pasmo's symbol table) and press keys. They tune, clean, solve routing grids
by search, and check the screens in all three terminal modes.

In the repository's tests: `test/sigseek.test.js` (the `.DAT` is current, the shelf
copies match, an overlong line is refused) and a shelf test (`PLAY` starts a shift,
`Q` saves it, the next run is shift 02).

## Ideas not built

From the design notes:

- **PIXEL and the shelf:** asleep under the desk lamp, sniffing the plant, by the
  kettle when it is on: the decorations as places she goes.
- **More shop things:** a star chart that marks where old signals were heard; a
  second buffer, so one packet can wait while another comes in.
- **A Z80-uLM tie-in** (put off): Hum talking through the tiny language model on its
  own disk, say.

New:

- **Printing on the FX-80:** the Archive, a postcard or the night's log, on
  DigitalRerun's printer, kept as PNG or PDF.
- **A help screen (`?`):** the rules and the keys, in the game.
- **Real dates from the clock device:** it gives the date too: special
  nights (a new year, the Perseids in August, the night you started).
- **Answering callers:** now and then a choice of two replies, which turns their next
  letter a little.
- **Stamps:** a small page of milestones (the first clean packet, all eight callers
  met, the lantern found).
- **A faster shelf test:** the game never goes idle, so the test's wait runs to its
  limit (about 35 s).
- **Ghost signals:** peaks that look like any other and lock like one, but never
  decode: the letters come in and dissolve again, or keep changing, and the buffer
  never quite fills. Harmless, a little eerie. PIXEL stares at them, or hisses. Some
  might be the Lantern beacons' echoes; one, now and then, says a word.
- **Signal fingerprints:** each caller's peak has its own shape on the band (Mira's
  narrow and quick, Barry's wide and square, Hum's faint and wavering), so you learn
  to know who is calling before the packet is in.
- **Echoes:** a message delivered tonight comes back on a later night, fainter, from
  farther out, with a line added by whoever passed it on.
- **Upkeep, gently:** now and then PWR sags or a relay rattles loose; a small fix
  (a routing grid of two rows, a byte to set) and it is right again. Never urgent.
- **Another program in `apps/`:** a cozy companion (a tide-table toy, a calm card
  game) or a tool (a VT100 screen designer).
