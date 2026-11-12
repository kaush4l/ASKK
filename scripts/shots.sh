#!/usr/bin/env bash
# Screenshots of every UI, per build type, so each can be judged and improved on its own.
#
#   ./scripts/shots.sh            capture what the last build made (./scripts/run.sh builds it)
#   ./scripts/shots.sh --build    build the `full` preset first
#   ./scripts/shots.sh --mac      also build and shoot the Mac window (needs the Screen
#                                 Recording permission for the terminal that runs this)
#
# Out: target/shots/index.html (open it in a browser), one section per type:
#   web       the full app's page: canvas, every box, pill, palette, an engine, a terminal,
#             settings; phone, tablet and wide; dark and light; and less motion, no glass,
#             more contrast
#   tab       the `tab` preset, when ./scripts/local.sh has built it
#   terminal  `askk terminal`: lines (piped) and the full screen, step by step
#   mac       the Mac window (with --mac)
#
# A fresh home each run, with the defaults: the screens show the same things every time, so
# two runs can be compared. Env: PORT (default 8891), CHROME (the browser to drive).
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

BUILD=0 MAC=0
for a in "$@"; do
    case $a in
    --build) BUILD=1 ;;
    --mac) MAC=1 ;;
    *) echo "unknown: $a (see the top of $0)"; exit 1 ;;
    esac
done

CHROME=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
[ -x "$CHROME" ] || CHROME=$(command -v google-chrome || command -v chromium || true)
[ -n "$CHROME" ] || { echo "no Chrome to drive (set CHROME)"; exit 1; }
command -v node >/dev/null || { echo "node is not installed: it drives the browser"; exit 1; }

[ $BUILD = 1 ] && ./scripts/build.sh full
OUT_APP=target/dx/askk/release/web
BIN=$OUT_APP/server
[ -x "$BIN" ] || { echo "nothing is built at $OUT_APP. Run ./scripts/shots.sh --build"; exit 1; }

PORT=${PORT:-8891}
URL=http://127.0.0.1:$PORT
SHOTS=$ROOT/target/shots
mkdir -p "$ROOT/target"
WORK=$(mktemp -d "$ROOT/target/shots-run.XXXXXX")
H=$WORK/home
mkdir -p "$WORK/app" "$H" "$SHOTS"
find "$SHOTS" -maxdepth 1 -type f \( -name '*.png' -o -name '*.txt' -o -name '*.html' \) -delete
# A copy is run, never the build output itself (macOS stops a program written over in place).
cp "$BIN" "$WORK/app/" && cp -R "$OUT_APP/public" "$WORK/app/public"
BIN=$WORK/app/server
askk() { (cd "$H" && ASKK_HOME="$H" PORT=$PORT IP=127.0.0.1 SHELL=/bin/sh "$BIN" "$@"); }
ask() { curl -s -m 30 -X POST -H 'content-type: application/json' -d "$2" "$URL/ask/$1"; }
word() { printf '%s' "$1" | sed -n "s/.*\"$2\": *\"\([^\"]*\)\".*/\1/p" | head -1; }
tab_pid=""
mac_pid=""
stop() {
    [ -n "$mac_pid" ] && kill "$mac_pid" 2>/dev/null
    askk stop >/dev/null 2>&1
    [ -n "$tab_pid" ] && kill "$tab_pid" 2>/dev/null
    rm -rf "$WORK"
}
trap stop EXIT

shoot() {  # shoot <plan.json> <what>
    node "$ROOT/scripts/shots/page.mjs" "$CHROME" "$WORK/chrome" "$SHOTS" "$1" > "$WORK/report.json" 2>&1
    python3 -I - "$WORK/report.json" "$2" <<'EOF'
import json, sys
try:
    r = json.load(open(sys.argv[1]))
except Exception as e:
    print(f"   {sys.argv[2]}: the browser said nothing readable ({e})"); sys.exit(0)
bad = [x for x in r if x.get("error") or x.get("console")]
print(f"   {sys.argv[2]}: {sum(1 for x in r if x.get('name'))} frames" + (f", {len(bad)} with something said:" if bad else ""))
for x in bad[:8]:
    print("     ", x.get("name", ""), (x.get("error") or "; ".join(x["console"]))[:200])
EOF
}

