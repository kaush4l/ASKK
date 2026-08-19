# CRITIQUE-03 — the Faculty seam, and an agent that starts an agent

Bar-raiser round 3, 2026-08-19. Read-only. Every claim below was resolved by opening the
file; `path:line` is against the working tree as it stood at the end of this review, with
`git show ca59db1:<path>` used where a doc cites its own baseline.

**Tree state note.** A coding agent was landing `crates/core/src/faculty.rs` and
`crates/core/src/space/sense.rs` while this review ran. An early pass found the `Sense`
port ORPHANED (no `mod faculty;` in `crates/core/src/lib.rs`, no caller for
`refresh_all`, `crate::space::sense` absent) and the interim writers still in
`crates/core/src/space/shared.rs`. By the end of the review all of that had landed and
the interim writers were gone. **Everything below judges the finished state**, and no
finding depends on unfinished work. The one exception is flagged inline (F3), where the
work landed and a piece it was supposed to remove did not go.

## The gates — run unpiped, cargo's own exit code

```
cargo test --workspace                                   TEST_EXIT=0
cargo check -p adapters_web --target wasm32-unknown-unknown  WEB_EXIT=0
cargo check -p ui --target wasm32-unknown-unknown             UI_EXIT=0
python3 scripts/check-size.py                                SIZE_EXIT=0
```

All four green. No contention observed; the run completed after the concurrent agent's
last write. `cargo fmt --all --check` fails, but see F9 — it is pre-existing and repo-wide.

---

## Q1. Is `Faculty` a real seam, or a second way to do what `space:` already did?

**A real seam. The migration is genuine, not a rename.** This is the strongest part of
the round and it survives the hard tests:

- `SharedSpace` is **out of the prompt path**. `crates/agent/src/components/mod.rs:79-90`
  builds `dynamic()` from three machine blocks plus a `Sensed` per declared faculty
  block. There is no `SharedSpace` in it. At `ca59db1` there was
  (`git show ca59db1:crates/agent/src/components/mod.rs` line 71 is
  `Box::new(SharedSpace {`). The only remaining references to the type are
  `space_parts` (`components/space.rs:53`) and `tests/space.rs`.
- **No space-specific branch survives in the generic path.**
  `grep -rn '"space"' crates/agent/src crates/core/src` returns ten hits and not one is a
  branch in the generic path: one const definition (`faculty/space.rs:20`), one
  frontmatter key (`spec/yaml.rs:80`), one `write_agent` argument name, one module-id for
  the UI pane, and doc comments. The prompt path knows the faculty name only as
  `faculty::SPACE`.
- All three of §9.2's hardcodes really did become table entries: tools via
  `faculty::tools_for` concatenated into `offered` (`subagent.rs:61`), the block via
  `faculty::blocks_of` (`components/mod.rs:86`), the refresher via
  `installed_by_default()` → `SpaceSense` (`core/src/faculty.rs:59-61`).
- **The byte-identity claim is real and is proved by an artifact, not an assertion.**
  `crates/agent/tests/prompt.rs` renders the shipped `public/agents/main/agent.md`
  through the real `step` and asserts the `## space` block's actual bytes
  (`prompt.rs:166-172`). That file is **unchanged in this round's diff**
  (`git diff --name-only` does not list it) while `SharedSpace` left `dynamic()`. A
  migration that moved the prompt would have shown up there. It did not.
- `faculty::of` is extensible without touching anything else — see F4 for the true edit
  count, which is three lines in one file rather than the one the doc implies.

### F3 — MEDIUM. A pure crate still seeds one named faculty's state, and its own comment says it should not.

`crates/agent/src/paper/adopt.rs:65-70`:

```rust
fn adopt_faculties(state: &mut AgentState, spec: &AgentSpec) {
    state.faculties = crate::faculty::declared(spec);
    if state.space.is_some() {
        let parts = crate::components::space_parts(&state.space);
        state.senses.insert(crate::faculty::SPACE.to_string(), parts);
    }
}
```

The doc comment above it (`adopt.rs:60-64`) says: *"The `senses` write is INTERIM … It
goes when that host becomes an injected `Sense` port and every faculty is refreshed
through one mechanism."* **That host became an injected `Sense` port in this same round**
— `crates/core/src/faculty.rs:46` `trait Sense`, `crates/core/src/space/sense.rs:27`
`impl Sense for SpaceSense`, called from `crates/core/src/runtime/mod.rs:59`
`refresh_all`. The condition the comment names is met and the writer did not go.

