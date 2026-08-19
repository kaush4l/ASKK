# ARCH-COMPONENTS — the standard for everything that reaches a model

Status: PROPOSAL, increment 1. Written by the architecture lead. No code changed.
Ground truth is cited as `path:line` throughout; every claim about today's behaviour
was read, not remembered.

The owner's requirement: *everything that goes into the LLM prompt call is a
component; the architecture must be uniform and simple; adding a new component must
be a declaration; the core must be abstract and every agent must be configuration.*

The verdict up front: **the component contract itself is good and should barely
change. The attachment story does not exist.** A component today can only be one of
twelve hardcoded types in one hardcoded vector in a core crate. A chrome-use agent
cannot add a page-snapshot block without editing three files in two core crates.
That is the gap this document is written to close, and §5 is the section that
matters.

---

## 1. What a component IS

### 1.1 The contract as it stands

`crates/context/src/component.rs:37` — thirteen methods today, three of them required.
The last row is the one this document adds.

| Method | Line | Callers today | Verdict |
|---|---|---|---|
| `id()` | `component.rs:39` | `paper::find` (`paper.rs:22`), `section()` | **keep** — the address |
| `slot()` | `component.rs:42` | `section()` → `assemble` sorts on it (`assemble.rs:109`) | **keep** — the ordering |
| `render()` | `component.rs:49` | `section()`, `key()` | **keep** — the toString |
| `intent()` | `component.rs:77` | `section()`; `validate` rejects empty (`law.rs:21`) | **keep** — the anti-accretion rule |
| `stability()` | `component.rs:86` | `section()` only | **keep** — `law::interleaved` (`law.rs:63`) enforces it |
| `floor()` | `component.rs:92` | `section()` only | **keep** — the degradation ladder binds on it |
| `budget_priority()` | `component.rs:97` | `section()` only | **keep** — `assemble.rs:122` degrades on it |
| `cacheable()` | `component.rs:103` | `section()` → `produced_at` | **keep, narrowly** — see 1.3 |
| `key()` | `component.rs:118` | `section()` → `provenance.input_hash` | **keep** |
| `section()` | `component.rs:129` | `components::source` (`mod.rs:39`) | **keep** — the inherited conversion |
| `priority()` | `component.rs:80` | **none** | **DELETE** |
| `applies()` | `component.rs:109` | **none** | **DELETE** |
| `forms()` | `component.rs:57` | one assertion in `respond.rs:109`, `respond.rs:131` | **keep, WIRE IT** — §4 |
| `render_in()` | `component.rs:69` | `contract.rs:107`, `contract.rs:113` — i.e. `ResponseContract` calling itself | **keep, WIRE IT** — §4 |
| `notation()` | — | new, §4.2 | **ADD** — the intersection rule that makes `forms()` load-bearing |

Two methods do not earn their place, and two earn it but are not connected to
anything. Being blunt about each:

- **`priority()`** — declared "tiebreak within one slot", and `assemble` deliberately
  refuses to use it: `assemble.rs:105-108` says the sort is stable and is *"deliberately
  NOT tie-broken on `Section::priority`"*. A tiebreak nobody breaks ties with. Two
  components sharing a slot keep insertion order, which is a real and sufficient answer.
  Delete it. If a genuine same-slot ordering need appears, the slot numbers have gaps
  of ten (`slot.rs:15`) — use one.
- **`applies()`** — zero callers. Its own doc comment (`component.rs:107`) admits the
  assembler drops empty renders anyway (`assemble.rs:97`), so it is "an optimisation,
  not the guarantee". It is an optimisation nobody invokes. `Soul::applies`
  (`soul.rs:47`) and `Directive::applies` (`directive.rs:63`) are overridden and dead.
  Delete.

`forms()` and `render_in()` are a different case and must not be swept in with these
two. They have no assembly-level caller today, which makes them *decoration* — but the
remedy is to give them their caller, not to delete the capability. See §4; the fix is
four small pieces of wiring and no new subsystem.

That leaves **eleven methods, three of them required**. `id`, `slot`, `render` are what
an author must write; the other eight are declarations with defaults. That is the right
shape and it should be defended against growth.

### 1.2 What a component may NOT do

These are the rules that make the contract worth having. None is currently written
down anywhere, and two are currently violated.

1. **A component may not perform I/O.** It renders from fields it already holds.
   `context` is a pure crate (I3); `render()` has no `async`, no port, no clock.
2. **A component may not read a clock.** Time arrives as `Timestamp` at `section(at)`
   and only for provenance. `Environment` renders text that `now::environment`
   (`now.rs:51`) already built from an injected timestamp — correct.
3. **A component may not know about another component.** No component may name
   another's id, slot or content. `ResponseContract::tool_envelope`
   (`contract.rs:65`) currently names `## affordances` in its prose. That is a
   deliberate, documented coupling (`contract.rs:60-64`) and it is the one exception —
   record it as such rather than pretend it is not there.
4. **A component may not hold state between turns.** It is a value rebuilt from live
   state each call (`component.rs:14-17`). This is what makes `key()` honest.
5. **A component may not decide whether it is included.** Inclusion is the agent's
   configuration (§5); position is the slot; emptiness is `Fidelity::Elided`.
6. **A component may not build the frame.** `## {id}\n({intent})` is `render.rs:87`'s
   job, once, for everyone. A component that writes its own heading has broken the
   uniformity the whole design buys.

**Currently violated:** rule 3 (documented exception above), and more seriously —

7. **No text may reach the model except through a component's `render()`.** I13 says
   *"no ad-hoc string building anywhere"*. `now::environment` (`now.rs:51-67`)
   concatenates a clock block with `Space::context()` (`space.rs:72-94`), which itself
   builds `"space: …\nworkspace: …\nshared facts:…\nrecent notes:…"` with `push_str`.
   That is 22 lines of ad-hoc prompt string in a file that is not a component, handed
   to `Environment { text }` as an opaque blob (`ask.rs:67`). I13 is satisfied on a
   technicality — the string does end up inside a `Part` — and defeated in substance.
   The space is a *kind*, not a paragraph in the environment. §2 gives it its own slot.

### 1.3 One honest note on `cacheable()`

It has exactly one effect: `produced_at` becomes `Timestamp(0)` or the real time
(`component.rs:148`). It does not gate any cache, because no prompt cache exists yet.
It is doing one real job — keeping the byte-stable prefix byte-stable across boots —
and one aspirational one. Keep it; do not grow it into a caching subsystem until
there is a cache.

---

## 2. The taxonomy

Twelve components exist (`components/mod.rs:55-68`). The owner named ten kinds. They
do not line up. Here is the complete set as it should be, with today's state marked.

