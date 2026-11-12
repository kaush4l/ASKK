#!/bin/sh
# The one command that runs askk: the fullest build (the host that runs the engines, and the
# window a browser opens on it), built as released and started on this machine.
#
#   ./scripts/run.sh            build, then run at http://127.0.0.1:8090
#   ./scripts/run.sh --built    run what the last build made, without building
#
# Env: PORT (default 8090), and where the app keeps what it knows:
#   ASKK_HOME  the app's own folder (data/ and projects/ live inside it), or
#   ASKK_DATA  just the data folder (default ./data)
#
# It listens on this machine only (127.0.0.1). To run it locked down, see scripts/sandboxed.sh.
set -eu
cd "$(dirname "$0")/.."

OUT=target/dx/askk/release/web
if [ "${1:-}" != "--built" ]; then
    command -v dx >/dev/null || { echo "dx is not installed. Install it: cargo install dioxus-cli"; exit 1; }
    dx build --release --platform web
fi
[ -x "$OUT/server" ] || { echo "nothing is built yet at $OUT. Run ./scripts/run.sh without --built"; exit 1; }

PORT=${PORT:-8090}
if [ -z "${ASKK_HOME:-}" ]; then
    ASKK_DATA=${ASKK_DATA:-$(pwd)/data}
    export ASKK_DATA
fi
export PORT IP=127.0.0.1
echo "askk: http://127.0.0.1:$PORT   (stop with Ctrl-C)"
# A copy is run, never the build output itself: when a build writes over a program in place,
# macOS stops it at start (exit 137). The copy is a new file each time. The server finds the
# window's files (public/) beside itself, and the defaults in this folder (without them it
# uses the ones it was built with).
RUN=target/run
mkdir -p "$RUN"
cp -f "$OUT/server" "$RUN/askk.new" && mv -f "$RUN/askk.new" "$RUN/askk"
rm -rf "$RUN/public" && cp -R "$OUT/public" "$RUN/public"
exec "$RUN/askk"
