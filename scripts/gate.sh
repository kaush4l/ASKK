#!/usr/bin/env bash
# The merge gate. Green or no merge. Sub-agents run this before handing work back.
set -euo pipefail
cd "$(dirname "$0")/.."
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
echo "GATE GREEN"