| # | Kind | Slot | Stability | Floor | Data it carries | Owner (who writes it) | Rendered | State today |
|---|---|---|---|---|---|---|---|---|
| 1 | `soul` | Soul 0 | Static | Summarized | The agent file's markdown body, verbatim | `adopt_spec` (`paper.rs:112`) | once, at adoption | SHIPPED `soul.rs:10` |
| 2 | `identity` | Identity 10 | Static | Pointer | name + one-line role | `adopt_spec` (`paper.rs:113`) | once | SHIPPED `soul.rs:85` |
| 3 | `operating_rules` | OperatingRules 20 | Static | Summarized | The house's standing rules — a constant | nobody; it is a unit struct | never rebuilt | SHIPPED `soul.rs:124` |
| 4 | `affordances` | Affordances 30 | SemiStatic | Pointer | one `name(args): description` line per granted tool | `ask::call_model` (`ask.rs:61`) from the scoped toolbox | **per call** | SHIPPED `affordances.rs:14` |
| 5 | `user` | User 40 | SemiStatic | Pointer | durable facts about the person | **nobody** | per call in theory | SHIPPED, **DEAD** — grep finds no writer; every prompt carries `"No durable user facts recorded yet."` (`person.rs:37`) |
| 6 | `memory` | Memory 50 | SemiStatic | Elided | dated retained knowledge | **nobody** | — | SHIPPED, **DEAD** — `person.rs:74` |
| 7 | **`space`** | **Space 55 (new)** | SemiStatic | **Elided** | workspace path, shared facts, notes | `core::space::refresh` (`core/src/space.rs:62`) → `AgentState.space` | per call | **MISSING** — smuggled into `environment` as a string (`now.rs:63`) |
| 8 | `environment` | Environment 60 | Dynamic | Elided | clock, day, device — and nothing else | `ask::call_model` (`ask.rs:66`) | **per call, uncacheable** | SHIPPED `world.rs:13`, currently overloaded |
| 9 | **`artifacts`** | **Artifacts 65 (new)** | Dynamic | **Elided** | latest state of named work products (a file being drafted, a plan, a diff) | a faculty (§5) | per call | **MISSING ENTIRELY** |
| 10 | `task` | Task 70 | Dynamic | Summarized | what is being attempted | `step` on `UserMessage` (`step.rs:58`) | per turn | SHIPPED `world.rs:52` |
| 11 | `history` | History 80 | Dynamic | Pointer | the transcript, one `Part` per entry | `paper::push_history` (`paper.rs:41`), `window::compacted` | appended | SHIPPED `history.rs:23` |
| 12 | **`skills`** | **Skills 85 (new)** | Dynamic | Elided | the body of every skill read this turn | `skills::effect` result | per call | **MISSING** — a read skill lands in `observations`+`history` and is compacted away like a tool result (`step.rs:151`) |
| 13 | `observations` | Observations 90 | Volatile | Elided | the last actions' results | `step::on_tool_result` (`step.rs:152`) | per result | SHIPPED `world.rs:89` |
| 14 | **`perception`** | **Perception 92 (new)** | Volatile | Elided | a faculty's fresh snapshot of the outside — the chrome page tree, a screenshot's description, a camera frame | a faculty (§5) | **per call, uncacheable** | **MISSING** — this is §5's test case |
| 15 | `directive` | Directive 95 | Volatile | Elided | this stage's instruction | `stages::enter` (`stages.rs:86`), `answer.rs:57` | per stage | SHIPPED `directive.rs:28` |
| 16 | `response_contract` | Response 99 | Static | **Full** | the exact reply shape | `ask::call_model` (`ask.rs:62`) | per call | SHIPPED `contract.rs:27` |

Notes on the disagreements:

- **`user` and `memory` are dead weight and should be deleted, not filled.** Two
  components in every single prompt whose entire content is an apology for being
  empty. They were seeded (`mod.rs:60-61`) against a future that has not arrived.
  "Prefer deleting a concept over adding one": delete both. When personal memory is
  actually built it will be a faculty (§5) and it will arrive with a writer.
- **`space` must leave `environment`.** They have different stabilities (a peer's
  note is SemiStatic; the clock is uncacheable Dynamic), different owners
  (`core::space::refresh` vs `now::environment`), and different floors. Fusing them
  means the clock's uncacheability infects the space and the space's bulk rides in a
  block the budget is told is small. It also forces the I13 violation in 1.2.
- **`skills` needs a slot because of compaction, not tidiness.** A skill body read at
  round 2 of a 40-round project run is currently a `Result:` line in `history`
  (`step.rs:151`), and `history` has `budget_priority: 9` (`history.rs:61`) — the
  first thing the budget eats. The agent forgets its own house rules mid-task. A
  `skills` component at Dynamic/Elided with a low budget priority survives.
- **`artifacts` is the owner's word and there is nothing behind it.** It is not
  optional for the Hermes/Eliza bar: "the file I am drafting, as it stands right now"
  is the single highest-value dynamic block a coding agent can carry, and re-reading
  it via `read_file` every round is what the budget is being spent on instead.

**Concepts the taxonomy does not need, and which should go:**

- `PhaseConfig::sections: Vec<(SectionId, Fidelity)>` (`phase.rs:81`, populated at
  `phase.rs:100-112`). **Zero readers.** A phase declares eleven section ids and a
  fidelity for each and nothing anywhere consults it. It is also now *wrong* — it
  lists eleven names and the paper has twelve (`directive` is absent). Delete the field.
- `PhaseId::Verify` / the whole second `PhaseConfig` (`phase.rs:134`) is documented as
  *"configured but unreachable"* (`phase.rs:133`). The stage machine (`stages.rs`)
  superseded it. Out of scope for this document, but it is the same disease.
- `Fidelity::Pointer` has one production consumer (`assemble.rs:42`) and reads
  `"[section 'x': N part(s) available; ask for them]"` — a promise no tool can honour,
  because no tool restores a section. Either build the restore tool or drop the level.

---

## 3. Ordering

**`Slot` is the right idea and the wrong type.**

The idea is right and was hard won. `slot.rs:4-10` records the accident it ended:
order used to be `sort_by_key(stability)`, so the response contract rendered fourth.
Two questions, two types. `assemble.rs:109` sorts on slot and nothing else.
`law::ends` (`law.rs:76`) checks the pinned head and tail structurally rather than by
naming a type. That is exactly Python's "ordering is structural, not conventional",
and it works — `tests/paper.rs:173` proves soul first and contract last.

The type is wrong. `Slot` is a closed `enum` in a core crate (`slot.rs:25-53`). Adding
a kind — `space`, `artifacts`, `perception` — means editing `crates/context/src/slot.rs`.
That is precisely the thing §5 must make impossible: a browser faculty cannot ship a
component without a core-crate patch. The gaps of ten (`slot.rs:15`) are headroom the
enum cannot actually use without recompiling the world.

**It should be a newtype over `u8` with named constants:**

```rust
pub struct Slot(pub u8);
impl Slot {
    pub const SOUL: Slot = Slot(0);
    pub const IDENTITY: Slot = Slot(10);
    // …
    pub const RESPONSE: Slot = Slot(99);
}
```

`Ord`, `Serialize`, `is_head()`, `is_tail()` all survive verbatim. Every existing
`Slot::Soul` becomes `Slot::SOUL`. A faculty then declares `Slot(92)` for its
perception block without touching `context`. The pinned ends stay pinned because
`is_head`/`is_tail` are value predicates, and `law::ends` (`law.rs:76`) keeps
enforcing exactly-one-tail — a faculty that tries to claim 99 fails validation loudly
rather than silently displacing the contract.

