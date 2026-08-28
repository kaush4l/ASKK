#!/usr/bin/env bash
#
# The deploy. Every check first, git last.
#
#     scripts/deploy.sh --dry-run     # build and check, touch nothing
#     scripts/deploy.sh               # …and publish out/ to gh-pages
#
# The order is the safety property: `set -e` plus git being the final section
# means no check can be green-by-skipping. Nothing here rewrites a path after
# the fact — the subpath is built in by `basePath` in next.config.ts, because
# the old sed-the-HTML hack left the paths embedded in the JS pointing at the
# root and the page white-screened with no console error.
#
# The browser check runs outside the gate because it needs a build and a real
# engine, and it runs here: a page that rendered and did nothing once passed 426
# tests. It drives the export through `scripts/serve-subpath.ts`, at the subpath,
# because "it works at the root" has never been the question.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BRANCH="gh-pages"
PORT="${ASKK_PORT:-4599}"
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    *) echo "unknown option $arg — deploy takes --dry-run" >&2; exit 1 ;;
  esac
done

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
fail() { printf '\ndeploy FAILED — %s\n' "$1" >&2; exit 1; }

step "1/5  working tree"
if [ -n "$(git status --porcelain)" ]; then
  git status --short
  fail "the working tree is dirty. Deploy publishes what is committed, so commit or stash first."
fi
echo "  clean at $(git rev-parse --short HEAD) on $(git rev-parse --abbrev-ref HEAD)"

step "2/5  types"
# `bun run gate` lands at PLAN 1.6 and takes this slot when it does. Naming the
# absence out loud, because a deploy that quietly skips a check it believes in
# is worse than one that has not written it yet.
if grep -q '"gate"' package.json; then
  bun run gate || fail "the gate is red. Never weaken a check to pass it."
else
  echo "  bun run gate is not in the tree yet (PLAN 1.6) — running the type check alone"
  bun run types || fail "the type check is red"
fi

step "3/5  static export"
# `bun run build` removes .next and out first. A stale artifact served in place
# of the build just made is how a green deploy lies.
bun run build || fail "the export did not build"
grep -rl "_next/static" out/index.html >/dev/null || fail "out/index.html references no build output"

step "4/5  browser check, at the subpath"
LOG="$(mktemp)"
bun scripts/serve-subpath.ts out >"$LOG" 2>&1 &
SERVER=$!
cleanup_server() { kill "$SERVER" 2>/dev/null || true; }
trap cleanup_server EXIT
sleep 1
# Bun exits on EADDRINUSE, and a server already on that port is somebody else's
# out/ from an earlier run. Answered by a stale export, this check passes and
# means nothing — which it did, once, on the way to writing this line.
if ! kill -0 "$SERVER" 2>/dev/null; then
  cat "$LOG"
  fail "the server did not stay up — port ${PORT} is likely taken, or it refused this export. Its own output above says which"
fi
cat "$LOG"
# The URL is the server's, not a fourth copy of the subpath. The server derives
# it from the prefix the build recorded in out/index.html, so a build made at a
# different basePath cannot be checked at this one.
URL="$(sed -n 's|^serving .* at \(http://[^ ]*\)$|\1|p' "$LOG")"
[ -n "$URL" ] || fail "the server did not announce a URL — nothing to check"
bun scripts/verify-export.ts "$URL" || fail "the built export is not a working page at $URL"
cleanup_server
trap - EXIT

if [ "$DRY_RUN" -eq 1 ]; then
  step "5/5  dry run"
  echo "  would publish $(find out -type f | wc -l | tr -d ' ') files from out/ to $BRANCH"
  find out -type f | sed "s|^|  |"
  echo
  echo "dry run — git was not touched"
  exit 0
fi

step "5/5  publish to $BRANCH"
# A worktree rather than a checkout: the source tree is never left standing on
# the deploy branch, so an interrupted deploy cannot strand it there. The branch
# is extended, never rewritten, and never force-pushed.
WORKTREE="$(mktemp -d)/$BRANCH"
cleanup() { git worktree remove --force "$WORKTREE" >/dev/null 2>&1 || true; }
trap cleanup EXIT

git fetch origin "$BRANCH" || fail "could not fetch origin/$BRANCH — check the remote before publishing"
BEFORE="$(git rev-parse "origin/$BRANCH")"
git worktree add --force "$WORKTREE" "origin/$BRANCH" >/dev/null
git -C "$WORKTREE" checkout -B "$BRANCH" "origin/$BRANCH" >/dev/null

# Everything but .git: the export is the whole published tree, and a file left
# over from an older deploy is served for as long as it is there.
find "$WORKTREE" -mindepth 1 -maxdepth 1 ! -name ".git" -exec rm -rf {} +
cp -R out/. "$WORKTREE"/
touch "$WORKTREE/.nojekyll"   # or GitHub Pages drops every path starting with _

git -C "$WORKTREE" add -A
if git -C "$WORKTREE" diff --cached --quiet; then
  echo "  nothing changed — $BRANCH already serves this export"
  exit 0
fi
git -C "$WORKTREE" commit -q -m "Deploy $(git rev-parse --short HEAD)"
git -C "$WORKTREE" push origin "$BRANCH"

# The push's exit code is not the proof. This repo has seen publish report
# failure after a successful push, so the remote ref is read back and compared.
LOCAL="$(git -C "$WORKTREE" rev-parse "$BRANCH")"
REMOTE="$(git ls-remote origin "$BRANCH" | cut -f1)"
[ "$LOCAL" = "$REMOTE" ] || fail "origin/$BRANCH is $REMOTE, not the $LOCAL just pushed"
echo "  $BRANCH moved ${BEFORE:0:7} -> ${LOCAL:0:7}"

printf '\ndeployed — now verify the hosted URL, not this machine:\n'
printf '  bun scripts/verify-export.ts https://kaush4l.github.io/ASKK/\n'
