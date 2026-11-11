#!/bin/sh
# Run the built askk server under sandbox-exec. Build first: dx build --platform web
# Env: PORT (default 8090), CLI (default ~/.local), CLI_HOME (default ~/.claude), TOOLS (default /opt/homebrew: where
#   ffmpeg and ffprobe live; the app may run those two and read their libraries, nothing else there), and one of:
#   ASKK_HOME  the app's own environment (e.g. /Volumes/Backup/askk): data/ and projects/ live
#              inside it, and it is the only place the app may write and run what it made
#   ASKK_DATA  just the data folder (default ./data), when there is no home
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PORT=${PORT:-8090}; CLI=${CLI:-$HOME/.local}; CLI_HOME=${CLI_HOME:-$HOME/.claude}; TOOLS=${TOOLS:-/opt/homebrew}
# The two media programs, by the path they are called and the file that path leads to (a missing one is simply not runnable).
real() { /usr/bin/python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$1" 2>/dev/null || echo "$1"; }
FFMPEG=$TOOLS/bin/ffmpeg; FFPROBE=$TOOLS/bin/ffprobe
if [ -n "$ASKK_HOME" ]; then
  DATA=${ASKK_DATA:-$ASKK_HOME/data}; ASKK=$ASKK_HOME
  mkdir -p "$DATA" "${ASKK_WORKSPACE:-$ASKK_HOME/projects}"
  export ASKK_HOME
else
  DATA=${ASKK_DATA:-$ROOT/data}; ASKK=$DATA
fi
BIN=$ROOT/target/dx/askk/debug/web/server
if [ -n "$ASKK_HOME" ]; then
  # Run a copy kept in the home, never the build output itself: when a build overwrites a
  # binary in place, macOS kills it at start (exit 137). The copy is a new file each time.
  RUN="$ASKK_HOME/bin"; mkdir -p "$RUN"
  cp -f "$BIN" "$RUN/askk-host.new" && mv -f "$RUN/askk-host.new" "$RUN/askk-host"
  rm -rf "$RUN/public" && cp -R "$(dirname "$BIN")/public" "$RUN/public"
  BIN="$RUN/askk-host"
fi
cd "$ROOT"
# Commands resolve only to what the profile lets the app run (a wider PATH names tools it may not start).
PATH="$CLI/bin:$TOOLS/bin:/usr/bin:/bin"
export PATH PORT IP=127.0.0.1 ASKK_DATA="$DATA"
exec /usr/bin/sandbox-exec -f "$ROOT/sandbox/server.sb" -D ROOT="$ROOT" -D ASKK="$ASKK" -D DATA="$DATA" -D PORT="$PORT" -D CLI="$CLI" -D CLI_HOME="$CLI_HOME" -D HOME="$HOME" -D TOOLS="$TOOLS" -D FFMPEG="$FFMPEG" -D FFPROBE="$FFPROBE" -D FFMPEG_REAL="$(real "$FFMPEG")" -D FFPROBE_REAL="$(real "$FFPROBE")" "$BIN"
