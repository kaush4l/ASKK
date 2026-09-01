# What is in here, and where it came from

Everything the probe's browser loads. Not linted and not formatted — there is a
`biome.json` here that turns both off — because some of it is vendored upstream
code and a reformat would silently break the byte-for-byte claim below.

| file | origin |
|---|---|
| `workerTools.js` | **vendored verbatim** from xterm-pty 0.9.4. `TtyClient.req()` is `this.streamCtrl[0]=0; self.postMessage(t); Atomics.wait(this.streamCtrl,0,0)` — the blocking primitive the isolation probe measures, called from the third realm |
| `sandbox-pty.js` | `public/sandbox/vm-worker.js` with **exactly one** substitution: `patchStdio` replaced by upstream container2wasm's `wasiHack` (`examples/wasi-browser/htdocs/worker.js`), driven by the `TtyClient` above. That substitution is the experiment's declared variable. **It has since drifted:** the shipped loader gained a gzip inflate and this copy did not, so it can boot only the raw module |
| `vm-worker-streaming.js` | `public/sandbox/vm-worker.js` with `arrayBuffer()` + `WebAssembly.compile` replaced by `compileStreaming`. Exists to price that one change. **It has since drifted too**, and worse: `compileStreaming(fetch(...))` cannot inflate at all, so it can never boot the compressed artifact the deploy serves |
| `host.html`, `classic-isolation.js` | written here, for probe 4. `host.html` boots the tree's own `vm-worker.js` — it does NOT carry a copy, which is the whole point of that probe |
| `coi-serviceworker.js` | written from the technique, not copied. It re-serves **same-origin** responses with COOP/COEP/CORP added and does not intercept cross-origin requests at all, so what happens to those is the browser's own COEP enforcement — which is the thing being measured |
| `calls.js` | the app's real model requests, copied in shape from `src/core/inference/Inference.js`, `AnthropicCompatible.js` and `OpenAICompatible.js`. Endpoints resolve at call time so a nested worker can be told them by message |
| `pty-backend.js` | written here. The host half of the tty protocol, speaking the same wire format as the vendored `TtyClient`, which is upstream's `TtyServer.ack()`. It caps a read at the length the guest asked for; upstream's `feedToWorker(toWorkerBuf.length)` ignores that and its client then writes past the guest's buffer, so a verbatim port would inherit an overflow |
| `isolation.html`, `model.html`, `pty.html`, `atomics-worker.js`, `nested-*.js` | written here |

**Not in here, on purpose:** `vm-worker.js`, `wasi-util.js`,
`browser_wasi_shim/` and `sandbox.wasm`. The probe server mounts
`public/sandbox/` as a second root and serves the tree's own copies.

That protects only the pages which load those names directly — probe 4's
`host.html` and the pty probe's `oneshot` stage. **The two derived workers above
are copies and they have drifted**, so a stage that boots one is evidence about
that copy and not about what ships. Confirm which is which with:

```
md5 -q public/sandbox/vm-worker.js
```

and check it against the `[wasm]`/worker lines in a result artifact.
