#!/bin/sh
# The one command that runs askk: the fullest build (the host that runs the engines, and the
# window a browser opens on it), built as released and started on this machine.
#
#   ./scripts/run.sh            build, then run in this terminal until Ctrl-C
#   ./scripts/run.sh --built    the same, with what the last build made (no building)
#   ./scripts/run.sh start      build, then run in the background; returns when it answers
#   ./scripts/run.sh restart    build, then replace the one in the background with the new build
#   ./scripts/run.sh status     is one running in the background, where, since when
#   ./scripts/run.sh stop       ask it to finish
#
# Where it listens is written in settings.json in the data folder (`listen`, 127.0.0.1:8090
# to begin with: this machine only). PORT and IP in the environment win over that file.
# Where the app keeps what it knows:
#   ASKK_HOME  the app's own folder (data/ and projects/ live inside it), or
#   ASKK_DATA  just the data folder (default ./data)
#
# To run it locked down, see scripts/sandboxed.sh. How the background service works:
# docs/service.md.
set -eu
cd "$(dirname "$0")/.."

OUT=target/dx/askk/release/web
RUN=target/run
VERB=""
BUILD=1
COPY=1
case "${1:-}" in
--built) BUILD=0 ;;
start | restart) VERB=$1 ;;
# Asking or stopping needs no new build: the program started last time does it.
status | stop)
    VERB=$1
    if [ -x "$RUN/askk" ]; then
        BUILD=0
        COPY=0
    fi
    ;;
esac

if [ -z "${ASKK_HOME:-}" ]; then
    ASKK_DATA=${ASKK_DATA:-$(pwd)/data}
    export ASKK_DATA
fi

if [ $BUILD = 1 ]; then
    command -v dx >/dev/null || { echo "dx is not installed. Install it: cargo install dioxus-cli"; exit 1; }
    dx build --release --platform web
fi
if [ $COPY = 1 ]; then
    [ -x "$OUT/server" ] || { echo "nothing is built yet at $OUT. Run ./scripts/run.sh without --built"; exit 1; }
    # A copy is run, never the build output itself: when a build writes over a program in place,
    # macOS stops it at start (exit 137). The copy is a new file each time. The server finds the
    # window's files (public/) beside itself, and the defaults in this folder (without them it
    # uses the ones it was built with). A service already running keeps the file it was started
    # from until it is restarted.
    mkdir -p "$RUN"
    cp -f "$OUT/server" "$RUN/askk.new" && mv -f "$RUN/askk.new" "$RUN/askk"
    rm -rf "$RUN/public" && cp -R "$OUT/public" "$RUN/public"
fi

if [ -n "$VERB" ]; then
    exec "$RUN/askk" "$VERB"
fi
echo "askk: starting in this terminal (stop with Ctrl-C). It says below where it listens."
exec "$RUN/askk"
