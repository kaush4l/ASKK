#!/usr/bin/env bash
# Deploy a static directory to the gh-pages branch via a git worktree.
# Usage: publish.sh [--dry-run] <dir>   (e.g. publish.sh web)
# Gates hard before touching git; --dry-run runs every gate, prints the
# file list, and stops before push.
#
# DO NOT RUN YET: gh-pages currently serves the old ASKK page; replacing it
# is a human gate. Committed for later use only.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then DRY_RUN=1; shift; fi
DIR="${1:?usage: publish.sh [--dry-run] <dir>}"
WT=out/gh-pages-worktree

fail() { echo "GATE FAIL: $*" >&2; exit 1; }

# ---- gates ------------------------------------------------------------------
[ -d "$DIR" ] || fail "deploy dir not found: $DIR"
[ -f "$DIR/index.html" ] || fail "missing $DIR/index.html"

# GitHub hard-caps files at 100MB; refuse anything >= 99MB
big=$(find "$DIR" -type f -size +$((99 * 1024 * 1024 - 1))c)
[ -z "$big" ] || fail "file(s) >= 99MB: $big"

# relative-URL rule: the site lives under a subpath, so an absolute src/href
# white-pages in production. grep exits 1 on no match — that is the PASS
# case, hence || true (pipefail hygiene).
bad=$(find "$DIR" -name '*.html' -exec grep -nE '(src|href)="/' /dev/null {} + 2>/dev/null || true)
[ -z "$bad" ] || fail "absolute URLs in HTML: $bad"

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
