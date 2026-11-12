#!/bin/sh
# Build the `local` spike: the engine inside the browser tab, no server.
# Output: target/local (static files; serve them with anything).
#
# Not `dx build`: dx always adds the `web` feature (and builds a server), and `web` brings
# `dioxus/fullstack`, which makes the page wait for server HTML that does not exist.
set -eu
cd "$(dirname "$0")/.."

OUT=target/local
VERSION=$(awk '/^name = "wasm-bindgen"$/ { getline; gsub(/[^0-9.]/, ""); print; exit }' Cargo.lock)
BINDGEN="$HOME/.dx/tools/wasm-bindgen-$VERSION/wasm-bindgen"
[ -x "$BINDGEN" ] || BINDGEN=wasm-bindgen

# A release build reads the path it is served under when it is compiled (Dioxus reads the
# meta below only in a debug build): the router and the stylesheets are named under it.
DIOXUS_ASSET_ROOT="${BASE:-}" cargo build --release --target wasm32-unknown-unknown --no-default-features --features local
mkdir -p "$OUT"
"$BINDGEN" --target web --no-typescript --out-dir "$OUT" --out-name askk target/wasm32-unknown-unknown/release/askk.wasm
# The page's own looks: dx bundles them for the served page; here they are copied as they are.
rm -rf "$OUT/assets" && cp -R assets "$OUT/assets"
# BASE: the path the tab is served under (`/ASKK` on GitHub Pages); empty at a site's root.
cat > "$OUT/index.html" <<HTML
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="DIOXUS_ASSET_ROOT" content="${BASE:-}">
    <title>askk</title>
  </head>
  <body>
    <div id="main"></div>
    <script type="module">
      import init from "${BASE:-}/askk.js";
      init();
    </script>
  </body>
</html>
HTML
# A deep link (a page's own address) is served this same page on GitHub Pages.
cp "$OUT/index.html" "$OUT/404.html"
echo "built $OUT: $(wc -c < "$OUT/askk_bg.wasm") bytes of wasm, $(gzip -9c "$OUT/askk_bg.wasm" | wc -c) gzipped"
