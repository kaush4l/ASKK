#!/usr/bin/env bash
# THE FIFTH GATE COMMAND (I17): the browser half of `adapters_web`, executed.
#
# `cargo test --workspace` cannot reach this crate — it is the only one that
# knows browsers exist (I3), so the host suite `cargo check`s it and stops.
# Everything the owner's headline goals rest on lives behind that check:
# IndexedDB, Web Locks, and two contexts over one store. This runs them in a
# real Chrome and exits with the SUITE's exit code.
#
# The suite is a nested PACKAGE rather than files under
# `crates/adapters_web/tests/`; its Cargo.toml says why, in full.
#
# Usage: scripts/check-browser.sh [cargo test args…]   (e.g. `--test locks`)
set -o pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1
SUITE=crates/adapters_web/tests/browser

# WHY A WEBDRIVER AND NOT `chrome-headless-shell --dump-dom`, which is what
# scripts/check-layout.sh:15-17 resolves. That probe is synchronous — the DOM it
# dumps is finished by the time the load event fires. These tests are not:
# IndexedDB and Web Locks settle on real I/O, `--virtual-time-budget` expires
# long before they do, and the dump reads "running 5 tests" and nothing more.
# wasm-bindgen-test speaks WebDriver, and chrome-headless-shell is not a
# WebDriver server. So the same resolution is reused one layer out — that cache
# is a candidate BROWSER, and a chromedriver of the same major drives it.
version_major() { "$1" --version 2>/dev/null | grep -oE '[0-9]+' | head -1; }

drivers=$( { [ -n "$CHROMEDRIVER" ] && echo "$CHROMEDRIVER"
             command -v chromedriver 2>/dev/null
             find "$HOME/Library/Caches/.wasm-pack" "$HOME/.cache/.wasm-pack" \
               -name chromedriver -type f 2>/dev/null | sort; } 2>/dev/null )
browsers=$( { echo "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
              # check-layout.sh:15-17's own resolution, so this cache is found
              # the same way twice and not two slightly different ways.
              find "$HOME/Library/Caches/ms-playwright" "$HOME/.cache/ms-playwright" \
                -name chrome-headless-shell -type f 2>/dev/null | sort; } 2>/dev/null )

DRIVER= BROWSER= MAJOR=
while IFS= read -r d; do
  [ -x "$d" ] || continue
  dm=$(version_major "$d")
  [ -n "$dm" ] || continue
  while IFS= read -r b; do
    [ -x "$b" ] || continue
    [ "$(version_major "$b")" = "$dm" ] || continue
    DRIVER=$d; BROWSER=$b; MAJOR=$dm; break
  done <<< "$browsers"
  [ -n "$DRIVER" ] && break
done <<< "$drivers"

# ONE SENTENCE NAMING THE ONE THING TO FIX, in the shape of web/index.html's
# #boot fallback: somebody who cannot run this needs the fix, not a backtrace.
if [ -z "$DRIVER" ]; then
  {
    echo "BROWSER CHECK: no chromedriver here matches an installed Chrome, so none of"
    echo "these tests can run. Install the chromedriver whose MAJOR version equals your"
    echo "Chrome's — \`chromedriver --version\` and \`Google Chrome --version\` must agree"
    echo "on the first number — from googlechromelabs.github.io/chrome-for-testing, then"
    echo "put it on PATH or set CHROMEDRIVER=/path/to/chromedriver."
    echo "drivers found:"; echo "${drivers:-  (none)}"
    echo "browsers found:"; echo "${browsers:-  (none)}"
  } >&2
  exit 1
fi

# The capabilities the runner reads out of its working directory. GENERATED,
# not committed: it names an absolute path to one machine's Chrome.
cat > "$SUITE/webdriver.json" <<JSON
{
  "goog:chromeOptions": {
    "binary": "$BROWSER",
    "args": ["--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"]
  }
}
JSON

echo "browser suite: Chrome $MAJOR at $BROWSER, driven by $DRIVER"

# THE SERVICE WORKER, before the Rust suite — because the Rust suite cannot
# reach it. `wasm-bindgen-test-runner` serves the tests out of its own temp
# directory, and a service worker may only be registered from a script on the
# page's own origin, so no `#[wasm_bindgen_test]` can ever load `web/sw.js`.
# That gap shipped a bricked page on 2026-08-23: the worker's "network-first"
# branch called a plain `fetch`, which the HTTP cache answered, and every
# returning visitor with a warm cache got the previous deploy's wasm-bindgen
# snippet behind the new `index.html`'s SRI hash. The probe drives the real
# file in the same Chrome this script already resolved. Its exit code gates,
# with no skip flag: an off switch on a gate step is a way to make the gate
# green without checking, which is the defect this whole increment is about.
python3 scripts/sw-cache-probe.py --driver "$DRIVER" --browser "$BROWSER" || exit 1

cd "$SUITE" || exit 1
# UNPIPED, and its exit code is this script's. A pipeline here would report the
# exit status of whatever it was piped INTO — the mistake this repo made twice.
CHROMEDRIVER="$DRIVER" \
CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUNNER=wasm-bindgen-test-runner \
  cargo test --target wasm32-unknown-unknown "$@"
