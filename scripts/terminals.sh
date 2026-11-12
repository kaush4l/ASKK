#!/bin/sh
# The multiplexer: the service holds real terminals, and windows only look.
#
# It is the built app (what scripts/run.sh builds) started with `askk start` on a new, empty
# home. A terminal is opened over /ask by a client that leaves at once (curl); the program
# in it runs on, its screen is read as an object, typing reaches it, it is one of the boxes,
# it is confined to its folder where this system can confine, a program named like an agent
# is recognised (scripts/terminals/agent.sh stands in for one), and a request under a foreign
# name is refused. Then the full-screen terminal UI is driven once under a real terminal
# (scripts/terminals/tui.py). See docs/concept.md (sections 6 and 7) and docs/service.md.
#
#   ./scripts/terminals.sh            test the last build (target/dx/askk/release/web)
#   ./scripts/terminals.sh <folder>   test the build in that folder (it holds `server` and `public/`)
#
# Env: PORT (default 8795) is where the test service listens. SHOW=1 prints the screens the
# full-screen terminal drew while it was driven.
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${1:-$ROOT/target/dx/askk/release/web}
BIN=$OUT/server
[ -x "$BIN" ] || BIN=$OUT/server.exe
[ -x "$BIN" ] || { echo "nothing is built at $OUT. Build first: ./scripts/run.sh"; exit 1; }
command -v node >/dev/null || { echo "node is not installed: the test reads the service's answers with it"; exit 1; }

PORT=${PORT:-8795}
URL=http://127.0.0.1:$PORT
# The home is made under the build's own folder, not under the system's temp folder: a
# confined program may write in temp, so "outside its folder" has to be somewhere else.
mkdir -p "$ROOT/target"
WORK=$(mktemp -d "$ROOT/target/terminals.XXXXXX")
H=$WORK/home
LOG=$H/service/service.log

# A copy is run, never the build output itself (macOS stops a program whose file was
# written over in place).
mkdir -p "$WORK/app" "$H"
cp "$BIN" "$WORK/app/" && cp -R "$OUT/public" "$WORK/app/public"
BIN=$WORK/app/$(basename "$BIN")
# A program with an agent's name, for the service to recognise: it is found by its name alone.
mkdir -p "$WORK/bin"
cp "$ROOT/scripts/terminals/agent.sh" "$WORK/bin/opencode" && chmod +x "$WORK/bin/opencode"

# Every command is given the same home and the same port, as a person's shell would. The
# person's shell is named, so the test is the same on every machine.
askk() { (cd "$H" && PATH="$WORK/bin:$PATH" ASKK_HOME="$H" PORT=$PORT IP=127.0.0.1 SHELL=/bin/sh "$BIN" "$@"); }
ask() { curl -s -m 30 -X POST -H 'content-type: application/json' -d "$2" "$URL/ask/$1"; }
# The text after "name": in a line of JSON (a number, or a word in quotes).
number() { printf '%s' "$1" | sed -n "s/.*\"$2\": *\([0-9][0-9]*\).*/\1/p" | head -1; }
word() { printf '%s' "$1" | sed -n "s/.*\"$2\": *\"\([^\"]*\)\".*/\1/p" | head -1; }
# How often <text> holds <piece>.
count() { printf '%s' "$1" | grep -o -- "$2" | wc -l | tr -d ' '; }
# The box <id> out of the answer to `boxes`, as one line of JSON (nothing when it is not there).
box() { printf '%s' "$1" | node -e 'let s = ""; process.stdin.on("data", d => s += d).on("end", () => { const b = (JSON.parse(s).ok || []).find(b => b.id === process.argv[1]); console.log(b ? JSON.stringify(b) : ""); })' "$2"; }
screen() { ask terminal_screen "{\"id\":\"$1\"}"; }
# wait_screen <id> <piece> [<times>]: until the terminal's screen shows it (10 seconds at most).
wait_screen() {
    n=0
    shows=$(screen "$1")
    until [ "$(count "$shows" "$2")" -ge "${3:-1}" ] || [ $n -ge 100 ]; do
        sleep 0.1
        n=$((n + 1))
        shows=$(screen "$1")
    done
    [ "$(count "$shows" "$2")" -ge "${3:-1}" ]
}

