#!/bin/sh
# The service and its clients: askk runs in the background, is found, shows what it is doing,
# takes a hand edit without a restart, and comes back from a restart with what it knew.
#
# It is the built app (what scripts/run.sh builds) started with `askk start` on a new, empty
# home. The model is a script (scripts/service/model.sh: the landmark's model, one second
# slower), so nothing needs a network or a key. See docs/service.md.
#
#   ./scripts/service.sh            test the last build (target/dx/askk/release/web)
#   ./scripts/service.sh <folder>   test the build in that folder (it holds `server` and `public/`)
#
# Env: PORT (default 8796) is where the test service listens.
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${1:-$ROOT/target/dx/askk/release/web}
BIN=$OUT/server
[ -x "$BIN" ] || BIN=$OUT/server.exe
[ -x "$BIN" ] || { echo "nothing is built at $OUT. Build first: ./scripts/run.sh"; exit 1; }
command -v node >/dev/null || { echo "node is not installed: the host has nowhere to run a program, and the test's own client is written for it"; exit 1; }

PORT=${PORT:-8796}
URL=http://127.0.0.1:$PORT
QUESTION="What is the sum of the squares of the first 20 prime numbers?"
WORK=$(mktemp -d)
H=$WORK/home
RECORD=$H/service/service.json
LOG=$H/service/service.log

# A copy is run, never the build output itself (macOS stops a program whose file was
# written over in place).
mkdir -p "$WORK/app"
cp "$BIN" "$WORK/app/" && cp -R "$OUT/public" "$WORK/app/public"
BIN=$WORK/app/$(basename "$BIN")

# A new home whose only model is the script.
mkdir -p "$H/data"
printf '{"default":"scripted","models":[{"name":"scripted","method":"cli","command":["sh","%s/scripts/service/model.sh","{prompt}"]}]}' "$ROOT" >"$H/data/models.json"

# Every command is given the same home and the same port, as a person's shell would.
askk() { (cd "$H" && ASKK_HOME="$H" PORT=$PORT IP=127.0.0.1 "$BIN" "$@"); }
ask() { curl -s -m 60 -X POST -H 'content-type: application/json' -d "$2" "$URL/ask/$1"; }
# The number after "name": in a line of JSON.
number() { printf '%s' "$1" | sed -n "s/.*\"$2\": *\([0-9][0-9]*\).*/\1/p" | head -1; }

stop() {
    askk stop >/dev/null 2>&1
    rm -rf "$WORK"
}
trap stop EXIT

failed=""
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
done_step() { if [ "$1" = 1 ]; then echo "   ok"; fi; }

echo "== start: the service runs in the background and says where it is"
ok=1
said=$(askk start 2>&1)
has "$said" "askk is running at $URL" "\`askk start\` returns once the service answers, and says where" || ok=0
has "$(cat "$RECORD" 2>/dev/null)" "\"address\": \"$URL\"" "the running service leaves a record in its home" || ok=0
[ -s "$LOG" ] || { fail "the service writes what it says to a log in its home ($LOG)"; ok=0; }
PID=$(number "$(cat "$RECORD" 2>/dev/null | tr -d '\n')" pid)
kill -0 "${PID:-0}" 2>/dev/null || { fail "the record names the running process (found: ${PID:-none})"; ok=0; }
again=$(askk start 2>&1)
has "$again" "askk is already running at $URL (process $PID)" "started twice, it says it already runs, and where" || ok=0
status=$(askk status 2>&1) || { fail "\`askk status\` ends with 0 while the service runs"; ok=0; }
has "$status" "askk is running at $URL" "status says it runs" || ok=0
has "$status" "askk/coder" "status names the engines" || ok=0
has "$status" "can do   store, engines, background" "status says what the service can do" || ok=0
has "$status" "version  " "status says which version and build" || ok=0
done_step $ok

echo "== clients find it: a terminal given no address talks to the running service"
ok=1
beside=$(printf '/engines\n/quit\n' | askk terminal 2>&1)
has "$beside" "a service is running for this home at $URL" "the terminal finds the service by its record" || ok=0
has "$beside" "askk/coder" "and reads the service's engines instead of booting none of its own" || ok=0
done_step $ok

echo "== processing is shown: a run is followed on the change feed while it happens"
ok=1
run=$(node "$ROOT/scripts/service/follow.mjs" "$URL" askk/coder "$QUESTION" 2>&1)
has "$run" "is 30007." "asked over /ask, the service answers with the value its program gave" || ok=0
has "$run" '"thinking think"' "the run was seen while the model was still thinking" || ok=0
has "$run" '"calling act"' "and while its program was being run" || ok=0
looks=$(number "$run" looks)
waits=$(number "$run" waits)
[ "${looks:-0}" -ge 2 ] && [ "${looks:-0}" -le "${waits:-0}" ] || { fail "the client looked only when the feed said something changed (looked $looks times, the feed spoke $waits times)"; ok=0; }
[ $ok = 1 ] || printf '%s\n' "$run" | cut -c1-600
done_step $ok

