# Spike A — the seam + transport

Proves PROMPT.md §3 (one `handle(Request) -> Response` seam) and §5 Option B
(htmx extension as transport, no server), plus one working streaming answer.
Feeds ADR-002.

## Claims and evidence

### WORKED — pure seam, native tests, no browser

`pub fn handle(req: Request) -> Response` in `src/lib.rs`. Method+path+headers+body
in; status+headers+HTML-fragment body out. Routes: `GET /panel`, `GET /about`,
`GET /stream/{0,1,2}`, 404 fragment otherwise.

```
cd spikes/seam && cargo test
# 5 passed: panel_returns_fragment, about_returns_fragment,
# unknown_route_is_404_fragment, stream_chunks_chain_then_terminate,
# responses_declare_html_content_type — 0.00s, no browser, no Wasm.
```

### WORKED — Wasm build + thin export

`wasm-pack build --target web` → `pkg/spike_seam.js` + `spike_seam_bg.wasm`.
`src/wasm.rs` is the only Wasm-aware file: `wasm_handle(method, path, headers, body)`
returns a getter-struct (status/headers/body) — no serde, no JSON dep.

### WORKED — headless browser test (after toolchain surgery)

Two `wasm-bindgen-test` cases in `tests/browser.rs`, `run_in_browser`:

1. `fragment_lands_in_dom` — `handle(get("/panel"))`'s body inserted into a real
   DOM, asserted by id + text.
2. `htmx_click_swaps_fragment_from_handle` — the **vendored** `web/vendor/htmx.min.js`
   injected via eval, an `hx-get="/panel"` button clicked, `htmx:beforeRequest`
   intercepted and answered from `handle()`, fragment asserted in the target.
   This is the §5 Option B transport, driven by real htmx.

Stock `wasm-pack test --headless --chrome` FAILS here: wasm-pack's cached
chromedriver is 151 vs installed Chrome 150 → `Error: http status: 404` at session
create, and wasm-pack overrides `$CHROMEDRIVER` so you can't just point it at a
good driver. Working recipe (matches the prior-art memory for this machine):
download the version-matched chromedriver from Chrome for Testing, then run the
runner directly:

```
CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUNNER=~/.cargo/bin/wasm-bindgen-test-runner \
CHROMEDRIVER=<matched chromedriver 150.0.7871.124> \
WASM_BINDGEN_TEST_ONLY_WEB=1 cargo test --target wasm32-unknown-unknown --test browser
# test result: ok. 2 passed; 0 failed  (0.06s)
```

`--headless --firefox` fallback: no Firefox installed on this machine (geckodriver 500).

Two traps burned into the tests, keep them for later spikes:

- **Never clobber `document.body.innerHTML` in a browser test.** The harness keeps
  its output element in the body; wiping it hangs the runner with
  "Failed to detect test as having been run". Append a container div instead.
- **`js_sys::eval` is strict-mode direct eval** in the generated glue, so a
  classic script's `var htmx = ...` stays eval-scoped. Export it inside the same
  eval (`; window.htmx = htmx`) or the global never appears.

### WORKED — served page, real clicks

`python3 -m http.server 8911` from repo root; all assets 200 via `curl -sI`:
`/web/index.html`, `/web/vendor/htmx.min.js` (htmx **2.0.10**, 51 KB, unpkg),
`/web/transport.js`, `/spikes/seam/pkg/spike_seam.js`, `/spikes/seam/pkg/spike_seam_bg.wasm`.

In Chrome: Panel/About buttons swap their fragments into `#out`, and the network
log shows **no request for `/panel`** — the extension cancels htmx's request and
answers from Wasm. Transport is ~35 lines, transport-only (I5).

### WORKED (with a caveat) — streaming in ≥3 visible chunks

**Choice: core-driven htmx chaining.** Each chunk's fragment ends with a
placeholder `<div hx-get="/stream/N+1" hx-trigger="load delay:250ms"
hx-swap="outerHTML">` that pulls the next chunk and replaces itself, so chunks
accumulate. The chain lives entirely in `handle()` — zero streaming JS, works
through the identical transport, testable natively (see
`stream_chunks_chain_then_terminate`).

Considered and not built: htmx SSE extension (needs a fake EventSource shim —
more JS, against I5) and a JS pump doing out-of-band swaps (application logic in
the transport). Chaining was the smallest thing that could work, and it did.

Evidence (MutationObserver timestamps in Chrome): chunk 1 at ~1 ms, chunk 2 at
~1110 ms, chunk 3 at ~2100 ms after click — three visible, progressive arrivals.

**Caveat for ADR-002:** per-hop latency is ~1 s despite `delay:250ms` — suspect
settle timing plus the double `htmx.process` in the transport. Fine for a spike;
measure before committing to chaining for token-rate streaming, and note that
true token streaming may still want the SSE extension against a simulated
streamed response.

## Layout

```
spikes/seam/src/lib.rs      pure seam + native tests (no wasm-bindgen)
spikes/seam/src/wasm.rs     #[wasm_bindgen] wrapper, cfg(target_arch = "wasm32")
spikes/seam/tests/browser.rs headless DOM + real-htmx transport proof
web/index.html              htmx script tag, buttons, #out — nothing else
web/vendor/htmx.min.js      vendored htmx 2.0.10
web/transport.js            §5 Option B extension: beforeRequest → wasm_handle → htmx.swap
```

Build artifacts (`target/`, `pkg/`, `Cargo.lock`) are gitignored; rebuild with
`wasm-pack build --target web` before serving.
