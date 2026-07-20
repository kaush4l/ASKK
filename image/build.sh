#!/bin/bash
# Build the ASKK guest image and convert it to one wasm (Eliza build.sh shape).
#   image/build.sh                 full pipeline: docker -> flatten -> c2w -> chunks
#   image/build.sh --skip-c2w      stop after the docker image (unit E2E)
#   image/build.sh --skip-docker   reuse the existing askk-guest image
#   image/build.sh --dev           verbose guest boot (kernel loglevel 7 + init debug)
#   image/build.sh --test-manifest self-check the manifest writer and exit
# Env: C2W_SRC (container2wasm clone), GUEST_RAM_MB (default 512 — the
# shipped default since ADR-051: python+hermes are BAKED onto the read-only
# ISO and read from there, so nothing extracts into the tmpfs upper and the
# hermes profile boots in 512 (verified: HERMES at 512, tab ~794MB). Bump to
# 1024 if a startup script pulls a heavy toolchain into tmpfs at runtime.
# 2048 is opt-in AND wizer-incompatible (see the stage 3 WIZER note). Guest
# RAM = wasm linear memory = browser tab commit),
#      WIZER=1 (default; WIZER=0 opts out of wizer pre-boot — needed for
#      big-RAM builds, see stage 3),
#      WASMOPT=1 (wasm-opt -Oz shrink, see stage 3.5; 0 = escape hatch),
#      GZIP_LEVEL=6 (stage 4 gzip compression level).
set -euo pipefail
cd "$(dirname "$0")/.."

C2W_SRC="${C2W_SRC:-$HOME/Downloads/Dev/c2w-alpine/container2wasm}"
GUEST_RAM_MB="${GUEST_RAM_MB:-512}"
GZIP_LEVEL="${GZIP_LEVEL:-6}"
WASM_OUT=out/askk-amd64.wasm

SKIP_C2W=0 SKIP_DOCKER=0 DEV=0 TEST_MANIFEST=0
for arg in "$@"; do
    case "$arg" in
        --skip-c2w)      SKIP_C2W=1 ;;
        --skip-docker)   SKIP_DOCKER=1 ;;
        --dev)           DEV=1 ;;
        --test-manifest) TEST_MANIFEST=1 ;;
        *) echo "unknown flag: $arg" >&2; exit 2 ;;
    esac
done

# write_manifest <chunk_dir> <raw_wasm> — docs/wasm/manifest.json, CONTRACTS schema.
write_manifest() {
    python3 - "$1" "$2" <<'EOF'
import json, os, glob, sys
chunk_dir, raw = sys.argv[1], sys.argv[2]
parts = sorted(glob.glob(os.path.join(chunk_dir, "out.wasm.gz.part-*")))
assert parts, f"no chunks in {chunk_dir}"
sizes = [os.path.getsize(p) for p in parts]
m = {"parts": [os.path.basename(p) for p in parts], "sizes": sizes,
     "gz_total": sum(sizes), "raw_total": os.path.getsize(raw)}
open(os.path.join(chunk_dir, "manifest.json"), "w").write(json.dumps(m))
print("manifest:", m["gz_total"], "gz /", m["raw_total"], "raw,", len(parts), "part(s)")
EOF
}

# optimize_wasm <file> — stage 3.5: shrink in place with wasm-opt -Oz.
# Any failure falls back to the unoptimized wasm; never breaks the build.
optimize_wasm() {
    local wasm="$1" before after
    if [ "${WASMOPT:-1}" != 1 ]; then
        echo "== stage 3.5: skipped (WASMOPT=0) =="
        return 0
    fi
    if ! command -v wasm-opt >/dev/null 2>&1; then
        echo "== stage 3.5: skipped — wasm-opt not on PATH (brew install binaryen) =="
        return 0
    fi
    echo "== stage 3.5: wasm-opt -Oz -> $wasm =="
    before=$(wc -c < "$wasm")
    # --enable-* flags are required: the module uses post-MVP wasm features
    # and wasm-opt defaults to MVP-only, hard-erroring without them.
    if wasm-opt -Oz --strip-debug --strip-dwarf --strip-producers \
            --enable-bulk-memory --enable-sign-ext --enable-mutable-globals \
            -o "$wasm.opt" "$wasm"; then
        mv "$wasm.opt" "$wasm"
        after=$(wc -c < "$wasm")
        printf 'wasm-opt: raw before %d\n' "$before"
        printf 'wasm-opt: raw after  %d (%d%% saved)\n' "$after" \
            $(( (before - after) * 100 / before ))
    else
        rm -f "$wasm.opt"
        echo "WARN: wasm-opt failed; continuing with unoptimized wasm" >&2
    fi
}