Cost of the openness: two components could collide on one number. `assemble`'s stable
sort already answers that (insertion order wins) and `validate` already refuses
duplicate ids (`law.rs:46`). Acceptable.

---

## 4. The conversion contract — the `Form` layer

*"Defining the way of what and how the data is converted into input format best
understood by the LLM."*

This is the question `Form` was introduced to answer (`form.rs`, `UPGRADE-STRATEGY.md`
§1). **It does not currently answer it, because nothing chooses a form.**

Trace it: `assemble` reads `State.sources` (`assemble.rs:93`), which hold `Section`s
built by `components::source` (`mod.rs:39`) from `Component::section()`
(`component.rs:129`), whose last line is `parts: self.render()` (`component.rs:153`).
`render()`, not `render_in(form)`. There is no path from any caller to a `Form`. The
only live `render_in` calls are `ResponseContract` dispatching to its own
`ResponseObject` (`contract.rs:113` → `respond.rs:40`). `forms()` is asserted on in
one unit test (`respond.rs:109`) and read nowhere else.

So the second notation is real machinery serving one component's internal branch,
dressed as a trait-wide capability. That is speculative generality with one caller,
and the rule says say so.

**Is Markdown/Json the right axis? Yes — and there are two axes, not one.** They are
easy to confuse and the current code confuses them.

- **Axis 1: the shape of a block, chosen by the component.** A tool block wants call
  signatures (`affordances.rs:80`), a transcript wants tagged turns (`history.rs:66`),
  a fact list wants `- k: v` (`person.rs:82`), a page snapshot wants an indexed
  accessibility tree. These are already different and already implemented, inside each
  `render()`. Nothing is missing here.
- **Axis 2: the notation a block is written in, requested by the caller.** The same
  object, written down two ways. `respond.rs:11-18` states the real case exactly: a
  local 12B follows a `ROUTE:` line nearly always and emits valid JSON only mostly,
  with silent failures; a provider that can constrain generation to a schema reverses
  the argument. `ResponseObject::lines()` (`respond.rs:51`) and `::json()`
  (`respond.rs:69`) are both written, both correct, and one of them is unreachable.

`forms()` is the honest half of axis 2 and should stay exactly as it is: it is a
component's statement of what it can *actually* do, and `respond.rs` already models
the two cases correctly — a shaped contract declares `BOTH` (`respond.rs:85`,
asserted at `respond.rs:109`), and a prose contract declares one form and means it
(`contract.rs:117-122`), because asked for JSON a paragraph is still a paragraph.

**What is missing is the chooser.** A request that nobody issues is not an axis.

### 4.1 Where the chooser belongs

`ask::call_model` — `crates/agent/src/ask.rs:55-82`.

It is the only site in the codebase that holds both halves at once: it constructs the
`ProviderFormat` (`ask.rs:73-76`) and the `Document` (`ask.rs:71`) in the same
function, four lines apart. Nowhere else knows the endpoint and the paper together.

It is *not* `render` (`render.rs:67`), even though `render` also switches on
`ProviderFormat`. By then the parts are already bytes; `render`'s job is to decide
whether this wire can carry a part (`render.rs:97-146`), not what the part should
have said. And it is not `assemble`, which must stay a pure ordering-and-budget
function with no provider concept in it at all (`assemble.rs:1-2`, I14).

### 4.2 The wiring, in four small pieces

1. **`Component::notation(&self, wanted: Form) -> Form`** — a provided method, default:
   return `wanted` if `self.forms()` contains it, else `self.forms()[0]`. This is the
   whole intersection rule, in one place, and it is what makes `forms()` load-bearing
   instead of decorative: a component that cannot honour a request says so by omission
   and the request is quietly and correctly ignored.
2. **`Component::section(&self, at, form)`** — the one line that is currently the bug.
   `component.rs:153` reads `parts: self.render()`; it becomes
   `parts: self.render_in(self.notation(form))`. `render()` keeps its meaning as
   `render_in(Form::DEFAULT)` and stays the required method authors implement.
3. **`context::State.form: Form`** (`state.rs:25`, `#[serde(default)]` so stored papers
   still load). The paper declares the notation it is being written in; `seed()`
   (`components/mod.rs:52`) sets `Form::DEFAULT`. This is what keeps the change small:
   `components::source` and `paper::set_component` read it from the paper they are
   already holding, so **none of the fourteen `set_component` call sites change.**
4. **`Form::for_target(ProviderFormat) -> Form`** in `form.rs`, and one assignment in
   `ask::call_model` before the dynamic rebuilds: `state.paper.form = Form::for_target(format)`.

Today `for_target` returns `Markdown` for `OpenAiChat` — and that is a real computed
answer, not a stub, for exactly the reason `respond.rs:11-18` gives. The Json branch
becomes reachable the moment a schema-constraining target lands, which is the same
`todo!("G5: second provider")` already sitting at `render.rs:70`.

### 4.3 What a component author implements to add a notation

> Implement `render() -> Vec<Part>` — that is the block's default shape and the only
> required method. If, and only if, the block genuinely means something different in
> another notation, add `forms()` listing what you support and `render_in(form)`
> switching on it. Declaring one form is the common and honest case
> (`component.rs:52-53`), and the default `render_in` then answers every request with
> the default rendering. The frame — `## {id}\n({intent})` — is inherited from
> `render.rs:87` and is never the author's business.

`ResponseContract` (`contract.rs:106-122`) is already the worked example of the full
version, and after this wiring it is the first component whose second notation can
actually be requested.

### 4.4 The test that proves the wire is live

Set `paper.form = Form::Json`, assemble, and assert both halves in one test:
the strategy contract (`strategy::OBJECT`, `strategy.rs:92`) renders as a JSON object,
**and** the prose contract in the same document still renders as prose. The second
assertion is the one that matters — it proves `forms()` is being consulted rather than
the form being applied blindly. That test cannot be written today, which is the
measure of the defect.

---

## 5. Attachment — the section that matters

**The chrome-use test:** an agent file declares navigation tools; before every model
call the latest page snapshot is included by default; no change to the assembler and
no change to any core crate.

### 5.1 Under the current design this is impossible. Three walls.

**Wall 1 — the paper is a closed world.** `components::seed()` (`mod.rs:52-70`) builds
a `State` with exactly twelve hardcoded `source(&T::default(), at)` calls. That vector
is the complete set of sections that can ever exist. `paper::find` (`paper.rs:22`) ends
in `.expect("seeded section exists")`, so `set_component` with an unseeded id
**panics**. Adding a thirteenth block means editing `crates/agent/src/components/mod.rs` —
a core crate.

**Wall 2 — the per-call refresh list is three literals.** `ask::call_model`
(`ask.rs:55-70`) rebuilds exactly `Affordances`, the contract, and `Environment`. That
is the entire "before every LLM call" hook, written as three consecutive statements.
A fourth thing that must be fresh has to be a fourth statement in `ask.rs`.
`UPGRADE-STRATEGY.md` §2 promised this set would be "named in one place
(`components::dynamic`)"; it was not built — the list is still three
`set_component` calls in `ask::call_model`, exactly as the plan said it should stop being.

