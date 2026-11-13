# Adding an app or a game to DigitalRerun

Cold Storage, Signal Seeker, Tidepool and Ledger are written for this machine and live in their own
repositories. DigitalRerun mounts each as a git submodule under `apps/`, builds nothing from it,
and ships only the finished files on a shelf disk. This is the recipe, from an empty directory to
a green test run. Ledger (`apps/ledger`) is the freshest example, Tidepool (`apps/tidepool`) the clearest; read them beside this page. Ledger also shows a second model of the app's rules in JavaScript (`tools/ledger.js`) that the test compares the emulated program with.

| Piece | Where | Notes |
|-------|-------|-------|
| the source | its own repo, `github.com/cstroie/<name>`, mounted at `apps/<name>` | MIT, the app builds and tests itself |
| the shelf disk | `disks/shelf/<id>/` | the built files, `README.TXT`, `disk.json`; `disks/shelf.json` is generated |
| the test | `test/<id>.test.js` | the shelf copies equal the app's build, and the game runs in the emulator |
| the bookkeeping | `README.md` line, `test/shelf.test.js` id list, `js/version.js` stamp | |

## 1. The app repo

Layout (copy Tidepool's or Cold Storage's):

    README.md  DESIGN.md  LICENSE  build.sh
    <name>.asm  term.asm  save.asm ...     Z80, assembled with pasmo (apt install pasmo)
    docs/PLAYING.txt                       the player's guide: it becomes README.TXT on the disk
    test/<name>.test.js                    node:test; the emulator part skips without a checkout
    tools/screen.js                        run a program and print the screen
    tools/visit.js                         (if time matters) a machine with a clock you set

Habits that paid off:

- **One `.COM`, one `.SAV`.** CP/M 2.2, 64K, no dependencies at run time. Keep the save as whole
  128-byte records written straight from a state block (see `save.asm`); a signature and a version
  in its first bytes, and a load that falls back to a new game when they do not match.
- **Terminals.** Ask once (`1 VT100  2 VT52  3 ADM-3A`), keep the answer in the save, accept
  `/100 /52 /ADM` on the command line. `term.asm` has the cursor, attributes, the VT100
  line-drawing set (`gfxon`, `gfxoff`, `gc`), erase to end of line and the arrow keys. Never write
  the 80th column of row 24: it scrolls.
- **The clock.** Port 20 (`OUT` latches, 15 `IN`s read): the date and time of the host at reset,
  moved on by the machine's own time. `apps/tidepool/clock.asm` turns it into minutes since 1978;
  `apps/coldstor/clock.asm` is the 100 ms tick. Without the device (`IN` answers 0FFh) do something
  sensible: a real Z80 will not have one.
- **Data.** Text goes in a plain file that a Node script checks and packs (`coldstor.txt` ->
  `mkdat.js`), pictures in a text file converted to `db` lines (`art.txt` -> `mkart.js`): a build step
  that fails on a wrong length beats a screen that is wrong in a way nobody sees.
- **Pasmo gotchas.** `LOW`, `HIGH` and other operators are keywords (do not `equ` them). `jr` is
  127 bytes: a main loop that grew wants `jp`. A label defined twice across `include`d files is an
  error: prefix per file. Variables can be `equ`s after the last byte of the program, so the `.COM`
  does not carry them.
- **Tests** run the real `.COM` in `js/machine.js`. `tools/visit.js` shows how to make a machine whose
  clock says what you want (`m.clock.now = () => ms` before `m.reset()`, and `m.clock.base += ms`
  to move it on while it runs), mount a folder as B:, and read the screen through `js/terminal.js`.
  Use machine time (`m.run(200000)` is 50 ms at 4 MHz), never wall time.

## 2. GitHub and the submodule

Only the repository's owner can create it (the cloud sessions that write these apps are not given
that right). Create an **empty** repository `cstroie/<name>` (no README, no licence), then:

    cd apps/<name>                                  # built there, or git clone it there
    git init -b main && git add -A && git commit -m "feat: <name>"
    git remote add origin https://github.com/cstroie/<name>.git
    git push -u origin main
    cd ../..
    git submodule add https://github.com/cstroie/<name>.git apps/<name>
    git submodule update --init system/dialtone     # tools/build.js needs it

`git submodule add` accepts a directory that is already a repository whose `origin` matches the
URL, so the app can be written in place first. A submodule commit in DigitalRerun names an exact
commit of the app: **push the app before pushing DigitalRerun**, or everyone else gets a dangling
pointer. After a change in the app, commit and push it, then `git add apps/<name>` here.

## 3. The shelf

    mkdir disks/shelf/<id>
    cp apps/<name>/<NAME>.COM disks/shelf/<id>/
    cp apps/<name>/docs/PLAYING.txt disks/shelf/<id>/README.TXT
    cat > disks/shelf/<id>/disk.json <<'JSON'
    { "name": "...", "format": "sssd8", "description": "...", "credit": "...; MIT licence. Source in apps/<name>.",
      "licence": "MIT", "category": "Games", "play": "<NAME>" }
    JSON
    node tools/build.js          # builds PLAY.COM, checks the disk fits, rewrites disks/shelf.json
    node tools/stamp.js          # js/version.js: the cache stamp (a test fails when it is stale)

`"play": "<NAME>"` gives the disk a `PLAY.COM`, so `PLAY` starts the game after inserting the disk.
Then add the id to the list in `test/shelf.test.js`, a line to the README's *shelf of software*
bullet, and `test/<id>.test.js` (copy `test/tidepool.test.js`: the shelf copies equal the app's
build, `PLAY`, leave, run again). `node --test` must be green.

The save file lives on the disk the game ran from. A shelf disk is rebuilt from the shelf when
inserted again, but a snapshot (which keeps the disks) and *My disks* keep the save.

## 4. A new build of an existing app

Tidepool, Signal Seeker, Cold Storage and Ledger keep no binaries in their repositories: take the files from the GitHub
release instead (`gh release download <tag> -R cstroie/tidepool -p TIDEPOOL.COM -D disks/shelf/tidepool`;
for Signal Seeker `-R cstroie/signal-seeker -D disks/shelf/sigseek`, both `SIGSEEK.COM` and
`SIGSEEK.DAT`; likewise `cold-storage` into `coldstor` with `COLDSTOR.COM` and `COLDSTOR.DAT`, and
`ledger` with `LEDGER.COM`), point the submodule at the same tag, and copy `docs/PLAYING.txt` as below; their
tests compare only the guide (and, for Signal Seeker and Cold Storage, that the `.DAT` is packed from the text).

    sh apps/<name>/build.sh
    cp apps/<name>/<NAME>.COM disks/shelf/<id>/ ; cp apps/<name>/docs/PLAYING.txt disks/shelf/<id>/README.TXT
    node tools/build.js && node tools/stamp.js && node --test
