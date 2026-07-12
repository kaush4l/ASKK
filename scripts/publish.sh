#!/usr/bin/env bash
# Publish the release web build to GitHub Pages (https://kaush4l.github.io/ASKK/).
# Run scripts/gate.sh first — this script builds and ships, it does not re-gate.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

REMOTE=git@github.com:kaush4l/ASKK.git
DIST=target/dx/askk-web/release/web/public
WT=target/gh-pages-worktree

# 1. clean dist so the deploy is exactly this build (stale hashed assets linger otherwise)
rm -rf "$DIST"

# 2. release build — the /ASKK/ base path is baked into HTML + JS glue + wasm
#    (DIOXUS_ASSET_ROOT) at compile time; post-processing a dist cannot fix it.
dx build -p askk-web --web --release --base-path ASKK --debug-symbols false

# 2b. the live agents config folder (ADR-019): dx only bundles asset!()-referenced
#     files, so the folder must ship verbatim for runtime fetch + drop-in edits.
rm -rf "$DIST/assets/agents"
cp -R crates/web/assets/agents "$DIST/assets/agents"

# 3. sanity: every path surface must carry the base path (the white-page trap)
test -f "$DIST/index.html"
grep -q 'src="/ASKK/' "$DIST/index.html"
grep -q '"/ASKK/assets/' "$DIST"/assets/askk-web-*.js
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
