# HARNESS — rewrite status

> The lead agent's status page. One row per lane, updated at every increment.
> **Read this first.** `docs/RULINGS.md` is the architecture of record for the
> rewrite; `INVARIANTS.md` is still law, with the amendments listed below.

**Goal.** Rewrite HARNESS from the ground up: Rust → Wasm becomes vanilla
JavaScript on Bun 1.4, Dioxus becomes a Next.js static export. A faithful
translation of the parts that were right, and a deliberate correction of the
parts the rewrite exposes as wrong.

**Started.** 2026-08-25.

---

## Where things stand

| Lane | Owns | Increment | State |
|---|---|---|---|
| LEAD | workspace shell, `packages/kernel`, gates, the seam, this page | kernel · gates · seam freeze · deploy proven | ✅ landed |
| RESEARCH | 8 sweeps, 6 architecture attacks, one ruling | `docs/RULINGS.md`, 360 lines | ✅ landed |
| — | the component inventory | `docs/PORT-MAP.md`, 144 rows, 31 increments | ✅ landed |
| A · PAPER | `packages/context` | 1/7 — shapes: parts, sections, documents, slots | 🔄 round 1 |
| B · LOOP | `packages/agent` | 1/8 — state, effects, the phase vocabulary | 🔄 round 1 |
| C · SPINE | `packages/core`, `packages/adapters-web` | 1/9 — registry and the one dispatch point | 🔄 round 1 |
| D · FACE | `apps/web` | 1/7 — the shell, four destinations, the token layer | 🔄 round 1 |

## What exists

```
packages/kernel/src/   ids · status · errors · event · seam · capability · manifest · ports
scripts-js/check-size.js   I12, executable: files <= 200 lines, functions <= 40
jsconfig.json              checkJs strict over every package — vanilla JS, checked types
```

Gate: `bun run gate` = `tsc --checkJs` + `bun test packages` + the I12 size check.

## Rulings so far

1. **Vanilla JS with JSDoc types, checked by `tsc --checkJs`.** Not TypeScript:
   the source that runs is the source that ships, there is no build step for any
   package below the UI, and Bun runs every file directly. Type safety without a
   compiler in the loop.
2. **The seam keeps its shape and changes its payload.** `handle(Request) ->
   Response` survives verbatim (I4). `Response.body` was an HTML fragment
   because the predecessor was htmx-with-no-server; it is now a NAMED TYPED
   PROJECTION, because shipping markup out of a state machine puts the design
   system inside the core. **I5 is amended**: the UI renders `data` and may not
   compute it — stricter than the original, not looser.
3. **Facts carry an envelope version.** `Event.v`, stamped at append, read at
   replay. The predecessor's closed enum bricked a browser on any field added
   without a default; a version plus a nested `fact` object makes additions
   structural instead of hopeful.
4. **`module` folds away.** Manifest types live in `kernel`, the registry lives
   in `core`. Six hundred lines of crate ceremony for one lookup table.
5. **Ports gain streaming and cancellation.** `ModelPort.call` takes
   `{signal, onDelta}`; a port that cannot stream never calls `onDelta` (I15).
   `ModelReply` separates `reasoning` from `text` so a reasoning model's scratch
   is never fed back as history.

6. **Bun's batteries are BUILD-TIME, and that is measured.** `Bun.markdown`
   (`.html`/`.ansi`/`.react`), `Bun.YAML`, `Bun.TOML`, `HTMLRewriter` and
   `Bun.SQL` all exist in Bun 1.4 — and `bun build --target=browser` emits
   `Bun.markdown.html(...)` **verbatim**, so none of them exists in the page.
   Measured, not assumed. Therefore:
   - Markdown a person reads is parsed by ours into a TYPED BLOCK TREE in
     `packages/context`, and the UI renders that tree to React elements. No
     HTML string, no `dangerouslySetInnerHTML`, so a model cannot inject markup
     into the page it is talking to — the safety is structural, not a sanitizer.
   - Agent files are parsed by ours too, because a person may author one in the
     browser and a build-time parse cannot see it.
   - Bun's own batteries are used where they belong: the gate, the scripts, and
     anything that runs before the page ships.

## What the ruling changed

`docs/RULINGS.md` is the architecture of record. Eight attacks; three changed law.

- **I20 Bounded boot** (new). Boot read one IndexedDB record per event, in its
  own transaction, against a real browser holding **39,237** of them — and every
  seam request then deep-cloned the whole log, making a session O(history²) with
  four panes polling. Facts now persist as SEGMENTS (~512 per record, NDJSON)
  with periodic SNAPSHOTS, and every projection is a registered reducer folded
  incrementally. No handler ever receives the event array.
- **I21 Turn identity** (new). A tool result from an abandoned turn silently
  billed a model call. Every effect carries its `turnId`; the reducer drops what
  is not live; every outstanding call has a deadline and an `AbortController`.
- **I5 gains the view-model clause.** A projection carries the already-worded
  string beside the machine field, because the moment two panes word one fact
  for themselves they word it differently.
- **The phase machine is retired.** `state.phase` was assigned nowhere in 67,476
  lines and the exit table had zero readers. Stages survive.
- **The budget is derived, never declared.** Every catalogue entry now carries
  `context_tokens`; an entry without one is a configuration error at install.
- **Head-of-string truncation is banned.** The Rust kept the FRONT 200 characters
  of an oldest-first history — on any constrained turn it kept the greeting and
  lost the message.
- **The emulator does not come back.** 47 MB to serve four file operations, and
  `durable()` returned false, so every file was lost on refresh. OPFS instead,
  and `durable()` finally returns true.
- **Search ships working.** Firecrawl keyless is verified CORS-`*` with no
  Authorization header. Two things this project's own memory believed are
  measured FALSE: public SearXNG (60 of 76 instances 429, two emit any
  `access-control-allow-origin`) and `r.jina.ai` keyless (hard 401 against
  consumer residential ISPs — exactly where a browser agent lives).
- **Reasoning passback is provider-conditional**, and one detail bricks a whole
  session: an assistant turn with only reasoning or only tool calls must
  serialise `content` as `""` and never `null`.
- **Dependencies below the UI stay at zero.** Refused by name: zod, Tailwind,
  framer-motion, charting, marked + dompurify, any public CORS proxy.

## Open questions

- Which of the nine ports survive (the `ports` critique decides).
- Whether the emulated-Linux workspace survives, or becomes OPFS + a Worker.
- The compaction ladder's shape under a 200k-context model.
