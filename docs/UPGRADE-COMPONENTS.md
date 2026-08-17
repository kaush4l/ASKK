# Upgrade plan — the prompt becomes components

Status: DONE, shipped 2026-08-17 (main `90fad03`, gh-pages `dc1b9b1`, live and hash-verified).
Written by the lead agent after two research passes: one over `PythonProject1/core/`
(the ideology), one over this repo (the blast radius). Kept as the record of WHY the
shape is what it is; the increments in §5 are all landed.

One deviation from §6 worth naming: the plan said keep `summarizer` and `critic` and
remove five. That is what shipped. The five live on as test fixtures under
`crates/agent/tests/agents/`, so the machinery they exercised — passes, the critique
stage, authoring — is still covered.

One increment was added that §5 did not foresee: the stage brief. It was prompt content
posing as a `user:` turn, which is the same category error as the ordering bug, and it
became the `directive` component at slot 95.

## 1. Why

The rendered prompt is the whole product surface: it is everything the model is ever told.
Today this repo builds it well but *flatly*.

- `Section` (`crates/context/src/types.rs:88`) is a plain data struct. Nothing is a type, so
  nothing can format itself.
- The eleven sections are **string literals in one function** (`crates/agent/src/seed.rs:40`),
  patched at runtime by string id (`paper::set_text`, `paper.rs:32`) which `expect()`s the id
  exists.
- **Order is `sort_by_key(stability)` and nothing else** (`assemble.rs:95`). Because
  `response_contract` is declared `Static` (`seed.rs:72`), the output-format instruction
  currently renders **fourth, near the top** — not last. That is an accident of a caching
  property being made to do an ordering job.
- **Every section renders through one shape**: `## {id}\n({intent})\n{text}`
  (`render.rs:87`). Tools, history, memory and the response contract are formatted
  identically, so no part of the prompt can carry the format that is actually best for it.
  `render_chat` is ~90 lines — already over the 40-line function cap (I12).

## 2. The ideology being adopted

From `PythonProject1/core/components.py`, verbatim:

```
Component (abstract)
├─ render()    the object as instructions for the model   (its "toString")
├─ key()       content hash — identical key means identical bytes ("hashCode")
├─ applies()   cheap emptiness check; empty components vanish from the prompt
└─ SLOT        where in the prompt this component belongs
```

"Ordering is structural, not conventional." A component is a frozen value object that knows
only how to write itself down. The assembler is deliberately dumb: it does not know what a
soul or a toolbox *is*. It sorts by `(slot, priority)`, checks three invariants, concatenates.

Pinning is structural, never procedural: `Soul` is first because its slot is 0, and the
response contract is last because its slot is 99. Nothing in the assembler names either type.

## 3. Slot — the order, made explicit

`Stability` stops being the sort key and goes back to being what it says it is: a declared
cache class. `Slot` decides order.

| Slot | # | Stability | Cacheable |
|---|---|---|---|
| `Soul` | 0 | Static | yes |
| `Identity` | 10 | Static | yes |
| `OperatingRules` | 20 | Static | yes |
| `Affordances` (tools) | 30 | SemiStatic | yes |
| `User` | 40 | SemiStatic | yes |
| `Memory` | 50 | SemiStatic | yes |
| `Environment` | 60 | Dynamic | **no** — a cached clock is a wrong clock |
| `Task` | 70 | Dynamic | yes |
| `History` | 80 | Dynamic | yes |
| `Observations` | 90 | Volatile | yes |
| `Response` | 99 | (Static content, pinned last on purpose) | yes |

Gaps of 10 are deliberate headroom, so a new slot never renumbers the others.

This deliberately does **not** copy Python's slot order, which puts `HISTORY = 50` before
`TOOLS = 60`. Python's memo is per-component so it never paid for that; this repo's provider
prefix cache would. Here the order stays stability-monotonic through the whole cacheable
head, and only the pinned response tail breaks it.

**Why the response contract is last even though its content is static.** Prefix caching only
ever caches a *prefix*. Once `environment`/`history`/`observations` have changed, nothing
after them was going to be cached wherever it sat. Pinning the contract last therefore costs
no reachable cache and buys recency for the output format — which is the point.

