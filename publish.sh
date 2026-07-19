#!/usr/bin/env bash
# Deploy docs/ (INCLUDING the gitignored docs/wasm/ build output) to the
# gh-pages branch via a git worktree. Gates hard before touching git;
# --dry-run runs every gate, prints the file list, and stops before push.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

DOCS=docs
WT=out/gh-pages-worktree
DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then DRY_RUN=1; fi

fail() { echo "GATE FAIL: $*" >&2; exit 1; }

# ---- gates ------------------------------------------------------------------
[ -f "$DOCS/index.html" ] || fail "missing $DOCS/index.html"
[ -f "$DOCS/askk-sw.js" ] || fail "missing $DOCS/askk-sw.js"

MANIFEST="$DOCS/wasm/manifest.json"
[ -f "$MANIFEST" ] || fail "missing $MANIFEST (build the image first)"

# manifest lists every wasm part + exact byte size (schema per CONTRACTS.md)
pairs=$(python3 - "$MANIFEST" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
parts, sizes = m["parts"], m["sizes"]
if not parts:
    sys.exit("manifest has no parts")
if len(parts) != len(sizes):
    sys.exit("manifest parts/sizes length mismatch")
for p, s in zip(parts, sizes):
    print(f"{p}\t{s}")
PY
)
while IFS=$'\t' read -r part size; do
  f="$DOCS/wasm/$part"
  [ -f "$f" ] || fail "manifest part missing on disk: $f"
  actual=$(wc -c < "$f" | tr -d '[:space:]')
  [ "$actual" = "$size" ] || fail "$f is $actual bytes, manifest says $size"
done <<< "$pairs"

# GitHub hard-caps files at 100MB; refuse anything >= 99MB
big=$(find "$DOCS" -type f -size +$((99 * 1024 * 1024 - 1))c)
[ -z "$big" ] || fail "file(s) >= 99MB: $big"

# relative-URL rule: the site lives under /ASKK/, so an absolute src/href
# white-pages in production. grep exits 1 on no match — that is the PASS
# case, hence || true (pipefail hygiene).
bad=$(grep -RnE '(src|href)="/' "$DOCS"/*.html || true)
[ -z "$bad" ] || fail "absolute URLs in HTML: $bad"

echo "WARN: total deploy size: $(du -sh "$DOCS" | cut -f1)"

if [ "$DRY_RUN" = 1 ]; then
  echo "-- dry run: files that would deploy --"
  find "$DOCS" -type f | sort
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
cp -R "$DOCS"/. "$WT"/
touch "$WT/.nojekyll"

git -C "$WT" add -A
git -C "$WT" commit -m "deploy $(git rev-parse --short HEAD)" || true # no-op deploy is fine
# never --force: the owner deploys in parallel; a non-fast-forward must fail
# loudly so we re-fetch instead of clobbering their push.
git -C "$WT" push origin gh-pages
git worktree remove --force "$WT"
echo "PUBLISHED $(git rev-parse --short HEAD) -> https://kaush4l.github.io/ASKK/"