**Wall 3 — `agent.md` cannot name a component.** `AgentSpec` (`spec.rs:45-77`) has
twelve fields. Every one is a scalar, a stage list, or `tools: Vec<String>`. There is
no key by which a file could request a block. `adopt_spec` (`paper.rs:85`) writes
exactly `soul` and `identity` from the spec and nothing else. So "every agent is
configuration" is true of *prompt text and tools* and false of *prompt structure*.

So today a chrome faculty costs: `components/chrome.rs` (new), `components/mod.rs`
(export + seed), `ask.rs` (a fourth refresh), `slot.rs` in **crates/context** (a new
slot), plus `spec.rs`/`loader.rs` if it is to be per-agent. **Five files, two crates,
one of them the pure core.** The architecture has failed the requirement.

### 5.2 The seam that makes it work

The precedent already exists in this codebase and nobody generalised it. Look at what
`space:` does today:

- a single frontmatter key (`spec.rs:61`, `main/agent.md:23`);
- naming it attaches **thirteen tools** the agent never listed — `space_tools()` +
  `workspace_tools()` (`subagent.rs:60-63`);
- an impure host refreshes live state before every pass —
  `core::space::refresh` at `core/src/runtime.rs:47`, writing `AgentState.space`
  (`core/src/space.rs:72`);
- a pure component renders that state into the prompt on every call (`ask.rs:66`).

That is exactly the chrome requirement, already working, for one hardcoded case. The
seam is: **name the pattern, and let a declaration select it.**

**A `Faculty` is a named bundle of (tools, prompt components, a host refresher).**

```rust
// crates/agent/src/faculty.rs — the declaration, pure
pub struct Faculty {
    pub name: &'static str,
    pub tools: Vec<Tool>,
    /// One per block this faculty contributes. Slot and id are the
    /// component's own, as for every other component.
    pub blocks: Vec<FacultyBlock>,
}
pub struct FacultyBlock {
    pub id: &'static str,
    pub slot: Slot,
    pub intent: &'static str,
    pub stability: Stability,
    pub floor: Fidelity,
}
```

Four moving parts, and three of them already exist:

1. **`AgentSpec.faculties: Vec<String>`** — one new frontmatter key
   (`spec.rs`). `space:` becomes `faculties: [space]` in time; it need not, today.
2. **`AgentState.senses: BTreeMap<String, Vec<Part>>`** — one new field
   (`state.rs`). This is `AgentState.space` (`state.rs:149`) generalised: the slot
   where an impure host leaves fresh data for a pure component to render. `Vec<Part>`,
   not `String`, so a screenshot is representable without a second mechanism (§6).
3. **`components::Sensed`** — ONE generic component type. It carries an id, a slot,
   an intent, and `Vec<Part>` straight from `senses`. It is the only new component
   type the whole faculty system needs, because a component's job is to render bytes
   at a position and the bytes were produced elsewhere. Every faculty block is a
   `Sensed`; none of them is a new Rust type.
4. **A refresher, in the adapter crate, keyed by faculty name.** `core::runtime::drive`
   already calls `crate::space::refresh(&app).await` unconditionally at line 47.
   That becomes a loop over the agent's declared faculties, dispatching to a table in
   `adapters_web` — the same shape as `core::tools`'s executor table
   (`core/src/tools.rs:67-76`), which is the established pattern for "declared purely,
   run impurely".

**Two enabling changes to what exists:**

- `paper::find` (`paper.rs:22`) stops `expect`ing and **upserts**: an unknown id is
  appended to `State.sources`. This is safe precisely because ordering is structural —
  `assemble.rs:109` sorts by slot, so append position is irrelevant. One line changes
  from `.expect(...)` to a `match … None => push`.
- `ask::call_model` (`ask.rs:55`) stops listing three components and instead walks
  `components::dynamic(state)` — the list `UPGRADE-STRATEGY.md` §2 already specified
  and which was never built. Affordances, contract and environment are the first three
  entries; every attached faculty block is the rest.

### 5.3 The chrome agent, end to end, under this design

```yaml
---
name: browser
faculties: [chrome]
tools: [navigate, click, type_text, read_page]
---
```

1. `parse_agent_file` reads `faculties: [chrome]` into `spec.faculties` (`spec.rs`).
2. `subagent::resolve` (`subagent.rs:44`) already concatenates tool sets from the
   space and workspace; it gains one more source — `faculty::of("chrome").tools` —
   and the allowlist filter at `subagent.rs:78-86` applies to them unchanged. The
   agent gets `navigate`, `click`, `type_text`, `read_page` and nothing else.
3. `adopt_spec` (`paper.rs:85`) seeds one `Sensed` per faculty block into
   `state.paper` — for chrome, one block: id `page`, slot `Slot(92)`, intent
   *"The page as it is right now: title, URL, and the elements you can act on."*
4. Every pass, `core::runtime::drive` calls the chrome refresher, which lives in
   `adapters_web` (the only crate allowed to touch a browser, I3), snapshots the page
   and writes `state.senses["page"] = vec![Part::Text{…}]`.
5. Every call, `ask::call_model` walks `components::dynamic(state)`, finds the `page`
   block, renders it from `senses`, and the snapshot lands at slot 92 — after the
   observations, before the directive. **Fresh, by default, without the model asking.**

**Files touched to add the chrome faculty after the seam exists:**
`crates/agent/src/faculty/chrome.rs` (the declaration) and
`crates/adapters_web/src/chrome.rs` (the refresher). **Two.** Zero changes to
`assemble`, `law`, `render`, `slot`, `Component`, `ask` or `paper`.

That is the requirement, met.

### 5.4 A slot constrains a stability — verified, not assumed

Found while landing gap 6, and it is a real constraint on every future faculty: a
component that declares a slot **after** the seeded `observations` block must also
declare `Stability::Volatile`, or `validate` rejects the whole document with
`ContextError::InterleavedStability` (`law.rs:36`, predicate at `law.rs:63`). The
cacheable head must stay stability-monotonic, so the slot number and the stability
class are not independent choices.

The taxonomy in §2 already satisfies this and it is worth checking explicitly, because
a faculty author will get it wrong:

`space` 55 SemiStatic → `environment` 60 Dynamic → `artifacts` 65 Dynamic →
`task` 70 Dynamic → `history` 80 Dynamic → `skills` 85 Dynamic →
`observations` 90 Volatile → `perception` 92 Volatile → `directive` 95 Volatile →
`response_contract` 99 Static (tail, exempt by `law.rs:64`).

Monotonic throughout. A faculty that declares a Dynamic block at slot 92 fails a test
rather than silently poisoning the prefix cache — which is the mitigation working as
designed, and the reason `Slot` opening up (§3) does not open up the paper's laws.

### 5.5 An optional component MUST floor at Elided — the rule, and why

Found by landing gap 8, and it corrects an error this document made twice (§2 rows 7
and 9 both had it wrong before this paragraph existed).

`Fidelity` derives `Ord` in the order `Full < Summarized < Pointer < Elided`
(`types.rs:55`). `assemble` starts a section with no parts at `Fidelity::Elided`
(`assemble.rs:97`). And `validate` rejects any section whose `fidelity > floor`
(`law.rs:31`). Put those three together: **a component that can render nothing must
declare `floor() -> Fidelity::Elided`, or the first agent that leaves it empty produces
an illegal document.**

