#!/usr/bin/env bash
# THE DESIGN LOOP'S EYE. Renders the shell's real markup against the SOURCE
# stylesheets in web/ and writes a PNG an agent can actually look at.
#
# It is deliberately NOT check-layout.sh. That script is a GATE: it reads the
# fingerprinted files out of dist/, so it measures what a browser is shipped
# and it cannot run until `trunk build` has. This one reads web/*.css directly,
# so a CSS edit is visible in about two seconds with no Wasm build in the way.
# The gate still owns the verdict; this owns the iteration.
#
# Usage: scripts/shot.sh <width> [out.png] [skin] [route]
#   width  device-independent px (390 phone, 768 tablet, 1440 desktop)
#   skin   glass (default) | plain   — BOTH ship, so both get looked at
#   route  dash (default) | chat | deck
#
# THE ROUTE ARGUMENT IS NOT OPTIONAL POLISH. The first version of this script
# copied no JavaScript into the working directory, so the probe's own
# `layout-probe.js` never ran — and that file is what HIDES the two routes you
# are not looking at. Every shot it produced was all three routes stacked on
# one page, with the error banner, the folder panel and a toast all painted at
# once, which is a page no visitor is ever served. Renders taken before this
# was fixed should be thrown away.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

W=${1:?usage: shot.sh <width> [out.png] [skin] [route]}
OUT=${2:-out/shots/shot-$W.png}
SKIN=${3:-glass}
ROUTE=${4:-dash}
H=${HEIGHT:-}

SB=$(find "$HOME/Library/Caches/ms-playwright" "$HOME/.cache/ms-playwright" \
  -name chrome-headless-shell -type f 2>/dev/null | sort | tail -1 || true)
[ -n "$SB" ] || { echo "shot.sh: chrome-headless-shell not found" >&2; exit 1; }

mkdir -p "$(dirname "$OUT")" out/shot-work

# The probe's own scripts, which is what makes it a page rather than a pile of
# markup: layout-probe.js routes it and builds window.__probe, and the audits
# read the cascade. check-layout.sh copies exactly this list.
cp scripts/layout-probe.js scripts/deck-probe.js scripts/fold-probe.js \
   scripts/glass-audit.js scripts/ramp-audit.js scripts/layout-audit.js out/shot-work/

# The sheets, in the order index.html links them — READ OFF index.html, never
# listed here. check-layout.sh learned this the hard way: a hardcoded list went
# stale, and the probe measured a page with a whole view missing while printing
# OK. A new sheet must be visible to the eye the moment it is linked.
python3 - "$SKIN" <<'PY'
import pathlib, re, sys
skin = sys.argv[1]
root = pathlib.Path(".")
names = re.findall(r'rel="css" href="([a-z-]+)\.css"', (root/"web/index.html").read_text())
css = "\n".join(f"/* ==== {n}.css ==== */\n" + (root/f"web/{n}.css").read_text() for n in names)
html = (root/"scripts/layout-probe.html").read_text()
# INLINED, not <link>ed: a file:// stylesheet is opaque to CSSOM, and the audit
# scripts that run against this page have to read cssRules.
# The probe PRINTS its audit into a <pre id="report"> in the page, which is
# what check-layout.sh scrapes out of --dump-dom. In a screenshot it is a wall
# of PASS lines painted over the design. Hidden here and here only: the gate
# still reads it, the eye no longer has to look past it.
html = html.replace("<!--CSS-->", f"<style>\n{css}\n#report{{display:none !important}}\n</style>")
html = html.replace("<html lang=\"en\">", f"<html lang=\"en\" data-skin=\"{skin}\">")
(root/"out/shot-work/index.html").write_text(html)
print(f"shot.sh: {len(names)} sheets inlined ({', '.join(names)})", file=sys.stderr)
PY

"$SB" --headless --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 \
  --window-size="$W,${H:-$(( W < 500 ? 844 : 900 ))}" \
  --virtual-time-budget=3000 \
  --screenshot="$OUT" \
  "file://$PWD/out/shot-work/index.html?skin=$SKIN&route=$ROUTE" >/dev/null 2>&1

[ -s "$OUT" ] || { echo "shot.sh: no bytes written" >&2; exit 1; }
echo "$OUT  ${W}px  skin=$SKIN  route=$ROUTE  $(wc -c < "$OUT" | tr -d ' ') bytes"