echo "== the service (a fresh home on $URL)"
askk start >/dev/null 2>&1 || { echo "   it did not start"; exit 1; }
n=0
until [ "$(curl -s -o /dev/null -w '%{http_code}' "$URL/")" = 200 ] || [ $n -ge 100 ]; do sleep 0.2; n=$((n + 1)); done

echo "== terminal: the full screen"
(cd "$H" && ASKK_HOME="$H" PORT=$PORT IP=127.0.0.1 SHELL=/bin/sh python3 "$ROOT/scripts/shots/tui.py" "$BIN") > "$WORK/tui.txt" 2>&1
cp "$WORK/tui.txt" "$SHOTS/terminal-walk.log"
python3 -I scripts/shots/plan.py frames "$WORK/tui.txt" "$SHOTS" > "$WORK/tui.json"
shoot "$WORK/tui.json" terminal
find "$SHOTS" -maxdepth 1 -name 'terminal--*.html' -delete

# A terminal to show: a listing on a shell's screen.
terminal=""
opened=$(ask terminal_open '{"command":"","place":"demo","cols":100,"rows":30}')
tid=$(word "$opened" ok)
if [ -n "$tid" ]; then
    terminal="terminal:$tid"
    sleep 1
    ask terminal_type "{\"id\":\"$tid\",\"keys\":\"printf 'askk\\\\n' > hello.txt; ls -la; echo done\\r\"}" >/dev/null
    sleep 1
else
    echo "   no terminal to show: $opened"
fi

echo "== web: the full app's page"
python3 -I scripts/shots/plan.py page "$URL" "$terminal" > "$WORK/web.json"
shoot "$WORK/web.json" web

echo "== terminal: lines"
printf '/boxes\n/quit\n' | askk terminal --lines > "$SHOTS/terminal--lines-boxes--piped-plain.txt" 2>&1
echo "   $(wc -l < "$SHOTS/terminal--lines-boxes--piped-plain.txt" | tr -d ' ') lines"

echo "== tab: the whole app in one browser tab"
if [ -f target/local/index.html ]; then
    TAB_PORT=$((PORT + 1))
    python3 -m http.server "$TAB_PORT" --bind 127.0.0.1 --directory target/local >/dev/null 2>&1 &
    tab_pid=$!
    sleep 1
    python3 -I scripts/shots/plan.py tab "http://127.0.0.1:$TAB_PORT/" > "$WORK/tab.json"
    shoot "$WORK/tab.json" tab
else
    echo "   not built: ./scripts/build.sh tab"
fi

echo "== mac: the Mac window"
if [ $MAC = 1 ] && [ "$(uname)" = Darwin ]; then
    ./scripts/build.sh mac >/dev/null 2>&1 || echo "   the Mac window did not build"
    if [ -x target/release/askk ]; then
        (cd "$H" && ASKK_HOME="$H" PORT=$PORT IP=127.0.0.1 exec "$ROOT/target/release/askk" >/dev/null 2>&1) &
        mac_pid=$!
        sleep 8
        # The window's number, from the system's list of windows, by the program that owns it.
        wid=$(swift - "$mac_pid" 2>/dev/null <<'EOF'
import CoreGraphics
let pid = Int(CommandLine.arguments[1])!
let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as! [[String: Any]]
for w in list where (w[kCGWindowOwnerPID as String] as? Int) == pid && (w[kCGWindowLayer as String] as? Int) == 0 {
    print(w[kCGWindowNumber as String]!); break
}
EOF
)
        if [ -n "$wid" ] && screencapture -x -o -l "$wid" "$SHOTS/mac--window--app-system.png" 2>/dev/null; then
            echo "   1 frame"
        else
            if [ -z "$wid" ]; then echo "   not captured: the window did not open"; else echo "   not captured: the window is there ($wid), but the system refused the picture. Allow this terminal in System Settings, Privacy & Security, Screen Recording"; fi
        fi
        kill "$mac_pid" 2>/dev/null
    fi
else
    echo "   not asked (--mac)"
fi

frames=$(python3 -I scripts/shots/plan.py index "$SHOTS")
echo "ready: $frames frames in $SHOTS/index.html"
