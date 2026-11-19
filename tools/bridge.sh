#!/bin/sh
# bridge.sh: run the modem bridge (WebSocket to TCP) for DigitalRerun's modem.
#
#   tools/bridge.sh                  allow the hosts of the board's dial directory, IRC.DIR, GOPHER.DIR, MUD.DIR, NETTIME's clock
#   tools/bridge.sh host,host:port   allow these instead (names, host:port, *.domain, *)
#   tools/bridge.sh --show-token     print the token and exit
#
# Environment: BRIDGE_PORT (default 1984), BRIDGE_SEED (a salt for the token),
# BRIDGE_ALLOW (the list, if none is given), BRIDGE_NODE=1 (the JavaScript bridge even
# when the C one is built). More options are passed on to the bridge (see the header of
# modem-bridge.js). Then, in DEVICES, MODEM: the address and the token this prints; in
# TERM: ATDT telehack.com
#
# The bridge is the C one (tools/modem-bridge/, about 2 MB in memory) when it is built,
# else modem-bridge.js with Node.js; with neither, but a C compiler and make, the C one is
# built first.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
bin="$here/modem-bridge/modem-bridge"
if [ -z "${BRIDGE_NODE:-}" ] && [ ! -x "$bin" ] && ! command -v node >/dev/null 2>&1 && command -v make >/dev/null 2>&1 && command -v cc >/dev/null 2>&1; then
  make -s -C "$here/modem-bridge" >&2
fi
if [ -z "${BRIDGE_NODE:-}" ] && [ -x "$bin" ]; then
  set -- "$bin" "$@"
elif command -v node >/dev/null 2>&1; then
  set -- node "$here/modem-bridge.js" "$@"
else
  echo "bridge.sh: build the bridge (make -C tools/modem-bridge) or install Node.js (https://nodejs.org)" >&2
  exit 1
fi
run=$1
shift
script=
if [ "$run" = node ]; then script=$1; shift; fi

port=${BRIDGE_PORT:-1984}
allow_default='telehack.com,bbs.fozztexx.com,towel.blinkenlights.nl,nethack.alt.org,bbs.retrocampus.com,bbs.hispamsx.org,particlesbbs.dyndns.org:6400,aardmud.org:4000,batmud.bat.org,sdf.org,irc.sdf.org:6667,irc.libera.chat:6667,irc.oftc.net:6667,irc.rizon.net:6667,irc.efnet.org:6667,irc.dal.net:6667,us.undernet.org:6667,irc.quakenet.org:6667,gopher.floodgap.com:70,graph.no:79,gopher.quux.org:70,gopherpedia.com:70,bitreich.org:70,discworld.starturtle.net:4242,alteraeon.com:3000,ancient.anguish.org:2222,3k.org:3000,time.nist.gov:13,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12'
allow=${BRIDGE_ALLOW:-$allow_default}

# a first argument that is not an option is the list of hosts (after the bridge chosen above)
case "${1:-}" in
  ''|-*) ;;
  *) allow=$1; shift ;;
esac

seed=${BRIDGE_SEED:+--seed=$BRIDGE_SEED}
# shellcheck disable=SC2086
exec "$run" ${script:+"$script"} --allow="$allow" --port="$port" $seed "$@"
