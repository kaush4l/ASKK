#!/bin/sh
# Run the built askk server under sandbox-exec. Build first: dx build --platform web
# Env: PORT (default 8090), ASKK_DATA (default ./data), CLI (default ~/.local), CLI_HOME (default ~/.claude)
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PORT=${PORT:-8090}; DATA=${ASKK_DATA:-$ROOT/data}; CLI=${CLI:-$HOME/.local}; CLI_HOME=${CLI_HOME:-$HOME/.claude}
BIN=$ROOT/target/dx/askk/debug/web/server
cd "$ROOT"
export PORT IP=127.0.0.1 ASKK_DATA="$DATA"
exec /usr/bin/sandbox-exec -f "$ROOT/sandbox/server.sb" -D ROOT="$ROOT" -D DATA="$DATA" -D PORT="$PORT" -D CLI="$CLI" -D CLI_HOME="$CLI_HOME" -D HOME="$HOME" "$BIN"
