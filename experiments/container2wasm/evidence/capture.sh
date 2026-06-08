#!/usr/bin/env bash
# capture.sh — produce evidence/uname-output.png by driving headless Chrome over CDP.
# Requires: the spike server running (node ../server.js on :8105) and Google Chrome.
# Real-time wait is required because the wasm boot does not advance under Chrome's
# --virtual-time-budget; capture.mjs polls window.__c2wDone before screenshotting.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
PORT="${CDP_PORT:-9334}"
URL="${URL:-http://localhost:8105/?auto=1}"
OUT="$HERE/uname-output.png"

if [ ! -x "$CHROME" ]; then echo "Chrome not found at: $CHROME (set CHROME=...)" >&2; exit 1; fi
if ! curl -s "http://localhost:8105/" >/dev/null 2>&1; then
  echo "spike server not reachable on :8105 — run 'node ../server.js' first" >&2; exit 1
fi

PROFILE="$(mktemp -d)"
"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --user-data-dir="$PROFILE" --remote-debugging-port="$PORT" \
  --window-size=1400,950 about:blank >/tmp/c2w-chrome-cdp.log 2>&1 &
CHROME_PID=$!
trap 'kill "$CHROME_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 30); do
  curl -s "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 && break
  sleep 0.3
done

node "$HERE/capture.mjs" "http://127.0.0.1:$PORT" "$URL" "$OUT"
echo "screenshot: $OUT"
