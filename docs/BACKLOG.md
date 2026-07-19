# BACKLOG

Tasks carry acceptance criteria; a task without them is a wish, not work.
Ordered roughly by value; renegotiate order, not criteria.

## 1. WebSocket support for the dashboard chat tab — SHIPPED 2026-07-18

WS-over-relay tunnel landed (CONTRACTS.md): the SW injects a WebSocket
polyfill (`docs/askk-ws.js`) into relayed dashboard HTML; frames tunnel as
`/__ws/*` fetches through the ingress relay to guest-side `askk-wsbridge`
(python/uvicorn, 127.0.0.1:9219) holding the real WS connections to :9119.
Events feed, tool-call sidebar, and the chat gateway connect in the
published page with no host-side helper; node 24.17 + the wheel's prebuilt
TUI (HERMES_TUI_DIR) ship so the launcher no longer aborts. Terminal pane
unchanged. PROVEN over the tunnel (2026-07-18, direct JSON-RPC probe):
`session.create` → session + model, `prompt.submit` → message.start /
streaming / thinking.delta events, LLM round trip 200 — the gateway chat
is an in-process PYTHON agent (node TUI not required for it). Remaining:
(a) frame latency = one relay round trip (seconds); (b) recv-loop retry
landed (bd4b455) after a transient relay error killed a live stream —
re-verify a full SPA chat reply end-to-end on the next boot; the SPA also
races the gateway on first connect (one reconnect click).

## 2. VM survives page refresh (SharedWorker ownership) — ADR gate

Refresh currently restarts the VM: chunks and tarballs come from the
askk-image cache, but boot + shelf extraction re-run (~10 min emulated).
Moving VM + net-stack workers under a SharedWorker would let a reloaded
page reattach to the running guest. Boundary move (units 2/3/5 own the
files) and platform risk: page↔SharedWorker cannot share SABs (separate
agent clusters), so the tty/net SAB plumbing must live entirely inside
the SharedWorker's cluster with postMessage bridging to the page, and
SharedWorker cross-origin-isolation support must be spiked first.

- **Accept:** an ADR records the spike result (SAB + crossOriginIsolated
  inside a SharedWorker on current Chrome) and the go/no-go.
- **Accept (if go):** reload during a live session reattaches terminal +
  dashboard without a guest reboot; first visit unchanged.

## 3. QEMU-wasm upgrade spike

Bochs emulation is the recorded performance ceiling; c2w's QEMU-wasm
`--to-js` path is the recorded upgrade (ADR-047).

- **Accept:** a spike branch produces a booting QEMU-wasm build of the same
  image; boot-to-`@ASKK:READY@` time measured and compared to Bochs on the
  same machine, written up in the ADR that proposes (or rejects) cutover.
- **Accept:** page-side diff quantified — which of boot.js/worker.js/net
  stack survive unchanged.

## 4. Image-size diet

Chunked image size drives first-visit download and gh-pages weight.
Progress: a wasm-opt stage landed (`WASMOPT=1` on `image/build.sh`);
the SHELF-side diet landed with ADR-050 (pyc/tests/doc strip in the
hermes and python311 recipes — python bytecode strip is off this list),
and repeat-visit download cost is now ~zero anyway (all `bin/*` assets
sha-cached against `BUNDLES.json`). The image-chunk candidates below
still stand for the first visit.

- **Accept:** `manifest.json` `gz_total` reduced by at least 20% from the
  first shipped image with no lost boot marker and hermes still reaching
  `READY` (candidates: apk cache purge, doc/locale removal, single-arch
  busybox).
- **Accept:** before/after sizes recorded in the commit message.

## 5. JVM on the shelf (GraalVM skipped — ADR-049)

Decided 2026-07-18: GraalVM CE 25.1 is **skipped** — no musl build exists,
and the `gcompat` glibc shim was rejected as unreliable under emulation.
(This item previously claimed the Dockerfile carries a commented GraalVM
stage; no such stage ever existed in `image/Dockerfile` — corrected in
ADR-049.) The revisit path is a musl-native JVM: BellSoft Liberica NIK
(≈310 MB, needs >1024 MB guest RAM), as a `bundles.d/` shelf recipe once
the RAM budget allows.

