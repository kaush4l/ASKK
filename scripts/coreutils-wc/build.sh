#!/usr/bin/env bash
# Build the `wc` hosted-binary proof into a wasm32-wasip1 binary.
#
# This util proves the WASI runner's BinaryEnv descriptor generalizes beyond
# the bespoke Python runtime: it is hosted as a bundled asset and selected by
# name through a descriptor, not by a `.wasm` path.
#
# Prereq (one-time): rustup target add wasm32-wasip1
#
# Output: assets/runtimes/coreutils/wc.wasm (committed; tiny, well under 1 MB).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/../.." && pwd)"
out_dir="$repo_root/assets/runtimes/coreutils"
out="$out_dir/wc.wasm"

mkdir -p "$out_dir"

echo "Compiling coreutils-wc/main.rs -> wc.wasm (wasm32-wasip1, -O) ..."
rustc \
  --target wasm32-wasip1 \
  -O \
  -C strip=symbols \
  -o "$out" \
  "$here/main.rs"

size_bytes=$(wc -c < "$out" | tr -d ' ')
size_kib=$(awk -v b="$size_bytes" 'BEGIN{printf "%.2f", b/1024}')
echo "Built $out ($size_bytes bytes, $size_kib KiB)"
