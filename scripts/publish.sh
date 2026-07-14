#!/usr/bin/env bash
# Publish the release web build to GitHub Pages (https://kaush4l.github.io/ASKK/).
# Run scripts/gate.sh first — this script builds and ships, it does not re-gate.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

REMOTE=git@github.com:kaush4l/ASKK.git
DIST=target/dx/askk-frontend/release/web/public
WT=target/gh-pages-worktree

# 1. clean dist so the deploy is exactly this build (stale hashed assets linger otherwise)
rm -rf "$DIST"

# 2. release build — the /ASKK/ base path is baked into HTML + JS glue + wasm
#    (DIOXUS_ASSET_ROOT) at compile time; post-processing a dist cannot fix it.
dx build -p askk-frontend --web --release --base-path ASKK --debug-symbols false

# 2b. the live agents config folder (ADR-019): dx only bundles asset!()-referenced
#     files, so the folder must ship verbatim for runtime fetch + drop-in edits.
rm -rf "$DIST/assets/agents"
cp -R crates/frontend/assets/agents "$DIST/assets/agents"

# 2c. cross-origin isolation for the c2w VM (SharedArrayBuffer): GitHub Pages
#     cannot send COOP/COEP, so the COI service worker ships at the site ROOT
#     (SW scope covers the whole app) and its tag is injected as the FIRST
#     script in <head>. Default mode is COEP:credentialless, so cross-origin
#     model/CDN fetches keep working on Chromium/Firefox; browsers without
#     credentialless stay un-isolated and the VM console explains itself.
cp scripts/vm-c2w/vendor/coi-serviceworker.min.js "$DIST/coi-serviceworker.min.js"
sed -i '' 's|<head>|<head><script src="/ASKK/coi-serviceworker.min.js"></script>|' "$DIST/index.html"
grep -q 'coi-serviceworker' "$DIST/index.html"

# 2d. GitHub hard-caps files at 100 MB: split the c2w VM image into 50 MB
#     chunks; the worker probes `<name>.wasm00.wasm` when the whole file 404s
#     and re-concatenates (scripts/vm-c2w/worker-entry.js fetchChunked).
for W in "$DIST"/assets/alpine64-*.wasm; do
  [ -f "$W" ] || continue
  if [ "$(wc -c < "$W")" -gt 99000000 ]; then
    split -b 50m "$W" "$W.chunk."
    n=0
    for C in "$W".chunk.*; do
      mv "$C" "$(printf '%s%02d.wasm' "$W" "$n")"
      n=$((n + 1))
    done
    rm "$W"
  fi
done

# 3. sanity: every path surface must carry the base path (the white-page trap)
test -f "$DIST/index.html"
grep -q 'src="/ASKK/' "$DIST/index.html"
grep -q '"/ASKK/assets/' "$DIST"/assets/askk-frontend-*.js
test -f "$DIST/assets/agents/manifest.json"
test -z "$(find "$DIST" -type f -size +99M)" # GitHub hard limit is 100MB/file

# 4. gh-pages worktree (orphan only on a first-ever publish)
git remote get-url origin >/dev/null 2>&1 || git remote add origin "$REMOTE"
git worktree remove --force "$WT" 2>/dev/null || true
if git fetch origin gh-pages 2>/dev/null; then
  git worktree add "$WT" -B gh-pages origin/gh-pages
else
  git worktree add --orphan -b gh-pages "$WT"
fi

# 5. replace contents wholesale; .nojekyll skips Jekyll over the asset tree
find "$WT" -mindepth 1 -maxdepth 1 -not -name .git -exec rm -rf {} +
cp -R "$DIST"/. "$WT"/
touch "$WT/.nojekyll"

# 6. commit + push (empty commit skipped = no-op deploy is fine)
git -C "$WT" add -A
git -C "$WT" commit -m "deploy $(git rev-parse --short HEAD)" || true
git -C "$WT" push origin gh-pages
git worktree remove --force "$WT"
echo "PUBLISHED $(git rev-parse --short HEAD) -> https://kaush4l.github.io/ASKK/"