stop() {
    askk stop >/dev/null 2>&1
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
done_step() { if [ "$1" = 1 ]; then echo "   ok"; fi; }

echo "== the service says it holds terminals"
ok=1
said=$(askk start 2>&1)
has "$said" "askk is running at $URL" "\`askk start\` returns once the service answers" || ok=0
status=$(askk status 2>&1)
case $status in
*"can do   "*terminals*) ;;
*) fail "the running service says it can hold terminals (\`askk status\`: can do … terminals)"; ok=0 ;;
esac
SERVICE=$(number "$(ask hello '{}')" pid)
done_step $ok

echo "== a terminal opened over /ask: its program runs with nobody attached"
ok=1
opened=$(ask terminal_open "{\"command\":\"sh -c 'echo hello-\$((6*7)); cat'\",\"place\":\"demo\",\"cols\":80,\"rows\":24}")
T=$(word "$opened" ok)
[ -n "$T" ] || { fail "\`terminal_open\` gives the terminal's id (it said: $opened)"; ok=0; }
# Every question here is asked by a client that has left before the next one is asked.
wait_screen "$T" '"text":"hello-42"' || { fail "the screen shows what the program printed (hello-42); it shows: $(screen "$T")"; ok=0; }
s=$(screen "$T")
has "$s" '"cols":80' "the screen is as wide as was asked for" || ok=0
has "$s" '"rows":24' "and as high" || ok=0
has "$s" '"alive":true' "the program still runs" || ok=0
has "$s" '"cursor":[0,1]' "the cursor waits under what was printed" || ok=0
done_step $ok

echo "== typing reaches the program, and the change feed says the screen changed"
ok=1
feed=$(ask changes '{"epoch":0,"seen":0}')
EPOCH=$(number "$feed" epoch)
SEQ=$(number "$feed" seq)
typed=$(ask terminal_type "{\"id\":\"$T\",\"keys\":\"typed by a client\\r\"}")
has "$typed" '{"ok":null}' "\`terminal_type\` takes the keys" || ok=0
# The terminal shows what was typed, and \`cat\` says it again: twice on the screen.
wait_screen "$T" 'typed by a client' 2 || { fail "the typed line is on the screen twice (typed, and said again by cat); it shows: $(screen "$T")"; ok=0; }
told=$(ask changes "{\"epoch\":$EPOCH,\"seen\":$SEQ}")
has "$told" "\"terminals/$T\"" "a client that waits on the change feed is told that the terminal changed" || ok=0
done_step $ok

echo "== a terminal is a box, in the page's list and in the terminal's"
ok=1
boxes=$(ask boxes '{}')
B=$(box "$boxes" "terminal:$T")
has "$B" '"kind":"sh"' "\`boxes\` lists it, by its program's name" || ok=0
has "$B" '"depth":"screen"' "askk sees as deep as its screen" || ok=0
has "$B" '"state":"working"' "it is working while its program runs" || ok=0
has "$B" '"place":"demo"' "the box says where it runs" || ok=0
has "$B" '"last":"typed by a client"' "and the last line on its screen" || ok=0
has "$B" '{"label":"confined","value":"' "the box says how its program is confined" || ok=0
lines=$(printf '/boxes\n/quit\n' | askk terminal 2>&1)
has "$lines" "(sh in demo, working): typed by a client" "\`askk terminal\`, with its lines sent to a pipe, lists the same box" || ok=0
# That terminal client came and went. The program is still there, and still reads.
ask terminal_type "{\"id\":\"$T\",\"keys\":\"still here\\r\"}" >/dev/null
wait_screen "$T" 'still here' 2 || { fail "after the clients have gone the program still runs and still reads what is typed"; ok=0; }
done_step $ok

