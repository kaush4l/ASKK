#!/usr/bin/env bash
# The layout check (increment 12d). Runs scripts/layout-probe.html — the shell's
# own markup against the BUILT stylesheets in dist/ — under chrome-headless-shell
# at four widths, in both skins, on both routes, and fails on any FAIL line.
#
# Why a probe and not the app: the app is Wasm behind an async boot and a model
# endpoint, and the bug this catches is pure CSS and structure. The probe links
# the FINGERPRINTED dist/ files, so the build's own CSS pass is what is measured
# (12c lost a nested rule to it silently).
#
# Usage: scripts/check-layout.sh [--reduced-motion]
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

SHELL_BIN=$(find "$HOME/Library/Caches/ms-playwright" "$HOME/.cache/ms-playwright" \
  -name chrome-headless-shell -type f 2>/dev/null | sort | tail -1 || true)
[ -n "$SHELL_BIN" ] || { echo "GATE FAIL: chrome-headless-shell not found" >&2; exit 1; }

OUT=out/layout-probe
mkdir -p "$OUT"
cp scripts/layout-probe.js scripts/glass-audit.js scripts/layout-audit.js "$OUT/"

# The stylesheets in the order index.html links them, fingerprints and all —
# READ OFF index.html rather than listed here. The hardcoded list was itself an
# instance of the bug this script exists to catch: increment 13 added dash.css,
# the list did not know, and the probe measured a page with no dashboard in it
# and printed LAYOUT CHECK OK while the deployed page was broken in two ways.
links=""
for name in $(grep -o 'rel="css" href="[a-z-]*\.css"' web/index.html | sed 's/.*href="//; s/\.css"//'); do
  f=$(ls dist/"$name"-*.css 2>/dev/null | head -1) \
    || { echo "GATE FAIL: dist/$name-*.css missing — run trunk build" >&2; exit 1; }
  [ -n "$f" ] || { echo "GATE FAIL: dist/$name-*.css missing" >&2; exit 1; }
  cp "$f" "$OUT/"
  links="$links<link rel=\"stylesheet\" href=\"$(basename "$f")\">"
done
python3 - "$OUT/index.html" "$links" <<'PY'
import sys, pathlib
dst, links = pathlib.Path(sys.argv[1]), sys.argv[2]
dst.write_text(pathlib.Path("scripts/layout-probe.html").read_text().replace("<!--CSS-->", links))
PY

EXTRA=""
[ "${1:-}" = "--reduced-motion" ] && EXTRA="--force-prefers-reduced-motion"

fails=0
# 320 and 1920 are the ends of DESIGN §10.6's range and were the two widths
# nothing ever rendered: 320 is the narrowest phone still in the field and the
# first width where a fixed gutter eats the column, 1920 the first where a
# max-width can leave the stage stranded beside furniture that keeps growing.
# 320x256 is 400% browser zoom on a 1280x1024 screen — the WCAG 1.4.10
# case, and the one where the one-screen promise had to be given up.
for size in 320x256 320x780 360x780 390x844 768x1024 1100x900 1280x900 1440x900 1920x1080; do
  for skin in machine plain; do
    for route in chat deck; do
      url="file://$PWD/$OUT/index.html?skin=$skin&deck=$([ "$route" = deck ] && echo 1 || echo 0)"
      dom=$("$SHELL_BIN" --headless --disable-gpu --no-sandbox $EXTRA \
        --window-size="${size/x/,}" --virtual-time-budget=1500 --dump-dom "$url" 2>/dev/null)
      report=$(printf '%s' "$dom" | python3 -c '
import html, re, sys
m = re.search(r"<pre id=\"report\">(.*?)</pre>", sys.stdin.read(), re.S)
print(html.unescape(m.group(1)) if m else "")')
      [ -n "$report" ] || { echo "GATE FAIL: no report at $size $skin $route" >&2; fails=$((fails+1)); continue; }
      echo "$report"
      echo
      n=$(printf '%s' "$report" | grep -c '^FAIL ' || true)
      fails=$((fails + n))
    done
  done
done

if [ "$fails" -gt 0 ]; then echo "LAYOUT CHECK FAILED: $fails" >&2; exit 1; fi
echo "LAYOUT CHECK OK"