- **Accept:** an `image/bundles.d/` recipe produces a multi-part Liberica
  NIK shelf artifact; `java -version` + one JIT-warm workload measured
  inside the *guest*.
- **Accept:** guest RAM raised only for a JVM profile; the default image
  and default RAM stay unchanged.

## 6. Wire the CodeMirror editor surface

CM6 is vendored but inert (ADR-047 deferred). An editor needs a file
transport to the guest.

- **Accept:** open, edit, and save a guest file (round trip through the
  ingress relay or persist store) from a CM6 pane; `/etc/askk/startup.sh`
  editable this way as the demo case.
- **Accept:** page remains build-step-free — the vendored bundle is used
  as-is.

## 7. CI for the image build

Today the image builds only on the owner's machine with a sibling c2w
checkout.

- **Accept:** a GitHub Actions workflow runs `image/build.sh --skip-c2w`
  (docker smoke: container boots natively, prints `@ASKK:BOOT@` and
  `@ASKK:HERMES@`) on every push to main.
- **Accept:** full c2w conversion stays manual/local (runner time + 2 GiB
  guest RAM make it a poor CI fit) — documented in the workflow file.
- **Accept:** no wasm artifact is ever pushed to main by CI.

## 8. Shelf follow-ups (ADR-050 residue)

- **Deferred:** `image/bundles.d/rust.sh`'s fetch-skip path does not
  upsert its `docs/bin/BUNDLES.json` entry — a skipped rebuild can ship
  a manifest missing rust, dropping its clients to ETag revalidation
  (correct but slower). Fix = upsert in the skip path too.
  - **Accept:** `image/bundles.sh rust` with a warm cache leaves a
    `BUNDLES.json` containing a correct rust entry.
- **Watch:** `askk-ingressd` poll loops showed curl code-000 backoffs on
  the hosted page during the ADR-050 repro. Not reproduced locally; no
  user-visible failure pinned to it yet. Watch on the next hosted boot
  before spending on it.

## P0 — `net=browser` boot stall: DHCP offer never reaches the guest NIC
   (2026-07-17/18, ROOT-CAUSED; static-IP fallback shipped)

Was described as an "intermittent 3-thread handshake deadlock" (~50% of 512MB
boots); at 1024/1536MB it fails 100%, which made it reproducible enough to
pin down. Frame-level instrumentation in worker.js (sock_accept/send/recv
wraps, TX/RX hex dumps on the askk-dbg bus) established:

- The SAB handshake is HEALTHY: cert delivered, `sock_accept` returns a
  connection, TX and RX both flow. Not a deadlock — nothing Atomics-waits.
- The guest is ALIVE: c2w init runs, brings eth0 up, and busybox `udhcpc`
  broadcasts well-formed DHCP DISCOVERs (visible in TX dumps) on schedule.
- The proxy answers correctly: RX dumps show valid DHCP OFFERs from the
  gvisor gateway (192.168.127.1, MAC 5a:94:ef:e4:0c:dd) consumed by Bochs's
  socket netdev via sock_recv.
- The offer is never delivered INTO the guest NIC (TX path works, RX
  injection doesn't — likely the c2w Bochs fork's netdev RX/IRQ path;
  RAM-size dependence unexplained). udhcpc retries forever, and c2w init
  blocks on udhcpc BEFORE the container entrypoint — hence the silent
  console (write=0): the guest is quiet by design until the entrypoint.
- The "console output clears the watchdog" signature and the write=35 dev
  variant are the same stall: dev builds print init logs up to "accepted
  fd=5" (NIC socket open), then udhcpc spins.

Mitigation SHIPPED (sibling c2w checkout, cmd/init/main.go — local patch):
udhcpc bounded to `-t 3 -T 1 -n`, then static fallback 192.168.127.3/24,
default via 192.168.127.1, resolv.conf → 192.168.127.1 (the gvisor stack
hard-codes this subnet; sentinel HTTP rides http_proxy=192.168.127.253:80,
no DNS needed). Boot watchdog + `?net=none`/`?nosw=1` switches remain.

Open (upstream): why Bochs socket-netdev RX injection drops frames, and the
RAM correlation. Candidates to check in the ktock/Bochs fork: RX ring/IRQ
handling in the wasi socket netdev. QEMU-wasm `--to-js` remains the recorded
alternative path.