echo "== the program is confined to its folder"
case $status in
*"can do   "*sandbox*)
    ok=1
    opened=$(ask terminal_open "{\"command\":\"echo in > inside.txt; echo out > ../../data/outside.txt; echo tried-\$?\",\"place\":\"demo\",\"cols\":80,\"rows\":24}")
    C=$(word "$opened" ok)
    wait_screen "$C" 'tried-' || { fail "the confined program ran to its end; its screen: $(screen "$C")"; ok=0; }
    [ -f "$H/projects/demo/inside.txt" ] || { fail "a confined program may write in its own folder ($H/projects/demo)"; ok=0; }
    [ ! -e "$H/data/outside.txt" ] || { fail "a confined program may NOT write outside its folder (it wrote $H/data/outside.txt)"; ok=0; }
    # (The shell says how the refused write ended: 1 in one shell, 2 in another, never 0.)
    case $(screen "$C") in
    *tried-0*) fail "the system refused the write outside, and the program was told (its screen: $(screen "$C"))"; ok=0 ;;
    esac
    case $B in
    *'"value":"not confined'*) fail "the box says its program is confined"; ok=0 ;;
    esac
    ask terminal_close "{\"id\":\"$C\"}" >/dev/null
    done_step $ok
    ;;
*)
    echo "   not checked: this build has no sandbox for this system, and its boxes say so"
    has "$B" '"value":"not confined' "with no sandbox, the box says its program is not confined" || true
    unchecked="$unchecked\n  the program is confined to its folder"
    ;;
esac

echo "== an agent in a terminal is recognised by its program's name; its state is a guess"
ok=1
opened=$(ask terminal_open '{"command":"opencode","place":"demo","cols":80,"rows":24}')
A=$(word "$opened" ok)
# state_of <what the screen must show first> : the box's state once the screen shows it.
agent_box() {
    wait_screen "$A" "$1" || fail "the stand-in agent's screen shows: $1 (it shows: $(screen "$A"))"
    box "$(ask boxes '{}')" "terminal:$A"
}
G=$(agent_box 'esc to interrupt')
has "$G" '"kind":"opencode"' "the box is named after the agent, not after the shell that carries it" || ok=0
has "$G" '"depth":"recognised"' "askk sees one step deeper than a screen: which agent it is" || ok=0
has "$G" '"state":"working"' "while its screen says it works, the box is working" || ok=0
has "$G" '{"label":"its state","value":"a guess, read off its screen"}' "and the box says that this state is a guess" || ok=0
ask terminal_type "{\"id\":\"$A\",\"keys\":\"\\r\"}" >/dev/null
has "$(agent_box 'Do you want to')" '"state":"blocked"' "a question on its screen: the box waits for the owner" || ok=0
ask terminal_type "{\"id\":\"$A\",\"keys\":\"y\\r\"}" >/dev/null
has "$(agent_box 'ready')" '"state":"idle"' "back at its prompt: idle" || ok=0
ask terminal_close "{\"id\":\"$A\"}" >/dev/null
done_step $ok

echo "== a request under a foreign name is refused"
ok=1
as() { curl -s -m 10 -o "$WORK/reply" -w '%{http_code}' -X POST -H "Host: $1" -H 'content-type: application/json' -d "$3" "$URL/ask/$2"; }
code=$(as "evil.example:$PORT" terminal_open '{"command":"touch refused-but-ran","place":"demo","cols":80,"rows":24}')
[ "$code" = 403 ] || { fail "asked as evil.example, \`terminal_open\` is refused with 403 (it answered $code)"; ok=0; }
has "$(cat "$WORK/reply")" "this request named 'evil.example:$PORT'" "the refusal says why, in a sentence" || ok=0
[ ! -e "$H/projects/demo/refused-but-ran" ] || { fail "a refused request starts nothing"; ok=0; }
[ "$(as "evil.example:$PORT" boxes '{}')" = 403 ] || { fail "asked as evil.example, every question is refused"; ok=0; }
[ "$(curl -s -m 10 -o /dev/null -w '%{http_code}' -H 'Host: evil.example' "$URL/")" = 403 ] || { fail "asked as evil.example, a page is refused too"; ok=0; }
[ "$(as "localhost:$PORT" boxes '{}')" = 200 ] || { fail "asked as localhost, it answers"; ok=0; }
[ "$(as "127.0.0.1:$PORT" boxes '{}')" = 200 ] || { fail "asked as 127.0.0.1, it answers"; ok=0; }
done_step $ok

