# ADR-002 — htmx transport and streaming

**Status:** Accepted (PROVISIONAL — decided unattended per PROMPT §17 from Spike A evidence;
human review pending)
**Evidence:** `spikes/seam/` (running code), `spikes/seam/README.md`

## Context

htmx swaps HTML fragments returned over HTTP; HARNESS has no server (I1). §5 frames the choice:
service worker as the server (A) vs an htmx extension calling the Wasm core directly (B).
Streaming needed a proven mechanism, not an assumed one.

## Options

**Transport A — service worker as server.** htmx unmodified; but the SW is idle-terminated, needs
a stateless-router + long-lived-Worker split anyway, has a first-load bootstrap race, and its
debugging tax is real (the predecessor repo paid it: two loads after every SW change).

**Transport B — htmx extension (~35 lines, measured).** Cancel `htmx:beforeRequest`, call
`handle()`, hand htmx the HTML via `htmx.swap`. No SW lifecycle, trivially debuggable.

**Streaming 1 — SSE extension** against a synthetic streamed response: needs a Response-faking
layer inside the transport plus the htmx SSE ext; two moving parts before any proof.

**Streaming 2 — OOB swaps pushed from JS**: JS holds a pump loop = logic in the frontend, I5 risk.

**Streaming 3 — core-driven chaining (chosen, proven):** each chunk fragment ends with a
self-replacing `<div hx-get="/stream/N+1" hx-trigger="load delay:250ms">` placeholder. Zero
streaming JS; the core decides continuation; each hop is an ordinary seam round-trip; natively
testable (`handle(get("/stream/1"))`).

## Decision

Transport **B** for v1 (Spike A: 2/2 headless-Chrome tests, real vendored htmx 2.0.10, zero
network requests to app routes). SW retained for caching/updates only (ADR-007). Streaming =
**core-driven chaining**; token deltas never enter the event log — the completed message is the
Event (I8 intact).

## Consequences

- The frontend stays provably logic-free; transport is ~35 audited lines.
- Streaming granularity is bounded by hop latency — Spike A observed ~1 s/hop against a 250 ms
  declared delay in the headless harness. Acceptable for v1 token batching; measure in G4 in a
  real page and tune the delay or batch size.
- A future move to Transport A (or the Worker-hosted core, ARCHITECTURE §1d) is transport-only;
  the §3 seam is byte-identical.

## Reversal cost

Low. Both transports consume `Request → Response`; swapping is a `web/` change with no core edit.
Streaming mechanism likewise — chaining, SSE, and OOB all render from the same fragments.
