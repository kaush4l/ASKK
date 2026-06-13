#!/usr/bin/env bash
#
# publish.sh — the canonical ASKK ship step.
#
# Run after every completed unit of work (CLAUDE.md "Shipping"). It pushes the
# current `main` to origin and publishes the release bundle to the `gh-pages`
# branch, leaving the repository with only `main` and `gh-pages` — no dangling
# branches. A red verification gate never reaches the live site.
#
# Usage:
#   scripts/publish.sh              # verify, push main, build release, deploy
#   scripts/publish.sh --no-verify  # skip the gate (only when it just passed)
#
# Idempotent: a no-op deploy (bundle unchanged) is detected and skipped.
set -euo pipefail

BASE_PATH="/ASKK/"                              # omitting this is the blank-page trap
PUBLIC_DIR="target/dx/askk/release/web/public"
PAGES_BRANCH="gh-pages"
PAGES_URL="https://kaush4l.github.io/ASKK/"

cd "$(git rev-parse --show-toplevel)"

verify=1
[ "${1:-}" = "--no-verify" ] && verify=0

branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != "main" ]; then
  echo "publish: refusing — HEAD is '$branch', not 'main'. Squash-merge to main first." >&2
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "publish: refusing — working tree is dirty. Commit the work first." >&2
  exit 1
fi

# 1. Verification gate — a red build must never publish.
if [ "$verify" -eq 1 ]; then
  echo "publish: running verification gate…"
  cargo fmt --all -- --check
  cargo clippy --all-targets --all-features -- -D warnings
  cargo clippy --target wasm32-unknown-unknown -- -D warnings
  cargo test --workspace
else
  echo "publish: --no-verify (gate skipped)."
fi

# 2. Push source to main (fast-forward only; bail if origin moved under us so we
#    never clobber parallel work — integrate and re-run).
git fetch origin
if ! git merge-base --is-ancestor origin/main HEAD; then
  echo "publish: refusing — origin/main has commits you don't have. Rebase, then re-run." >&2
  exit 1
fi
git push origin main

# 3. Release build with the base-path gh-pages needs.
echo "publish: building release bundle…"
dx build --release --web --base-path "$BASE_PATH" --locked
[ -d "$PUBLIC_DIR" ] || { echo "publish: build produced no $PUBLIC_DIR" >&2; exit 1; }

# 4. Publish the bundle to the root of gh-pages, via a throwaway worktree so the
#    main working tree is never disturbed. Stale files are dropped (full rm), then
#    the fresh bundle + .nojekyll are committed, referencing the source sha.
main_sha="$(git rev-parse --short HEAD)"
subject="$(git log -1 --pretty=%s)"
worktree="$(mktemp -d)"
git fetch origin "$PAGES_BRANCH"
git worktree add --force "$worktree" "$PAGES_BRANCH" >/dev/null
git -C "$worktree" merge --ff-only "origin/$PAGES_BRANCH" >/dev/null 2>&1 || true
git -C "$worktree" rm -rfq . >/dev/null 2>&1 || true
cp -R "$PUBLIC_DIR"/. "$worktree"/
touch "$worktree/.nojekyll"
git -C "$worktree" add -A
if git -C "$worktree" diff --cached --quiet; then
  echo "publish: gh-pages already up to date with this bundle."
else
  git -C "$worktree" commit -q -m "deploy: $subject (main $main_sha)"
  git -C "$worktree" push origin "$PAGES_BRANCH"
fi
git worktree remove --force "$worktree"

# 5. Branch hygiene: only `main` and `gh-pages` may survive. Delete every other
#    local branch that is already merged into main; warn (don't force) on unmerged.
git for-each-ref --format='%(refname:short)' refs/heads | grep -vxE 'main|gh-pages' | while read -r b; do
  if git branch -d "$b" >/dev/null 2>&1; then
    echo "publish: pruned merged branch '$b'."
  else
    echo "publish: WARNING — '$b' is unmerged; left intact. Delete manually if intended." >&2
  fi
done

echo "publish: done → $PAGES_URL  (main $main_sha)"
