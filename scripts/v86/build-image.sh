#!/usr/bin/env bash
# Build a v86-bootable Alpine Linux image with packages baked in at BUILD time.
#
# Why this exists: the in-browser v86 VM has NO runtime network on deployed
# gh-pages, so `apk add` can never run in the browser. Every package the VM
# needs (python3, gcc, ...) must be installed HERE, on a dev machine, and frozen
# into the image the browser loads. THIS SCRIPT IS THE ONLY PLACE PACKAGES ARE
# INSTALLED. The browser just resumes a frozen machine.
#
# Usage:
#   scripts/v86/build-image.sh --packages python3,py3-pip --out alpine-python
#   scripts/v86/build-image.sh --packages python3 --out alpine-python --dry-run
#   scripts/v86/build-image.sh --help
#
# Approach (v86 save_state):
#   1. Boot the base Alpine v86 image in Node via the `v86` npm package, headless.
#   2. Drive the serial console: `apk update && apk add <packages>`.
#   3. Call emulator.save_state() and write the bytes to the output blob.
# The browser then boots that blob with restore_state — instant, no network,
# packages already present.
#
# Output: assets/runtimes/v86/<out-id>.bin  (a v86 save_state blob)
#         + assets/runtimes/v86/<out-id>.json (sidecar: packages, base, built-at)
# This is where the runtime/staging step picks images up.
#
# Prerequisites (only needed for a REAL build, not --dry-run):
#   - bun OR node (>= 18) to run the headless v86 driver.
#   - the `v86` npm package + a base Alpine v86 image (state.bin or a kernel
#     bzImage, e.g. from the v86 project's images/). Point at them with the env
#     vars below.
# Override defaults via env:
#   V86_BASE_STATE   path to a bootable base Alpine v86 save_state .bin
#   V86_BASE_BZIMAGE path to the base kernel bzImage (alt to a state blob)
#   V86_RUNNER       js runtime to use (default: bun if present, else node)
#   BOOT_TIMEOUT     seconds to wait for boot + apk (default 180)
#
# ponytail: requires bun/node + a base v86 image; NOT fully offline at build
#           time (apk needs the network on the dev box). x86-only (v86 is x86).
#           Real boot/bake is dev-machine only — CI uses --dry-run.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT_DIR="$ROOT/assets/runtimes/v86"

# --- defaults / env knobs -------------------------------------------------
V86_BASE_STATE="${V86_BASE_STATE:-}"
V86_BASE_BZIMAGE="${V86_BASE_BZIMAGE:-}"
BOOT_TIMEOUT="${BOOT_TIMEOUT:-180}"
RUNNER="${V86_RUNNER:-}"

PACKAGES=""
OUT_ID=""
DRY_RUN=0

usage() {
    sed -n '2,39p' "$0" | sed 's/^# \{0,1\}//'
    exit "${1:-0}"
}

# --- arg parsing (long flags, matches the house style) --------------------
while [ $# -gt 0 ]; do
    case "$1" in
    --packages)
        PACKAGES="${2:-}"
        shift 2
        ;;
    --out)
        OUT_ID="${2:-}"
        shift 2
        ;;
    --dry-run)
        DRY_RUN=1
        shift
        ;;
    -h | --help)
        usage 0
        ;;
    *)
        echo "error: unknown argument: $1" >&2
        usage 1
        ;;
    esac
done

# --- validate -------------------------------------------------------------
if [ -z "$PACKAGES" ]; then
    echo "error: --packages is required (comma-separated, e.g. python3,py3-pip)" >&2
    exit 2
fi
if [ -z "$OUT_ID" ]; then
    echo "error: --out is required (artifact id, e.g. alpine-python)" >&2
    exit 2
