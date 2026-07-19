# ADR-047 — Rewrite on a container2wasm base

- **Status:** accepted (owner directive), 2026-07-17
- **Supersedes:** the entire pre-rewrite Rust architecture (ADR-001…046,
  preserved at tag `pre-rewrite-rust`)

## Context

ASKK spent 46 ADRs as a 7-crate Rust → Dioxus → wasm agent harness. Every
capability — tools, exec, persistence, delegation, senses — was rebuilt by
hand inside the browser sandbox: a WASI shim for exec, an MCP runtime
shellized into workers, OPFS persistence with quota traps, a VM stage
(v86, then c2w/Bochs) bolted on as a *feature*. Each addition fought the
sandbox instead of standing on an OS.

The learned experience: the hard part was never the agent loop; it was
re-implementing an operating system's worth of substrate in page JS/wasm.
Meanwhile the owner's Eliza repo
(<https://github.com/kaush4l/Eliza>) proved the inversion end to end: a
full Linux compiled to one wasm via container2wasm boots in a stock
browser tab, with networking, persistence, and a real userland for free.
NousResearch's hermes-agent — a capable, maintained Python agent with its
own dashboard web UI — runs unmodified on such a system.

Owner directive: scrap the harness, make the VM the base.

## Decision

Rewrite ASKK with **container2wasm as the base, the Eliza pattern as the
blueprint**:

1. **VM-as-base, not VM-as-feature.** Latest Alpine (amd64) + hermes-agent
   compiled to ONE wasm via c2w's Bochs/WASI path. The browser page is a
   *client* of the VM, not the runtime.
2. **The agent is hermes.** No bespoke agent loop in page code. The guest's
   `hermes dashboard` (in-guest HTTP server on `:9119`) is the primary UI,
   full-viewport in an iframe.
3. **SW ingress relay.** c2w networking is outbound-only, so the guest
   *long-polls* the service worker (`askk-ingressd`: poll → execute against
   `127.0.0.1:9119` → post response), and the SW serves the dashboard at a
   virtual same-origin prefix `/__hermes/`. No inbound socket ever needed.
4. **Sentinel hosts.** Guest-side URLs (`llm.askk.internal`,
   `persist.askk.internal`, `ingress.askk.internal`) remapped browser-side
   by the net stack — the guest never knows the user's real endpoints; the
   user's LLM backend is swappable live from the topbar.
5. **User-ownable startup.** `/etc/askk/startup.sh` launches the dashboard;
   it is editable in-guest and persist-overridable — the VM is the user's
   machine, not an appliance.
6. **xterm.js terminal** in a resizable pane beside the dashboard — the
   escape hatch that makes every accepted ceiling below tolerable.

## Alternatives rejected

- **Keep the Rust harness, embed the VM as a stage.** That was the ADR-037/
  wave-20 status quo. Rejected: two runtimes to maintain, with the harness
  duplicating (worse) everything the guest OS provides. The learned lesson
  is precisely that the harness is the redundant half.
- **QEMU-wasm `--to-js` now.** Faster emulation (TCG vs Bochs) and the
  obvious performance upgrade. Rejected *for now*: the Eliza pattern is
  proven on the Bochs path end to end; changing base and emulator in one
  step doubles the unknowns. Recorded below as the upgrade path.
- **Host relay daemon as primary ingress.** A local process could proxy
  browser↔guest with real sockets and WebSockets. Rejected as *primary*:
  it breaks the browser-only, access-anywhere goal — the published GitHub
  Pages URL must work with zero host install. (A bridge remains possible
  later as an optional enhancement.)
- **Committing wasm chunks to main.** Eliza does this and its git history
  bloats by ~500 MB per image respin. Rejected: `docs/wasm/` is gitignored,
  chunks (gzip -6, 90 MiB splits + manifest) deploy to gh-pages only via
  `publish.sh`.

## Consequences

- One agent runtime (hermes in the guest); page code shrinks to boot, net,
  SW, and chrome — plain ES2022, no build step.
- Anything Alpine can run, ASKK can run; capability work moves from page
  JS to `rootfs/` and the Dockerfile.
- Build chain: `image/build.sh` → docker → c2w (sibling checkout,
  `GUEST_RAM_MB=2048`) → gzip → chunks → `docs/wasm/`; local dev via
  `serve.py` (COOP/COEP + `/v1` LLM proxy); deploy via `publish.sh` to
  <https://kaush4l.github.io/ASKK/>.

### Accepted ceilings (eyes open)

- **Bochs is slow.** Full CPU emulation: minutes to boot, sluggish guest.
  Upgrade path recorded: QEMU-wasm `--to-js` when the base is stable.
- **No WebSockets over the polling relay.** Dashboard tabs that need WS
  (live chat) degrade; the terminal pane covers interactive use. A thin
  REST chat surface or SW-side WS emulation is backlog, not blocker.
- **Published-page LLM needs CORS.** The page calls the user's backend
  directly; locally `serve.py` proxies `/v1`, remotely the backend must
  send CORS headers. Inherent to serverless pages; documented, not fought.

### Deferred (committed but dormant)

- **GraalVM 25.1** — image stage written but commented out. Blocker:
  glibc-on-musl; needs `gcompat` (fragile for a JIT) or a musl-native
  build (Liberica NIK). Decision deferred until a JVM workload exists.
- **CodeMirror 6** — vendored as an inert prebuilt bundle, unwired. An
  editor surface is real work (file transport, save path through ingress)
  and earns its own increment.