Declaring `Summarized` for the space block did exactly that — every spaceless agent's
paper failed `validate` with `BelowFloor`. It is not a subtle failure and it is not a
rare one: it fires for the default configuration, which is the case least likely to be
covered by a test written against a configured agent.

So the floor is not a free choice about how much degradation a block tolerates. It is
constrained by whether the block can be absent:

- **Can be absent** (`space`, `artifacts`, `perception`, `skills`, `directive`,
  `observations`, `environment`) → floor MUST be `Elided`. This is why those four
  existing components already declare it, which read as a coincidence until now.
- **Always present** (`soul`, `identity`, `operating_rules`, `affordances`, `task`,
  `history`) → floor is a real choice about degradation tolerance.
- **Must never degrade** (`response_contract`) → floor `Full` (`contract.rs:100`).

Combined with §5.4, a faculty author has two hard constraints and neither is
discoverable by reading the trait: the slot fixes the stability class, and absence
fixes the floor. Both are enforced by `validate` rather than by the type system, which
means **both surface as a failing test and never as a compile error.** That is the
strongest argument in this document for the `Faculty` declaration of §5.2 carrying
slot, stability and floor as *declared data* the harness can check once, instead of as
three methods each faculty author reimplements and gets wrong.

### 5.6 What this deliberately does not do

No faculty may run at assemble time. No faculty may add a method to `Component`. No
faculty may claim `Slot::is_head()` or `Slot::is_tail()` — `law::ends` (`law.rs:76`)
refuses a second tail, so an attempt fails a test rather than displacing the response
contract. And there is no plugin loading: a faculty is Rust compiled into the binary,
selected by a string. Anything else is a module system, and this repo already has one
(`MODULES/module.md`) that this must not duplicate.

---

## 6. Multimodal stays separate

The owner's instruction is already the design, and it is the right boundary — but for
a more precise reason than "images are different".

Images and audio are **not** outside the component tree. `Part` (`types.rs:14`) has
`Image`, `Audio`, `File` and `Fragment` variants; `render()` returns `Vec<Part>`
(`component.rs:49`); `component.rs` explicitly refuses to collapse to `String`
(`component.rs:46-48`), and `UPGRADE-COMPONENTS.md` §4 calls collapsing to a string
"the documented failure mode". A screenshot in a component is representable today.

What stays separate is **the decision about whether this endpoint can hear it**, and
that lives one layer down, in `render`: `ProviderFormat::OpenAiChat { vision, audio }`
(`render.rs:15`) gates each part, and a part the target cannot hear becomes a typed
placeholder — `"[image (image/png) withheld: text-only target]"` (`render.rs:130-146`)
— never a silent drop (I15).

**Why that boundary is right, in one sentence:** `assemble` decides *what is said* and
must stay deterministic and byte-identical across providers (I14), while *whether a
JPEG can be said at all* is a fact about the endpoint that changes when the user
switches models — so putting the capability check in `assemble` would make the golden
test provider-dependent and break the one property the whole crate exists to hold.

The practical consequence for a chrome faculty: it emits `Part::Text` (an
accessibility tree) as its default, and may emit `Part::Image` beside it. Against
today's `vision: false` (`ask.rs:74`) the image degrades to a visible placeholder and
the tree carries the turn. Nothing in the component knows or cares. That is the
boundary working.

The one thing genuinely outside the tree: **binary blobs are base64 in
`Part::Image.data_base64`** (`types.rs:20`), and `assemble::cost` charges them at
`bytes/4` (`assemble.rs:17`). A 200 KB screenshot costs ~50 000 budget units against a
4096-token budget (`phase.rs:127`) and will trigger the degradation loop
(`assemble.rs:112`) on every call. **This is a real, unhandled trap** and it is on the
gap list.

---

## 7. Extension — the file count

**Adding a static or state-derived component (the common case): TWO files.**

1. `crates/agent/src/components/<name>.rs` — the type, its `Component` impl, its
   `render()`.
2. `crates/agent/src/components/mod.rs` — one `mod` line, one `pub(crate) use`, one
   entry in the registry.

**Adding a component that senses the outside (chrome, camera, a filesystem watcher):
TWO files**, per §5.3 — the faculty declaration and its host refresher.

**Today it is four to five files across two crates**, per §5.1. The architecture has
failed the owner's bar and the gap list is how it stops failing.

The two-file number is only reachable if all four of these hold, and each is a gap
item: `Slot` is open (§3), `paper::find` upserts (§5.2), the dynamic set is a list not
three statements (§5.2), and `seed()` is a registry rather than a literal vector.

---

## 8. The gap list

Ordered by lowest reversal cost first. Each item is one coding turn.

