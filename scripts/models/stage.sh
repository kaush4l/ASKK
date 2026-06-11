#!/usr/bin/env bash
# Stage the local model cache into a built site so weights are served
# same-origin (the runtime checks <base>/models/ before the Hugging Face Hub).
# Run after `dx build` and before deploying. See models/README.md.
#
# Usage:
#   scripts/models/stage.sh [publish-dir]
#   (default publish-dir: target/dx/askk/release/web/public)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CACHE="$ROOT/models"
DEST="${1:-$ROOT/target/dx/askk/release/web/public}"

if [ ! -d "$DEST" ]; then
    echo "error: publish dir not found: $DEST (build the site first: dx build --release --platform web)" >&2
    exit 1
fi

file_count=$(find "$CACHE" -type f ! -name "README.md" 2>/dev/null | wc -l | tr -d ' ')
if [ "$file_count" = "0" ]; then
    echo "nothing to stage: $CACHE is empty (run scripts/models/fetch.sh first)" >&2
    exit 1
fi

mkdir -p "$DEST/models"
# rsync when available (fast re-stages); cp -R fallback keeps this portable.
if command -v rsync >/dev/null 2>&1; then
    rsync -a --exclude README.md "$CACHE/" "$DEST/models/"
else
    cp -R "$CACHE/." "$DEST/models/"
    rm -f "$DEST/models/README.md"
fi

echo "Staged $(du -sh "$DEST/models" | cut -f1) of models into $DEST/models"
