# SALVAGE — what survives the old tree

> Working note for the architect. Not the architecture of record.
> **Standing correction:** the inventory that produced this assumed Next.js
> implies a server. It does not here. `docs/NORTH-STAR.md` fixes zero backend
> and static export. Every "delete it, the server does it" verdict below is
> overturned by that constraint and is marked **[SERVERLESS OVERTURN]**.

## Copy nearly verbatim — the prompt & response pillars (~1,400 lines)

`component-base.js` (Slot enum + `hash()` + `key()`), `components.js`,
`assembler.js` (sort, 3 invariants, memo), `component-registry.js`,
`tool-prompt.js`, `response-base.js`, `responses.js`, `response-react.js`
(incl. `FORMAT_NOTES` and the act-rescue), `response-parse.js`, `tool-call.js`,
`tools.js` (batch semantics), `phases.js`, `phase-prompts.js`, `flows.js`
(+`validateFlow`), `agent-flow.js`, `agent-react.js` (repeat guard),
`agent.js`, `agent-config.js`, `agent-recipe.js`, `session.js`.

The slot order is the load-bearing constant:
`SOUL 0 · SYSTEM 10 · CONTEXT 20 · SKILLS 30 · PHASE 40 · HISTORY 50 · TOOLS 60 · RESPONSE 99`

## Copy as text, never edited

All four `agent.md` bodies (main / summarizer / verifier / critic),
`agents/models.json`, `skills/summarize-file/SKILL.md`, `COMPACT_PROMPT`,
`tests/golden/*` as the new oracle.

**The fixture trap:** the goldens pin `2026-08-16` beside `day: Saturday`, and
that date is a **Sunday**. A clock cannot derive the golden context block; the
day must be pinned. Any test that "fixes" it has broken the oracle.

## The fifteen ideas worth carrying, in order

1. **Prompt = a sorted bag of immutable components.** Each knows how to render,
   hash, and vanish when empty. The assembler holds no opinion and raises
   rather than repairs. Buys the prompt inspector, prefix-cache stability, and
   a `components:` config line that reorders a prompt with no code change.
2. **The field table IS the contract.** One declaration produces the prompt
   instructions, the parse target, and the routing input. `parse()` never
   throws — unknown format falls through to the other, then the whole reply
   lands in the answer field. `normalize()` fails toward the *careful* branch.
3. **The phase graph is a validated data table.** A phase returns an *outcome
   name*, never a next phase. `validateFlow` runs at load: targets exist,
   outcomes are declared, every outcome has an edge, every phase is reachable.
   A typo is a load error, not a silent stop on turn 40.
4. **Ports with loud stubs.** `defaultPorts()` returns functions that throw
   `no fs.read port configured`, plus `isConfigured()` — because `if (p.spawn)`
   is true for a stub and registers a capability that dies at the call site.
5. **The whole prompt-text corpus.** Tuned against real small local models.
   Losing it is the most expensive mistake available in this migration.
6. **Batching where layout carries the schedule.** Commas on one line = run
   together; a newline = "after everything above". Split on the *gaps between
   regex matches*, not on lines, so multi-line JSON args survive.
7. **Nothing in the tool path throws.** Errors are values the model reads, so
   the error text is a product surface: `Tool not found. Available: ...`.
8. **Meta phases write nothing to the transcript**, and reviewers run on fresh
   context — a reviewer who read the worker's reasoning agrees with it.
9. **The repeat guard**, in three tiers: scold, then a synthesized give-up
   answer of the same response class, so the loop ends with a reply.
10. **Observer contract:** `assembled` fires *before* inference, `entered` at
    phase *entry* (so `verify→plan` and `verify→respond` are distinguishable),
    `results` *per batch*. This is what makes an honest live UI possible.
11. **Skills:** `skills/<name>/SKILL.md`, Claude-Code-compatible, two-stage
    disclosure (catalog = one line each, loaded = full body). A broken skill
    costs itself, never the startup.
12. **`agent.md` is the config seam; `models.json` is the endpoint catalogue.**
    A new server is a new entry, not a code change.
13. **Green tests are not a working page.** 426 tests once passed a page that
    did nothing. Assert the DOM the interface rendered; prove a rebuild by the
    *loss* it causes; assert a tool's own sentence, not a generic success.
14. **A claim the gate cannot execute is not a verified claim.**
15. **Reproduce, and record.** Every divergence from the source gets a
    file:line on both sides and a reason.

## Cut, with the reason

- **The 200-line file rule.** It produced relocation, not simplification: nine
  files sit at exactly 200 lines and one class is spread across six files.
  Keep the 40-line *function* rule, which did its job.
- **`core/index.js`** — barrel file, defeats tree-shaking, exists for a Python
  `__init__.py` problem that no longer applies.
- **`inference-http.js`** hand-rolls streaming/retries/accounting and has none
  of the three. Replace with one real streaming transport.
- **`core/space.js`** — 200 lines and ~22 lines of every turn's prompt budget
  for a shared board that, in the default config, nothing else writes to.
  Unpaid-for. Earn it back later or not at all.
- **`core/schedule.js` + three cron adapters (~540 lines)** — keep the
  validation rules and the exact return strings, drop the machinery until
  something needs it.
- **Comment ballast** — ~1,500 of 7,143 core lines justify port decisions that
  stop being decisions once the port is over.
- **`new agent.constructor({...})`** to dodge an import cycle. The cycle was
  created by the file layout; fix the layout.

## [SERVERLESS OVERTURN] — kept *because* there is no server

The inventory recommended deleting these on the assumption a backend exists.
NORTH-STAR forbids the backend, so they stay, in idea if not in code:

- **Worker-hosted engine** — the isolation story, since there is no process to
  put the engine in. Powerhouse already does this; take its shape.
- **A browser storage adapter** — IndexedDB/OPFS is the only persistence.
- **A frontmatter reader in the bundle** — `agent.md` is parsed at *runtime* in
  the tab, so a build-time YAML import does not reach it.
- **Direct-from-page model calls** — the user's own key or their own local
  endpoint. There is no route handler to hide a key behind, and per NORTH-STAR
  that is a feature, not a gap.

## Known defects — do not port silently

- `resetFor` does not clear `session.skills`; loaded skills leak across turns.
- Compaction triggers on **message count** (`compactAt = 75`), not tokens.
- The repeat guard keys on the whole batch string, so `a(), b()` and `b(), a()`
  are different keys.
- Remote audio URLs are sent as empty `{data:"", format:""}` — silently broken.
- `consult` builds a throwaway reviewer per call.
