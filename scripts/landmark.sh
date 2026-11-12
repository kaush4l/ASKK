#!/bin/sh
# The landmark of 0.1: one engine loop, whole, on every runtime this version promises.
#
# The loop: a question goes to the engine `askk/coder`, the model writes a program, the tool
# `run_code` runs it on this runtime, the result goes back, the answer comes out, and the
# conversation is kept. The model is a script (scripts/landmark/model.sh), so the test needs
# no network and no key, and "30007" in the answer can only come from the program having run.
#
#   runtime                    who is the host            the program runs in
#   1. a terminal process      the process itself         node
#   2. a hosted service        the server                 node
#      seen from a browser page and from a terminal beside it
#   3. a browser tab           the browser                the browser's own sandbox
#      (its model is asked from the service in 2, by fetch)
#
#   ./scripts/landmark.sh                  test the last builds
#   ./scripts/landmark.sh <app> <tab>      the built app's folder, the built tab's folder
#
# A runtime that cannot be tested on this machine is said, not passed over in silence.
# With LANDMARK_ALL=1 (CI) "not checked" counts as a failure.
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${1:-$ROOT/target/dx/askk/release/web}
TAB=${2:-$ROOT/target/local}
BIN=$OUT/server
[ -x "$BIN" ] || BIN=$OUT/server.exe
[ -x "$BIN" ] || { echo "nothing is built at $OUT. Build first: ./scripts/run.sh"; exit 1; }
command -v node >/dev/null || { echo "node is not installed: the host has nowhere to run a program, so the loop cannot be tested"; exit 1; }

PORT=${PORT:-8798}
TAB_PORT=${TAB_PORT:-8799}
URL=http://127.0.0.1:$PORT
QUESTION="What is the sum of the squares of the first 20 prime numbers?"
WORK=$(mktemp -d)

# A copy is run, never the build output itself (macOS stops a program whose file was
# written over in place).
mkdir -p "$WORK/app"
cp "$BIN" "$WORK/app/" && cp -R "$OUT/public" "$WORK/app/public"
BIN=$WORK/app/$(basename "$BIN")

# A new home whose only model is the script.
home() {
    mkdir -p "$1/data"
    printf '{"default":"scripted","models":[{"name":"scripted","method":"cli","command":["sh","%s/scripts/landmark/model.sh","{prompt}"]}]}' "$ROOT" >"$1/data/models.json"
}

SERVER=""
PAGES=""
stop() {
    [ -z "$SERVER" ] || kill "$SERVER" 2>/dev/null
    [ -z "$PAGES" ] || kill "$PAGES" 2>/dev/null
    wait 2>/dev/null
    rm -rf "$WORK"
}
trap stop EXIT

failed=""
unchecked=""
fail() {
    printf '   FAILED: %s\n' "$1"
    failed="$failed\n  $1"
}
# has <text> <what must be in it> <what that proves>
has() {
    case $1 in
    *"$2"*) return 0 ;;
    esac
    fail "$3 (looked for: $2)"
    return 1
}

echo "== 1. a terminal process: the process is the host"
H1=$WORK/home1
home "$H1"
said=$(cd "$H1" && ASKK_HOME="$H1" "$BIN" terminal "$QUESTION" 2>"$WORK/terminal.log")
ok=1
has "$said" "run_code(" "the terminal shows the program being run" || ok=0
has "$said" '{"result":30007' "the program ran and gave its value" || ok=0
has "$said" "is 30007." "the answer carries the program's value" || ok=0
# A second process, later: the conversation was kept on disk.
kept=$(printf '/history\n/quit\n' | (cd "$H1" && ASKK_HOME="$H1" "$BIN" terminal 2>>"$WORK/terminal.log"))
has "$kept" "user: $QUESTION" "the question is in the kept history" || ok=0
has "$kept" "model: The sum of the squares" "the answer is in the kept history" || ok=0
if [ $ok = 1 ]; then echo "   ok"; else cat "$WORK/terminal.log"; fi

