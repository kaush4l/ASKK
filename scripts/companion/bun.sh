#!/bin/sh
set -eu
bundle_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
unset BUN_BE_BUN
exec "$bundle_dir/runtime/bun" --bun "$@"
