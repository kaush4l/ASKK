#!/usr/bin/env bash
# Build one of the presets in builds.toml, by name.
#
#   ./scripts/build.sh               the presets, one line each
#   ./scripts/build.sh full          build it as released (dx, cargo or scripts/local.sh)
#   ./scripts/build.sh full --check  only compile it, quickly (what scripts/check.sh does)
#   ./scripts/build.sh all --check   compile every preset
#   ./scripts/build.sh full --features   print the cargo features of its host, and nothing else
#
# TARGET in the environment builds a host for another machine (cargo --target).
set -euo pipefail
cd "$(dirname "$0")/.."

read_presets() {
    # name<TAB>shell<TAB>features (space separated; "-" for none)<TAB>about, one preset per line.
    python3 -I - builds.toml <<'EOF'
import sys, tomllib
with open(sys.argv[1], "rb") as f:
    for name, p in tomllib.load(f).items():
        print("\t".join([name, p["shell"], " ".join(p.get("features", [])) or "-", p.get("about", "")]))
EOF
}

if [ $# -eq 0 ]; then
    read_presets | while IFS=$'\t' read -r name shell features about; do
        printf '%-15s %-8s %-20s %s\n' "$name" "$shell" "$features" "$about"
    done
    exit 0
fi

want=$1
mode=${2:-}
found=0
WASM=wasm32-unknown-unknown
target=()
[ -n "${TARGET:-}" ] && target=(--target "$TARGET")

build_one() {
    local name=$1 shell=$2 features=$3
    # The host: the base `server` and what the preset adds.
    local host="server${features:+ $features}"
    if [ "$mode" = "--features" ]; then
        echo "$host"
        return
    fi
    echo "== $name ($shell${features:+; $features})"
    case "$shell:$mode" in
    web:--check)
        cargo check --quiet ${target[@]+"${target[@]}"} --features "$host"
        cargo check --quiet --target $WASM --features web
        ;;
    web:*)
        command -v dx >/dev/null || { echo "dx is not installed. Install it: cargo install dioxus-cli"; exit 1; }
        # The page gets `web`; only the host gets the capabilities (they hold processes). Each
        # half names its platform, or dx builds the host for the browser too.
        if [ -n "$features" ]; then
            dx build --release @client --platform web @server --platform server --features "${features// /,}"
        else
            dx build --release --platform web
        fi
        ;;
    desktop:--check) cargo check --quiet --features desktop ;;
    desktop:*) cargo build --release --features desktop ;;
    local:--check) cargo check --quiet --target $WASM --no-default-features --features local ;;
    local:*) ./scripts/local.sh ;;
    mobile:*) echo "   no phone shell yet (shells/phone.rs is planned)"; return 1 ;;
    *) echo "unknown shell '$shell' in builds.toml"; return 1 ;;
    esac
}

while IFS=$'\t' read -r name shell features about; do
    [ "$features" = - ] && features=
    if [ "$want" = all ] || [ "$want" = "$name" ]; then
        found=1
        # The Mac window is built on a Mac only.
        if [ "$shell" = desktop ] && [ "$(uname)" != Darwin ] && [ "$want" = all ]; then
            echo "== $name: not on this system (the Mac window)"
            continue
        fi
        build_one "$name" "$shell" "$features"
    fi
done < <(read_presets)

[ $found = 1 ] || { echo "no preset '$want' in builds.toml; ./scripts/build.sh lists them"; exit 1; }