It is not decorative — it is **load-bearing for the seam's own proof**.
`crates/agent/tests/prompt.rs` is a pure-`agent`-crate test: `rendered_from`
(`prompt.rs:53-60`) calls `adopt_spec` then `step`, and no core runtime ever runs. Delete
the `if state.space.is_some()` arm and `state.senses` is empty, `Sensed::render` returns
no parts, and `prompt.rs:167` (`space.contains("space: research")`) goes red. So the
byte-identity evidence for §9.2 rests on a space-only hardcode in the pure core.

**What it costs:** the proof does not generalise. A browser faculty gets no equivalent
arm, so `prompt.rs` can never demonstrate for `page` what it demonstrates for `space`,
and the next faculty author reading `adopt.rs` will reasonably conclude that seeding
their own faculty's senses here is the pattern. It also makes `adopt_spec` — the one
function that turns a file into a running agent — carry knowledge of one faculty's
rendering.

**Does it make the seam a lie?** No. In production it is redundant: `refresh_all` runs at
the top of `drive` before any event is pumped (`runtime/mod.rs:58-60`), so the first model
call already has fresh parts. The seam is real; this is a test fixture that leaked into
production code.

**Smallest fix:** delete the `if state.space.is_some()` arm; in `prompt.rs`, have
`rendered_from` fill `state.senses` from `agent::space_parts(&state.space)` for every
declared faculty the fixture wants populated — i.e. the fixture plays the host, which is
what a host-half seam means. Two lines moved, and the test then works the same way for a
browser fixture.

### What is still space-shaped, and is fine

`crates/core/src/runtime/mod.rs:58` still calls `space::shared::refresh` unconditionally
before `refresh_all`. That is **justified and documented**: `refresh` re-reads the KV
store into `AgentState.space`, which is what the space TOOLS read; `SpaceSense` then
renders that same field for the prompt. Two readers of one fact. A browser faculty needs
only the second, so nothing is being asked of it that the space gets for free.

`faculty::declared` (`faculty/mod.rs:77-79`) reads a non-empty `space:` as declaring the
space faculty. That is a compatibility rule stated in one place and covered by
`tests/faculty.rs:90-100`, including the deduplication that stops
`space: research` + `faculties: [space]` from producing a `DuplicateSection`. Correct.

---

## Q2. Does the chrome case work by configuration alone? Traced end to end.

**It works for DECLARATION and PERCEPTION. It does not work for ACTION.** The break is at
step 3, and it is in the pure core.

**1. `faculties: [browser]` and `tools: [navigate, click, read_page]` parse — YES, both
shapes.** `spec/yaml.rs:90` routes `faculties` to `list_field`, which handles inline
`[a, b]` (`:141`) and a bare key opening a `- name` block (`:143`, with the block-item
branch at `:46`). A scalar is refused with a message naming both shapes (`:136`).
`tests/faculty.rs:139-148` pins all three. `AgentSpec.faculties` is `#[serde(default)]`
(`spec/mod.rs:73`), so stored specs still load.

**2. `faculty::of("browser")` — what must be edited.** `crates/agent/src/faculty/mod.rs`
in three places: `mod browser;` (beside `:22`), the match arm (`:46-49`), and
`pub const ALL: [&str; 1]` at `:53`, whose **array length must change**. See F4.

**3. The tools — the allowlist rule is intact, and the tools do not run.**

The allowlist half is correct. `resolve` (`subagent.rs:55-66`) concatenates
`builtin_tools()` and `faculty::tools_for(spec)` into `offered` **before** the filter, and
`allowlisted` (`:77-93`) then picks from it. A faculty widens what a non-empty `tools:`
list may PICK FROM and grants nothing. `tests/faculty.rs:127-133` proves a space name that
`Space::named` refuses declares no faculty and therefore grants no `exec`. This is exactly
the rule §5.2's gap-10 risk line demanded, and it holds.

**But nothing executes a faculty's tools.** `Faculty.tools` is `Vec<Tool>` — a name, a
description and an argument list. Execution is dispatched by
`crates/core/src/tools.rs:107`:

```rust
pub(crate) fn tool_entry(tool: &ToolId) -> Option<ToolHandler> {
    match tool.0.as_str() {
        name if agent::is_workspace_tool(name) => Some(workspace),
        name if name == agent::WEB_SEARCH => Some(websearch),
        name if agent::is_space_tool(name) => Some(space),
        _ => None,
    }
}
```

…a closed `match` **in the pure core**, naming three `agent`-crate predicates. A name with
no arm falls through to the sync `run` (`crates/core/src/tools.rs:125`), whose own `match`
has four arms and a `_ =>` that returns
`"Tool not found. Available: <builtin_tools()>"` (`:134-142`).

