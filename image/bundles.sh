#!/bin/sh
# Shelf bundle dispatcher (ADR-048, extended by ADR-049): builds the
# docs/bin/ artifacts. Runs on the host, needs docker (linux/amd64 via
# Rosetta) for container-built bundles.
#
#   image/bundles.sh              build every bundle in image/bundles.d/
#   image/bundles.sh rust bun     build a named subset
#
# Each bundle is a script image/bundles.d/<name>.sh run in a subshell with
# the lib.sh helpers loaded (fetch_cached / bundle_container / bundle_rm /
# emit_artifact / record_artifact) and cwd = repo root. A bundle produces
# its docs/bin/ artifact(s); emit_artifact records sizes in
# docs/bin/SIZES.txt and the hash manifest in docs/bin/BUNDLES.json.
# Artifacts over the 90MiB gh-pages chunk limit ship as .part-* + .parts
# index (schema in CONTRACTS.md).
set -eu

cd "$(dirname "$0")/.."
mkdir -p out/cache docs/bin
BUNDLED=image/bundles.d

if [ "$#" -gt 0 ]; then
    names="$*"
else
    names=$(for f in "$BUNDLED"/*.sh; do
        b=$(basename "$f" .sh)
        [ "$b" = lib ] || echo "$b"
    done)
fi

for n in $names; do
    f="$BUNDLED/$n.sh"
    [ -f "$f" ] || { echo "bundles: unknown bundle '$n' (no $f)" >&2; exit 2; }
    echo "==== bundle: $n ===="
    ( . "$BUNDLED/lib.sh"; . "$f" )
done

echo "==== shelf sizes (docs/bin/SIZES.txt) ===="
cat docs/bin/SIZES.txt 2>/dev/null || true

echo "==== shelf manifest (docs/bin/BUNDLES.json) ===="
python3 -m json.tool docs/bin/BUNDLES.json 2>/dev/null || true
