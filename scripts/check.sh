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
        [ -z "${GITHUB_ACTIONS:-}" ] || printf '::error title=check.sh::failed: %s\n' "$name"
        failed="$failed\n  $name"
    fi
}

WASM=wasm32-unknown-unknown

# Run a step without its chatter; when it fails, show the end of what it said.
quiet() {
    log=$(mktemp)
    if "$@" >"$log" 2>&1; then
        rm -f "$log"
    else
        tail -40 "$log"
        # On GitHub, also put the end of it where the run's summary shows it.
        if [ -n "${GITHUB_ACTIONS:-}" ]; then
            printf '::error title=check.sh: %s::%s\n' "$1 $2" "$(tail -25 "$log" | sed 's/%/%25/g' | awk '{printf "%s%%0A", $0}')"
        fi
        rm -f "$log"
        return 1
    fi
}

step "tests (rules and behaviour)" quiet cargo test --quiet --features server
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

# The app as a person runs it (scripts/run.sh): dx puts the host and its window together, and
# chooses features itself, so only this step shows whether that choice still compiles.
if command -v dx >/dev/null; then
    step "build: the full app, as scripts/run.sh builds it" quiet dx build --release --platform web
    step "the built app runs (scripts/smoke.sh)" quiet ./scripts/smoke.sh
    step "build: the tab, as published (scripts/local.sh)" quiet ./scripts/local.sh
    # The landmark of 0.1: the engine loop, whole, as a terminal process, as a hosted service
    # and in a browser tab. On CI every runtime must be checked; here a missing browser is said.
    step "landmark 0.1: the loop on every runtime (scripts/landmark.sh)" quiet env LANDMARK_ALL="${CI:+1}" ./scripts/landmark.sh
    # The service and its clients: started in the background, found, followed while it works,
    # given a hand edit without a restart, restarted, stopped (docs/service.md).
    step "the service: background, clients, hand edits, restart (scripts/service.sh)" quiet ./scripts/service.sh
    # The multiplexer: terminals the service holds with nobody attached, each a screen and a
    # box, confined to its folder; and the full-screen terminal driven under a real terminal
    # (docs/concept.md, sections 6 and 7).
    step "the terminals: held by the service, confined, the full screen (scripts/terminals.sh)" quiet ./scripts/terminals.sh
else
    printf '== build: the full app\n   not checked: dx is not installed (cargo install dioxus-cli)\n'
fi

if [ -n "$failed" ]; then
    printf '\nnot ready:%b\n' "$failed"
    exit 1
fi
printf '\nready: every rule holds, every build compiles, the built app runs, the loop works on every runtime, the service runs in the background, and it holds terminals\n'