fi
# Keep --out a safe bare filename: it becomes a path under assets/.
case "$OUT_ID" in
*/* | *..*)
    echo "error: --out must be a bare id (no slashes or ..): $OUT_ID" >&2
    exit 2
    ;;
esac

# Normalize comma list -> space list for apk.
APK_PKGS="$(echo "$PACKAGES" | tr ',' ' ' | tr -s ' ' | sed 's/^ //; s/ $//')"
OUT_BIN="$OUT_DIR/$OUT_ID.bin"
OUT_JSON="$OUT_DIR/$OUT_ID.json"

# Pick a JS runtime if the caller didn't.
if [ -z "$RUNNER" ]; then
    if command -v bun >/dev/null 2>&1; then
        RUNNER="bun"
    elif command -v node >/dev/null 2>&1; then
        RUNNER="node"
    fi
fi

echo "==> v86 image build"
echo "    packages : $APK_PKGS"
echo "    out id   : $OUT_ID"
echo "    artifact : $OUT_BIN"
echo "    sidecar  : $OUT_JSON"
echo "    runner   : ${RUNNER:-<none found>}"

# --- dry-run: validate + print the plan, no heavy toolchain needed --------
if [ "$DRY_RUN" -eq 1 ]; then
    echo
    echo "DRY RUN — plan only, nothing built:"
    echo "  1. boot base Alpine in v86 (state=${V86_BASE_STATE:-<set V86_BASE_STATE>})"
    echo "  2. serial console: apk update && apk add $APK_PKGS"
    echo "  3. save_state() -> $OUT_BIN"
    echo "  4. write sidecar -> $OUT_JSON"
    echo "OK (dry run)"
    exit 0
fi

# --- real build -----------------------------------------------------------
if [ -z "$RUNNER" ]; then
    echo "error: need bun or node to run the headless v86 driver" >&2
    exit 3
fi
if [ -z "$V86_BASE_STATE" ] && [ -z "$V86_BASE_BZIMAGE" ]; then
    echo "error: set V86_BASE_STATE (a base Alpine v86 save_state .bin) or" >&2
    echo "       V86_BASE_BZIMAGE (a base Alpine kernel). See scripts/v86/README.md." >&2
    exit 3
fi

mkdir -p "$OUT_DIR"

# The headless v86 driver lives inline so this stays a two-file unit. It boots
# the base image, types the apk command on the serial console, waits for a
# sentinel line, then snapshots. Tunables come in via env so the JS stays dumb.
DRIVER="$(mktemp -t v86-build-driver.XXXXXX.mjs)"
trap 'rm -f "$DRIVER"' EXIT
cat >"$DRIVER" <<'JS'
// Headless v86 driver: boot base Alpine, `apk add`, snapshot save_state.
// Run with bun or node. All inputs arrive via env (see build-image.sh).
import fs from "node:fs";
import { V86 } from "v86"; // requires the `v86` npm package on the dev box

const BASE_STATE   = process.env.V86_BASE_STATE   || "";
const BASE_BZIMAGE = process.env.V86_BASE_BZIMAGE || "";
const APK_PKGS     = process.env.APK_PKGS || "";
const OUT_BIN      = process.env.OUT_BIN;
const TIMEOUT_MS   = parseInt(process.env.BOOT_TIMEOUT || "180", 10) * 1000;
const SENTINEL     = "ASKK_BAKE_DONE";

const opts = {
    wasm_path: process.env.V86_WASM_PATH || "node_modules/v86/build/v86.wasm",
    autostart: true,
    disable_speaker: true,
};
if (BASE_STATE)   opts.initial_state = { url: BASE_STATE };
if (BASE_BZIMAGE) opts.bzimage       = { url: BASE_BZIMAGE };

const emulator = new V86(opts);

let line = "";
let booted = false;
const fail = (msg) => { console.error(msg); process.exit(1); };
const timer = setTimeout(() => fail(`timeout after ${TIMEOUT_MS}ms`), TIMEOUT_MS);

// Type a string on the serial console, char by char.
const send = (s) => { for (const ch of s) emulator.serial0_send(ch); };

emulator.add_listener("serial0-output-byte", async (byte) => {
    const ch = String.fromCharCode(byte);
    if (ch === "\n") {
        if (!booted && /login:/.test(line)) {
            // Auto-login if the base image prompts (root, no password).
            send("root\n");
        }
        // Match the sentinel only as a line of its own — the command echo
        // also contains the word "ASKK_BAKE_DONE" but with `echo ` before it.
        if (line.trim() === SENTINEL) {
            clearTimeout(timer);
            const state = await emulator.save_state();
            fs.writeFileSync(OUT_BIN, Buffer.from(state));
            console.log(`wrote ${OUT_BIN} (${state.byteLength} bytes)`);
            emulator.destroy?.();
            process.exit(0);
        }
        line = "";
        return;
    }
    line += ch;
    // First shell prompt -> fire the install, then echo the sentinel.
    if (!booted && /[#$]\s$/.test(line)) {
        booted = true;
        send(`apk update && apk add ${APK_PKGS} && echo ${SENTINEL}\n`);
    }
});
JS

echo
echo "Booting base Alpine and installing: $APK_PKGS (timeout ${BOOT_TIMEOUT}s)"
APK_PKGS="$APK_PKGS" OUT_BIN="$OUT_BIN" \
    V86_BASE_STATE="$V86_BASE_STATE" V86_BASE_BZIMAGE="$V86_BASE_BZIMAGE" \
    BOOT_TIMEOUT="$BOOT_TIMEOUT" \
    "$RUNNER" "$DRIVER"

if [ ! -s "$OUT_BIN" ]; then
    echo "error: no output written (boot/apk failed). Re-run with a higher BOOT_TIMEOUT." >&2
    exit 4
fi

# Sidecar: record what got baked so staging/runtime can reason about it.
pkg_json="$(echo "$APK_PKGS" | tr ' ' '\n' | sed '/^$/d; s/.*/"&"/' | paste -sd, -)"
cat >"$OUT_JSON" <<EOF
{
  "id": "$OUT_ID",
  "base": "alpine",
  "packages": [$pkg_json],
  "format": "v86-save-state",
  "built_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

echo "Done. Image: $OUT_BIN ($(du -h "$OUT_BIN" | cut -f1)), sidecar: $OUT_JSON"
