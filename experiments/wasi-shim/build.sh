#!/usr/bin/env bash
# Build the tiny Rust guest into a wasm32-wasip1 binary for the wasi-shim spike.
#
# Prereq (one-time): rustup target add wasm32-wasip1
#
# Output: experiments/wasi-shim/demo.wasm  (committed; single-digit MB).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="$here/demo.wasm"

echo "Compiling guest/main.rs -> demo.wasm (wasm32-wasip1, -O) ..."
rustc \
  --target wasm32-wasip1 \
  -O \
  -C strip=symbols \
  -o "$out" \
  "$here/guest/main.rs"

size_bytes=$(wc -c < "$out" | tr -d ' ')
size_kib=$(awk -v b="$size_bytes" 'BEGIN{printf "%.2f", b/1024}')
echo "Built $out ($size_bytes bytes, $size_kib KiB)"
