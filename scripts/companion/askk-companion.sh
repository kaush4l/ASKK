#!/bin/sh
set -eu
PATH=/usr/bin:/bin:/usr/sbin:/sbin
export PATH
bundle_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
unset BUN_BE_BUN BUN_OPTIONS NODE_OPTIONS ASKK_PAIRING_TOKEN
cd "$bundle_dir"
exec "$bundle_dir/runtime/bun" --no-install --no-env-file --config="$bundle_dir/bunfig.toml" "$bundle_dir/scripts/companion/launch.js" "$@"
