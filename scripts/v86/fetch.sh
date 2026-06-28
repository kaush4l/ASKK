#!/usr/bin/env bash
# Pull pre-built v86 disk images into assets/runtimes/v86/ so stage.sh can copy
# them into the deploy. Downloads are resumable: curl -C - continues a partial
# file and a fully-downloaded one is a no-op.
#
# There is no canonical image registry yet, so the source of truth is the
# `url` field of each entry in scripts/v86/manifest.json: entries with an
# ABSOLUTE url (http/https) are fetched; entries with a relative url are
# local-only (built by scripts/v86/build-image.sh) and skipped here.
#
# Usage:
#   scripts/v86/fetch.sh                 # fetch every absolute-url image
#   scripts/v86/fetch.sh alpine-base ... # fetch only the named image ids

set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="$ROOT/assets/runtimes/v86"
MANIFEST="$ROOT/scripts/v86/manifest.json"

WANT=("$@") # optional allowlist of image ids

# Want this id? Empty allowlist = take everything.
wanted() {
    [ ${#WANT[@]} -eq 0 ] && return 0
    local id
    for id in "${WANT[@]}"; do
        [ "$id" = "$1" ] && return 0
    done
    return 1
}

mkdir -p "$DEST"

# Emit "id<TAB>url" for every manifest entry; the loop filters from there.
rows=$(python3 -c '
import json, sys
data = json.load(open(sys.argv[1]))
for img in data.get("images", []):
    print("%s\t%s" % (img.get("id", ""), img.get("url", "")))
' "$MANIFEST")

fetched=0
while IFS=$'\t' read -r id url; do
    [ -z "$id" ] && continue
    wanted "$id" || continue
    case "$url" in
    http://* | https://*) ;;
    *)
        echo "skip $id — local image (relative url '$url'); build with scripts/v86/build-image.sh" >&2
        continue
        ;;
    esac
    dest="$DEST/$(basename "$url")"
    echo "==> $id  ($url)"
    curl -fSL -C - --retry 3 -o "$dest" "$url"
    fetched=$((fetched + 1))
done <<<"$rows"

if [ "$fetched" = "0" ]; then
    echo "Nothing fetched — no matching images with an absolute url." >&2
fi
echo "Done. Images: $DEST"
du -sh "$DEST" 2>/dev/null || true