echo "== a place is a workspace: its branch and how it stands, read with git by the service"
ok=1
if command -v git >/dev/null; then
    D=$H/projects/demo
    git -C "$D" init -q -b main && git -C "$D" -c user.name=askk -c user.email=askk@localhost commit -q --allow-empty -m first
    printf 'not committed\n' >"$D/notes.txt"
    places=$(ask workspaces '{}')
    # (The answer's keys come in the order of their names: git before place.)
    has "$places" '"branch":"main","changed":' "\`workspaces\` names the place of the first terminal with its branch, and how many files changed (it said: $places)" || ok=0
    has "$places" '},"place":"demo"}' "that git state is the place demo's" || ok=0
    has "$places" '{"place":""}' "the workspace itself, where the engines and the shells run, is a place too; it is no repository of its own, so it has no git state" || ok=0
    done_step $ok
else
    echo "   not checked: git is not installed"
    unchecked="$unchecked\n  the places' git state"
fi

echo "== the full-screen terminal: a sidebar, a pane, a shell in a new tab, copy, paste, places, keys, detach"
if command -v python3 >/dev/null; then
    ok=1
    drove=$(cd "$H" && ASKK_HOME="$H" PORT=$PORT IP=127.0.0.1 SHELL=/bin/sh python3 "$ROOT/scripts/terminals/tui.py" "$BIN" 2>&1)
    has "$drove" "saw: the sidebar lists the boxes" "on a real terminal \`askk terminal\` draws a sidebar with every box" || ok=0
    has "$drove" "saw: a pane shows the engine" "and a pane with the engine to talk to" || ok=0
    has "$drove" "saw: a terminal box shows its live screen" "a terminal box chosen in the sidebar shows its live screen in the pane" || ok=0
    has "$drove" "saw: a shell in a new tab ran what was typed" "ctrl+b c opens a shell in a new tab, and typing reaches it" || ok=0
    has "$drove" "saw: the wheel looked back up the shell's pane, and typing returned to its end" "the wheel looks back at what scrolled off a terminal's pane" || ok=0
    has "$drove" "saw: copy mode moved up the shell's pane and copied a line (OSC 52)" "ctrl+b [ is copy mode: it moves up into the scroll-back, v selects, y copies to the outer terminal's clipboard" || ok=0
    has "$drove" "saw: a drag over the shell's pane selected and copied (OSC 52)" "a drag of the mouse over a terminal's pane selects, and letting go copies" || ok=0
    has "$drove" "saw: a paste reached the program between the marks it asked for" "a paste reaches a program that asked for bracketed paste between the marks" || ok=0
    has "$drove" "saw: a split pane beside it, and a click moved the focus" "ctrl+b v splits the pane, and a click on a pane takes the focus there" || ok=0
    has "$drove" "saw: a click on a box in the sidebar showed it in the pane" "a click on a row of the sidebar shows that box" || ok=0
    if command -v git >/dev/null; then
        has "$drove" "saw: the sidebar groups the boxes by place, with the place's branch and git state" "the sidebar groups the boxes by place, each with its branch and changes" || ok=0
    fi
    has "$drove" "saw: the help lists the keys in force" "ctrl+b ? lists the keys in force, the numbers and copy mode among them" || ok=0
    has "$drove" "saw: an edit of the keys in settings.json held at once, and back" "keys written in settings.json hold in a running \`askk terminal\` at once" || ok=0
    has "$drove" "saw: detached with 0" "ctrl+b q detaches" || ok=0
    SHELL_PID=$(number "$drove" shell)
    kill -0 "${SHELL_PID:-0}" 2>/dev/null || { fail "after the terminal UI detached, the shell it opened still runs (process ${SHELL_PID:-unknown})"; ok=0; }
    has "$(ask boxes '{}')" '{"label":"command","value":"your shell (sh)"}' "and it is still one of the service's boxes" || ok=0
    # A second window, later: the service kept the layout, and the terminals come back in it.
    has "$(ask terminal_layout '{}')" '"split":{"down":false' "the service keeps the layout the window left (\`terminal_layout\`)" || ok=0
    again=$(cd "$H" && ASKK_HOME="$H" PORT=$PORT IP=127.0.0.1 SHELL=/bin/sh python3 "$ROOT/scripts/terminals/tui.py" "$BIN" again 2>&1)
    has "$again" "saw: attached again, the tabs and splits laid out as they were left" "\`askk terminal\`, started again, lays out the tabs and splits the last one left, with each terminal in its pane" || ok=0
    has "$again" "saw: ctrl+b 1 showed the box that needs the owner first" "ctrl+b and a number shows that box, what needs the owner first" || ok=0
    drove="$drove