if [ "$TEST_MANIFEST" = 1 ]; then
    # Self-check: fake chunks + fake raw -> schema and totals must line up.
    tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
    printf 'aaaa' > "$tmp/out.wasm.gz.part-aa"
    printf 'bb'   > "$tmp/out.wasm.gz.part-ab"
    printf '12345678' > "$tmp/raw.wasm"
    write_manifest "$tmp" "$tmp/raw.wasm"
    python3 - "$tmp/manifest.json" <<'EOF'
import json, sys
m = json.load(open(sys.argv[1]))
assert m["parts"] == ["out.wasm.gz.part-aa", "out.wasm.gz.part-ab"], m
assert m["sizes"] == [4, 2] and m["gz_total"] == 6 and m["raw_total"] == 8, m
print("manifest self-check OK")
EOF
    exit 0
fi

# --- stage 1: docker image ------------------------------------------------
if [ "$SKIP_DOCKER" = 0 ]; then
    echo "== stage 1: docker build (askk-guest) =="
    # tar context = only what the build needs; keeps gitignored docs/wasm
    # chunks (GBs on a published checkout) out of the build context.
    tar -cf - image rootfs | docker build --platform linux/amd64 \
        -f image/Dockerfile -t askk-guest -
else
    echo "== stage 1: skipped (--skip-docker), reusing askk-guest =="
fi

if [ "$SKIP_C2W" = 1 ]; then
    echo "== --skip-c2w: stopping after the docker image =="
    exit 0
fi

# --- stage 2: flatten to a single layer -----------------------------------
echo "== stage 2: flatten (askk-guest:flat) =="
cid=$(docker create --platform linux/amd64 askk-guest)
trap 'docker rm -f "$cid" >/dev/null 2>&1 || true' EXIT
docker export "$cid" | docker import --platform linux/amd64 \
    --change 'ENTRYPOINT ["/sbin/askk-boot"]' \
    --change 'ENV TERM=linux LANG=C.UTF-8' \
    - askk-guest:flat
docker rm "$cid" >/dev/null

# --- stage 3: container2wasm (Bochs path) ---------------------------------
echo "== stage 3: c2w -> $WASM_OUT (RAM ${GUEST_RAM_MB}MB, dev=$DEV) =="
mkdir -p out
c2w_args=( --dockerfile "$C2W_SRC/Dockerfile" --assets "$C2W_SRC"
           --build-arg VM_MEMORY_SIZE_MB="$GUEST_RAM_MB" )
if [ "$DEV" = 1 ]; then
    c2w_args+=( --build-arg LINUX_LOGLEVEL=7 --build-arg INIT_DEBUG=true )
fi
# Wizer pre-boots the kernel at build time (faster browser boot) and is the
# c2w Dockerfile's DEFAULT — but its build-time wasmtime run traps OOB when
# VM_MEMORY_SIZE_MB is high (observed at 2048). WIZER=0 forces the native
# (non-prebooted) mode for big-RAM builds.
c2w_args+=( --build-arg OPTIMIZATION_MODE=$([ "${WIZER:-1}" = 1 ] && echo wizer || echo native) )
c2w "${c2w_args[@]}" askk-guest:flat "$WASM_OUT"

# --- stage 3.5: wasm-opt shrink -------------------------------------------
optimize_wasm "$WASM_OUT"

# --- stage 4: gh-pages-friendly chunks + manifest -------------------------
echo "== stage 4: gzip -$GZIP_LEVEL + split -> docs/wasm/ =="
rm -f docs/wasm/out.wasm.gz.part-*
mkdir -p docs/wasm
gzip "-$GZIP_LEVEL" -c "$WASM_OUT" | split -b 94371840 - docs/wasm/out.wasm.gz.part-
write_manifest docs/wasm "$WASM_OUT"
# The page's startup editor shows the baked default as its starting point;
# copying here keeps it in lockstep with the script actually in the image.
cp rootfs/startup.sh docs/startup.default.sh
echo "done: docs/wasm/ ($(du -sh docs/wasm | cut -f1) gzipped chunks)"

# --- memory/size budget -----------------------------------------------------
# Tab cost preview: guest RAM is the wasm linear memory the browser commits,
# plus the raw wasm bytes buffered while the module instantiates at boot.
raw_bytes=$(wc -c < "$WASM_OUT")
gz_bytes=$(cat docs/wasm/out.wasm.gz.part-* | wc -c)
printf '\n== budget ==\n'
printf '%-24s %6d MB\n'            'guest RAM'       "$GUEST_RAM_MB"
printf '%-24s %6d MB (%d bytes)\n' 'raw wasm'        "$(( raw_bytes / 1048576 ))" "$raw_bytes"
printf '%-24s %6d MB (%d bytes)\n' 'gz chunks total' "$(( gz_bytes  / 1048576 ))" "$gz_bytes"
printf '%-24s %6d MB (guest RAM + raw wasm during boot)\n' \
    '~tab commit'                  "$(( GUEST_RAM_MB + raw_bytes / 1048576 ))"
