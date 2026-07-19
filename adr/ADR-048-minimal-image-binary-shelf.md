# ADR-048 — Minimal image + runtime binary injection (the shelf)

Status: accepted, 2026-07-17. Amends ADR-047 mid-rewrite, by owner directive.

## Context

ADR-047's first cut baked the whole agent stack — CPython 3.11, Node,
hermes-agent, a prewarmed dashboard bundle — into the c2w image. That
pushed the image toward Eliza's numbers (~650 MB raw, ~210 MB gz, 2 GB
guest RAM, multi-minute boots) and made every agent-stack change a full
image rebuild. The sibling `c2w-alpine` bench proved the other end:
stock Alpine converts to a ~105 MB wasm that boots to a usable shell in
~3 s under the patched (unthrottled) Bochs.

## Decision

1. **The image is the smallest possible Alpine.** Stock `alpine:latest`
   plus only the `rootfs/` scripts. Zero apk installs. `GUEST_RAM_MB=512`.
2. **Binaries are injected at runtime, not baked.** Static amd64 tools and
   runtime tarballs live on the public shelf `docs/bin/`, served like any
   page asset. In-guest, `askk-get <name>` pulls
   `http://bin.askk.internal/<name>` through the fetch proxy (sentinel
   remap → same-origin `./bin/<name>`) into `/usr/local/bin`.
3. **Dev build first, then small.** `image/build.sh --dev` passes
   `LINUX_LOGLEVEL=7 INIT_DEBUG=true` for a verbose, understandable boot;
   the default build drops the debug flags for the smallest artifact.
   `WIZER=1` (build-time kernel pre-boot) stays an opt-in A/B knob.
4. **Markers become a profile.** The minimal image emits
   `BOOT → NET → READY`; `HERMES` appears only after an injected agent
   starts its dashboard. The page reaches 100% on `READY` alone.

## Consequences

- Boot drops from minutes to seconds; the wire cost from ~210 MB gz to
  roughly the c2w-alpine baseline (~40–50 MB gz expected).
- Shelf binaries must be fully static (musl) or self-contained — the guest
  has no shared-library zoo. Large tarballs follow the `docs/wasm/` rule:
  never on main, gh-pages only.
- The hermes dashboard path (ADR-047's ingress relay) is unchanged and
  dormant until hermes is injected; the iframe shows a placeholder until a
  guest server answers.
- Injected state is RAM-backed: a reload loses injected binaries unless
  persisted via the SW blob store (future: `askk-get --persist`).

## Rejected

- Baking a "small" agent (python-less hermes repack): still tens of MB and
  couples agent iteration to image rebuilds — the exact coupling the owner
  is removing.
- Guest-side `apk add` over the proxy as the primary injection path: works
  in principle (HTTP mirrors), but pulls a dependency tree instead of one
  static artifact; kept as a user option, not the mechanism.
