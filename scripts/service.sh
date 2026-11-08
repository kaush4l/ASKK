#!/bin/sh
# Run askk under a supervisor that keeps this terminal: the app's output stays here, and the
# Restart button (or the `restart` tool) asks this loop to update, build, stop and start again.
#
#   scripts/service.sh            # from the project folder
#
# Steps come from data/service.json (update, build, start: shell commands; empty = skip).
# A failed update or build leaves the running app as it is. Ctrl-C stops everything.
cd "$(dirname "$0")/.." || exit 1
DATA=${ASKK_DATA:-data}
FLAG="$DATA/.restart"
STATUS="$DATA/service-status.json"
export ASKK_SUPERVISED=1

field() { python3 -c "import json,sys; print(json.load(open('$DATA/service.json')).get('$1',''))" 2>/dev/null; }
mark() { printf '{"step":"%s","ok":%s,"note":"%s","at":%s}\n' "$1" "$2" "$3" "$(date +%s)" > "$STATUS"; echo "askk service: $1 $3"; }
step() { # name, command
  [ -z "$2" ] && return 0
  mark "$1" true ""
  sh -c "$2" || { mark failed false "$1"; return 1; }
}
start() {
  rm -f "$FLAG"
  mark start true ""
  sh -c "$(field start)" &
  APP=$!
  mark started true ""
}
stop() { [ -n "$APP" ] && { pkill -P "$APP" 2>/dev/null; kill "$APP" 2>/dev/null; wait "$APP" 2>/dev/null; }; }
trap 'stop; rm -f "$FLAG"; exit 0' INT TERM

start
while :; do
  sleep 1
  if [ -f "$FLAG" ]; then
    rm -f "$FLAG"
    if step update "$(field update)" && step build "$(field build)"; then
      mark stop true ""
      stop
      start
    fi
  elif [ -n "$APP" ] && ! kill -0 "$APP" 2>/dev/null; then
    echo "askk service: the app exited; waiting for a restart request (Ctrl-C to quit)"
    APP=
  fi
done
