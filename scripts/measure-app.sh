#!/usr/bin/env bash
# MEASURE THE REAL APP, at a list of widths. The rig docs/UPLIFT-FINDINGS.md F7
# says has to exist before a fit can be trusted.
#
# scripts/shot.sh and check-layout.sh both drive scripts/layout-probe.html — the
# shell's markup against the built CSS. That fixture is right for structure and
# WRONG for anything whose answer depends on real content: its column widths are
# not the app's, and its non-Dashboard nameplate is the word "main", four letters
# against a constant derived from seven. A fit verified there is not verified.
#
# This serves dist/ and drives the actual Wasm build. It is slower (the app has
# to boot at every width) and it is the only thing that can settle a question
# about what a user is served.
#
# Usage: scripts/measure-app.sh '<js expression returning a string>' [widths...]
#   e.g. scripts/measure-app.sh 'document.querySelectorAll("h1").length' 390 1440
# Default widths: 320 360 375 390 400 500 768 1024 1280 1440 1920
#
# ROUTE=chat|deck|workspace|... picks the view. Three of the four defects this
# rig was built for are only WRONG on a route the default load never reaches,
# and the rig could only ever see the Dashboard. The address bar IS the view
# (`crates/ui/src/shell/route.rs`), so a route here is a hash and nothing else;
# the app reads it at boot. Unset = whatever a bare load lands on.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

EXPR=${1:?usage: measure-app.sh '<js expression>' [widths...]}
shift || true
WIDTHS=${*:-"320 360 375 390 400 500 768 1024 1280 1440 1920"}
HASH=${ROUTE:+#/$ROUTE}

[ -f dist/index.html ] || { echo "measure-app.sh: no dist/ — run trunk build" >&2; exit 1; }
SB=$(find "$HOME/Library/Caches/ms-playwright" "$HOME/.cache/ms-playwright" \
  -name chrome-headless-shell -type f 2>/dev/null | sort | tail -1 || true)
[ -n "$SB" ] || { echo "measure-app.sh: chrome-headless-shell not found" >&2; exit 1; }

WORK=out/measure-app
rm -rf "$WORK"; mkdir -p "$WORK"
cp -R dist/. "$WORK/"

# The probe is appended to a COPY of index.html. It cannot be an external file:
# the page's other resources carry Subresource Integrity, and a copied tree that
# rewrote any of them would fail its own hashes. An added inline script carries
# no integrity of its own and changes none of theirs.
#
# IT DOES NOT TOUCH THE SERVICE WORKER, and the first version did. Unregistering
# looked like obvious hygiene against a stale Cache Storage answer, and it made
# the app render NOTHING: coi-sw.js is the COOP/COEP shim this build needs for
# cross-origin isolation, so killing it killed the boot. The shell mounted, the
# routed view did not, and the measurement came back with two visible nodes and
# no masthead. Freshness comes from the PORT instead — a new port is a new
# origin and therefore an empty worker registry — and isolation comes from the
# server below sending the two headers itself, which needs no worker at all.
python3 - "$WORK/index.html" "$EXPR" <<'PY'
import pathlib, sys, json
p = pathlib.Path(sys.argv[1]); expr = sys.argv[2]
html = p.read_text()
probe = """
<script>
(function(){
  // The app is Wasm behind an async boot, so there is no event to wait on from
  // out here. Poll for the shell, then measure one frame later.
  // No requestAnimationFrame: under --virtual-time-budget it is not reliably
  // serviced in headless, which cost one debugging round when 1440 answered
  // and 390 silently did not. Plain timers only, and the title is rewritten on
  // EVERY poll so a run can never produce nothing at all — a missing answer
  // and a wrong answer must not look the same.
  var tries = 0;
  function stamp(state, out) {
    document.title = 'MEASURE|' + window.innerWidth + '|' + state + '|' + out;
  }
  stamp('waiting', '');
  (function wait(){
    tries++;
    // READY IS THE ROUTED VIEW, NOT THE SHELL. The shell mounts long before the
    // app has read its state, and waiting on it returned a page whose only
    // visible text was "Skip to content", the wordmark, and "Starting up —
    // reading...". A measurement taken then is a measurement of a splash.
    // The readiness test is the routed region being LAID OUT; it deliberately
    // does not also wait for "Starting up" to disappear, because that string
    // can persist in a status pill long after the view has real geometry, and
    // a rig that reports NOBOOT beside correct numbers teaches you to ignore
    // its own status field.
    var view = document.querySelector('.masthead, .view-panel, .deck');
    var ready = view && view.offsetParent;
    if (!ready && tries < 400) { stamp('waiting', 'try ' + tries); return setTimeout(wait, 50); }
    setTimeout(function(){
      var out;
      try { out = String(%s); } catch (e) { out = 'ERR ' + e.message; }
      stamp(ready ? 'booted' : 'NOBOOT', out);
    }, 80);
  })();
})();
</script>
""" % expr
p.write_text(html.replace("</body>", probe + "</body>") if "</body>" in html else html + probe)
PY

# A fresh port per run, so the browser profile carries no worker for this
# origin and nothing can answer from a previous build's cache.
PORT=${PORT:-$(( 8900 + RANDOM % 900 ))}
python3 scripts/coi-server.py "$WORK" "$PORT" >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
for i in $(seq 40); do
  curl -fsS "http://127.0.0.1:$PORT/index.html" >/dev/null 2>&1 && break
  [ "$i" = 40 ] && { echo "measure-app.sh: server never came up" >&2; exit 1; }
done

for W in $WIDTHS; do
  H=$([ "$W" -lt 500 ] && echo 844 || echo 900)
  "$SB" --headless --disable-gpu --hide-scrollbars --window-size="$W,$H" \
    --virtual-time-budget=45000 --dump-dom "http://127.0.0.1:$PORT/$HASH" 2>/dev/null \
  | grep -o '<title>MEASURE|[^<]*</title>' | sed 's/<[^>]*>//g' \
  || echo "MEASURE|$W|NOTITLE|"
done
