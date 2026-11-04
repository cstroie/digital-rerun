#!/bin/sh
# Assemble SIGSEEK.COM with pasmo (apt install pasmo, or set PASMO=/path/to/pasmo)
set -e
cd "$(dirname "$0")"
${PASMO:-pasmo} sigseek.asm SIGSEEK.COM
cp SIGSEEK.COM ../../disks/shelf/sigseek/
ls -l SIGSEEK.COM