**What actually happens to a chrome agent's turn today:** the `page` block renders
correctly at its slot before every call; `## affordances` lists `navigate`, `click`,
`read_page` with their descriptions; the model calls `navigate` — and gets back
`ok: false, output: "Tool not found. Available: now, list_agents, read_agent,
write_agent, spawn_agent, web_search, list_skills, read_skill"`. A tool the prompt
promised, on every call, forever. That is worse than the tool being absent.

There is also no port to reach a browser with. `Ports` (`crates/core/src/app.rs:27-47`) is
a closed struct of eight named `Rc<dyn …>` fields; there is no open list and no
`install_*`. The module tier is not an escape: `dispatch::builtin_entry`
(`crates/core/src/dispatch.rs:42`) maps `ModuleId` to UI pane handlers, not tool names,
and `Effect::InvokeTool` never reaches it (`batch.rs:170-174`).

**The asymmetry is the finding.** This round got the perception half exactly right —
`App.senses: Vec<Rc<dyn Sense>>` (`app.rs:59-64`) is **composed in, not required**, with
`pub fn install_sense` (`core/src/faculty.rs:65`) as the composition root's door, and
`core` names nothing it senses. The identical lesson was not applied to action, where the
table is still closed and lives in the crate that must not know what a page is.

**4. What writes `state.senses["page"]`, and can `adapters_web` do it without a core
edit? — YES, and this is genuinely good.** `Sense` (`core/src/faculty.rs:46-52`) and
`Sensing` are `pub use`d from `crates/core/src/lib.rs:41`; `install_sense(&mut App, …)`
takes the public `App`. `adapters_web` can `impl Sense for PageSense` and install it with
no `core` edit. `refresh_all` (`:80-98`) walks the agent's declared faculties, skips a
faculty with no installed sense in silence (I15), and **clears the block ids before
writing** (`:91-93`) so a sense that comes back empty leaves the prompt saying nothing
rather than last turn's snapshot. That last detail is the difference between a seam and a
liability and it was got right.

**5. Slot, stability, floor — checked, and the error is a good one.** `Slot` is
`pub struct Slot(pub u8)` (`crates/context/src/slot.rs:32`) with named consts, so a block
at `Slot(92)` needs no `context` edit. A block at or after `OBSERVATIONS` must declare
`Stability::Volatile` or `law::interleaved` (`law.rs:63`) refuses the whole document —
and the author finds out through
`crates/agent/tests/faculty.rs:63-78`, which walks **every block of every faculty in
`ALL`**, both empty and filled, and on failure panics with `explain()`
(`tests/faculty.rs:37-57`): a paragraph naming the error, the reason, and the exact field
to change. **This is the single best artifact of the round.** It is the answer to §5.5's
"both surface as a failing test and never as a compile error", and it turns the red suite
into a good error.

One qualification: the walk is over `ALL`. An author who adds `mod` and a match arm but
forgets the `ALL` entry gets a working faculty with **zero** structural coverage (F4).

**6. Budget — gap 12 LANDED, and honestly.** `crates/context/src/degrade.rs:18`
`BINARY_SHARE_DIVISOR = 4`; `withhold_oversized` (`:25-49`) replaces any binary part over
`budget.max_tokens / 4` with a typed placeholder naming the media type and the cost, and
records the section in `CompactionReport.withheld` — deliberately **not** in `steps`,
because the section's own fidelity did not move (I8: no false receipts). It runs in
`gather` (`assemble.rs:97-110`) **before** any ladder. Three tests pin it
(`oversized_binary_degrades_before_any_text`, `withheld_binary_is_recorded_and_reaches_the_model`,
`withholding_is_deterministic`), all green. §6's "real, unhandled trap" is handled. A
200 KB screenshot against a 4096 budget now becomes one visible sentence instead of
shredding the conversation.

### The true extension cost, as a number

**A perception-only faculty (a block, no tools):**
2 new files (`agent/src/faculty/<name>.rs`, `adapters_web/src/<name>.rs`), 2 existing
files edited (`agent/src/faculty/mod.rs` ×3 lines; `adapters_web/src/lib.rs` — a `mod`
line and an `install_sense` call), **0 core edits**. ≈ 6 lines in existing files.

**The chrome faculty as the owner actually described it — tools that navigate:**
add a port trait (`crates/kernel`), a field on `Ports` (`crates/core/src/app.rs:27`), a
stub in `crates/adapters_test` so the workspace still compiles, a real impl in
`adapters_web`, and a `tool_entry` arm plus a handler fn in **`crates/core/src/tools.rs`**.
≈ **3 new files and 5 edited files across 4 crates, one of them the pure core.**

### F1 — HIGH. §9.5's claim is not honest for a faculty that can act.

