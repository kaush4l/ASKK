#!/bin/sh
# Does the built app really run? Start what `scripts/run.sh` builds on a new, empty home,
# then ask it what a person would: each page, and the questions any UI may ask.
#
#   ./scripts/smoke.sh            test the last build (target/dx/askk/release/web)
#   ./scripts/smoke.sh <folder>   test the build in that folder (it holds `server` and `public/`)
#
# The program is started away from this repository on purpose: it must make its first home
# from the defaults it was built with, not from a folder that happens to be nearby.
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${1:-$ROOT/target/dx/askk/release/web}
BIN=$OUT/server
[ -x "$BIN" ] || BIN=$OUT/server.exe
[ -x "$BIN" ] || { echo "nothing is built at $OUT. Build first: ./scripts/run.sh"; exit 1; }

PORT=${PORT:-8797}
HOME_DIR=$(mktemp -d)
LOG=$HOME_DIR/server.log
URL=http://127.0.0.1:$PORT

# A copy is run, never the build output itself: when a build writes over a program in place,
# macOS stops it at start (exit 137). The copy is a new file each time.
APP=$HOME_DIR/app
mkdir -p "$APP"
cp "$BIN" "$APP/" && cp -R "$OUT/public" "$APP/public"
BIN=$APP/$(basename "$BIN")

(cd "$HOME_DIR" && PORT=$PORT IP=127.0.0.1 ASKK_HOME="$HOME_DIR" exec "$BIN") >"$LOG" 2>&1 &
PID=$!
stop() {
    kill "$PID" 2>/dev/null
    wait "$PID" 2>/dev/null
    rm -rf "$HOME_DIR"
}
trap stop EXIT

failed=""
fail() {
    printf '   FAILED: %s\n' "$1"
    failed="$failed\n  $1"
}

n=0
until curl -s -o /dev/null "$URL/ask" || [ $n -ge 60 ]; do
    kill -0 "$PID" 2>/dev/null || break
    sleep 1
    n=$((n + 1))
done
if ! curl -s -o /dev/null "$URL/ask"; then
    echo "the app did not start. What it said:"
    cat "$LOG"
    exit 1
fi

ask() { curl -s -X POST -H 'content-type: application/json' -d '{}' "$URL/ask/$1"; }

echo "== it boots its engines from the defaults it was built with"
engines=$(ask engine_paths)
case $engines in
*'"askk"'*) echo "   ok" ;;
*) fail "no engine booted: $engines" ;;
esac

echo "== it says what this build can do"
caps=$(ask capabilities)
for cap in store engines background files; do
    case $caps in
    *"{\"here\":true,\"name\":\"$cap\""*) ;;
    *) fail "the full build should have \`$cap\`: $caps" ;;
    esac
done
[ -n "$failed" ] || echo "   ok"

echo "== every page is drawn"
for page in / /canvas /talk /sessions /rooms /settings /e/askk; do
    code=$(curl -s -o "$HOME_DIR/page.html" -w '%{http_code}' "$URL$page")
    if [ "$code" != 200 ]; then
        fail "page $page answered $code"
    elif ! grep -q 'id="main"' "$HOME_DIR/page.html"; then
        fail "page $page has no app in it"
    fi
done
[ -n "$failed" ] || echo "   ok"

echo "== the window's program is served"
wasm=$(grep -o '/assets/[^"]*\.js' "$HOME_DIR/page.html" | head -1)
if [ -z "$wasm" ]; then
    fail "the page names no program to load"
else
    code=$(curl -s -o /dev/null -w '%{http_code}' "$URL$wasm")
    [ "$code" = 200 ] && echo "   ok" || fail "$wasm answered $code"
fi

echo "== a wrong question gets a sentence, not a crash"
wrong=$(ask no_such_question)
case $wrong in
*'"error"'*) echo "   ok" ;;
*) fail "expected an error sentence, got: $wrong" ;;
esac
kill -0 "$PID" 2>/dev/null || fail "the app stopped while being asked"

if [ -n "$failed" ]; then
    printf '\nnot working:%b\n\nwhat the app said:\n' "$failed"
    cat "$LOG"
    exit 1
fi
printf '\nworking: the built app starts, boots its engines, draws its pages and answers\n'