`validate`'s `InterleavedStability` law must be relaxed to check monotonicity over everything
*except* the pinned response tail. The law keeps its meaning for the cacheable head, which is
the part it was defending.

## 4. The trait

An associated `const SLOT` would block `dyn Component`, so the slot is an object-safe method
returning the type's constant:

```rust
pub trait Component {
    fn id(&self) -> SectionId;
    fn intent(&self) -> String;        // one sentence; validate rejects an empty one
    fn slot(&self) -> Slot;
    fn priority(&self) -> u8 { 0 }     // tiebreak within a slot
    fn stability(&self) -> Stability;
    fn floor(&self) -> Fidelity;
    fn cacheable(&self) -> bool { true }
    fn render(&self) -> Vec<Part>;     // THE toString: each type formats ITSELF
    fn applies(&self) -> bool { true }
    fn key(&self) -> String;           // type-name-prefixed content hash
    fn section(&self) -> Section { /* provided default — the inherited method */ }
}
```

`key()` is prefixed with the type name so two types carrying identical fields can never
collide in the memo. (In Python this is exactly why `SystemInstructions`, which subclasses
`Soul` with the same fields, is still distinct.)

`render()` returns `Vec<Part>`, not `String`, because this repo's paper is multimodal
(`types.rs:12`) and collapsing to a string is the documented failure mode (§8.1).

## 5. Increments

Each lands green, holds I12 (≤200 lines/file, ≤40/function), and keeps the golden honest.

1. **`context`: Slot + Component + Assembler.** New `slot.rs` and `component.rs`. `assemble`
   sorts by slot. `validate` relaxed for the pinned tail. Golden regenerated *once*, and the
   diff read line by line — it is the proof that ordering changed exactly as intended.
2. **`agent`: the eleven seeds become eleven component types**, each with its own render.
   `seed.rs`'s 98-line data literal dies. `paper.rs`'s string-id mutations become typed.
3. **Tools as a component.** `Toolbox::instructions()` is kept and a component is built whose
   output is byte-identical to it — Python's migration trick, and the acceptance test.
4. **Response contract as the pinned final component**, carrying pre-rendered instruction
   text so it stays a value and its `key()` covers the exact bytes.
5. **Per-component optimal formatting.** Only now does each component's shape get to differ:
   tools as call signatures, history as a tagged transcript, the contract as an imperative
   closing block. Everything before this is a refactor; this is the actual upgrade.
6. **One main agent.** See §6.
7. **Test the rendered prompt** end to end, then push and publish.

## 6. One main agent — scope, and what it costs

`public/agents/` ships eight. Removing all but `main` breaks concretely:

- **Compaction dies.** `adopt_spec` (`paper.rs:117`) finds the summarizer by
  `role: summarizer`; with no holder, `window::compaction` returns `None` forever and long
  runs lose the conversation to budget degradation instead.
- **Delegation becomes unreachable.** `subagent::resolve` only builds sub-agent tools from
  peers; `main`'s own `tools:` list names `researcher`, which would become an unresolved tool.
- **Tests assert against the real shipped files** — `tests/stages.rs`, `tests/passes.rs`,
  `tests/critic.rs`, `tests/compaction.rs` fail on file removal alone.

**Decision (PROVISIONAL, reversible):** remove `ask`, `author`, `builder`, `researcher`,
`scout` — the ones that are genuinely "a specialized agent you talk to". **Keep
`summarizer`** and **`critic`**: neither is a specialized agent in the user's sense. They are
*distributed capabilities*, exactly as in the Python original, where `registry.py` assigns
them onto every other agent as plain fields and phases invoke them — the model never calls
them and never sees them. Killing them deletes compaction and review, which is not what
"focus on one core main agent" asks for.

`main`'s `tools:` list drops `researcher`. Tests that assert on removed files move to
fixtures they own.

## 7. What proves it worked

- `crates/context/tests/golden/openai_chat.json` regenerated, diff justified line by line.
- A new test asserting the emitted order: soul first, response contract **last**.
- Byte-parity test for the tools component vs `Toolbox::instructions()`.
- The full rendered prompt captured and read by a human — the goal is that the instructions,
  format and information are what is actually wanted, and only reading it proves that.