> "TWO new files, TWO one-line registry entries, and ZERO changes to any existing logic —
> nothing in `context` …, nothing in `core`, and nothing in `agent` outside the new file
> and its registry arm."

For a block-only faculty this is close to true (F5 corrects the file count). For the
chrome faculty **the sentence in §9.5 that the owner's requirement rests on — "nothing in
`core`" — is false**, because `crates/core/src/tools.rs:107` must gain an arm and
`crates/core/src/app.rs:27` must gain a port, or `navigate` is a promise the prompt makes
and the runtime refuses.

§9.5 explicitly replaced §7's "two files" because it was overstated. The replacement is
overstated in the same direction, one layer down: §7 forgot the registry lines, §9.5
forgot that a faculty's tools have to run.

**Smallest fix — and it is small, because the shape already exists one file over.** Mirror
`senses`:

```rust
// crates/core/src/app.rs, beside `senses`
pub(crate) tool_hosts: Vec<Rc<dyn ToolHost>>,
// crates/core/src/faculty.rs
pub trait ToolHost { fn claims(&self, tool: &ToolId) -> bool;
                     fn run<'a>(&'a self, …) -> BoxFuture<'a, EventKind>; }
pub fn install_tool_host(app: &mut App, host: Rc<dyn ToolHost>);
```

…and one line at the top of `tool_entry` consulting `app.tool_hosts` before its match.
`core` then names no browser, `adapters_web` installs both halves of the faculty through
the same door, and §9.5's sentence becomes true. This is one increment and it is the
increment that finishes the seam.

### F4 — MEDIUM. The registry is three edits, and one of them is a typed length.

`crates/agent/src/faculty/mod.rs:53` — `pub const ALL: [&str; 1] = [SPACE];`. Adding a
faculty needs `mod browser;` (`:22`), the `of` arm (`:47`) **and** this array, whose length
`1` must become `2`. Worse: `tests/faculty.rs:63` iterates `FACULTIES`, so a faculty
missing from `ALL` is a faculty with no structural check at all —
`every_faculty_block_makes_a_legal_document_written_or_not` will pass while a `Dynamic`
block at slot 92 poisons every prompt of the agent that declares it. There is a test that
every `ALL` name answers `of` (`tests/faculty.rs:65-67`) but not the converse.

**Smallest fix:** `pub const ALL: &[&str] = &[SPACE];` — removes the length edit — and add
one assertion that `of` answers to nothing outside `ALL`, or better, derive `ALL` and `of`
from one array of `(name, fn)` pairs so drift is unrepresentable.

### F5 — MEDIUM. The composition-root edit is uncounted.

§9.5 lists the crates that do not change and omits `adapters_web`, which is precisely
where the change is: a `mod` line and an `install_sense` call in
`crates/adapters_web/src/lib.rs` (the `spawn`/boot region around `:129`). Not a defect in
the design — a defect in the sentence, and the sentence exists specifically to be the
honest count. **Fix:** say "two new files, three registry lines in `agent`, and one
installation line at the composition root".

---

## Q3. Is spawn-an-agent the smaller option, or the more impressive one?

**It is genuinely the smaller option, and its observability claim is verified fact. Its
central justification is false as built.**

**`write_agent` really did already ship, and §10.1 is accurate.**
`crates/core/src/agents/roster.rs:98` `write_agent` appends the `AUTHORED` fact;
`reconcile` (`:24-60`) re-parses built-ins + fetched files + authored files through
`agent::load_agents`, diffs the roster, writes board rows, and re-adopts this agent's own
spec. Every validation named in §10.1 is there: `usable_agent_name` (`:109`),
`parse_agent_file` and `unresolved_tools` inside `load_agents`, `app.agent_problems`
(`:45`). Building a second config-authoring path would indeed have been the
`Faculty`-versus-`space:` failure one increment over. The ruling's premise is sound.

**`spawn_agent` really is small.** The whole of it: one `Tool::new` in
`crates/agent/src/tools.rs:166-176`, one `pub(crate) const` at `:182`, one condition in
`invoke_or_refuse` (`subagent.rs:162`), and `delegated` (`subagent.rs:180-197`) — 18 lines
— which reads `agent` and `goal` out of the JSON and returns the **existing**
`Effect::Delegate`. No new `Effect` variant, no new port, no new error type, no new parse
path. §10.2's "measurably smaller" is true.

**The observability claim (§10.3) — all five facts verified line by line in
`crates/core/src/batch.rs`:**

