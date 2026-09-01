#!/usr/bin/env bash
# Build an Alpine-in-x86-emulator .wasm with container2wasm, from pinned sources.
#
# Why this exists rather than `brew install c2w && c2w alpine:3.21 out.wasm`:
# c2w 0.8.4 as shipped cannot build anything. Its Dockerfile clones its own
# build assets from ktock/container2wasm, which is now a fork stub with zero
# tags, and it fetches grub from ftp.gnu.org, which is unreachable from here.
# Both are patched below. Every other origin is pinned to immutable content.
#
# TWO PROFILES, because one artifact cannot be both diagnosable and shippable:
#
#   check  what upstream's Dockerfile actually defaults to — INIT_DEBUG=true and
#          LINUX_LOGLEVEL=7. The guest narrates its own boot, so when it does not
#          reach a shell you are told where it stopped instead of watching a
#          blank canvas. Nothing is stripped: the name section is what makes a
#          trap in the emulator readable.
#
#   ship   INIT_DEBUG=false, LINUX_LOGLEVEL=0, and every developer section
#          removed from the module afterwards. The debug print is not free — it
#          is emitted by the guest's init on a path the user will never read —
#          and the name/producers/target_features sections are a description of
#          the toolchain that built the file, shipped to every visitor.
#
# Both come from the SAME pinned sources, so a difference between them is a
# difference in flags and nothing else.
#
# Usage:  scripts/wasm/build.sh [image] [workdir]
#           PROFILE=ship|check   which of the two (default: ship)
#           DRY_RUN=1            stop before the build
# Output: $WORK/out/<name>.wasm
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
set -a; . "$HERE/PINS.env"; set +a

IMAGE="${1:-alpine:3.21}"
WORK="${2:-$HOME/.cache/askk-wasm}"
PROFILE="${PROFILE:-ship}"

case "$PROFILE" in
  ship)
    OUT_NAME="${OUT_NAME:-alpine.wasm}"
    # Nothing to pass. Measured: c2w already emits INIT_DEBUG=false and
    # LINUX_LOGLEVEL=0 of its own accord, overriding the Dockerfile's ARG
    # defaults of true and 7. Passing them again here would be a second
    # --build-arg for the same name on the same command line — which works, but
    # only by whichever end of the list buildx happens to prefer, and a flag
    # whose effect depends on that is not a flag anyone should rely on.
    BUILD_ARGS=()
    STRIP=1
    ;;
  check)
    OUT_NAME="${OUT_NAME:-alpine.check.wasm}"
    # c2w's own switch, for the same reason: it sets both values together and
    # cannot disagree with itself.
    BUILD_ARGS=(--debug-image)
    STRIP=0
    ;;
  *) echo "PROFILE must be ship or check, not $PROFILE"; exit 2 ;;
esac

mkdir -p "$WORK"

say() { printf '\n=== %s\n' "$*"; }

# ---------------------------------------------------------------- 1. vendor
say "vendoring container2wasm @ $C2W_SHA"
if [ ! -d "$WORK/src/.git" ]; then
  git clone --quiet "$C2W_REPO" "$WORK/src"
fi
git -C "$WORK/src" fetch --quiet origin
git -C "$WORK/src" checkout --quiet "$C2W_SHA"
test "$(git -C "$WORK/src" rev-parse HEAD)" = "$C2W_SHA" || { echo "c2w sha mismatch"; exit 1; }

# ------------------------------------------------------- 2. build c2w itself
# The Homebrew bottle bakes the dead upstream URL into its embedded Dockerfile
# and there is no darwin release binary, so build the CLI from the pinned tree.
say "building c2w from source"
( cd "$WORK/src" && go build -o "$WORK/c2w" ./cmd/c2w )
"$WORK/c2w" --version

# ------------------------------------------------------- 3. patch Dockerfile
say "patching Dockerfile (grub origin + hard pins)"
SRC="$WORK/src/Dockerfile"
DF="$WORK/Dockerfile.pinned"

