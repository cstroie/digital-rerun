#!/bin/sh
# bridge.sh: run the modem bridge (WebSocket to TCP) for DigitalRerun's modem.
#
#   tools/bridge.sh                  allow the hosts of the board's dial directory
#   tools/bridge.sh host,host:port   allow these instead (names, host:port, *.domain, *)
#   tools/bridge.sh --show-token     print the token and exit
#
# Environment: BRIDGE_PORT (default 1984), BRIDGE_SEED (a salt for the token),
# BRIDGE_ALLOW (the list, if none is given). More options are passed on to
# modem-bridge.js (see its header). Then, in SETUP, MODEM: the address and the
# token this prints; in TERM: ATDT telehack.com
set -eu
here=$(cd "$(dirname "$0")" && pwd)
command -v node >/dev/null 2>&1 || { echo "bridge.sh: node is needed (https://nodejs.org)" >&2; exit 1; }

port=${BRIDGE_PORT:-1984}
allow_default='telehack.com,bbs.fozztexx.com,towel.blinkenlights.nl,nethack.alt.org,bbs.retrocampus.com,bbs.hispamsx.org,particlesbbs.dyndns.org:6400,aardmud.org:4000,batmud.bat.org,sdf.org'
allow=${BRIDGE_ALLOW:-$allow_default}

# a first argument that is not an option is the list of hosts
case "${1:-}" in
  ''|-*) ;;
  *) allow=$1; shift ;;
esac

seed=${BRIDGE_SEED:+--seed=$BRIDGE_SEED}
# shellcheck disable=SC2086
exec node "$here/modem-bridge.js" --allow="$allow" --port="$port" $seed "$@"
