#!/usr/bin/env bash
# Rebuild the vendored speech bundles + stage ONNX runtime wasm as web assets.
# Run after editing stt-entry.js / tts-entry.js or bumping deps (bun update).
set -euo pipefail
cd "$(dirname "$0")"

bun install --frozen-lockfile 2>/dev/null || bun install

bun build stt-entry.js --target=browser --minify --outfile=dist/askk-stt.js
bun build tts-entry.js --target=browser --minify --outfile=dist/askk-tts.js

ASSETS=../../crates/web/assets/speech
mkdir -p "$ASSETS"
cp dist/askk-stt.js dist/askk-tts.js "$ASSETS/"

# Each bundle pins its own onnxruntime-web; stage each pair under a distinct
# name (plain CPU-wasm build only — jsep/webgpu is a later, heavier tier).
ORT_STT=node_modules/onnxruntime-web/dist
ORT_TTS=node_modules/kokoro-js/node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist
cp "$ORT_STT/ort-wasm-simd-threaded.mjs"  "$ASSETS/stt-ort.mjs"
cp "$ORT_STT/ort-wasm-simd-threaded.wasm" "$ASSETS/stt-ort.wasm"
cp "$ORT_TTS/ort-wasm-simd-threaded.mjs"  "$ASSETS/tts-ort.mjs"
cp "$ORT_TTS/ort-wasm-simd-threaded.wasm" "$ASSETS/tts-ort.wasm"

ls -la "$ASSETS"