sed \
  -e "s|^FROM ubuntu:22.04 AS |FROM ubuntu:22.04@${IMG_UBUNTU_2204} AS |" \
  -e "s|^FROM ubuntu AS bios-amd64-dev|FROM ubuntu:latest@${IMG_UBUNTU_LATEST} AS bios-amd64-dev|" \
  -e "s|^FROM golang:1.26-bookworm AS |FROM golang:1.26-bookworm@${IMG_GOLANG} AS |" \
  -e "s|^FROM rust:1.74.1-bullseye AS |FROM rust:1.74.1-bullseye@${IMG_RUST} AS |" \
  -e "s|^ARG RUNC_VERSION=v1.3.0$|ARG RUNC_VERSION=${SHA_RUNC}|" \
  -e "s|^ARG WASI_VFS_VERSION=v0.3.0$|ARG WASI_VFS_VERSION=${SHA_WASI_VFS}|" \
  -e "s|^ARG SOURCE_REPO=https://github.com/ktock/container2wasm$|ARG SOURCE_REPO=${C2W_REPO}|" \
  -e "s|^RUN wget https://ftp.gnu.org/gnu/grub/grub-2.06.tar.gz$|RUN wget -O grub-2.06.tar.gz ${URL_GRUB} \&\& echo \"${SHA256_GRUB}  grub-2.06.tar.gz\" \| sha256sum -c -|" \
  -e "s|^RUN wget \(https://busybox.net/downloads/busybox-\${BUSYBOX_VERSION}.tar.bz2\)$|RUN wget \1 \&\& echo \"${SHA256_BUSYBOX}  busybox-\${BUSYBOX_VERSION}.tar.bz2\" \| sha256sum -c -|" \
  -e "s|^RUN wget -O /tmp/binaryen.tar.gz \(.*\)$|RUN wget -O /tmp/binaryen.tar.gz \1 \&\& echo \"${SHA256_BINARYEN}  /tmp/binaryen.tar.gz\" \| sha256sum -c -|" \
  -e "s|^    tar xvf wasi-sdk.tar.gz \&\& rm wasi-sdk.tar.gz$|    echo \"${SHA256_WASI_SDK}  wasi-sdk.tar.gz\" \| sha256sum -c - \&\& tar xvf wasi-sdk.tar.gz \&\& rm wasi-sdk.tar.gz|" \
  -e "s|^RUN git clone -b v6.1 --depth 1 https://github.com/torvalds/linux$|RUN git clone -b v6.1 --depth 1 https://github.com/torvalds/linux \&\& test \"\$(git -C linux rev-parse HEAD)\" = \"${SHA_LINUX}\"|" \
  -e "s|^RUN git clone -b v0.19.0 https://github.com/krallin/tini$|RUN git clone -b v0.19.0 https://github.com/krallin/tini \&\& test \"\$(git -C tini rev-parse HEAD)\" = \"${SHA_TINI}\"|" \
  -e "s|^    cd vmtouch \&\& \\\\$|    cd vmtouch \&\& git checkout ${SHA_VMTOUCH} \&\& \\\\|" \
  "$SRC" > "$DF"

# Refuse to build a Dockerfile that did not actually get patched. A silent
# no-op sed is exactly the "reports success for work it did not do" defect.
grep -q "$URL_GRUB" "$DF"        || { echo "PATCH FAILED: grub"; exit 1; }
grep -q "$SHA256_BUSYBOX" "$DF"  || { echo "PATCH FAILED: busybox"; exit 1; }
grep -q "$SHA256_WASI_SDK" "$DF" || { echo "PATCH FAILED: wasi-sdk"; exit 1; }
grep -q "$SHA256_BINARYEN" "$DF" || { echo "PATCH FAILED: binaryen"; exit 1; }
grep -q "$SHA_VMTOUCH" "$DF"     || { echo "PATCH FAILED: vmtouch"; exit 1; }
grep -q "$SHA_LINUX" "$DF"       || { echo "PATCH FAILED: linux"; exit 1; }
if grep -q "ftp.gnu.org" "$DF"; then echo "PATCH FAILED: ftp.gnu.org survived"; exit 1; fi
echo "patched Dockerfile: $DF ($(wc -l < "$DF") lines)"

