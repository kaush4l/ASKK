#!/usr/bin/env bash
# Stage the v86 Alpine disk images into a built site so they are served
# same-origin at a stable path. The in-browser v86 view reads the manifest at
# <base>/assets/runtimes/v86/manifest.json and fetches each image by its `url`
# (resolved relative to document.baseURI). asset!()-bundled files get content
# hashes, so these images must land at the verbatim runtimes/v86/ path instead —
# that's what this script does. Run after `dx build` and before deploying.
# See scripts/v86/HOSTING.md.
#
# Usage:
#   scripts/v86/stage.sh [publish-dir]
#   (default publish-dir: target/dx/askk/release/web/public)

set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGES="$ROOT/assets/runtimes/v86"
MANIFEST="$ROOT/scripts/v86/manifest.json"
DEST="${1:-$ROOT/target/dx/askk/release/web/public}"

if [ ! -d "$DEST" ]; then
    echo "error: publish dir not found: $DEST (build the site first: dx build --release --platform web)" >&2
    exit 1
fi

DEST_V86="$DEST/assets/runtimes/v86"
mkdir -p "$DEST_V86"

# The manifest is always staged — the view needs it to know which images exist.
cp "$MANIFEST" "$DEST_V86/manifest.json"

# Image files are optional (the build unit produces them; they may not exist yet).
# Count anything that isn't the manifest itself.
image_count=0
if [ -d "$IMAGES" ]; then
    image_count=$(find "$IMAGES" -type f ! -name "manifest.json" 2>/dev/null | wc -l | tr -d ' ')
fi

if [ "$image_count" = "0" ]; then
    echo "notice: no v86 image files in $IMAGES — staged manifest only." >&2
    echo "        (build images with scripts/v86/build-image.sh, then re-stage.)" >&2
    exit 0
fi

# rsync when available (fast re-stages); cp -R fallback keeps this portable.
if command -v rsync >/dev/null 2>&1; then
    rsync -a --exclude manifest.json "$IMAGES/" "$DEST_V86/"
else
    cp -R "$IMAGES/." "$DEST_V86/"
    # Keep the manifest we copied above, not any stray one under assets/.
    cp "$MANIFEST" "$DEST_V86/manifest.json"
fi

echo "Staged $(du -sh "$DEST_V86" | cut -f1) of v86 images into $DEST_V86"
