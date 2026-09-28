# Browser Linux runtime

The browser runtime is a persistent ARM64 Linux guest, compiled with container2wasm v0.8.4 and QEMU Wasm. It contains Node 24/npm, a JavaScript supervisor and a real node-pty helper. Agent jobs use child-process pipes; terminal sessions use separate PTYs. Neither path parses shell prompts to determine completion.

## Build

Use a Docker engine capable of executing the upstream amd64 build stages. On Apple Silicon, the dedicated Colima VZ profile must have Rosetta enabled; its default QEMU translation produced compiler segmentation faults on this machine. The build script uses the explicit `colima-askk-browser-build` context and leaves the user's active context unchanged. Override with `ASKK_DOCKER_CONTEXT`.

```sh
bun scripts/browser-linux/build.js
bun scripts/browser-linux/prepare-network.js
bun scripts/browser-linux/publish.js
bun test test/browser-linux.test.js
```

The first command builds the native guest, proves its PTY and offline npm install plus Next static export, and compiles the browser image into `.cache/browser-linux/artifact`. The approved guest allocation is 1536 MiB; upstream QEMU reserves a 2300 MiB Wasm heap. The translation cache is reduced to 128 MiB because the upstream 500 MiB cache caused browser memory faults with 1536 MiB guest RAM. Publishing verifies every emitted asset hash and splits large assets into 64 MiB pieces under an immutable image id in the ignored `public/browser-linux/generated` directory. Each piece and the complete reassembled asset are verified before use. Network and PTY transport JS/Wasm are included in that same manifest and execute from verified bytes. The normal application build then includes that directory. The `vendor` directory is build staging only. Nothing substitutes the historical Python guest if the Node image is absent.

The UI must be cross-origin isolated (`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`). QEMU uses shared memory even with one guest core. `BrowserLinuxExecution.prepare()` refuses a non-isolated page. The trusted runtime frame must have the same headers and origin as the harness. Generated applications must never run in that trusted frame.

## Files and lifecycle

`/workspaces/<projectId>` is one IDBFS-backed Emscripten filesystem, mounted into Linux through 9p. It is restored before guest boot. Editor requests and actual child processes see the same files. Save acknowledgements and successful command exits wait for `syncfs(false)` to complete. User command writes remain subject to ordinary external-edit races; file revisions are content hashes, and stale editor writes are rejected.

An exclusive browser Web Lock prevents two live guests from mounting the same project in separate tabs. A second owner receives `WORKSPACE_BUSY`. The lock is released after a checkpointed shutdown or when its runtime frame is destroyed.

The guest inbox scanner backs off from 20 ms to a maximum of 1000 ms when idle and resets after receiving commands. Child output, exits and PTY output use independent callbacks. This bounds idle 9p work instead of continuously competing with the programs being run. `runtime.metrics` reports guest CPU usage and actual poll counts for diagnostic comparisons; it does not infer child progress from elapsed time.

The separate `/harness-control` mount holds request-id JSON mailboxes, response files and sequenced output records. Temporary-file rename publishes complete messages. Binary output uses base64 within this private protocol; it is never inserted into a shell command. The guest bounds pending event files and pauses process streams when the receiver falls behind.

The supervisor is also a versioned, hash-verified image asset. The trusted frame mounts its verified bytes into `/harness-control/supervisor.js` and supplies that exact entrypoint through container2wasm's configuration. `compose-supervisor.js` can update this JavaScript control plane without rebuilding Linux or copying its large root filesystem. It preserves the compiled QEMU and rootfs provenance; `publish.js` verifies all reusable chunks and their aggregate digest before hardlinking them into the new immutable image directory. The native PTY module remains in the pinned Linux image.

The network adapter is upstream c2w-net-proxy compiled to WASI. By default it forwards HTTP/HTTPS through browser fetch and therefore retains browser CORS restrictions. Explicit `setNetworkRelay({url,token})` sends guest requests through the paired companion's authenticated `/network/fetch` binary relay; `setNetworkRelay(null)` restores browser fetch. Relay selection grants networking only and never switches execution to the host. The relay token stays in the trusted frame. Node receives the ephemeral guest proxy certificate via `NODE_EXTRA_CA_CERTS`. Model credentials never enter the guest.

