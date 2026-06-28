#!/usr/bin/env bash
# Fill the local model cache (models/ — see models/README.md) from the Hugging
# Face Hub. Downloads are resumable (curl -C -) and skipped when complete.
#
# Usage:
#   scripts/models/fetch.sh                  # fetch the default model set
#   scripts/models/fetch.sh org/repo [...]   # fetch specific repos instead
#
# Default set = what the in-browser runtime uses out of the box:
#   onnx-community/whisper-base          ASR (transcribe_audio tool)
#   onnx-community/gemma-4-E2B-it-ONNX   Gemma 4 E2B multimodal (local/e2b)
# Add gemma-4-E4B-it-ONNX (local/e4b) or whisper-large-v3-turbo as needed.
#
# Only ONNX weights in the dtypes the runtime actually loads are pulled
# (fp32/q4/q4f16/q8 — see scripts/local-ai/worker.js); configs/tokenizers are
# always pulled. Files that match nothing are skipped harmlessly.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CACHE="$ROOT/models"
HUB="https://huggingface.co"

REPOS=("$@")
if [ ${#REPOS[@]} -eq 0 ]; then
    REPOS=(
        "onnx-community/whisper-base"
        "onnx-community/gemma-4-E2B-it-ONNX"
    )
fi

# Keep: every non-.onnx file (configs, tokenizers, processors — all small) and
# .onnx/.onnx_data files whose name carries a dtype the runtime loads.
keep_file() {
    case "$1" in
    *.onnx | *.onnx_data)
        case "$1" in
        *q4f16* | *_q4.* | *_q4_* | *q4.onnx* | *_q8* | *quantized* | *fp32* | *encoder_model.onnx*) return 0 ;;
        *) return 1 ;;
        esac
        ;;
    *) return 0 ;;
    esac
}

for repo in "${REPOS[@]}"; do
    echo "==> $repo"
    api="$HUB/api/models/$repo"
    files=$(curl -fsSL "$api" | python3 -c '
import json, sys
data = json.load(sys.stdin)
for sibling in data.get("siblings", []):
    print(sibling["rfilename"])
')
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        if ! keep_file "$file"; then
            continue
        fi
        dest="$CACHE/$repo/$file"
        mkdir -p "$(dirname "$dest")"
        echo "    $file"
        curl -fSL -C - --retry 3 -o "$dest" "$HUB/$repo/resolve/main/$file"
    done <<<"$files"
done

echo "Done. Cache: $CACHE"
du -sh "$CACHE" 2>/dev/null || true