echo "== hello: the same service says the same hello"
ok=1
hello=$(ask hello '{}')
has "$hello" "\"pid\":$PID" "hello names the process in the record" || ok=0
has "$hello" '"build":"' "hello names the build" || ok=0
[ "$hello" = "$(ask hello '{}')" ] || { fail "asked twice, hello is the same"; ok=0; }
done_step $ok

echo "== config in place: a file edited by hand takes effect without a restart"
ok=1
# 1. An engine's goal, then \`reload\` on demand: the running engine's next prompt has it.
printf 'Answer with a program. The word of the day is PURPLE-ELEPHANT.\n' >"$H/data/engines/askk/coder/goal.md"
reloaded=$(ask reload '{}')
# (The service looks by itself too. If it looked a moment before we asked, it said so in its log.)
has "$reloaded $(cat "$LOG")" "engines/askk/coder/goal.md: in the engine's next prompt" "\`reload\` says what it read again" || ok=0
has "$reloaded" "Read at start only" "and what can never change in place" || ok=0
has "$(ask engine_prompt '{"path":"askk/coder","input":"hi"}')" "PURPLE-ELEPHANT" "the running engine's next prompt carries the edited goal" || ok=0
# 2. The settings, with nobody asking: the service notices the edit by itself. A page at
#    another address may ask from then on; a new address to listen at waits for a restart.
allowed() { curl -s -m 5 -i -X OPTIONS -H 'Origin: https://pages.example' "$URL/ask" | tr -d '\r' | grep -ci '^access-control-allow-origin: https://pages.example'; }
[ "$(allowed)" = 0 ] || { fail "a page nobody named may not ask"; ok=0; }
printf '{"listen": "127.0.0.1:1", "origins": ["https://pages.example"], "look_every_ms": 500}\n' >"$H/data/settings.json"
n=0
until [ "$(allowed)" = 1 ] || [ $n -ge 20 ]; do
    sleep 0.5
    n=$((n + 1))
done
[ "$(allowed)" = 1 ] || { fail "an origin written into settings.json may ask within seconds, with no restart and no reload asked"; ok=0; }
has "$(cat "$LOG")" 'waits for a restart: settings.json: `listen`' "what cannot change in place is said in the log" || ok=0
has "$(ask service_settings '{}')" '"look_every_ms":500' "the settings in force are the edited ones" || ok=0
# 3. A file that cannot be read is refused in a sentence, and what was in force is kept.
printf '{"origins": [' >"$H/data/settings.json"
has "$(ask reload '{}') $(cat "$LOG")" "the settings in force are kept" "a broken file is refused, not obeyed" || ok=0
[ "$(allowed)" = 1 ] || { fail "after a broken edit the settings in force are still the last good ones"; ok=0; }
printf '{"origins": ["https://pages.example"]}\n' >"$H/data/settings.json"
[ "$hello" = "$(ask hello '{}')" ] || { fail "all of that happened in the same run of the service (hello is unchanged)"; ok=0; }
done_step $ok

echo "== restart: a new start, and everything it knew is still there"
ok=1
said=$(askk restart 2>&1)
has "$said" "askk is running at $URL" "\`askk restart\` brings the service back at the same address" || ok=0
after=$(ask hello '{}')
[ -n "$(number "$after" started)" ] && [ "$(number "$after" started)" != "$(number "$hello" started)" ] || { fail "after a restart hello has a new start time (before: $hello, after: $after)"; ok=0; }
[ "$(number "$after" pid)" != "$PID" ] || { fail "after a restart the service is a new process"; ok=0; }
has "$(ask engine_chat '{"path":"askk/coder"}')" "The sum of the squares of the first 20 primes is 30007." "the conversation from before the restart is kept" || ok=0
has "$(ask engine_prompt '{"path":"askk/coder","input":"hi"}')" "PURPLE-ELEPHANT" "and so is the goal edited by hand" || ok=0
done_step $ok

echo "== stop: it finishes when asked, and leaves no record"
ok=1
PID=$(number "$after" pid)
said=$(askk stop 2>&1)
has "$said" "askk has stopped" "\`askk stop\` waits until the service has finished" || ok=0
[ ! -e "$RECORD" ] || { fail "a stopped service leaves no record"; ok=0; }
if kill -0 "${PID:-0}" 2>/dev/null; then fail "its process is gone"; ok=0; fi
status=$(askk status 2>&1) && { fail "\`askk status\` ends with 1 when nothing runs"; ok=0; }
has "$status" "askk is not running" "status says it is not running" || ok=0
curl -s -m 3 -o /dev/null "$URL/ask" && { fail "nothing listens at $URL any more"; ok=0; }
done_step $ok

if [ -n "$failed" ]; then
    printf '\nthe service is not right:%b\n\nwhat it said:\n' "$failed"
    grep -v 'Registering: ' "$LOG" 2>/dev/null | tail -30
    exit 1
fi
printf '\nthe service works: it runs in the background, is found by its clients, shows a run as it happens, takes hand edits in place, and keeps what it knew across a restart\n'
