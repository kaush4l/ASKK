#!/bin/sh
# An answer streams, end to end: a real server sends it piece by piece (server-sent events, as
# every OpenAI-style server does), the `openai` method reads it as it comes, the engine keeps
# what has come, and a window asking `run_partial` sees the answer before it is whole.
#
# The model server is scripts/stream/server.py: a word every few tenths of a second, no network,
# no key. The engine is the default `askk/developer`, in a new home whose only model is that
# server. Then a program the engine runs writes a file, and the Diff shows it.
#
#   ./scripts/stream.sh                 test the last build
#   ./scripts/stream.sh <app>           the built app's folder
#
# PORT is the service's port; TAB_PORT the model server's (the same pair the landmark uses).
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${1:-$ROOT/target/dx/askk/release/web}
BIN=$OUT/server
[ -x "$BIN" ] || BIN=$OUT/server.exe
[ -x "$BIN" ] || { echo "nothing is built at $OUT. Build first: ./scripts/run.sh"; exit 1; }
command -v python3 >/dev/null || { echo "python3 is not installed: there is no model server to stream from"; exit 1; }

PORT=${PORT:-8798}
SSE_PORT=${TAB_PORT:-8799}
URL=http://127.0.0.1:$PORT
WORK=$(mktemp -d)
mkdir -p "$WORK/app" "$WORK/home/data" "$WORK/ws"
cp "$BIN" "$WORK/app/" && cp -R "$OUT/public" "$WORK/app/public"
BIN=$WORK/app/$(basename "$BIN")
printf '{"default":"sse","models":[{"name":"sse","method":"openai","base_url":"http://127.0.0.1:%s/v1"}]}' "$SSE_PORT" >"$WORK/home/data/models.json"

SERVER=""
MODEL=""
ASKED=""
stop() {
    for p in $ASKED $SERVER $MODEL; do kill "$p" 2>/dev/null; done
    wait 2>/dev/null
    rm -rf "$WORK"
}
trap stop EXIT

failed=""
fail() {
    printf '   FAILED: %s\n' "$1"
    failed="$failed\n  $1"
}
# field <answer> <name>: one string field of what an answer gives (`{"ok": {...}}`).
field() { printf '%s' "$1" | python3 -c "import json,sys; v=json.load(sys.stdin).get('ok') or {}; print(v.get('$2','') if isinstance(v, dict) else '')" 2>/dev/null; }
ask() { curl -s -X POST -H 'content-type: application/json' -d "$2" "$URL/ask/$1"; }

python3 "$ROOT/scripts/stream/server.py" "$SSE_PORT" 0.3 >"$WORK/model.log" 2>&1 &
MODEL=$!
(cd "$WORK/home" && PORT=$PORT IP=127.0.0.1 ASKK_HOME="$WORK/home" ASKK_WORKSPACE="$WORK/ws" exec "$BIN") >"$WORK/server.log" 2>&1 &
SERVER=$!
n=0
until curl -s -o /dev/null "$URL/ask" || [ $n -ge 60 ]; do
    kill -0 "$SERVER" 2>/dev/null || break
    sleep 1
    n=$((n + 1))
done
curl -s -o /dev/null "http://127.0.0.1:$SSE_PORT/v1/models" || fail "the model server did not start on $SSE_PORT"

echo "== 1. the answer is seen while it arrives"
ask run_engine '{"path":"askk/developer","input":"Tell me how a stream arrives."}' >"$WORK/answer.json" &
ASKED=$!
seen=""
early=""
pieces=0
i=0
# Asked as a window asks: what has come so far, while the run still goes.
while kill -0 "$ASKED" 2>/dev/null && [ $i -lt 150 ]; do
    said=$(field "$(ask run_partial '{"path":"askk/developer"}')" said)
    if [ -n "$said" ] && [ "$said" != "$seen" ]; then
        seen=$said
        pieces=$((pieces + 1))
        case $said in *finished.*) ;; *) [ -n "$early" ] || early=$said ;; esac
    fi
    sleep 0.15
    i=$((i + 1))
done
wait "$ASKED" 2>/dev/null
ASKED=""
answer=$(cat "$WORK/answer.json")
ok=1
case $answer in *"the last word is finished."*) ;; *) fail "the run ended with the whole answer (it gave: $(printf '%s' "$answer" | cut -c1-300))"; ok=0 ;; esac
if [ -z "$early" ]; then
    fail "a part of the answer was seen before its end (seen last: '$seen')"
    ok=0
else
    case $early in Streams*) ;; *) fail "what was seen early is the start of the answer, not the reply's fields: '$early'"; ok=0 ;; esac
fi
[ $pieces -ge 3 ] || { fail "the answer was seen growing, not only once (seen $pieces times)"; ok=0; }
[ $ok = 1 ] && echo "   ok: seen $pieces times as it grew, first \"$early\""

echo "== 2. a file a program wrote is in the diff"
answer=$(ask run_engine '{"path":"askk/developer","input":"Write a file with a program, please."}')
ok=1
case $answer in *"made-by-program.txt"*) ;; *) fail "the run that ran a program answered (it gave: $(printf '%s' "$answer" | cut -c1-300))"; ok=0 ;; esac
[ -f "$WORK/ws/made-by-program.txt" ] || { fail "the program wrote its file in the workspace"; ok=0; }
diff=$(ask workspace_diff '{"path":"askk/developer"}')
case $diff in *'"path":"made-by-program.txt"'*) ;; *) fail "the diff shows the file the program wrote (it gave: $(printf '%s' "$diff" | cut -c1-300))"; ok=0 ;; esac
case $diff in *'"before":null'*'written by a program'*|*'written by a program'*'"before":null'*) ;; *) fail "the diff shows the file as new, with what the program wrote in it"; ok=0 ;; esac
[ $ok = 1 ] && echo "   ok"

if [ -n "$failed" ]; then
    printf '\nstream not proven:%b\n' "$failed"
    tail -20 "$WORK/server.log" | grep -v Registering
    exit 1
fi
printf '\nstreamed: a real server sent the answer in pieces and it was seen before its end; a program'"'"'s file is in the diff\n'
