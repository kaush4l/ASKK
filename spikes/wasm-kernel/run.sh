#!/bin/sh
# The WASM spike end to end (docs/portability.md §5): bundle the kernel, componentize it, run it under jco (a JS host)
# and under wasmtime (a Rust host component plugged in; the folder grant is wasmtime's --dir). Needs node, bun, cargo
# with the wasm32-wasip2 target, wac, wasmtime. Run from this folder.
set -e
npm install --silent
bun build kernel/entry.js --target=browser --format=esm --external 'askk:spike/host@0.1.0' --outfile out/kernel.bundle.js
node build.mjs out/kernel.bundle.js kernel out/kernel.wasm http,fetch-event
echo "── jco (Node; the same JS runs in a browser tab) ──"
rm -rf out/js lane
npx jco transpile out/kernel.wasm -o out/js --map 'askk:spike/host@0.1.0=../../jco/host.js' > /dev/null
node jco/run.mjs
echo "── wasmtime (only lane/ granted, as /desk) ──"
(cd host-rs && cargo build --quiet --release --target wasm32-wasip2)
wac plug out/kernel.wasm --plug host-rs/target/wasm32-wasip2/release/askk_host.wasm -o out/app.wasm
rm -rf lane && mkdir -p lane
wasmtime run --dir lane::/desk --invoke 'ask("Write a hello note in notes/, then prove you cannot write outside your folder.")' out/app.wasm
cat lane/notes/hello.md
