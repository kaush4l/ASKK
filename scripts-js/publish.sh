#!/usr/bin/env bash
# Build the static export and deploy it to the ROOT of gh-pages via a git
# worktree. Usage: scripts-js/publish.sh [--dry-run]
#
# Every gate runs BEFORE git is touched, and --dry-run runs all of them, prints
# the file list, and stops short of the push. A bare run in a numbered list of
# steps is how an owner gate gets inverted by formatting, so the push is here
# and nowhere else.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

DIR=apps/web/out
WT=.deploy/gh-pages
BASE=${HARNESS_BASE_PATH:-/ASKK}

fail() { echo "GATE FAIL: $*" >&2; exit 1; }

# ---- gates that do not need a build ----------------------------------------
bun run typecheck || fail "types do not check"
bun test packages || fail "the pure core does not pass on the host (I3)"
bun scripts-js/check-size.js || fail "I12: a file or a function is over its limit"
bun scripts-js/check-purity.js || fail "I3: a pure package reaches for something the host does not have"
bun scripts-js/check-viewmodel.js || fail "I5: the interface computed something the core owes it"

# ---- build ------------------------------------------------------------------
rm -rf "$DIR"
( cd apps/web && HARNESS_BASE_PATH="$BASE" bun run build ) || fail "the static export did not build"

# ---- gates on the artifact --------------------------------------------------
[ -f "$DIR/index.html" ] || fail "no index.html in $DIR"
[ -f "$DIR/.nojekyll" ] || fail "no .nojekyll — the gh-pages BRANCH runs Jekyll, and every _next/ path 404s silently"

# Agents and stage briefs are FETCHED AT RUNTIME. Without them the page boots
# with no agent at all, and it does so silently — so the manifest is checked
# against the folders that actually shipped, not trusted.
[ -f "$DIR/agents/index.json" ] || fail "agent manifest missing: $DIR/agents/index.json"
bun -e '
const dir = process.argv[1]
const names = (await Bun.file(dir + "/agents/index.json").json()).agents
const missing = []
for (const n of names) if (!(await Bun.file(`${dir}/agents/${n}/agent.md`).exists())) missing.push(n)
if (missing.length) { console.error("manifest names agents that did not ship: " + missing.join(", ")); process.exit(1) }
' "$DIR" || fail "the agent manifest disagrees with the deployed folders"

# Every asset reference must carry the base path, or the page 404s its own
# JavaScript on GitHub Pages and shows a white screen with no console error.
if [ -n "$BASE" ]; then
  grep -q "$BASE/_next/" "$DIR/index.html" || fail "index.html does not reference $BASE/_next — the base path did not apply"
fi

COUNT=$(find "$DIR" -type f | wc -l | tr -d ' ')
echo "built $COUNT files into $DIR (base path '$BASE')"

if [ "$DRY_RUN" = 1 ]; then
  echo "--dry-run: every gate passed; stopping before the push."
  find "$DIR" -type f | sed "s|^$DIR/||" | sort | head -40
  exit 0
fi

# ---- deploy -----------------------------------------------------------------
git fetch origin gh-pages
rm -rf "$WT"
git worktree prune
git worktree add "$WT" gh-pages
find "$WT" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -R "$DIR"/. "$WT"/
cd "$WT"
git add -A
if git diff --cached --quiet; then
  echo "gh-pages already matches this build; nothing to push."
else
  git commit -q -m "Deploy $(git -C "$OLDPWD" rev-parse --short HEAD)"
  git push origin gh-pages
  echo "pushed gh-pages"
fi
cd "$OLDPWD"
git worktree remove "$WT" --force