| # | Change | Files | ~Lines | Invariants | Risk |
|---|---|---|---|---|---|
| 1 | **Delete `priority()` and `applies()` from `Component`**, and the four overrides of `applies` | `context/src/component.rs`, `agent/src/components/{soul,directive,contract,history}.rs` | −40 | I12 | None — zero callers; `cargo build` proves it |
| 2 | **Delete `PhaseConfig::sections`** and the `all_full` helper that fills it | `agent/src/phase.rs` | −25 | I12 | None — zero readers |
| 3 | **Delete `user` and `memory` components** and their seed entries | `agent/src/components/person.rs` (delete), `components/mod.rs` | −95 | I12, I13 | Golden regenerates; two blocks leave every prompt. Reversible — the file is in git |
| 4 | **Wire `render_in`: give the notation request a chooser** (§4.2) — add `Component::notation`, `section(at, form)`, `State.form`, `Form::for_target`, one assignment in `ask::call_model` | `context/src/{component.rs,form.rs,state.rs}`, `agent/src/{components/mod.rs,paper.rs,ask.rs}` | +55 | I13, I14, I15 | The rendered prompt must NOT move — `for_target` returns Markdown today, so the golden is the proof the wiring is inert until asked. If the golden moves, the intersection rule is wrong |
| 5 | **`Slot` enum → newtype + consts** | `context/src/slot.rs`, every `slot()` impl (12 sites), `law.rs` unchanged | ~+20/−15, 12 one-line edits | I13 | Mechanical. Goldens must not move — assert byte-identity before/after |
| 6 | **`paper::find` upserts instead of `expect`** | `agent/src/paper.rs` | +8 | I13, I14 | A typo'd id now silently adds a block instead of panicking. Mitigate: `validate` already refuses duplicate ids; add a test that an unknown id lands at its declared slot |
| 7 | **`components::dynamic(state)` replaces the three literals in `ask::call_model`** | `agent/src/components/mod.rs`, `agent/src/ask.rs` | +35/−12 | I13, I14 | The prompt must not change. Prove with a byte-identical golden before touching anything else |
| 8 | **Split `space` out of `environment` into its own component at slot 55**; `now::environment` stops calling `Space::context()` | `agent/src/components/space.rs` (new), `components/mod.rs`, `now.rs`, `ask.rs`, `space.rs` (`context()` moves into the component) | +90/−30 | **I13 (this is the live violation)**, I14 | Golden moves — one block becomes two with different headings. `main/agent.md:104` describes the space as living in `## environment` and must be edited with it |
| 9 | **`Sensed` generic component + `AgentState.senses`** | `agent/src/components/sensed.rs` (new), `agent/src/state.rs` | +80 | I7, I13, I15 | `AgentState` is serialized for pause/resume (`state.rs:23`) — `Vec<Part>` in a `BTreeMap` must round-trip; add a serde test |
| 10 | **`Faculty` declaration + `faculties:` frontmatter key + attach in `adopt_spec`/`subagent::resolve`** | `agent/src/faculty.rs` (new), `agent/src/spec.rs`, `agent/src/paper.rs`, `agent/src/subagent.rs` | +130 | I6 (default deny), I9, I15 | The allowlist rule must hold: a faculty makes tools *available to name*, never granted (`subagent.rs:71-76`'s exact rule). A faculty that grants silently is the `engine: base` failure again |
| 11 | **Faculty refresher table in `core::runtime::drive`**, `space::refresh` becomes its first entry | `core/src/runtime.rs`, `core/src/faculty.rs` (new) | +60 | I3, I7, I15 | An absent faculty must degrade, not break (I15). One refresher failing must cost that block and not the turn — the `load_agents` rule (`loader.rs:24`) |
| 12 | **Budget guard for binary parts**: a `Part::Image` over N bytes degrades before any text does | `context/src/assemble.rs` | +25 | I14, I15 | Changes the degradation order. Must be recorded in `CompactionReport` like every other step (`assemble.rs:131`) — never a silent drop |
| 13 | **`skills` component at slot 85** — a read skill lands there, not in `history` | `agent/src/components/skills.rs` (new), `agent/src/skills.rs`, `agent/src/step.rs` | +70 | I13 | `step.rs:151` currently pushes every result to history uniformly; a per-tool branch there is a new special case — keep it to one `if` |
| 14 | **`artifacts` component at slot 65**, written by a faculty | `agent/src/components/artifacts.rs` (new) | +70 | I13, I15 | Needs a writer to be worth having. Do not land it before a faculty writes to it, or it becomes `user`/`memory` again |
| 15 | **Chrome faculty** — the acceptance test for the whole seam | `agent/src/faculty/chrome.rs`, `adapters_web/src/chrome.rs` | +150 | I2, I6, I15 | Network/permission surface — CLAUDE.md §17 makes this a **user gate**, not an unattended decision |

Items 1, 2, 3, 5, 6, 7 are subtraction and mechanical refactor: independently
revertible, any order within the dependency chain below. Item 4 is wiring — it adds
capability without moving a byte. Item 8 is the invariant fix and the highest-value
item on the list. Items 9–11 are the seam. Items 12–15 are what the seam is for.

**Dependency order:** 5 and 6 are independent of each other; 7 depends on 6; 4 depends
on 1 (both edit `component.rs`); 8 depends on 7 (both edit `components/mod.rs` and
`ask.rs`).

**Lead's rulings, 2026-08-18.** Items 9, 10, 11, 13, 14 are **HELD for one round**
pending a bar-raiser judgement on whether I12 was satisfied by splitting files rather
than simplifying (253 files under `crates/*/src`, the longest at exactly 200 lines —
zero headroom). The Faculty seam adds files and will not be authorized into a tree
that is about to be judged unnavigable. Item 15 (chrome) is **HELD as a user gate**
per CLAUDE.md §17 — designed here in §5.3, shipped by nobody until the owner says so.

**Do not start at 15.** The chrome faculty written before item 11 is another
hardcoded block in `seed()`, and the next faculty pays the same price again.

---

## What proves this document

1. `cargo test -p context` goldens regenerate exactly once per gap item that moves
   bytes (items 3 and 8, and no others), and each diff is read line by line. **Item 4
   must not move the golden** — a notation wiring that changes the prompt before
   anyone requests a second notation has got the intersection rule backwards.
2. The `paper.form = Json` test of §4.4 — both halves, including the prose contract
   that must ignore the request.
3. A test that adds an unknown component id through `set_component` and asserts it
   lands at its declared slot — the proof that item 6 opened the world.
4. A test that a spec with `faculties: [x]` for an unknown `x` loads, reports the
   problem, and runs (I15) — the `load_agents` discipline (`loader.rs:24`). HELD.
5. The full rendered prompt of the chrome agent, printed via `SHOW_PROMPT=1` and read
   by a human. Nothing else proves the blocks say what was wanted. HELD (user gate).

---

## 9. The seam as BUILT — increment 27, and what changed since §5 was written

Status: this section is the record of the round §5 designed. **§5's file paths are
pre-reorganisation and many are dead.** Every path below was re-verified against the
tree at `ca59db1` by opening the definition, not by trusting §5's map.

### 9.1 Two of §5's three walls were already down

§5.1 named three walls. Gaps 1–8 landed since, and two of them fell as a side effect:

| Wall (§5.1) | Status at `ca59db1` | Where |
|---|---|---|
| 1 — `paper::find` panics on an unseeded id, so the paper is a closed world | **DOWN** | `crates/agent/src/paper/mod.rs:50` `set_component` UPSERTS. `find` still `expect`s but is now private and reached only by the two history writers, which is honest: a window out of nowhere IS a bug. |
| 2 — the per-call refresh list is three literals in `ask::call_model` | **DOWN** | `crates/agent/src/components/mod.rs:62` `dynamic()` is the list; `crates/agent/src/ask.rs:75` walks it and does not name it. |
| 3 — `AgentSpec` has no key by which a file can name a block | **STANDING** | `crates/agent/src/spec/mod.rs:54` — twelve fields, none of them a block. |

So this round is wall 3 and the machinery behind it, not the whole of §5.

### 9.2 The ruling that decides whether `Faculty` is a seam or a duplicate

The sharpest objection to §5 is that `Faculty` is a second way to do what `space:`
already does. It would be correct if `space:` kept its hardcoded path and `faculties:`
were added beside it. So:

> **`space:` is IMPLEMENTED BY the faculty seam. It does not sit beside it.**

Concretely, `space` today is hardcoded in three places, and all three become table
entries:

| What `space` hardcodes today | `path:line` | Becomes |
|---|---|---|
| its tools | `crates/agent/src/subagent.rs:74` `with_the_space` | `faculty::of("space").tools`, concatenated in `resolve` beside the built-ins |
| its prompt block | `crates/agent/src/components/mod.rs:71` — a `SharedSpace` literal in `dynamic()` | one generic `Sensed` built from `faculty::of("space").blocks` |
| its host refresher | `crates/core/src/runtime/mod.rs:49` — an unconditional call | the first entry in the `Sense` list |

A frontmatter `space: research` continues to mean exactly what it means today, because
`adopt_spec` reads a non-empty `space:` as declaring the `space` faculty. **No agent
file changes and the rendered prompt does not move.** That byte-identity is the proof
the migration is inert, and it is the acceptance criterion for this round rather than a
hope.

### 9.3 The four parts

1. **`Block`** (`crates/agent/src/components/sensed.rs`) — `id`, `slot`, `intent`,
   `stability`. Declared data.
2. **`Sensed`** — ONE generic component. Every faculty block is a `Sensed`; none of
   them is a new Rust type. A component's job is to render bytes at a position, and
   the bytes were produced elsewhere.
3. **`Faculty`** (`crates/agent/src/faculty/`) — a named bundle of declared tools and
   declared blocks, plus `faculty::of(name)`, the registry table.
4. **`Sense`** (`crates/core/src/faculty.rs`) — the host half: a port, injected at the
   composition root, that reads the outside world and returns `block id -> Vec<Part>`.

`AgentState.senses: BTreeMap<String, Vec<Part>>` is where 4 leaves bytes for 2 to
render. It is `AgentState.space` generalised.

### 9.4 §5.5 corrected: the floor is not declared data, it is UNREPRESENTABLE

§5.5 established that anything which can be absent must floor at `Elided`, and closed
by arguing that slot, stability and floor should therefore be *declared data the
harness checks once*. That is right about slot and stability and **wrong about the
floor**, and this round does better than §5 asked for:

`Block` has **no `floor` field**. `Sensed::floor()` returns `Fidelity::Elided`
unconditionally. A sensed block is by definition state a host may not have written —
I15 says every capability may be absent — so there is no honest second answer, and a
field offering one is a field whose only use is to be filled in wrongly. The failure
`validate` used to catch is now one the type system cannot express.

Stability stays declared, because §5.4's constraint is real and directional: a block
slotted after `observations` must be `Volatile` or `law::interleaved` refuses the whole
document. That IS a genuine author choice within a constraint, so it stays data — and
the constraint is checked ONCE, by a single test walking the whole registry, rather
than by each faculty author rediscovering it.

### 9.5 The chrome agent, traced end to end — and the honest file count

`crates/agent/src/faculty/chrome.rs` and `crates/adapters_web/src/chrome.rs` are the
two files. They are joined by one line each in two registry tables. **§7's flat claim
of "two files" is not quite honest and this section replaces it:**

> **TWO new files, TWO one-line registry entries, and ZERO changes to any existing
> logic** — nothing in `context` (`assemble`, `law`, `render`, `slot`, `Component`),
> nothing in `core`, and nothing in `agent` outside the new file and its registry arm.

A registry line is the declaration itself, not a modification to behaviour; it is the
same shape the repo already accepted for `core::tools::tool_entry` and
`core::dispatch::builtin_entry`. Counting it as a touched file would make those tables
failures too. Counting it as nothing would be the overstatement §5 made.

DO NOT SHIP THE CHROME FACULTY. CLAUDE.md §17 makes a browser/network capability a user
gate. It is designed here and reachable by configuration; it is built by nobody until
the owner says so.

---

## 10. AN AGENT THAT STARTS AN AGENT WITH A GOAL — the written ruling

The question put to the architecture lead: is a spawned agent (a) a configuration
written at runtime, or (b) a goal handed to a copy of an existing configuration?

### 10.1 The finding that decides it: (a) already shipped

`grep -rn spawn_agent crates/agent/src` returns nothing, which is true and misleading.
**Runtime configuration authoring is not missing — it is `write_agent`**
(`crates/core/src/agents/roster.rs:98`, increment 11). A model calls
`write_agent({name, description, prompt, tools, space})`; it appends an `AUTHORED` fact;
`roster::reconcile` (`crates/core/src/agents/roster.rs:24`) re-parses the whole set
through `agent::load_agents` at the next TURN BOUNDARY; the new agent is installed with
its own Worker and is indistinguishable from a shipped one (I9). Every validation is
already a runtime error path and every one of them already exists —
`usable_agent_name`, `parse_agent_file`, `unresolved_tools`, `app.agent_problems`.

So building "spawn = author a config at runtime" would be a SECOND config-authoring
path. That is precisely the `Faculty`-versus-`space:` failure mode one increment over,
and §9.2 rules against it.

### 10.2 The ruling

> **(b). And (a) is not the alternative — (a) is `write_agent`, which shipped in
> increment 11.**
>
> `spawn_agent(agent, goal)` hands a goal to an agent that already exists. Composed
> with `write_agent`, that gives the owner (a)'s full expressive power — a genuinely
> new role, authored and then started — without a second file format, without a
> second validation surface, and without a new error type.

This is the smaller of the two options by a measurable amount: `spawn_agent` adds no
new validation, no new parse path, no new `Effect` variant and no new port. It is one
branch in `crates/agent/src/subagent.rs`'s `invoke_or_refuse`, which converts the call
into the `Effect::Delegate` that already exists.

### 10.2b CORRECTION — the composition spans TWO TURNS, not one

An earlier draft of §10.2 claimed "already exists" included an agent `write_agent`
created *ten milliseconds earlier in the same turn*. **That is false and it was the
weakest sentence in this document.** Checked against the tree rather than remembered:

`roster::reconcile` (`crates/core/src/agents/roster.rs:24-28`) returns early while
`app.agent.task.is_some()`, and `runtime::drive` only calls it AFTER the turn loop
(`crates/core/src/runtime/mod.rs:66`). `task` is `Some` from the utterance that starts
a turn until the answer that ends it. So an agent authored mid-turn is installed at the
TURN BOUNDARY, and a `spawn_agent` naming it in that same turn fails with
`DelegateError::Unknown` — "No agent called 'X' is loaded in this browser."

So the honest statement of the composition is:

> **Turn 1** the agent calls `write_agent`. **Turn 2** it can `spawn_agent` the result.

Three things follow, and none of them changes the ruling:

1. **The deferral is deliberate and correct, not a defect.** Swapping an agent's
   prompt between a model call and the reply it is waiting for would assemble the rest
   of that turn out of one file and the history of another — the crossed-projection bug
   increment 07 already produced once. `reconcile`'s own doc comment says so.
2. **The failure is honest and recoverable.** It is a refused tool result naming the
   cause, not a silent no-op, so the model can wait and retry. `write_agent`'s success
   message already tells it the truth: *"It is installed in this browser as soon as this
   turn ends."*
3. **The ruling stands, and is if anything strengthened.** The alternative — option (a)
   as a NEW mechanism that installs an agent mid-turn — would have to defeat exactly the
   safety property `reconcile` exists to hold. That is a strong argument against building
   it, not a reason to regret (b).

What this DOES cost: an agent cannot author-and-run a helper inside a single turn, so
"decompose this into three specialists and run them" is a multi-turn workflow. A
`passes:` budget above 1 makes that reachable without the person asking again each time
(`crates/agent/src/passes.rs`), which is the existing mechanism and not a new one.

### 10.3 Why (b) is also the OBSERVABLE one — the owner asked to verify a workflow ran

Going through `Effect::Delegate` is not merely cheaper; it is the reason the result can
be inspected at all. `crates/core/src/batch.rs:84` `delegate` already, for free:

- appends `EventKind::UserMessage { text: goal, agent, from }` — **what it was given**,
  in the callee's own history, attributed to the caller;
- runs the turn on the callee's own Worker via `batch::run_on`
  (`crates/core/src/batch.rs:31`) and records `ModelReplied` there — **that it ran**;
- moves the callee's board row Working -> Idle, or Failed WITH THE MESSAGE
  (`crates/core/src/batch.rs:65` `refused`);
- emits `EventKind::ToolInvoked { tool: <agent name>, args: goal, ok, output }` —
  **what came back** — which the Tool trace pane (`crates/core/src/trace/pane.rs`)
  already renders and `/tools` already projects (I8).

Under a new spawn mechanism every one of those five would have to be built again.
**Inheriting observability rather than rebuilding it is the strongest single argument
for the ruling**, and it is what makes the owner's "verify that a workflow is working
as expected" answerable today rather than after another increment.

### 10.4 The capability rule, which is where this could go wrong

`spawn_agent` may start any agent loaded in this browser. That is a real widening and
it is granted the ordinary way: `spawn_agent` is a built-in tool, so an agent gets it
only if its own `tools:` list names it (or the list is empty, which means every
built-in). The allowlist IS the mode (ADR-006, ALIGNMENT §1) and nothing here bypasses
it.

Two ways to reach a peer now exist and they mean different things, both honest:

- `tools: [researcher]` — a NAMED, statically known collaborator, resolved at load.
- `tools: [spawn_agent]` — the capability to hand a goal to any loaded agent,
  including one written in an EARLIER turn (§10.2b — not the same turn; `reconcile`
  installs at the turn boundary). Dynamic, and the file that grants it said so.

**A related defect, found while ruling and NOT fixed here.** `subagent::resolve`
(`crates/agent/src/subagent.rs:56`) adds peers only through `allowlisted`, which runs
only when `tools:` is NON-empty. An agent with `tools: []` therefore gets every
built-in and NO peers — so the commonest default agent can delegate to nobody, and
adding peers to the empty case would silently auto-grant every future authored agent to
`main`. That is a capability widening and a user gate under CLAUDE.md §17. It is
recorded here and left standing; `spawn_agent` serves the same need explicitly, which
is the better answer anyway.

---

## 11. What the bar-raiser found, and what changed because of it

`docs/CRITIQUE-03.md` — **GO on the prompt-side component requirement, NO-GO on §9.5's
file-count claim.** Both halves of that verdict were acted on rather than argued with.

### 11.1 The finding that mattered: perception was solved, action was not

**F1 (HIGH).** This round built `App.senses` + `install_sense` so a host outside `core`
could fill a prompt block — and did NOT apply the same lesson to running a faculty's
TOOLS. `core::tools::tool_entry` was a closed `match` in the pure core; a name with no
arm fell through to `"Tool not found"`. So a browser agent would have got its page
snapshot, seen `navigate` in its affordances, and had every `navigate` call refused
forever.

That is the sharpest possible statement of the owner's requirement being half-met, and
the asymmetry was self-inflicted: the right answer already existed one file away.

**Fixed.** `crates/core/src/faculty.rs` now carries a second port beside `Sense`:

```rust
pub trait ToolHost {
    fn handles(&self, tool: &str) -> bool;
    fn run<'a>(&'a self, tool: &'a str, args_json: &'a str)
        -> BoxFuture<'a, Result<String, String>>;
}
pub fn install_tool_host(app: &mut App, host: Rc<dyn ToolHost>)
```

Precedence in `crates/core/src/batch.rs:180-191` is **built-in → installed host → local
refusal**. Built-ins win on purpose: a host must not be able to shadow `exec` or
`web_search`.

### 11.2 The special case that survived the seam, and no longer does

**F3 (MEDIUM).** `paper::adopt.rs` was still seeding `senses["space"]` from a PURE
crate — the one faculty that crate knew by name — which made the seam a generalisation
everywhere except at its own first entry. It was load-bearing: `tests/prompt.rs` has no
host in it, so deleting the write turned the byte-identity proof red.

**Fixed properly rather than conveniently.** `adopt_faculties` now writes the
DECLARATION and nothing else, and `crates/agent/tests/prompt.rs` and
`crates/agent/tests/live.rs` each call a `sensed_by_the_host` helper that does what a
host does. The tests now SAY they are standing in for one, instead of production code
filling a block so a test could pass.

### 11.3 The rest

| # | Finding | Action |
|---|---|---|
| F2 | `write_agent` told the model "installed immediately" while `roster.rs:137` said "as soon as this turn ends" | tool description now states the turn-boundary rule and that `spawn_agent` cannot reach it until the next turn |
| F2 | §10.4 still asserted the same-turn claim §10.2b had already retracted | corrected to "an EARLIER turn" |
| F6 | `components/world.rs` cited `SharedSpace, Slot::SPACE` | now cites `crate::faculty::space` + `Sensed` |
| F4 | `ALL: [&str; 1]` — a faculty missing from it gets ZERO structural coverage | **OPEN**, recorded below |
| F10 | §9.2's `path:line`s were exact against `ca59db1` and now point at shifted lines | **OPEN** — accepted cost of citing a baseline |

### 11.4 The honest extension cost, restated a third time

§7 said two files. §9.5 said two files, two registry lines, zero core changes — and was
**wrong**, because it counted only perception. With F1 fixed:

| Half | Cost |
|---|---|
| Prompt block (perception) | `agent/src/faculty/chrome.rs` + one arm in `faculty/mod.rs`; `adapters_web/src/chrome.rs` + one `install_sense` |
| Tools that RUN (action) | the same `adapters_web` file `impl ToolHost` + one `install_tool_host` |

**Two new files, four one-line registry entries, zero edits to `context` and zero to
`core`.** A third statement of this number was needed because the first two were both
too generous; this one is stated against a tree where both halves are proven by test
(`crates/core/tests/faculty.rs`).

### 11.5 What is still NOT true, and must not be claimed

1. **`agent::faculty::of` is a closed `match` with one arm**, and that arm gates BOTH
   halves — which is sharper than it first looks and was found by probing, not by
   reading. A toolbox is `builtin_tools() union faculty::tools_of(spec)`, so with only a
   `space` arm there is **no non-built-in tool name in any toolbox in this build**. A
   model calling `navigate` is refused by `Toolbox::check`
   (`crates/agent/src/toolbox.rs:76`) in the PURE crate, before any effect reaches the
   executor, with `"Tool not found. Available: …"`. The positive branch of
   `faculty::run_hosted` is therefore **unreachable today by a name `core` does not
   already own**.

   This does not weaken §11.4's count — that one arm IS one of the four registry entries,
   and adding it is what puts `navigate` in the toolbox and makes the host reachable. But
   it means the honest sentence is: *`core` can now run a faculty's tools, and no faculty
   yet declares any.* "A browser faculty's tools run" is true of `core` and still false
   of the system.

   `crates/core/tests/faculty.rs` proves the host path at the one reachable equivalent
   seam: an agent declaring `faculties: [space]` with an EMPTY `space:` gets `remember`
   in its toolbox, `tool_entry` routes it to the space handler, that handler DECLINES it
   (no space to write to), and the call lands on exactly the fallthrough a browser tool
   would take. Proven at a real seam rather than asserted, and the test says so.
2. **F4 stands:** `ALL` is a fixed-length array and `tests/faculty.rs` iterates it, so a
   faculty its author forgets to add gets no structural check at all. The constraint
   harness is opt-in, which is the weakest thing about it.
3. **No chrome faculty exists and none was built.** CLAUDE.md §17 user gate.
