# ADR-051 — Self-contained image: bake python + hermes, drop the runtime shelf

- **Status:** accepted, 2026-07-19
- **Amends:** ADR-048 (minimal image + binary shelf) — for the hermes
  profile the shelf is no longer the delivery path; python + hermes ship
  inside the module. ADR-049 (toolchain shelf) still stands for *optional*
  heavy tools pulled on demand. ADR-050 (guest RAM) — revisits the number:
  baking removes the tmpfs extraction that forced 1024 MB.

## Context

ADR-048 shipped a minimal busybox Alpine and pulled the big binaries
(python311, hermes, node) into the *running* guest over the fetch-proxy via
`askk-get`, off the page's `docs/bin/` shelf. That kept the base module tiny
but had two costs the owner called out:

1. **Two-stage, re-extracted start.** Every boot: download the module,
   then download the bundles, then extract them into the guest. The guest
   rootfs is a tmpfs overlay, so the ~189 MB of extracted python+hermes
   consumed guest RAM — which is exactly why ADR-050 had to bake the guest
   at 1024 MB (`free -m`≈993). The download was also split across the image
   cache *and* the shelf cache, two versioning schemes.
2. **"It should be one image, no build script."** The owner's target was a
   single artifact — bookmark it, it just runs — comparable to ElizaOS
   (~200 MB) rather than an image plus a separate download-and-assemble step.

## Decision

**Bake python + hermes into the image.** `image/Dockerfile` is now
multi-stage: a builder installs python-build-standalone (musl) +
`hermes-agent[web,pty]`, prewarms the Node-built TUI dist, and trims the
tree (275 → 189 MB); the final minimal-Alpine stage `COPY`s `/opt/python`
and `/root/.hermes`, `apk add`s `curl` (askk-ingressd needs it), and
verifies hermes runs with **no Node** present. `rootfs/startup.sh` drops all
`askk-get`/tarball/extraction logic — bringup is now render-config →
dashboard → gateway → wsbridge from the baked tree. Boot markers and their
order are unchanged (`BOOT`/`NET`/`READY`/`HERMES`).

**Why baking *lowers* peak RAM instead of raising it.** c2w packs the
container rootfs into the module as a **read-only ISO** (`mkisofs` →
`rootfs.bin` → `wasi-vfs pack`), and the container root is an **overlay**:
`lowerdir=/oci/rootfs` (the ISO, read-only) + a tmpfs `upperdir` for
writes. Baked files are therefore *read from the ISO on demand*, not copied
into tmpfs — the opposite of `askk-get`, which wrote 189 MB of extracted
bundles into the tmpfs upper. Removing that extraction is what lets the
guest RAM come back down (see budget).

**The shelf is not deleted, just dormant.** `askk-get`, `docs/bin/`, the
`bundles.d/` recipes, and the SW shelf cache all remain for *optional*
heavy tools a startup script might pull on demand (ADR-049's point). The
hermes bringup simply no longer touches them.

## Budget (measured)

| | shelf (ADR-048/050) | self-contained (this ADR) |
|---|---|---|
| download | 38 MB image gz + ~63 MB shelf = ~101 MB, **2 stages** | **100 MB** gz, **1 cached artifact** |
| raw wasm | 116 MB | 291 MB |
| python+hermes | extracted into tmpfs at boot | on the read-only ISO |
| guest RAM | 1024 MB (forced by the tmpfs extraction) | **512 MB** |
| ~tab commit | ~1140 MB | **~794 MB** |
| runtime shelf download | every boot until cached | **none** |

The download stays ~100 MB (same content, same gzip) but collapses to one
content-versioned artifact (`docs/wasm/` `?g=<gz_total>`), cached once and
never re-fetched — no second shelf round trip, no runtime extraction.

**Guest RAM drops to 512 MB (the new `build.sh` default).** With python +
hermes on the read-only ISO instead of the tmpfs upper, the guest's writable
working set is just config + logs + hermes runtime, and it boots to `HERMES`
in 512 MB (verified). Tab commit = guest RAM (512) + the raw wasm buffered
during instantiation (282) ≈ **794 MB**, *below* the shelf build's ~1140 MB
despite the larger module. This directly answers the earlier "why is the tab
~1.2 GB" concern: the extraction that drove it is gone. Bump back to 1024
only if a startup script pulls a heavy toolchain into tmpfs at runtime.

## Consequences

- **One artifact, one cache.** Repeat visits re-download nothing (image
  cache hit on the unchanged `gz_total`); there is no shelf step to be
  stale or partial.
- **Bigger module, smaller working set.** The raw wasm roughly triples
  (116 → 291 MB) because the ISO now carries python+hermes, but that data
  lives on the read-only ISO, not in tmpfs.
- **Swapping the agent is a rebuild, not a re-upload.** ADR-048's selling
  point was swapping hermes for another runtime by replacing a shelf
  bundle. That now means rebuilding the image. Acceptable: the owner's
  framing is "hermes might be swapped later," a deliberate rebuild, not a
  hot-swap. Optional *additional* tools still come off the shelf live.
- **Node is not baked.** The dashboard, gateway, and ws bridge (the whole
  LLM path) are python-only and verified without Node. The embedded chat
  *session* PTY (`askk-session`) runs the Ink TUI under Node and stays down
  until Node is added — the same BACKLOG-1 chat-session gap as before, not
  a regression from this change.

## Verification

Built and booted locally (dev server, two loads for the SW): boots
`BOOT → READY → HERMES` with **no shelf-download line**; terminal live with
the WebGL renderer; the Hermes dashboard SPA renders as the iframe
component; and the guest reaches a host LLM end-to-end through the proxy
chain (guest → `llm.askk.internal` → c2w-net-proxy → serve.py → upstream),
confirmed by the upstream receiving the guest's `/v1/models` request. The
dashboard's "Gateway Status" indicator and chat-session lifecycle remain the
pre-existing BACKLOG-1 item (identical hermes build, unchanged by baking).