| Claim | Verified at |
|---|---|
| `UserMessage { text: goal, agent, from }` in the callee's history, attributed to the caller | `batch.rs:86-90` (`from: asked_by`, taken from `app.me()` at `:85`) |
| runs on the callee's own Worker via `run_on` and records `ModelReplied` there | `batch.rs:31-42` (`ports.agents.delegate`), `:46-49` |
| board row Working → Idle | `batch.rs:39` (`Working`), `:50-54` (`Idle`, because `asked_by_person: false` at `:91`) |
| Failed WITH THE MESSAGE | `batch.rs:65-81` `refused`, `set_status(…, Status::Failed, &said)` at `:75` |
| `ToolInvoked { tool: <agent name>, args: goal, ok, output }` | `batch.rs:95-100` |

All five, for free, inherited. §10.3 is the strongest argument in §10 and it is honest.

### F2 — HIGH (doc half already fixed mid-review; CODE half stands). "Author a new role, then start it" does not work in one turn, and the product still says two different things about it.

**Fairness note, and it matters.** This finding was written against §10.2's original
parenthetical — *"'Already exists' includes one `write_agent` created ten milliseconds
earlier in the same turn"*. **The lead self-corrected that WHILE this review was running.**
`docs/ARCH-COMPONENTS.md` now carries **§10.2b CORRECTION — the composition spans TWO
TURNS, not one**, which traces `reconcile`'s early return and `drive`'s call site exactly
as this review did, states the honest "Turn 1 write, Turn 2 spawn", argues correctly that
the deferral is a safety property rather than a defect, and names the multi-turn cost.
That is the right response and it is credited as such. **The document half of F2 is
closed.** What follows is the half that is still in the tree.

Traced:

1. `write_agent` (`roster.rs:98`) only **appends the `AUTHORED` fact**. It installs
   nothing.
2. `reconcile` is called **once, after the `drive` loop has drained**
   (`crates/core/src/runtime/mod.rs:76`), and returns immediately if
   `app.agent.task.is_some()` (`roster.rs:26`) — which is exactly the span from the
   utterance that starts a turn to the answer that ends it. It also returns early if an
   unconsumed `UserMessage` for this agent is pending (`accepted`, `:67-72`).
3. The callee's **Worker** is started later still, by
   `WebApp::sync_workers` (`crates/adapters_web/src/roster.rs:24-42`), documented as
   "called after every seam round-trip".
4. So when `spawn_agent` fires mid-turn, `AgentWorkers.live`
   (`crates/adapters_web/src/workers.rs:170`) has no entry for the new name →
   `DelegateError::Unknown` (`:172`) → `refused` (`batch.rs:65-69`) → the model is told
   **"No agent called '<name>' is loaded in this browser."**

**User-visible behaviour:** a model that follows the tool descriptions writes an agent,
spawns it in the same reply, and is told the agent it just created does not exist. It has
no way to read that as "wait one turn" — the message asserts the opposite. It will most
likely re-call `write_agent`, and the round-trip counter in `max_rounds` runs out.

Worse, the tree contradicts itself about this **in two strings a model reads**:

- `crates/agent/src/tools.rs:157` — `write_agent`'s description: *"Create or replace an
  agent in this browser: **it is installed immediately**, gets its own Worker…"*
- `crates/core/src/agents/roster.rs:137` — `write_agent`'s own success message:
  *"It is installed in this browser **as soon as this turn ends**…"*

One of those is wrong, and it is the one in the tool description — the field CRITIQUE
history already flagged as "the worst place in the product to be out of date", in a doc
comment eleven lines above the offending string (`tools.rs:143-146`).

There is also **no test for the composition**. `crates/agent/tests/faculty.rs:175-187`
exercises `spawn_agent` in the pure `agent` crate, where `delegated` accepts any name
because nothing resolves it. Nothing in `crates/core/tests/` covers write-then-spawn.

**What this does to the ruling.** Nothing — (b) is still smaller, still inherits
observability, still avoids a second config format, and §10.2b's argument that the
deferral is the very safety property option (a) would have to defeat is correct and makes
the ruling stronger. **The ruling stands.** What does not stand is the tree.

**§10.4 was not updated with §10.2b and now contradicts it.** `docs/ARCH-COMPONENTS.md`
§10.4 still reads: *"`tools: [spawn_agent]` — the capability to hand a goal to any loaded
agent, **including one written this turn**."* That is the retracted sentence surviving in
a second place, six paragraphs after its own correction.

**Smallest fixes, in order of value — all three still open:**
1. `crates/agent/src/tools.rs:157` — change "it is installed immediately" to "it starts
   being callable at the end of this turn". One string, and it is the one a MODEL reads;
   §10.2b's point 2 cites `write_agent`'s *success message* as already telling the truth,
   but the *tool description* the model plans from still says the opposite, and the
   description is read first and every turn.