$again"
    if [ -n "${SHOW:-}" ]; then printf '%s\n' "$drove"; elif [ $ok != 1 ]; then printf '%s\n' "$drove" | tail -45; fi
    done_step $ok
else
    echo "   not checked: python3 is not installed (it gives the test a real terminal)"
    unchecked="$unchecked\n  the full-screen terminal"
    SHELL_PID=""
fi

echo "== close: the program ends; stop: every terminal ends with the service"
ok=1
has "$(ask terminal_close "{\"id\":\"$T\"}")" '{"ok":null}' "\`terminal_close\` ends the terminal" || ok=0
has "$(screen "$T")" "no terminal '$T' is held" "a closed terminal is gone, and asking for it says so" || ok=0
[ -z "$(box "$(ask boxes '{}')" "terminal:$T")" ] || { fail "a closed terminal is no longer a box"; ok=0; }
# One more, left running: the service takes it along when it stops.
opened=$(ask terminal_open '{"command":"echo pid-$$; sleep 600","place":"","cols":80,"rows":24}')
L=$(word "$opened" ok)
wait_screen "$L" 'pid-[0-9]' || { fail "the last terminal started; its screen: $(screen "$L")"; ok=0; }
LEFT=$(screen "$L" | sed -n 's/.*pid-\([0-9][0-9]*\).*/\1/p' | head -1)
kill -0 "${LEFT:-0}" 2>/dev/null || { fail "the program of the last terminal runs (process ${LEFT:-unknown})"; ok=0; }
has "$(askk stop 2>&1)" "askk has stopped" "\`askk stop\` ends the service" || ok=0
n=0
until ! kill -0 "${LEFT:-0}" 2>/dev/null || [ $n -ge 50 ]; do
    sleep 0.1
    n=$((n + 1))
done
if kill -0 "${LEFT:-0}" 2>/dev/null; then fail "when the service stops, its terminals end with it (process $LEFT still runs)"; ok=0; fi
if [ -n "${SHELL_PID:-}" ] && kill -0 "$SHELL_PID" 2>/dev/null; then fail "the shell the terminal UI opened ends with the service too (process $SHELL_PID still runs)"; ok=0; fi
if kill -0 "${SERVICE:-0}" 2>/dev/null; then fail "the service's process is gone"; ok=0; fi
done_step $ok

if [ -n "$failed" ]; then
    printf '\nthe terminals are not right:%b\n\nwhat the service said:\n' "$failed"
    grep -v 'Registering: ' "$LOG" 2>/dev/null | tail -30
    exit 1
fi
if [ -n "$unchecked" ]; then
    printf '\nnot checked on this machine:%b\n' "$unchecked"
fi
printf '\nthe terminals work: the service holds them with nobody attached, shows each as a screen and as a box, takes typing, confines the program, recognises an agent, refuses a foreign name, and ends them when it stops\n'
