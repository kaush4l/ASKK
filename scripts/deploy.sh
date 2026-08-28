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
#
# There is no `bun run build` of its own here any more. The gate's `export` check
# builds, and `bun run build` opens with `rm -rf .next out` — so a second build
# threw away the artifact the gate had just scanned and published one nothing had
# looked at. Everything below step 2 publishes the build the gate verified.
#
# The last step is the point of the whole file. §8.4: the local run is the fast
# feedback loop, the deployed run is the proof. This script used to end by
# PRINTING the two commands and trusting a human to run them, and the artifact
# went three increments stale behind a tree that thought it was shipping.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BRANCH="gh-pages"
PORT="${ASKK_PORT:-4599}"
# The one URL this project is judged on. Hard-coded, because a deploy that
# verifies whatever URL it was handed can be pointed at something that passes.
SITE="https://kaush4l.github.io/ASKK/"
# GitHub Pages publishes a push within a minute or two; ten is the outside edge
# before the right conclusion is "it did not publish" rather than "wait longer".
PUBLISH_BUDGET_S=600
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

step "2/5  the gate — which is also the build that gets published"
bun run gate || fail "the gate is red. Never weaken a check to pass it."

step "3/5  browser check, at the subpath"
# out/ is the gate's own artifact, scanned by its `export` check for server code.
# Nothing rebuilds it between there and gh-pages.
[ -f out/index.html ] || fail "the gate left no out/index.html — there is nothing to check or publish"
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
# Two browser checks, two different questions. verify-export asks whether the
# artifact loads; verify-worker asks whether the worker realm the whole
# architecture is drawn on still behaves the way it was measured behaving —
# including the one property of the single-writer election that can ship broken.
bun scripts/verify-worker.ts "$URL" || fail "the worker realm is not what the architecture assumes at $URL"
cleanup_server
trap - EXIT

if [ "$DRY_RUN" -eq 1 ]; then
  step "4/5  dry run"
  echo "  would publish $(find out -type f | wc -l | tr -d ' ') files from out/ to $BRANCH"
  find out -type f | sed "s|^|  |"
  echo
  echo "dry run — git was not touched"
  exit 0
fi

step "4/5  publish to $BRANCH"
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
  # Not an exit. "gh-pages already holds these bytes" is a claim about the
  # branch, and the branch is not the thing being served — step 5 is the only
  # statement about that, and this is precisely the case where it might be stale.
  echo "  nothing changed — $BRANCH already holds this export"
else
  git -C "$WORKTREE" commit -q -m "Deploy $(git rev-parse --short HEAD)"
  git -C "$WORKTREE" push origin "$BRANCH"

  # The push's exit code is not the proof. This repo has seen publish report
  # failure after a successful push, so the remote ref is read back and compared.
  LOCAL="$(git -C "$WORKTREE" rev-parse "$BRANCH")"
  REMOTE="$(git ls-remote origin "$BRANCH" | cut -f1)"
  [ "$LOCAL" = "$REMOTE" ] || fail "origin/$BRANCH is $REMOTE, not the $LOCAL just pushed"
  echo "  $BRANCH moved ${BEFORE:0:7} -> ${LOCAL:0:7}"
fi

step "5/5  the deployed run — the proof, per §8.4"
# The identifying string is in every build, so waiting for the page to contain
# it proves nothing about which build is being served. Next writes a fresh build
# id per build and puts it in the document; that is the token this waits for. The
# query string is a cache-buster: this repo has already been served an entire
# stale build out of a cache while believing it had checked the new one.
BUILD_ID="$(find out/_next/static -mindepth 1 -maxdepth 1 -type d ! -name chunks -exec basename {} \; | head -1)"
[ -n "$BUILD_ID" ] || fail "the export has no build id under out/_next/static — nothing identifies this build from the last one"
grep -q "$BUILD_ID" out/index.html || fail "build id $BUILD_ID is not in out/index.html, so the hosted document cannot be checked for it"
echo "  waiting for $SITE to serve build $BUILD_ID"

WAITED=0
until curl -fsS -H 'Cache-Control: no-cache' -H 'Pragma: no-cache' \
        "${SITE}?deploy=${BUILD_ID}&t=${WAITED}" 2>/dev/null | grep -q "$BUILD_ID"; do
  [ "$WAITED" -lt "$PUBLISH_BUDGET_S" ] || fail "after ${PUBLISH_BUDGET_S}s $SITE is still not serving build $BUILD_ID. GitHub Pages has not published it — the tree and the artifact are not the same thing yet, and this is the state that went unnoticed for three increments"
  sleep 10
  WAITED=$((WAITED + 10))
  printf '  %ss…\n' "$WAITED"
done
echo "  $SITE serves build $BUILD_ID after ${WAITED}s"

# Both checks, against the host that is actually serving people. §8.4: any
# assertion whose subject is a failure status is authoritative only here,
# because GitHub Pages returns real 404s and a local fixture chooses its own.
bun scripts/verify-export.ts "$SITE" || fail "the DEPLOYED page is not a working page at $SITE"
bun scripts/verify-worker.ts "$SITE" || fail "the DEPLOYED page's worker realm is not what the architecture assumes at $SITE"

printf '\ndeployed and verified on the hosted URL: %s\n' "$SITE"