echo "== 2. a hosted service: the server is the host"
H2=$WORK/home2
home "$H2"
(cd "$H2" && PORT=$PORT IP=127.0.0.1 ASKK_HOME="$H2" ASKK_ORIGINS="http://127.0.0.1:$TAB_PORT" exec "$BIN") >"$WORK/server.log" 2>&1 &
SERVER=$!
n=0
until curl -s -o /dev/null "$URL/ask" || [ $n -ge 60 ]; do
    kill -0 "$SERVER" 2>/dev/null || break
    sleep 1
    n=$((n + 1))
done
ask() { curl -s -X POST -H 'content-type: application/json' -d "$2" "$URL/ask/$1"; }
ok=1
answer=$(ask run_engine "{\"path\":\"askk/coder\",\"input\":\"$QUESTION\"}")
has "$answer" "is 30007." "asked over /ask, the service answers with the program's value" || ok=0
chat=$(ask engine_chat '{"path":"askk/coder"}')
has "$chat" "run_code(" "the service kept the program in its history" || ok=0
page=$(curl -s -o /dev/null -w '%{http_code}' "$URL/e/askk/coder")
[ "$page" = 200 ] || { fail "the engine's page in the browser answered $page"; ok=0; }
# A terminal beside the long-running service sees the same conversation.
beside=$(printf '/history\n/quit\n' | "$BIN" terminal --to "$URL" 2>&1)
has "$beside" "model: The sum of the squares" "a terminal attached to the service reads its history" || ok=0
if [ $ok = 1 ]; then echo "   ok"; else cat "$WORK/server.log" | grep -v Registering; fi

echo "== 3. a browser tab: the browser is the host"
CHROME=${CHROME:-}
for c in google-chrome google-chrome-stable chromium chromium-browser "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do
    [ -n "$CHROME" ] && break
    if command -v "$c" >/dev/null 2>&1 || [ -x "$c" ]; then CHROME=$c; fi
done
if [ ! -f "$TAB/index.html" ]; then
    echo "   not checked: no tab build at $TAB (build it: ./scripts/local.sh)"
    unchecked="$unchecked\n  3. a browser tab"
elif [ -z "$CHROME" ]; then
    echo "   not checked: no Chrome or Chromium on this machine (name one in CHROME=)"
    unchecked="$unchecked\n  3. a browser tab"
else
    python3 -m http.server "$TAB_PORT" --bind 127.0.0.1 --directory "$TAB" >/dev/null 2>&1 &
    PAGES=$!
    n=0
    until curl -s -o /dev/null "http://127.0.0.1:$TAB_PORT/" || [ $n -ge 20 ]; do sleep 1; n=$((n + 1)); done
    asked=$(printf '%s' "$QUESTION" | sed 's/ /%20/g; s/?/%3F/g')
    # The page is driven through Chrome's own debugging door (scripts/landmark/tab.mjs).
    dom=$(node "$ROOT/scripts/landmark/tab.mjs" "$CHROME" "http://127.0.0.1:$TAB_PORT/?model=$URL/ask&ask=$asked" "$WORK/chrome" 2>"$WORK/chrome.log")
    ok=1
    has "$dom" '"answer":"The sum' "the tab ran the question and drew an answer" || ok=0
    has "$dom" "is 30007." "the tab's answer carries the value its own sandbox computed" || ok=0
    has "$dom" "step 1 · Act" "the tab shows what its loop did" || ok=0
    has "$dom" 'user: What is the sum' "the tab shows the kept conversation" || ok=0
    if [ $ok = 1 ]; then echo "   ok"; else printf '%s\n' "$dom" | cut -c1-1500; tail -5 "$WORK/chrome.log"; fi
fi

if [ -n "$failed" ]; then
    printf '\nlandmark not reached:%b\n' "$failed"
    exit 1
fi
if [ -n "$unchecked" ]; then
    printf '\nnot checked on this machine:%b\n' "$unchecked"
    [ -z "${LANDMARK_ALL:-}" ] || exit 1
    exit 0
fi
printf '\nlandmark reached: the loop runs whole as a terminal process, as a hosted service, and in a browser tab\n'