2. `crates/core/src/batch.rs:67-69` — when `DelegateError::Unknown` names an agent that IS
   in `app.authored` (or in the `AUTHORED` facts of this turn), say
   *"'<name>' was written this turn and starts at the end of it — ask again next turn"*
   instead of "no agent called '<name>' is loaded". §10.2b calls the failure "honest and
   recoverable"; it is recoverable, but the words are not honest — they assert the agent
   does not exist, which is the one thing that would stop a model waiting and retrying.
   A `Failed` board row is also written at `batch.rs:75` for a name the board never
   registered; suppress it for that case.
3. `docs/ARCH-COMPONENTS.md` §10.4 — delete "including one written this turn", and add a
   test for the composition. Nothing in `crates/core/tests/` covers write-then-spawn, and
   §10.2b's "Turn 1 / Turn 2" claim is now a documented behaviour with no test behind it.

### The capability question (§10.4) — sufficient, with one caveat

`spawn_agent` is an ordinary built-in: `tests/faculty.rs:215-223` proves
`tools: [now]` refuses it with "Tool not found", and `tests/space.rs:158-165` pins that an
empty list takes it along with every other built-in. That is the ADR-006 rule applied
unchanged, and it is sufficient — the widening is "may hand a goal to any loaded agent",
granted by a file that names the tool, and the callee still runs with **its own** toolbox
(ADR-038's rule: no parent∩child narrowing, and none is introduced here).

§10.4's recorded-and-unfixed defect is real: `resolve` (`subagent.rs:62-65`) reaches
`allowlisted` — the only place peers are added (`:86-87`) — only when `tools:` is
non-empty, so `tools: []` means every built-in and no peers. Correctly identified,
correctly left as a user gate.

### F8 — LOW. Nothing in the shipped tree can call it.

`public/agents/main/agent.md:27-47` grants neither `write_agent` nor `spawn_agent`.
Default-deny working as designed, but it means §10.3's "answerable today" requires the
owner to edit an agent file first, and `crates/agent/tests/live.rs` does not cover it.
§10 should say so in one sentence rather than implying the workflow is observable
out of the box.

---

## Honesty of the docs

**§9 and §10 are substantially honest and better-evidenced than §5 was.** §9.1's three-wall
table is correct. §9.4's ruling that the floor is *unrepresentable* rather than declared
data is right, better than what §5.5 asked for, and matches the code —
`Sensed::floor` returns `Fidelity::Elided` unconditionally (`sensed.rs:73-75`) and `Block`
has no floor field (`sensed.rs:26-41`). §9.2's byte-identity acceptance criterion was set
in advance and met. §10.1 and §10.3 are verified fact.

Sentences that are **not** true of the tree:

- **§9.5, "nothing in `core`"** — false for a faculty with tools (F1). This is the
  sentence the owner's requirement is being certified against.
- **§9.5, "TWO new files, TWO one-line registry entries"** — three registry lines, and the
  composition-root line is uncounted (F4, F5).
- **§10.2's original "ten milliseconds earlier in the same turn"** — false, and
  **retracted by the lead mid-review** in §10.2b, correctly and with the tree cited. But
  **§10.4 still says "including one written this turn"** — the retracted claim surviving in
  a second place in the same document (F2).
- **§9.2, "the first entry in the `Sense` list"** for the space refresher — true of
  `installed_by_default`, but the space still gets a *second*, unconditional host call at
  `runtime/mod.rs:58` that no other faculty has. Honest to say so; §9.2's table implies one
  mechanism where there are two (one of which is legitimately about tool state, not the
  prompt).
- **`crates/agent/src/paper/adopt.rs:60-64`** — a doc comment stating a condition that has
  since been met, describing code that did not change (F3).

### F10 — LOW. §9.2's `path:line`s are exact against its baseline and wrong at HEAD.

The lead's verification claim checks out. Verified with `git show ca59db1:<path>`:
`subagent.rs:74` = `fn with_the_space` ✓, `components/mod.rs:71` = `Box::new(SharedSpace {`
✓, `runtime/mod.rs:49` = `crate::space::shared::refresh(&app).await;` ✓. All three now
point at unrelated lines because the round landed on top of them, and `with_the_space` no
longer exists anywhere. §10.4's `subagent.rs:56` points at the `ENGINE_BASE` guard; the
rule it describes is at `:62-65`. **Fix:** the "at `ca59db1`" caveat is stated once at the
top of §9 — repeat it on the "becomes" table, or drop the line numbers from rows that
describe code the round deleted.

### Doc-comment path citations — the verification verifies

Every `crates/…rs:N` citation in every file this round created or changed was resolved by
opening the target. **All ten resolve to the right definition:**

```
components/sensed.rs:69  -> context/src/assemble.rs:110   0 => Fidelity::Elided,
components/sensed.rs:81  -> context/src/component.rs:149  produced_at: match self.cacheable() {
components/space.rs:50   -> context/src/assemble.rs:110   0 => Fidelity::Elided,
faculty/mod.rs:6         -> core/src/tools.rs:107         pub(crate) fn tool_entry(…)
faculty/mod.rs:7         -> core/src/dispatch.rs:42       pub fn builtin_entry(…)
faculty/mod.rs:69        -> context/src/law.rs:45         if seen.contains(&&s.id) {
core/src/faculty.rs:7    -> agent/src/faculty/mod.rs:45   pub fn of(name: &str) -> Option<Faculty>
core/src/faculty.rs:9    -> agent/src/components/sensed.rs:47  pub struct Sensed {
core/src/faculty.rs:104  -> core/src/batch.rs:135         async fn single(…)
core/src/space/sense.rs:37 -> agent/src/components/space.rs:52 pub fn space_parts(…)
```

CRITIQUE-02's F1 (13 broken citations) has not recurred in the new work. Credit where
due — this is the one thing a bar-raiser can check mechanically, and it came back clean.

---

## Dead code

### F6 — LOW. A doc comment naming a component that is no longer one.

`crates/agent/src/components/world.rs:11-13` still reads: *"The shared space is NOT in
here; it is its own block at its own slot (`SharedSpace`, `Slot::SPACE`)…"*. `SharedSpace`
is no longer a `Component` and names no block; the block is
`crates/agent/src/faculty/space.rs:28` `BLOCK`. The claim it makes (space is its own
section) is still true; the citation is dead. **Fix:** cite `faculty::space::BLOCK`.

### F7 — LOW. `SharedSpace` is a free function wearing a struct.

`crates/agent/src/components/space.rs:33-43`: a one-field struct whose only method is
`text()`, called by `space_parts` (`:53`) and by `tests/space.rs:11,245`. The
justification at `:30-31` — "kept as a NAMED VIEW … the one place that asks what was the
model actually shown about this space" — is a real question, but the answer is
`space_parts`, which is already public and already the thing the host calls. Keeping the
type means the crate exports two names for one rendering (`crates/agent/src/lib.rs:56`
exports both). Not harmful; it is the sort of retained-for-one-caller shape CRITIQUE-01
objected to. **Fix (optional):** delete the struct, keep `lines`, have `tests/space.rs`
call `space_parts`.

### F9 — LOW / pre-existing. `cargo fmt --all --check` fails repo-wide.

Hundreds of sites across `adapters_test`, `adapters_web`, `ui`, `core` — files this round
never touched. **Not this round's doing**, flagged only because the publish gate is
documented as clippy + `fmt --check`. Note that `crates/agent/src/state.rs` was
reformatted this round into `#[serde(default)] pub x: T,` one-liners
(`state.rs:36-146`) — a density choice that buys the file room under the 200-line rule
(it is 193) and that rustfmt will never produce. It reads fine and the trade is defensible;
it does mean the file is permanently un-rustfmt-able, which should be a conscious ruling
rather than a side effect.

---

## What is genuinely good

1. **`crates/agent/tests/faculty.rs:37-78`.** A registry walk that checks every block of
   every faculty in both states, and an `explain()` that turns each of the three
   reachable failures into a paragraph naming the field to change. §5.5 argued the
   slot/stability/floor constraints "surface as a failing test and never as a compile
   error"; this makes the failing test better than a compile error would have been.
   Every future faculty author is bought an afternoon.
2. **§9.4's correction of §5.5.** Recognising that the floor is not an authorial choice
   at all, deleting the field, and making `Sensed::floor` unconditional is a better answer
   than the one §5 asked for. "Unrepresentable beats checked" — and it was applied
   *against* the document's own earlier reasoning.
3. **`refresh_all` clears before it writes** (`core/src/faculty.rs:88-93`). A sense that
   comes back empty leaves the prompt saying nothing rather than last turn's snapshot.
   Stale perception is the one failure worse than absent perception, and it was
   anticipated rather than discovered.
4. **`senses` is on `App`, not on `Ports`.** `app.rs:59-64` gets the composed-in-not-
   required distinction exactly right, and the doc comment states why. This is the
   pattern the tool half still needs (F1) — the round already knows the answer, it just
   applied it once.
5. **Gap 12 landed properly.** Withholding runs before the ladder, is recorded in
   `withheld` and deliberately *not* in `steps` so the receipt does not lie, and is pinned
   by three tests including a determinism one. A trap the document had flagged as
   unhandled for two rounds is closed.
6. **The byte-identity proof is an unchanged file, not an assertion.** `tests/prompt.rs`
   not appearing in `git diff --name-only` while `SharedSpace` left `dynamic()` is worth
   more than any paragraph.
7. **`seed()` stopped reserving a space block** (`components/mod.rs:100-104`), and
   `tests/step.rs` was updated to assert the section is now *absent* rather than *empty*
   — with a comment explaining that the bytes are identical either way. The honest
   version of that change was harder to write than the dishonest one.
8. **`spawn_agent`'s refusals.** Three malformed shapes, each answered with a recorded
   `ToolInvoked { ok: false }` naming the exact call shape
   (`subagent.rs:186-196`, `tests/faculty.rs:193-209`). A refusal a model can act on.
9. **`Slot` as an open newtype** with gaps of ten and a module doc that names the browser
   faculty as the reason (`slot.rs:12-18`). The pure core was opened up for an extension
   that has not been written yet, correctly, and without opening the laws.

---

## VERDICT

**GO on the prompt-side component requirement. NO-GO on §9.5's file-count claim, which
must be corrected before §9 is treated as the design record. §10's same-turn claim was
already withdrawn by the lead mid-review (§10.2b) and is not held against the ruling —
but the three places in the tree that still assert it are open defects.**

### What this certifies

- Everything that goes into the LLM prompt call **is** a component, and a new one is added
  by declaring a faculty in an agent file. Verified end to end for `space`, which was
  migrated onto the seam with a byte-identical prompt.
- The core is abstract with respect to **perception**: `Sense` is a port, `install_sense`
  is the composition root's door, `core` names no browser, and an unknown faculty or an
  uninstalled sense degrades to nothing without ending a turn (I15).
- The chrome agent's "latest page snapshot, always included by default" is reachable by
  configuration alone, at the slot the faculty declares, refreshed before every model call,
  cleared when the host has nothing — with a structural check that fails loudly and
  explains itself if the block is declared wrong.
- The allowlist rule survives the widening (I6, ADR-006): a faculty makes tools available
  to name and grants nothing.
- `spawn_agent` is the smaller of the two options, is subject to the ordinary allowlist,
  and inherits all five observability facts §10.3 claims.
- All four gates are green, and the doc-comment `path:line` citations in the new work are
  clean.

### What this does NOT certify

- **That a chrome agent could act.** `crates/core/src/tools.rs:107` `tool_entry` is a
  closed match in the pure core and `crates/core/src/app.rs:27` `Ports` is a closed
  struct. A faculty's tools are declared, listed in the affordances, and then refused
  with "Tool not found" on every call. The seam covers half the owner's sentence. F1 is
  the increment that finishes it, and it is small because the round already built the
  right shape for senses.
- **That "author a new role, then start it" works as the tree tells a model it does.**
  It takes two turns — which §10.2b now states correctly and defends well — but
  `tools.rs:157` still promises "installed immediately", `batch.rs:67-69` still answers
  "No agent called 'X' is loaded", §10.4 still says "including one written this turn", and
  nothing tests the two-turn path (F2).
- **That the space faculty is free of special cases.** `paper/adopt.rs:65-70` still seeds
  one named faculty's senses from a pure crate, its own comment says it should have gone
  this round, and the seam's byte-identity proof depends on it (F3).
- **That §9.5's numbers can be quoted.** The honest counts are in this document; §9.5's
  are not (F1, F4, F5).
- **Anything about the browser.** No faculty that reaches a browser exists, nothing was
  run in one, and CLAUDE.md §17 correctly keeps it a user gate. The design is judged here;
  the capability is not shipped and must not be.

### Ordered remediation

| # | Finding | Severity | Cost |
|---|---|---|---|
| 1 | F2 — fix `tools.rs:157`'s "installed immediately"; make the Unknown-agent refusal name the turn boundary; delete §10.4's surviving "written this turn"; test the composition | HIGH | 2 strings, 1 branch, 1 test |
| 2 | F1 — `ToolHost` port + `install_tool_host` + one line in `tool_entry`; correct §9.5 | HIGH | one increment |
| 3 | F3 — delete `adopt_faculties`' space arm; let `tests/prompt.rs` play the host | MEDIUM | ~4 lines |
| 4 | F4 — `ALL: &[&str]`; one test that `of` answers nothing outside it | MEDIUM | 2 lines |
| 5 | F5 — correct §9.5's count to include the composition-root line | MEDIUM | one sentence |
| 6 | F6, F7, F10 — stale citation in `world.rs:11`; `SharedSpace` as a named view; §9.2's baseline numbers | LOW | cosmetic |
| 7 | F8 — say in §10 that no shipped agent grants `spawn_agent` | LOW | one sentence |
