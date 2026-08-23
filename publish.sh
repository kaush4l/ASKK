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
# ONE agent ships, and the manifest must say so. A stale manifest naming a
# folder that is no longer deployed is a fetch that 404s at boot, which is
# silent — the page comes up with fewer agents than it listed and nothing says
# which one it failed to get.
python3 -c "
import json,sys,pathlib
d=pathlib.Path(sys.argv[1])
names=json.loads((d/'agents/index.json').read_text())['agents']
missing=[n for n in names if not (d/'agents'/n/'agent.md').is_file()]
sys.exit('manifest names agents that are not deployed: '+', '.join(missing) if missing else 0)
" "$DIR" || fail "agent manifest disagrees with the deployed folders"
# The model catalogue (increment 04): without it the page has no endpoint at
# all and every turn fails on EndpointUnknown.
[ -f "$DIR/models.json" ] || fail "model catalogue missing: $DIR/models.json"
# Every agent runs in its own Worker (increment 06); without this shim there
# are no sub-agents and every delegation refuses as an unknown agent.
[ -f "$DIR/agent-worker.js" ] || fail "agent worker missing: $DIR/agent-worker.js"

# THE SHELL ITSELF. `web/c2w` reaches dist/ only through the trunk `copy-dir`
# in web/index.html; nothing else references these paths at build time, so a
# broken or renamed copy-dir deploys green and takes every command in the
# product with it — no console error, just a Linux that never boots. While
# there were two engines this cost you the second one; there is one now.
# The names are the arguments `c2w.js` passes to
# `RunContainer.createContainerWASI`, plus the two scripts it loads first.
for path in c2w/out.wasm.gzip c2w/imagemounter.wasm.gzip c2w/worker.js \
            c2w/dist/runcontainer.js c2w/vendor/xterm-pty.js; do
  [ -f "$DIR/$path" ] || fail "Linux engine asset missing: $DIR/$path"
done
[ -d "$DIR/c2w/img" ] || fail "Linux engine image missing: $DIR/c2w/img"
[ -n "$(find "$DIR/c2w/img" -type f -print -quit)" ] || fail "empty image dir: $DIR/c2w/img"
# An empty or truncated wasm passes an `-f` test and fails at boot. 1 MB is a
# floor, not a target: the real file is ~36 MB.
[ "$(wc -c < "$DIR/c2w/out.wasm.gzip")" -gt $((1024 * 1024)) ] \
  || fail "$DIR/c2w/out.wasm.gzip is too small to be the container image"

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

# CHANGED BYTES AT AN UNCHANGED URL. Every gate above asks whether this ONE
# artifact is self-consistent, and on 2026-08-23 it was — and the page still
# bricked, because the browser paired the new document with the previous
# deploy's copy of a file whose URL had not moved. That relationship only
# exists BETWEEN two deploys, so no check of a single directory can see it.
# This one compares against what is live and fails if any path changes content
# under a fixed URL without `web/sw.js` serving it network-first.
#
# The fetch is required, not best-effort: "could not compare" must not read as
# "compared and fine" (I17). A machine that cannot reach the remote is not in a
# position to deploy to it anyway.
git fetch -q origin gh-pages \
  || fail "cannot reach origin/gh-pages, so this build could not be compared against the
  deploy it replaces. That comparison is the only check here that can see a file whose
  bytes changed while its URL did not — it is not being skipped quietly."
python3 scripts/check-url-churn.py "$DIR" FETCH_HEAD || fail "unguarded URL churn (above)"

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

# Stamp the service worker with THIS deploy, so its bytes change and the
# browser installs it: the `activate` handler then drops every older cache.
# Without this the worker is byte-identical release to release and an old one
# can keep serving a shell whose assets no longer exist.
SW_VERSION=$(git rev-parse --short HEAD)
python3 - "$DIR/sw.js" "$SW_VERSION" <<'PY'
import pathlib, re, sys
path, version = pathlib.Path(sys.argv[1]), sys.argv[2]
text = path.read_text()
stamped = re.sub(r'const VERSION = "[^"]*";', f'const VERSION = "{version}";', text, count=1)
if stamped == text:
    raise SystemExit("GATE FAIL: could not stamp VERSION into sw.js")
path.write_text(stamped)
PY
grep -q "const VERSION = \"$SW_VERSION\";" "$DIR/sw.js" || fail "sw.js version stamp did not take"

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
