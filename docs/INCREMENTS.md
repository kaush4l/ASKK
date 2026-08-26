# Increments

Each row is one unit of work: one owner, disjoint files, its own tests, green
before it is done. The order is the dependency order — a wave may run in
parallel, a wave may not start until the one above it is green.

Every increment obeys `docs/PHILOSOPHY.md §7`: files ≤ 200 lines, functions ≤ 40,
zero runtime dependencies, pure core, comments explain the *reason*.

---

## Wave 1 — foundation (no dependencies)

| # | Files owned | Ports | Done when |
|---|---|---|---|
| 1.1 | `core/template.js` | the `{{ x }}` / `{% if %}` / `{% for %}` / `\| join(sep)` subset the components use | every `TEMPLATE` string in the Python renders byte-identically |
| 1.2 | `core/session.js` | `session.py` whole | `goal`, `unresolved`, `resetFor` behave as the Python; `Step`/`StepResult`/`Critique` defaults match |
| 1.3 | `core/state.js` | `state.py` whole | six statuses, `set` counts a turn on entering `working`, `snapshot` sorted by name, `report` line format identical |
| 1.4 | `core/frontmatter.js` | `utils.parse_agent_file` + the YAML subset (PORT-MAP R7) | parses every `agent.md` and `SKILL.md` in the Python tree; both malformed-frontmatter errors reproduce |
| 1.5 | `core/ports.js`, `core/ports/memory-fs.js` | the S9 shape + the in-memory fs used by every test | `replace` is atomic; `read` of a missing file is a typed miss, not a throw |

## Wave 2 — the four pillars

| # | Files owned | Ports | Done when |
|---|---|---|---|
| 2.1 | `core/components.js` | `components.py` whole | `Slot` values 0/10/20/30/40/50/60/99; eight components; `COMPONENTS` registry; `key()` stable and order-independent; `ContextBlock` not cacheable |
| 2.2 | `core/assembler.js` | `assembler.py` whole | three invariants throw `AssemblyError`; memo hits on stable components; `MEMO_LIMIT` 512 cleared wholesale; joined with `""` |
| 2.3 | `core/responses.js` | `responses.py` whole (PORT-MAP R1) | seven response classes + `ResponseContract`; TOON and JSON both ways; every coercion fails to the careful branch; `ReActResponse` act-rescue works |
| 2.4 | `core/tools.js` | `tools.py` whole (PORT-MAP R6) | `parseBatches` splits on gaps not lines; `ARG_ERROR` carried; nothing throws; `ToolboxComponent` text identical |
| 2.5 | `core/inference.js` | `inference.py` minus `ClaudeCLI` (R4) | `Multimodality`, `Inference`, two transports on `fetch`, `KINDS`, `getInference` with all five resolution rules |
| 2.6 | `core/memory.js` | `memory.py` whole (R3) | append/serialize/drain/atomic-rewrite; rolling compaction folds the previous summary; a failed summarizer leaves the log alone |
| 2.7 | `core/skills.js` | `skills.py` whole | folder and bare-`.md` spellings; a broken skill costs itself, never the load; `catalog`/`loaded`/`select` |

**Gate for wave 2:** `tests/parity.test.js` reproduces `render-bare.prompt` and
`render-plain-text.prompt` byte-for-byte after 2.1+2.2+2.3, and
`render-full.prompt` after 2.4.

## Wave 3 — control flow

| # | Files owned | Ports | Done when |
|---|---|---|---|
| 3.1 | `core/flows.js` | the declared edge table (R2) | both flows validate at load; an unknown edge or phase is a load error |
| 3.2 | `core/phases.js` | `phases.py` whole | eight phases; prompt constants character-identical; meta phases record nothing |
| 3.3 | `core/agent.js` | `agent.py` whole | `turn`/`reactLoop`/`consult`/`invoke`; repeat guard; `messages` is a getter (F-4) |

**Gate for wave 3:** the ported `test_core.py` passes in full — `react-loop.json`
parity, repeat guard, full-flow phase order, simple short-circuit, revise loop,
rounds exhausted, empty-skills-dir skip.

## Wave 4 — composition

| # | Files owned | Ports | Done when |
|---|---|---|---|
| 4.1 | `core/space.js` | `space.py` whole | name pattern guard; `NOTE_LIMIT` 20; atomic save; the three tools bind the author |
| 4.2 | `core/agentfile.js` | `utils.load_agent` whole | `RESERVED_KEYS`/`LOADER_KEYS` behaviour; `engine: base` → no response model; space tools come with the space; `preload_history` folds into the system block |
| 4.3 | `core/registry.js`, `core/worker-host.js` | `registry.py` whole (R3) | worker per agent; built-ins shadowed by project agents; summarizer/verifier/critic distributed; peers closed by the main agent |
| 4.4 | `core/schedule.js`, `core/ports/cron-*.js` | `cron.py` whole (R8) | every validation rule and every return string identical; a failed read writes nothing |
| 4.5 | `core/ports/opfs-fs.js`, `core/ports/bun-fs.js`, `core/inference-cli.js` | R5, R9 | the `claude` kind exists only where a spawner does |

## Wave 5 — the interface

| # | Files owned | Done when |
|---|---|---|
| 5.1 | `app/` shell, routing, theme | four destinations reachable, no framework, no runtime dependency |
| 5.2 | `app/` chat view | a turn goes out and an answer comes back against a configured model |
| 5.3 | `app/` prompt inspector | the assembled prompt shown component by component with slot, key, cache hit — the signature view, because the prompt is the product |
| 5.4 | `app/` flow view | live phase, the session blackboard, the plan and its step results |
| 5.5 | `app/` roster + editors | the state table; agent.md, models.json, skills and the schedule editable in place |

## Wave 6 — the gate

| # | Files owned | Done when |
|---|---|---|
| 6.1 | `scripts/gate.js` | types · tests · file and function size · purity · golden parity, in one command |
| 6.2 | `scripts/build.js` | a static export to `dist/` that opens from the filesystem and from a subpath |
| 6.3 | `scripts/smoke.js` | the built page drives one full turn in a real browser |

---

## The rule that outranks the schedule

A page that rendered and did nothing once passed 426 tests. **Green tests are
not a working page.** Wave 6.3 exists for that, and no increment is finished on
the strength of unit tests alone once there is a page to drive.
