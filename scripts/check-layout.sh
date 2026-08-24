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
cp scripts/layout-probe.js scripts/deck-probe.js scripts/fold-probe.js scripts/glass-audit.js scripts/ramp-audit.js scripts/span-audit.js scripts/layout-audit.js "$OUT/"

# The stylesheets in the order index.html links them, fingerprints and all —
# READ OFF index.html rather than listed here. The hardcoded list was itself an
# instance of the bug this script exists to catch: increment 13 added dash.css,
# the list did not know, and the probe measured a page with no dashboard in it
# and printed LAYOUT CHECK OK while the deployed page was broken in two ways.
sheets=""
for name in $(grep -o 'rel="css" href="[a-z-]*\.css"' web/index.html | sed 's/.*href="//; s/\.css"//'); do
  f=$(ls dist/"$name"-*.css 2>/dev/null | head -1) \
    || { echo "GATE FAIL: dist/$name-*.css missing — run trunk build" >&2; exit 1; }
  [ -n "$f" ] || { echo "GATE FAIL: dist/$name-*.css missing" >&2; exit 1; }
  cp "$f" "$OUT/"
  sheets="$sheets $(basename "$f")"
done
python3 - "$OUT/index.html" "$sheets" <<'PY'
import sys, pathlib
# INLINED in link order, not <link>ed (R11-6). Same bytes, same cascade order,
# same fingerprinted dist/ files — but a file:// <link> stylesheet is OPAQUE to
# CSSOM (`cssRules` throws SecurityError), and `layout-audit.js` has to read the
# cascade to measure the :hover and :active paintings the browser will never put
# a headless element into. A pressed row at 1.1:1 was invisible to this guard
# for exactly that reason.
dst = pathlib.Path(sys.argv[1])
here = dst.parent
blocks = "".join('<style data-sheet="%s">%s</style>' % (n, (here / n).read_text())
                 for n in sys.argv[2].split())
dst.write_text(pathlib.Path("scripts/layout-probe.html").read_text().replace("<!--CSS-->", blocks))
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
    # THREE routes, because the shell mounts one view at a time and the
    # Dashboard is one of them (R3-20/R3-21 put the primary input and the agent
    # picker on it). It used to be measured only as furniture standing under
    # the chat route, which is a page nobody is ever served.
    for route in dash chat deck; do
      url="file://$PWD/$OUT/index.html?skin=$skin&route=$route"
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

# ---- and every one of them again, in each of the four themes ---------------
# ADE-DESIGN.md E8: a theme that passes nothing is not a direction the owner can
# choose. The sweep above is 54 configurations and multiplying it by five would
# be 270 headless launches, so the themed pass is TWO viewports — the phone and
# the laptop the exit criteria are written against — on all three routes, in the
# shipped skin. That is 24 more runs and it is stated here rather than left
# implicit, because a gate that quietly covers less than it appears to is the
# defect this repo has already shipped twice.
for size in 390x844 1440x900; do
  for theme in halo console gallery atelier; do
    for route in dash chat deck; do
      url="file://$PWD/$OUT/index.html?skin=plain&theme=$theme&route=$route"
      dom=$("$SHELL_BIN" --headless --disable-gpu --no-sandbox $EXTRA \
        --window-size="${size/x/,}" --virtual-time-budget=1500 --dump-dom "$url" 2>/dev/null)
      report=$(printf '%s' "$dom" | python3 -c '
import html, re, sys
m = re.search(r"<pre id=\"report\">(.*?)</pre>", sys.stdin.read(), re.S)
print(html.unescape(m.group(1)) if m else "")')
      [ -n "$report" ] || { echo "GATE FAIL: no report at $size $theme $route" >&2; fails=$((fails+1)); continue; }
      echo "== $size $theme $route"
      echo "$report"
      echo
      n=$(printf '%s' "$report" | grep -c '^FAIL ' || true)
      fails=$((fails + n))
    done
  done
done

if [ "$fails" -gt 0 ]; then echo "LAYOUT CHECK FAILED: $fails" >&2; exit 1; fi
echo "LAYOUT CHECK OK"
