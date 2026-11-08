#!/usr/bin/env bash
# Walks the server through run → act → structure → stop → restart → crash → restart, on a
# throwaway data folder, and prints what each step left on disk. Usage: scripts/lifecycle.sh
set -u
cd "$(dirname "$0")/.."
cargo build -q -p askk-server || exit 1
BIN=target/debug/askk-server
DATA=$(mktemp -d "${TMPDIR:-/tmp}/askk-life.XXXXXX") || exit 1
PORT=4601
URL=http://127.0.0.1:$PORT
LOG=$DATA.log

run() {
  "$BIN" --data "$DATA" --port $PORT >>"$LOG" 2>&1 &
  PID=$!
  for _ in $(seq 100); do curl -sf $URL/world >/dev/null && return; sleep 0.1; done
  echo "server did not come up"; cat "$LOG"; exit 1
}
post() { curl -s -XPOST "$URL/$1" -H 'content-type: application/json' -d "$2"; echo; }
act() { local a="${3:-}"; [ -z "$a" ] && a="{}"; post act "{\"target\":\"$1\",\"action\":\"$2\",\"args\":$a}" | head -c 120; echo; }
SHOW=$DATA.show.py
cat >"$SHOW" <<'PY'
import json, sys
w = json.load(sys.stdin)
def show(e, d=0):
    els = ", ".join(f"{x['id']}={x['phase']}:{json.dumps(x['state'])}" for x in e["elements"])
    print("   " + "  " * d + f"{e['id']} [{e['phase']}] {els}")
    for c in e["children"]:
        show(c, d + 1)
for e in w["engines"]:
    show(e)
print("   kinds:", [k["kind"] for k in w["kinds"]], "layouts:", list(w["layouts"]))
PY
summary() { curl -s $URL/world | python3 "$SHOW"; }
# expect <id> <phase>: the phase in the state file, checked
expect() {
  local got; got=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['phase'])" "$DATA/state/$1.json")
  if [ "$got" = "$2" ]; then echo "   ok: $1 is $2"; else echo "   FAIL: $1 is $got, expected $2"; FAILS=$((FAILS+1)); fi
}
FAILS=0
# answer <loop id> <text>: the loop's saved last_answer starts with it
answer() {
  local got; got=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['state'].get('last_answer') or '')" "$DATA/state/$1.json")
  case "$got" in "$2"*) echo "   ok: $1 answered \"$got\"";; *) echo "   FAIL: $1 answered \"$got\", expected \"$2…\""; FAILS=$((FAILS+1));; esac
}
disk() { echo "   runtime.json: $(tr -d ' \n' <"$DATA/runtime.json")"; echo "   lock: $([ -e "$DATA/.lock" ] && echo present || echo none)"; echo "   files: $(cd "$DATA" && find engines state -type f | sort | tr '\n' ' ')"; }

echo "== 1. run (fresh data folder: seeded)"; run; tail -2 "$LOG"; summary
echo "== 2. structure + actions"
# offline: this folder's desk default is the built-in echo connector (the seed's is claude-cli)
printf -- '---\ntitle: Echo\nconfig: {connector: echo}\n---\n' >"$DATA/engines/models/echo.md"
printf -- '---\ntitle: Desk\nmodel: echo\n---\n' >"$DATA/engines/desk.md"
sleep 1 # the watcher reloads
act askk element.add '{"kind":"counter","title":"Runs","config":{"step":2}}'
act askk/runs inc
act askk element.add '{"kind":"status","title":"Job"}'
act askk/job start
act askk engine.add '{"title":"Child"}'
act askk element.add '{"kind":"timer","title":"Egg","config":{"seconds":30}}'
act askk element.add '{"kind":"timer","title":"Tea","config":{"seconds":30}}'
T0=$(date +%s)
act askk/egg start
act askk/tea start
echo "   loop (echo model): $(act askk/loop run '{"input":"hello"}')"
echo "   phase (mode): $(act askk/phases set '{"phase":"build"}')"
for _ in $(seq 50); do sleep 0.1; [ "$(python3 -c "import json; print(json.load(open('$DATA/state/askk/loop.json'))['phase'])")" = idle ] && break; done
expect askk/loop idle; answer askk/loop "echo: hello"
mode=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['state'].get('current'))" "$DATA/state/askk/phases.json")
[ "$mode" = build ] && echo "   ok: askk is in phase build" || { echo "   FAIL: askk phase is $mode"; FAILS=$((FAILS+1)); }
echo "   refusal: $(post act '{"target":"askk/runs","action":"explode"}')"
echo "   layout: $(post layout '{"view":"dashboard","layout":{"order":["askk"]}}')"
summary
sleep 2.2
echo "   two timers after $(( $(date +%s) - T0 ))s: $(curl -s $URL/world | python3 -c "import json,sys; w=json.load(sys.stdin); print([(e['id'], e['state']['elapsed']) for e in w['engines'][0]['elements'] if e['kind']=='timer'])")"
echo "== 3. stop (SIGTERM mid-timer, an /events stream open)"
curl -sN $URL/events >"$DATA.events" & SSE=$!
sleep 0.3; act askk/runs inc >/dev/null; sleep 0.3
kill -TERM $PID; wait $PID; echo "   exit code $?"; wait $SSE; echo "   events seen: $(grep -c '^event' "$DATA.events")"; tail -3 "$LOG"; disk
expect askk/egg stopped; expect askk/tea stopped
echo "== 4. restart"; : >"$LOG"; run; head -1 "$LOG"; summary
echo "   loop after restart: $(curl -s $URL/world | python3 -c "import json,sys; w=json.load(sys.stdin); print([x['state']['last_answer'] for x in w['engines'][0]['elements'] if x['kind']=='loop'])")"
answer askk/loop "echo: hello"
act askk/job start >/dev/null
act askk/egg start >/dev/null; sleep 1.5
echo "== 5. crash (SIGKILL mid-timer)"; kill -KILL $PID; wait $PID 2>/dev/null; disk
expect askk/egg running
echo "== 6. restart after crash (job → interrupted)"; : >"$LOG"; run; head -1 "$LOG"; summary
expect askk/egg interrupted; expect askk/job interrupted
kill -INT $PID; wait $PID; echo "   stopped with SIGINT, exit code $?"
rm -f "$SHOW"
echo "data folder: $DATA"
[ $FAILS -eq 0 ] && echo "lifecycle: all checks passed" || { echo "lifecycle: $FAILS check(s) failed"; exit 1; }
