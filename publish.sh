#!/usr/bin/env bash
# Build the Dioxus app with trunk and deploy dist/ to the ROOT of gh-pages via
# a git worktree. Usage: publish.sh [--dry-run]
# Gates hard before touching git; --dry-run runs every gate, prints the file
# list, and stops before push.
#
# gh-pages root is the new app (plan: "gh-pages root is replaced now"); the old
# c2w page survives in history at `deploy 80564a2`.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then DRY_RUN=1; shift; fi
DIR=dist
WT=out/gh-pages-worktree

fail() { echo "GATE FAIL: $*" >&2; exit 1; }

trunk build --release   # Trunk.toml: web/index.html -> dist/, public_url "./"

# ---- gates ------------------------------------------------------------------
[ -d "$DIR" ] || fail "deploy dir not found: $DIR"
[ -f "$DIR/index.html" ] || fail "missing $DIR/index.html"
[ -f "$DIR/sw.js" ] && [ -f "$DIR/coi-sw.js" ] || fail "isolation worker missing from $DIR"

# Agents are fetched at runtime from these static files; without them the page
# boots with the compiled-in built-ins only and no main agent (increment 03).
[ -f "$DIR/agents/index.json" ] || fail "agent manifest missing: $DIR/agents/index.json"
[ -f "$DIR/agents/main/agent.md" ] || fail "main agent missing: $DIR/agents/main/agent.md"
# The model catalogue (increment 04): without it the page has no endpoint at
# all and every turn fails on EndpointUnknown.
[ -f "$DIR/models.json" ] || fail "model catalogue missing: $DIR/models.json"

# GitHub hard-caps files at 100MB; refuse anything >= 99MB
big=$(find "$DIR" -type f -size +$((99 * 1024 * 1024 - 1))c)
[ -z "$big" ] || fail "file(s) >= 99MB: $big"

# relative-URL rule: the site lives under the /ASKK/ subpath, so an absolute
# src/href — or an absolute service-worker scope — white-pages production with
# no console error. grep exits 1 on no match: that is the PASS case, hence
# `|| true` (pipefail hygiene).
bad=$(find "$DIR" -name '*.html' -exec grep -nE '(src|href)="/' /dev/null {} + 2>/dev/null || true)
[ -z "$bad" ] || fail "absolute URLs in HTML: $bad"
bad=$(find "$DIR" -name '*.html' -o -name '*.js' \
  | xargs grep -nE 'serviceWorker\.register\(["'"'"']/' 2>/dev/null || true)
[ -z "$bad" ] || fail "absolute service-worker path: $bad"

echo "deploy size: $(du -sh "$DIR" | cut -f1)"

if [ "$DRY_RUN" = 1 ]; then
  echo "-- dry run: files that would deploy --"
  find "$DIR" -type f | sort
  echo "DRY RUN OK (all gates passed, nothing pushed)"
  exit 0
fi

# ---- gh-pages worktree deploy ----------------------------------------------
git worktree remove --force "$WT" 2>/dev/null || true
if git fetch origin gh-pages 2>/dev/null; then
  git worktree add "$WT" -B gh-pages origin/gh-pages
else
  git worktree add --orphan -b gh-pages "$WT"
fi

# replace contents wholesale; .nojekyll keeps Jekyll off the asset tree
find "$WT" -mindepth 1 -maxdepth 1 -not -name .git -exec rm -rf {} +
cp -R "$DIR"/. "$WT"/
touch "$WT/.nojekyll"

git -C "$WT" add -A
git -C "$WT" commit -m "deploy $(git rev-parse --short HEAD)" || true # no-op deploy is fine
# never --force: the owner deploys in parallel; a non-fast-forward must fail
# loudly so we re-fetch instead of clobbering their push.
git -C "$WT" push origin gh-pages
git worktree remove --force "$WT"
echo "PUBLISHED $(git rev-parse --short HEAD) from $DIR/"
