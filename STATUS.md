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
| LEAD | workspace shell, `packages/kernel`, gates, this page | kernel vocabulary | ✅ landed |
| RESEARCH | rival harnesses, Bun 1.4, Next latest, 6 architecture attacks | ruling document | 🔄 running |
| A · PAPER | `packages/context` | — | ⬜ not started |
| B · LOOP | `packages/agent` | — | ⬜ not started |
| C · SPINE | `packages/core`, `packages/adapters-*` | — | ⬜ not started |
| D · FACE | `apps/web` | — | ⬜ not started |

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

## Open questions

- Which of the nine ports survive (the `ports` critique decides).
- Whether the emulated-Linux workspace survives, or becomes OPFS + a Worker.
- The compaction ladder's shape under a 200k-context model.
