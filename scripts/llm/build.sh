#!/usr/bin/env bash
# Rebuild the vendored local-LLM worker bundle + stage ONNX runtime wasm as
# web assets. Run after editing entry.js or bumping deps (bun update).
set -euo pipefail
cd "$(dirname "$0")"

bun install --frozen-lockfile 2>/dev/null || bun install

bun build entry.js --target=browser --minify --outfile=dist/askk-llm.js

ASSETS=../../crates/browser/assets/llm
mkdir -p "$ASSETS"
cp dist/askk-llm.js "$ASSETS/"

# Stage the pinned onnxruntime-web runtime pair. Prefer the jsep build (one
# binary serving both the webgpu and cpu-wasm execution providers); fall
# back to the plain cpu build if this ort version has no jsep artifact.
ORT=node_modules/onnxruntime-web/dist
if [ -f "$ORT/ort-wasm-simd-threaded.jsep.mjs" ]; then
  cp "$ORT/ort-wasm-simd-threaded.jsep.mjs"  "$ASSETS/llm-ort.mjs"
  cp "$ORT/ort-wasm-simd-threaded.jsep.wasm" "$ASSETS/llm-ort.wasm"
else
  cp "$ORT/ort-wasm-simd-threaded.mjs"  "$ASSETS/llm-ort.mjs"
  cp "$ORT/ort-wasm-simd-threaded.wasm" "$ASSETS/llm-ort.wasm"
fi

ls -la "$ASSETS"
