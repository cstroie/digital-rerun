#!/bin/sh
# Build Signal Seeker: SIGSEEK.COM with pasmo (apt install pasmo, or set
# PASMO=/path/to/pasmo), SIGSEEK.DAT from sigseek.txt with mkdat.js, and
# copy both onto the shelf disk (then node tools/build.js for shelf.json).
set -e
cd "$(dirname "$0")"
${PASMO:-pasmo} sigseek.asm SIGSEEK.COM
node mkdat.js
cp SIGSEEK.COM SIGSEEK.DAT ../../disks/shelf/sigseek/
ls -l SIGSEEK.COM SIGSEEK.DAT
