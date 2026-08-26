#!/usr/bin/env bash
#
# The deploy. Every gate first, git last.
#
#     scripts/deploy.sh --dry-run     # build and check, touch nothing
#     scripts/deploy.sh               # …and publish dist/ to gh-pages
#
# The order is the safety property: `set -e` plus git being the final section
# means no check can be green-by-skipping. Nothing here rewrites a path after
# the fact — the subpath is built in by `--public-path`, because the old
# sed-the-HTML hack left the paths embedded in the JS pointing at the root and
# the page white-screened with no console error.
#
# Two gates run outside `bun run gate` because they need a browser, and they run
# here: a page that rendered and did nothing once passed 426 tests. If a browser
# gate is not in the tree yet, this refuses to deploy rather than deploying
# without it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASE_PATH="/ASKK/"
BRANCH="gh-pages"
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --base-path=*) BASE_PATH="${arg#*=}" ;;
    *) echo "unknown option $arg — deploy takes --dry-run, --base-path=" >&2; exit 1 ;;
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

step "2/5  gate"
bun run gate || fail "the gate is red. Never weaken a check to pass it."

step "3/5  static export"
bun run scripts/build.js --public-path="$BASE_PATH" || fail "the export did not build"

step "4/5  browser gates"
# The unit suite cannot see a runtime that never started, which is the only
# reason these two exist.
for gate in scripts/smoke.js scripts/check-contrast.js; do
  if [ -f "$gate" ]; then
    echo "  $gate"
    bun run "$gate" dist || fail "$gate is red against the built export"
  elif [ "$DRY_RUN" -eq 1 ]; then
    echo "  $gate is not in the tree yet — a real deploy will refuse until it is"
  else
    fail "$gate does not exist. It is what proves the built page starts; deploying without it is how a page that renders and does nothing gets shipped."
  fi
done

if [ "$DRY_RUN" -eq 1 ]; then
  step "5/5  dry run"
  echo "  would publish $(find dist -type f | wc -l | tr -d ' ') files from dist/ to $BRANCH at base path $BASE_PATH"
  find dist -type f | sed "s|^|  |"
  echo
  echo "dry run — git was not touched"
  exit 0
fi

step "5/5  publish to $BRANCH"
# A worktree rather than a checkout: the source tree is never left standing on
# the deploy branch, so an interrupted deploy cannot strand it there.
WORKTREE="$(mktemp -d)/$BRANCH"
cleanup() { git worktree remove --force "$WORKTREE" >/dev/null 2>&1 || true; }
trap cleanup EXIT

git fetch origin "$BRANCH" || fail "could not fetch origin/$BRANCH — check the remote before publishing"
git worktree add --force "$WORKTREE" "origin/$BRANCH" >/dev/null
git -C "$WORKTREE" checkout -B "$BRANCH" "origin/$BRANCH" >/dev/null

# Everything but .git: the export is the whole published tree, and a file left
# over from an older deploy is served for as long as it is there.
find "$WORKTREE" -mindepth 1 -maxdepth 1 ! -name ".git" -exec rm -rf {} +
cp -R dist/. "$WORKTREE"/
touch "$WORKTREE/.nojekyll"   # or GitHub Pages drops every path starting with _

git -C "$WORKTREE" add -A
if git -C "$WORKTREE" diff --cached --quiet; then
  echo "  nothing changed — $BRANCH already serves this export"
else
  git -C "$WORKTREE" commit -q -m "Deploy $(git rev-parse --short HEAD)"
  git -C "$WORKTREE" push origin "$BRANCH"
  echo "  pushed $(git -C "$WORKTREE" rev-parse --short HEAD) to $BRANCH"
fi

printf '\ndeployed\n'