The browser readiness handshake records the running supervisor's Node version, executes a separate `node --version` process, verifies its output, and checks a shared-file write/read/remove followed by an IDBFS checkpoint. This does not imply that npm or Next has passed. Native tests or a native Docker build do not prove browser compatibility. Keep browser acceptance evidence separate: JavaScript execution, npm, install/build, cancellation, PTY resize, durable reload and the actual static-export artifact must run on current Chrome and Safari before that compatibility is claimed.

The CUA-driven verification page is available through `bun scripts/browser-linux/probe.js --serve`. Its browser-visible result retains image/boot identity, each readiness phase, elapsed milliseconds, actual command results and failures. `?profile=1` runs bounded comparisons of ordinary Node, V8 `--jitless`, Node's debug-only `--no-node-snapshot`, and both flags; these are diagnostic experiments, not production defaults. `?build=1` adds the baked-cache npm/Next build, `?network=1` installs and executes a package absent from that cache, and `?phase=reload` verifies an earlier checkpoint. A failed or timed-out run remains a failed receipt.

The pinned Next/React proof copies `/opt/harness/template/package-lock.json` from the actual guest image and runs `npm ci --offline --no-audit --no-fund`. This exact lock avoids reparsing large registry histories during dependency resolution. It is valid only for the matching pinned template; applications with custom dependencies or their own lockfiles must retain their own dependency contract. Unlocked npm installation remains a real supported command, but its browser execution time must be reported separately.

## Provenance

- container2wasm: `6ed3d98882a2b22eafc1334f574c364a5b2b8c47` (v0.8.4), Apache-2.0, <https://github.com/container2wasm/container2wasm>.
- QEMU Wasm: `8604ed49a3cde392890b014a8d5a959c8a2fe72a`, QEMU's license terms apply, <https://github.com/ktock/qemu-wasm>. Linux, GNU tools and image packages retain their individual licenses.
- xterm-pty: 0.10.1, MIT; browser_wasi_shim: 0.2.17, MIT/Apache-2.0. Transport license copies accompany the generated vendor assets.
- Node base image: digest pinned in `guest/Dockerfile`; node-pty 1.1.0, Next 16.3.6, React and React DOM 19.3.0.

`build.js` records reproducible source edits: IDBFS link/export, maintained upstream repository URL, GNU mirror, Go 1.25 build stage and GCC 14 Bookworm stage. The source checkouts remain in `.cache/browser-linux`; source plus these scripts is required when distributing corresponding runtime binaries. The manifest records output integrity hashes and separates native verification from browser verification.

The pinned libffi wasm32 implementation and xterm-pty glue contain signed pointer shifts that cannot address a heap above 2 GiB. `patch-runtime.js` applies bounded post-link corrections to those pointer indexes, preserving the original and patched JavaScript hashes in the manifest. The ABI regression test executes the generated libffi argument/return marshalling with addresses on both sides of that boundary. Other arithmetic shifts remain unchanged.

That same script supplies the missing symlink mode on Emscripten's synthetic `/proc/self/fd` nodes. QEMU sets the permissions of newly created 9p files through those descriptor paths. Without the mode, Emscripten does not follow the descriptor link and rejects `chmod` with `EPERM`. The regression executes the generated descriptor-node factory and path resolver and checks that the corrected path resolves to the actual file. The patch preserves the requested permission change; it does not relax the guest's security model.

`patch-errno.js` corrects the pinned QEMU 9p server's assumption that Emscripten and Linux share errno numbers. Without it, a Linux lookup receives Emscripten `ENOENT=44` instead of Linux `ENOENT=2` and refuses subsequent file creation. `linux-errno.json` records Linux v6.1's `include/uapi/asm-generic/errno-base.h` and `errno.h` values; the independent test fixture `emscripten-errno.json` records Emscripten 4.0.10's musl `arch/emscripten/bits/errno.h` and `system/include/wasi/api.h` values. The test compiles the same translation branch as C and checks the Linux results. True Linux hosts retain their original behavior.
