#!/usr/bin/env bash
# fetch-assets.sh — download the large container2wasm assets that are NOT vendored
# in git (they exceed the repo's 50 MB blob limit). Everything fetched here is
# .gitignored. The small JS glue under htdocs/ IS committed.
#
# Source: the upstream published demo, https://ktock.github.io/container2wasm-demo/
# (Apache-2.0). These are prebuilt browser assets — no Docker / c2w build needed.
#
# Usage:  ./fetch-assets.sh [amd64-vim-wasi|riscv64-vim-wasi|all]
#   default: amd64-vim-wasi (x86_64 alpine:3.18, ~124 MB)
set -euo pipefail

BASE="https://ktock.github.io/container2wasm-demo"
HERE="$(cd "$(dirname "$0")" && pwd)"
DST="$HERE/htdocs/containers"
PROXY_DST="$HERE/htdocs/src/c2w-net-proxy.wasm"
mkdir -p "$DST"

# image-prefix -> chunk count (see upstream *.html startWasi calls).
# Plain case statement (not an associative array) so this runs on macOS bash 3.2.
chunks_for() {
  case "$1" in
    amd64-vim-wasi)    echo 3 ;;  # x86_64 alpine:3.18  ~124 MB  (Bochs emulator)
    riscv64-vim-wasi)  echo 2 ;;  # riscv64 alpine:3.18 ~74 MB   (TinyEMU, smallest)
    amd64-python-wasi) echo 3 ;;  # x86_64 python:3.11-alpine ~139 MB
    amd64-debian-wasi) echo 5 ;;  # x86_64 debian:sid-slim    ~191 MB
    *)                 echo "" ;;
  esac
}

fetch_image() {
  local prefix="$1"
  local n; n="$(chunks_for "$prefix")"
  if [ -z "$n" ]; then echo "unknown image: $prefix" >&2; exit 1; fi
  echo ">> fetching $prefix ($n chunks)"
  for ((i=0;i<n;i++)); do
    local idx; idx=$(printf "%02d" "$i")
    local f="${prefix}-container${idx}.wasm"
    echo "   $f"
    curl -fsSL "$BASE/containers/$f" -o "$DST/$f"
  done
}

fetch_proxy() {
  # Only needed if you re-enable networking (net != none). The spike defaults to
  # net=none and does not require it, but fetch it for completeness.
  if [ ! -f "$PROXY_DST" ]; then
    echo ">> fetching c2w-net-proxy.wasm (~18 MB, only needed for networking)"
    curl -fsSL "$BASE/src/c2w-net-proxy.wasm" -o "$PROXY_DST"
  fi
}

target="${1:-amd64-vim-wasi}"
case "$target" in
  all)
    for k in amd64-vim-wasi riscv64-vim-wasi amd64-python-wasi amd64-debian-wasi; do
      fetch_image "$k"
    done
    ;;
  *)
    fetch_image "$target"
    ;;
esac

echo ">> done. Downloaded into $DST"
du -ah "$DST" | sort -rh | head -20
echo
echo "Now serve with cross-origin-isolation headers:"
echo "    node $HERE/server.js        # http://localhost:8105/"
