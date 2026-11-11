#!/bin/sh
# The one command to run before a change is kept: the tests (the walls in src/structure.rs
# among them), then every build the one source must still make. See docs/maintenance.md.
#
# A build that is not installed on this machine (a missing target) is reported, not skipped
# silently.
set -u
cd "$(dirname "$0")/.."

failed=""
step() {
    name=$1
    shift
    printf '== %s\n' "$name"
    if "$@"; then
        printf '   ok\n'
    else
        printf '   FAILED: %s\n' "$*"
        failed="$failed\n  $name"
    fi
}

WASM=wasm32-unknown-unknown

step "tests (rules and behaviour)" cargo test --quiet --features server
step "build: server (the host)" cargo check --quiet --features server
# Release reads page templates strictly; the everyday build lets some mistakes through.
step "build: server, as released" cargo check --quiet --release --features server
step "build: web (a window in a browser)" cargo check --quiet --target $WASM --features web
if [ "$(uname)" = Darwin ]; then
    step "build: desktop (the Mac app)" cargo check --quiet --features desktop
else
    printf '== build: desktop (the Mac app)\n   not checked: it builds on a Mac only\n'
fi
step "build: local (the engine inside a browser tab)" cargo check --quiet --target $WASM --no-default-features --features local

if [ -n "$failed" ]; then
    printf '\nnot ready:%b\n' "$failed"
    exit 1
fi
printf '\nready: every rule holds and every build compiles\n'