# ------------------------------------------------------------------ 4. build
# --assets replaces the assets stage with the vendored tree, so the build never
# clones container2wasm at all. --platform=linux/amd64 is hardcoded inside c2w,
# so on Apple silicon every stage runs under the VM's x86_64 binfmt.
[ "${DRY_RUN:-}" = "1" ] && { echo "DRY_RUN=1: stopping before the build"; exit 0; }

say "building $IMAGE -> $WORK/out/$OUT_NAME [$PROFILE] (measured: 17m37s on 10 vCPUs, warm cache)"
mkdir -p "$WORK/out"
time "$WORK/c2w" \
  --target-arch=amd64 \
  --assets "$WORK/src" \
  --dockerfile "$DF" \
  ${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"} \
  "$IMAGE" "$WORK/out/$OUT_NAME"

RAW=$(wc -c < "$WORK/out/$OUT_NAME")

# ------------------------------------------------------------ 5. strip (ship)
# `name`, `producers` and `target_features` are developer sections: symbol names
# for a debugger, the toolchain that produced the module, and the wasm features
# it was compiled against. None is read by a browser running the module, and all
# three are downloaded by every visitor. wasm-opt is not asked to OPTIMISE here
# — this module is an emulator that was already optimised by its own build, and
# re-optimising it risks changing behaviour to save nothing.
if [ "$STRIP" = "1" ] && command -v wasm-opt >/dev/null 2>&1; then
  say "stripping developer sections"
  wasm-opt --strip-debug --strip-producers --strip-target-features \
    -o "$WORK/out/$OUT_NAME.stripped" "$WORK/out/$OUT_NAME"
  mv "$WORK/out/$OUT_NAME.stripped" "$WORK/out/$OUT_NAME"
elif [ "$STRIP" = "1" ]; then
  echo "WARNING: wasm-opt not found; shipping WITH developer sections"
fi

# ------------------------------------------------------- 6. compress (deploy)
# WRITTEN, not measured and discarded. The gzip size used to be piped into `wc`
# and printed, which is how this project shipped a page whose guest was a 404
# for a year: the module is over GitHub's 100 MiB per-file block and the block is
# on the file AT REST, so edge compression cannot reach it. `gzip -9` brings it
# under, and GitHub takes that. The `.gz` is therefore the DEPLOYED artifact, and
# `public/sandbox/vm-worker.js` inflates it with `DecompressionStream`. The raw
# module stays beside it for the probes, gitignored, and the deploy's own ignore
# rule (`sandbox/*.wasm`) drops it.
#
# No byte count is written here on purpose. This script is what CHANGES both of
# them, so a size in this comment is a lie one run away; the pair it prints below
# is the live answer and `docs/GATE.md` holds the dated one.
say "compressing for the deploy"
gzip -9 -c "$WORK/out/$OUT_NAME" > "$WORK/out/$OUT_NAME.gz"

say "artifact"
ls -l "$WORK/out/$OUT_NAME" "$WORK/out/$OUT_NAME.gz"
FINAL=$(wc -c < "$WORK/out/$OUT_NAME")
GZ=$(wc -c < "$WORK/out/$OUT_NAME.gz")
printf 'profile=%s raw=%s stripped=%s gzip=%s\n' "$PROFILE" "$RAW" "$FINAL" "$GZ"
echo "copy BOTH into public/sandbox/ — the page loads $OUT_NAME.gz, the probes load $OUT_NAME"
