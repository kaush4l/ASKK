# THREADS.md — more than one agent's conversation on one screen

> The owner, verbatim: *"Multiple agents can be shown as thread each expanding to
> the chat UI. Use shared components for UI elements."*

This is a presentation design. It adds nothing to the agent loop, no new seam
route, and no new fact. Everything below is a rearrangement of projections the
core already writes.

---

## 1. What exists now

### One agent is selected, page-wide

`selected: Signal<String>` is created once in the shell, seeded from the address
bar — `main.rs:83`, `route::agent().unwrap_or(DEFAULT_AGENT)` — and handed to
`Stage`, `Rail`, the status strip and the chat pane. There is exactly one of it.
`DEFAULT_AGENT = "main"` is `route.rs:22`.

It is written from two places: the tab strip (`tabs.rs:55`, `go` → `selected.set`)
and the hash listener (`route.rs:182-186`, only when the hash names an agent —
"a step Back onto `#/settings` is not a decision to change agent").

### The hash is the view AND the subject

`route::show` (`route.rs:70-96`) writes `{slug}/{agent}` for views that are about
one agent (`View::scoped`, `views.rs:121`) and `{slug}` alone for the rest.
`main.rs:98` runs it on every change of either half. `route::current`
(`route.rs:53`) and `route::agent` (`route.rs:58`) read it back at boot, so a
reload restores view + agent + history. `route.rs:173` corrects a hash that names
nothing. A bare load gets `replaceState` rather than a history entry
(`route.rs:88-94`).

Round 6 built this because "pick `researcher` on `#/workspace`, reload, and the
hash still said `#/workspace` while the strip had silently gone back to `main`"
(`route.rs:34-42`). This property does not get to regress.

### One view is mounted at a time, and one pane is the exception

`stage.rs` mounts one routed `section` per view (`stage.rs:77`, `125`, `145`,
`157`, `165`, `186`) — "several panels carry a fixed `id` and a clock, so mounting
them all put three `ToolTrace`s and two `Terminal`s in one document"
(`stage.rs:4-6`).

The chat pane is the exception: `stage.rs:114-124` mounts it always and sets
`hidden: here != View::Chat`, because *"unmounting it drops the poller of a turn
in flight"* (`views.rs:39-40`). A previous round recorded the general form of
this: **an unmounted Dioxus component stops publishing its signals** —
`main.rs:85`, *"a signal published by a component nobody has opened is false
(15H)"*. `endpoint_set` and `tokens` are both signals a pane publishes.

### The chat panel itself

`ChatPane` (`chat.rs:24-46`) takes `agent: ReadSignal<String>` and is documented
as *"the same component, one instance per agent, never a mode flag"*
(`chat.rs:35-38`) — the design already anticipated more than one instance. It
owns:

- `turn: Turn` (`chat.rs:47-55`), six signals grouped in `turn.rs:40-55`.
- one poller, guarded by `watching` (`chat.rs:86`, `watch::follow`, `watch.rs:31-45`)
  — 400 ms while `x-turn: pending` (`watch.rs:14`).
- `busy = mine && shown.pending` (`chat.rs:77`) — per agent, never per page,
  because *"another agent's turn runs in another Worker and must not lock this
  composer"*.
- per-agent drafts, already: `composer.rs:35` keeps a `HashMap<String, String>`.

Fixed ids it plants in the document: `chat-panel` (`chat.rs:123`), `chat-scroll`
(`chat.rs:141`), `aria-labelledby: tab-{agent}` (`chat.rs:127`) — and the core
writes `id="chat-log"` into the fragment itself (`transcript.rs:27`).
`route::newest_turn` (`route.rs:147-155`) queries `#chat-log > :last-child`.

### What is polling, right now

| clock | where | period | condition |
|---|---|---|---|
| turn poller | `watch.rs:14` | 400 ms | one, for the pane's agent, while pending |
| board | `board.rs:28-29` | 400 ms | while `x-watch` (any agent starting or working) |
| heartbeat | `frame.rs:132,196` | 2 s | always, for the life of the page |
| warmth | `frame.rs:18` | 500 ms | always, JS global read, no seam call |

Every seam call clones the whole log: `dispatch.rs:90`,
`recent: app.log.iter().map(|e| e.kind.clone()).collect()`. `transcript()` then
walks it once (`transcript.rs:44`) asking `fold::belongs_to` per fact
(`fold.rs:53`).

---

## 2. What "threads" should mean here

**Chosen: a vertical list of conversations, one per loaded agent, each expanding
in place into the full chat UI.** Not a column per agent, not master-detail.

It is what the owner described, and it is the only one of the three that survives
this product's own constraints:

- **A column per agent fails the measure.** `DESIGN.md` §4 of `VIEWS.md` records
  the decision not to take ngx-admin's fluid content column: *"harmless for
  charts, destructive for a conversation"*. At 1440 the stage is ~1136px
  (`layout.css:68`); two conversations side by side is two ~550px columns, under
  `--column`, with two composers competing for Enter. At 390 it is not a layout
  at all. And `layout.css:107` switches `.dash-grid` to two columns only above a
  66rem container — a two-column chat would be a single column below that, i.e.
  this design, arrived at by accident.
- **Master-detail is what already ships.** The tab strip plus one panel IS a
  master-detail; making the master taller buys nothing and costs a layout.
- **A list of expanding threads is a single column at every width.** It is the
  same box the chat view is today, so the 390px work (R18-P1-9, XOVERFLOW) is
  preserved by construction rather than re-earned.

It also matches what the product is for. You hand an agent a task and walk away.
Coming back, the question is *"what did each of them do"*, and today answering it
for a second agent means re-pointing the whole page and losing sight of the
first. `DESIGN.md` §9.2 already promised the outcome — *"you can hold three
conversations open and lose none of them"* — and the page has never let you see
two.

### The rules, in five lines

1. One row per **loaded** agent (`loaded: Signal<Vec<String>>`, `main.rs:80`), in
   roster order — the same list the tab strip renders (`tabs.rs:84`).
2. A **collapsed** row is a `Badge` and the board row's own sentence. It costs no
   seam call of its own.
3. Exactly one thread is **focused**. The focused thread is open, and its name is
   the one in the hash.
4. Other threads may be open too. Opening one focuses it.
5. Only the **focused** thread runs a 400 ms poller. Every other open thread
   re-projects on the shell's 2 s heartbeat.

### 1440px

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ☰ views │ Agent: main · main's folder · Linux ready │ 12,480 tokens      │  header
├──────────┬───────────────────────────────────────────────────────────────┤
│Dashboard │ CHAT                                                          │  stage-head
│ Chat  ◄  │ ┌───────────────────────────────────────────────────────────┐ │  (no strip here:
│ Agents   │ │ ▾ main   ● working · 3 turns in all · in this turn for 8s │ │   the list is
│ Commands │ │          · last tool: exec                                │ │   the picker)
│ Trace    │ ├───────────────────────────────────────────────────────────┤ │
│ Settings │ │  you: write the report to artifacts/index.md              │ │
│          │ │  main: I read a.md and b.md…                              │ │
│ ─────────│ │  main called write_file                                   │ │
│ 12,480   │ │  ⏳ waiting for the model — 8s of a 5-minute limit         │ │
│ tokens   │ │  [ Message to main ..................... ] [ Send to run ] │ │
│ local:87 │ ├───────────────────────────────────────────────────────────┤ │
│          │ │ ▸ researcher  ● ready · 2 turns in all · written here     │ │
│          │ ├───────────────────────────────────────────────────────────┤ │
│          │ │ ▸ summarizer  ● stopped at its round ceiling · 1 turn in  │ │
│          │ │               all — raise max_rounds:                     │ │
│          │ ├───────────────────────────────────────────────────────────┤ │
│          │ │ ▸ author      ● ready · no turns yet · written here       │ │
│          │ └───────────────────────────────────────────────────────────┘ │
└──────────┴───────────────────────────────────────────────────────────────┘
   nav 13rem                 .stage — one scroller, no rail on Chat
```

No rail: `View::rail()` is Commands-only (`views.rs:115-117`) and stays so. The
open thread's card is `--column`-wide inside the stage, exactly as the chat panel
is today.

### 390px

The collapsed rows go **below** the open one. R18-P1-9 measured chrome eating
~600px and leaving the transcript ~180px; stacking three summaries above the
conversation would spend that budget on furniture.

```
┌────────────────────────────────┐
│ ☰ views    main: ready         │  header
├────────────────────────────────┤
│ CHAT                           │
│ ┌────────────────────────────┐ │
│ │ ▾ main                     │ │  summary wraps to 2–3 lines,
│ │   ● working · 3 turns in   │ │  never nowrap, never a scroller
│ │     all · in this turn 8s  │ │
│ ├────────────────────────────┤ │
│ │  you: write the report…    │ │  ← the conversation keeps the
│ │  main: I read a.md…        │ │    top of the stage
│ │  ⏳ waiting — 8s of 5 min   │ │
│ │  [ Message to main ......] │ │
│ │  [        Send to the run ]│ │
│ ├────────────────────────────┤ │
│ │ ▸ researcher ● ready · 2   │ │  ← other threads under it
│ │ ▸ summarizer ● stopped at  │ │
│ │ ▸ author     ● ready · no  │ │
│ └────────────────────────────┘ │
└────────────────────────────────┘
```

Ordering is a CSS `order` on the open card, not a second markup path.

---

## 3. The hash route

**The hash keeps naming exactly one agent: the focused thread. Which other
threads happen to be open is view state, not address state.**

`#/chat/researcher` means: the Chat view, the thread list, `researcher` focused
and open, its history restored. Reload lands on exactly the screen the URL was
copied from, which is the property `route.rs:34-42` bought and a reviewer called
better than Hermes. Nothing about it changes: `route::show` (`route.rs:70`),
`View::scoped` (`views.rs:121`) and the listener (`route.rs:161`) are untouched.

Why the open **set** does not go in the URL:

- Assigning the hash pushes a history entry — deliberately, so Back moves between
  views and agents (`route.rs:63-64`). Putting expand/collapse in the hash makes
  Back replay accordion presses, which is not a place anybody was.
- `route::parts` (`route.rs:43-49`) splits on one `/` and every other scoped view
  takes the same second segment. `#/commands/main+researcher` is meaningless —
  the Commands view has one terminal. A list-shaped segment leaks into four views
  that cannot use it.
- `route.rs:173`'s "a hash that names nothing is corrected" would need a
  set-validating variant: what does the page do with `#/chat/main+nosuchagent`?
  Every answer is worse than not having the question.

Focus rule, stated so it never lies: **`selected` is the most recently opened
thread.** Opening a collapsed thread focuses it and writes the hash — one
gesture, one meaning, the same `selected.set` the tab strip already does
(`tabs.rs:55`). Collapsing a non-focused thread changes nothing in the address
bar. Collapsing the focused thread moves focus to the most recently opened
remaining thread; if there is none, the hash keeps naming it — the URL still says
which conversation this page is about — and a reload re-opens it. That is the
honest reading of what `#/chat/main` has always meant.

---

## 4. Sub-agents

**A delegated run gets no thread of its own and is not nested under its parent.
It is already visible twice, and both are true.**

What the records actually hold. A sub-agent's Worker reports back as
`core.agent_activity` (`told.rs:125`, `told::report_activity`, `told.rs:130-144`),
which stamps the child's name onto each item. `fold::belongs_to` (`fold.rs:53-83`)
has **no arm for `AGENT_ACTIVITY`**, so those facts appear in no conversation at
all — they feed the Trace. What does cross into a conversation is
`core.agent_error`, scoped to the child by `told::agent_of` (`fold.rs:79`,
`transcript.rs:110-120`), rendered in the same failure card as the parent's own
(`told.rs:19-29`).

So what the user learns from each option:

- **Its own top-level thread — which it already has.** Every loaded agent has a
  row, a conversation and a board row. During a delegation the parent's thread
  says `main called delegate` (`transcript.rs:17-23`, one announcement per run,
  R7-15) and the child's row moves to `working` off the same `/board` fold. The
  user sees both sides and the page claims nothing about ownership.
- **Nested under the parent.** This would assert a parent→child relation. **No
  fact records one.** `core.agent_activity` carries the agent's name and nothing
  about who asked; `ToolInvoked` carries neither (`told.rs:119-125` says exactly
  why). A tree drawn from an inference is R18-P0-1's defect class — *"the app
  narrated a history its own records disprove"* (`progress.md:2574`). It is also
  wrong on the facts: `researcher` is in the roster, can be talked to directly,
  and can be delegated to by two different parents in one session. Its place in
  the list would then depend on who delegated to it last, which is not a map.
- **Not at all.** Loses the child's failure card, which is the one thing today
  that tells you *why* a delegation came back empty.

**Decision: threads are loaded agents, one each, in roster order. Nothing else.**
No parent link, no indent, no badge saying "delegated". See the open questions for
whether to record a parent later; the recommendation is not to.

---

## 5. The shared components

### What is in `crates/ui/src/ui/` today

| file | component | status |
|---|---|---|
| `card.rs` | `Card` — `<section class="panel">` + optional `<h2>`, `hidden` passes through (`card.rs:6-8`) | shipped, everywhere |
| `button.rs` | `Button` — 4 variants, 44px floor, `aria-*`/`tabindex` pass through (`button.rs:36-39`) | shipped, everywhere |
| `field.rs` / `form.rs` / `select.rs` | `Field`, `Form`, `SelectField` | shipped |
| `disclose.rs` | `Disclosure` — `<details class="disclose panel-note">` | shipped, 4 call sites |
| `empty.rs` | `EmptyState` — title, one sentence, one action (`empty.rs:26-37`) | shipped |
| `skeleton.rs` | `Skeleton` — blocks in the shape of what is loading | shipped |
| `badge.rs` | `Badge` — dot AND label, never a dot alone (`badge.rs:5-8`) | **built, zero call sites** (`DESIGN.md` §8 table) |
| `mod.rs` | `focus`, `enter_submits`, `key_hint`, `show_newest`, `show_newest_soon`, `show_last`, `has_rows`, `quoted`, `COMPOSER_ID` | shipped |

### What each new piece of thread UI uses

| thread UI | verdict | why |
|---|---|---|
| the thread card | **reuse `Card`** | it is a panel; `variant` and `hidden` already pass through (`card.rs:23`) |
| the summary control | **reuse `Button`** | it needs `aria-expanded`, `aria-controls`, `id` and the 44px floor — all four already pass through (`button.rs:36-39`) |
| the status word + dot on a collapsed row | **reuse `Badge`** — this is the call site it has been waiting for | `badge.rs` is built and rendered only by the gallery. The board row already writes `data-status` (`boardrow.rs:96-97`); `boardcell::cell` reads it (`boardcell.rs:15`) |
| the collapsed row's sentence | **no component — `data-line`, verbatim** | `boardrow.rs:87-93` writes the whole row in one string precisely so a second surface can quote it; `runstatus.rs:86` already does exactly this. A second wording here is R8-8 |
| the expanded body | **reuse `ChatPane` unchanged** | `chat.rs:35-38` already says one instance per agent |
| "nothing said here yet" | **reuse `EmptyState`** via `recover::nothing_said` (`recover.rs:141`) | already inside `ChatPane` |
| first paint of a thread | **reuse `Skeleton`** (`chat.rs:147`) | already inside `ChatPane` |
| moving focus to a newly opened thread's composer | **reuse `ui::focus`** (`mod.rs:50`) + `COMPOSER_ID` | the roving-tabindex strip and every EmptyState already use it |
| scrolling the newest turn into view | **reuse `route::newest_turn`**, with a per-agent selector | see §7 |

**Not `Disclosure`, and this is the one place the obvious reuse is wrong.**
`Disclosure` is `<details>` whose open state is owned by the browser and set once
at render (`disclose.rs:26`); here openness is routed state that must be settable
from `route::listen` and readable by the hash writer, and a `<details>` the user
toggles behind the signal's back desynchronises the two. Its class is also
`disclose panel-note` — a footnote surface — and a thread is not a footnote. The
fold mechanism this app already uses for exactly this job is the `hidden`
attribute (`DESIGN.md` §8, "Nav (left) / Rail (right)": *"Fold via the `hidden`
attribute, which works in both skins"*), and `Card` passes it through.

**No new component in `ui/`.** The thread row is a *composition* — `Card` +
`Button` + `Badge` + a `<p>` — and it has exactly one caller, which is the test
`board.rs`, `roster.rs` and `runstatus.rs` already fail and correctly live outside
`ui/`. `ui/` holds primitives with two or more unrelated call sites; a new
`crates/ui/src/thread.rs` holds the composition. Every element inside it is a
shared component, which is what the owner asked for.

---

## 6. What this costs

### Today, during one run

`/chat` every 400 ms (`watch.rs:14`), `/board` every 400 ms (`board.rs:28`),
`/board` every 2 s (`frame.rs:132`). Each call clones the whole log
(`dispatch.rs:90`) and `transcript()` walks it once (`transcript.rs:44`).
So the fold is O(events) and the page already pays it ~5×/second.

### With N threads

| state | added seam calls | added folds |
|---|---|---|
| collapsed | **0** | 0 |
| open, not focused | 1 `/chat` per `tick` = 0.5/s | 1 per 2 s |
| open **and** focused, pending | the existing 400 ms poller | unchanged |

Three rules make that true, and they are the whole cost story:

1. **The list reads `/board` once, not once per row.** One `String` prop down to
   every summary, exactly as `LaunchedRun` takes `board: String`
   (`runstatus.rs:27-30`) *"because the card has to know the same answer… and two
   reads of one fold is how the card and its own confirmation came to
   disagree"*. A collapsed thread therefore adds nothing at all: `/board` is
   already fetched by the Heartbeat every 2 s (`frame.rs:162`) and by
   `AgentBoard` while `x-watch` is set.
2. **Only the focused thread may call `watch::follow`.** `ChatPane` gains a
   `live: bool`; when false it does not start a poller and its `use_effect`
   re-projects on `tick` instead. `watch::follow` already refuses a second poller
   per pane (`watch.rs:37-39`); this is the same guard raised one level.
3. **Nothing about openness is written anywhere.** Not a fact, not a KV key, not
   a preference. It is a `use_signal(HashSet<String>)` in the list and dies with
   the tab.

Rule 3 is the one that matters historically. 15M found *"every seam GET appended
a `RequestHandled` fact, which the NEXT request cloned into `Ctx` — so polling
made polling dearer, forever"* (`progress.md:1187`); the store went 39,237 → 336
events. **Every request this design adds is a GET that appends nothing**, which is
the same rule `Heartbeat` states for itself (`frame.rs:140-141`, *"a GET, so it
does not grow the log (15M)"*).

### The bound

Worst realistic case: five loaded agents, all open, one running. That is one
400 ms poller plus four folds per 2 s — 2.5 extra folds/second against the ~5 the
page already does. If that ever measures badly, the lever is the heartbeat period
(`frame.rs:132`), one constant, and it slows every non-focused thread at once. No
per-thread clock is ever introduced, which is what makes the lever exist.

---

## 7. What it must not break

**One panel, one home (R15-IA, `views.rs:4-8`; R17-IA, `views.rs:10-13`).** The
thread list is not a second board: it renders `data-line` verbatim off the same
projection, adds no launcher, no trace and no space tile. Chat's home is the
conversation and it still is — there are just more of them visible. The tab strip
**leaves the Chat view** (`stage.rs:73` becomes `here.scoped() && here !=
View::Chat`) because keeping it would put two controls for "which conversation"
on one screen, which is the bug R15 exists to prevent. It stays on Dashboard,
Commands and Trace, where it is those views' picker with their own accessible
names (`views.rs:140-146`, R4-10).

**Endings agree across surfaces** — the one thing round 18 *"tried to break and
could not"* (`progress.md:2613`). Every word on a collapsed row comes from
`boardcell::cell` over `/board`: `data-status`, `data-line`, `data-ending`,
`data-orphaned`, `data-failed-note` (`boardrow.rs:96-120`). No new sentence is
written anywhere in this design. `ending::of` remains the single fold
(`boardrow.rs:53-57`).

**No view claiming something the records disprove (R18-P0-1).** §4 is this rule
applied: no nesting, because no fact records a parent. Nor does the list ever say
"3 agents running" from its own count — `x-busy` (`board.rs:89`) carries who is
working and the frame already wears it.

**Zero horizontal overflow at 390px** (probe `XOVERFLOW`, `layout-probe.js:170`,
and R17's measured `scrollWidth === clientWidth === 390`). The list is one
column — the same box `.chat-view` is today. The summary is a wrapping `Button`,
never `white-space: nowrap` and never its own scroller; the horizontal-scroll
treatment at `layout.css:49-57` belongs to `.stage-head .agent-tabs` and is not
extended to it.

**ONESCREEN** (`layout-probe.js:151`). `.stage > .chat-view { flex: 1 1 auto;
min-height: 0 }` (`layout.css:62`) already makes the chat view fill the stage with
`.chat-log` holding the only scrollbar. The thread list becomes that flex child;
the open thread keeps `flex: 1 1 auto; min-height: 0` and the collapsed rows are
`flex: 0 0 auto`. The document does not grow.

**Contrast and target size.** `Badge` is a word with a dot drawn by `::before`
from `--tone` (`badge.rs:5-8`) — the R16/R17 sweeps passed on prose with tone, and
this adds no new colour. The summary is a `Button`, which `controls.css` holds at
44px and `button.rs` cannot lose.

**The layout gate's fixture.** `scripts/layout-probe.html:245-249` hand-writes
`#chat-view` → `#chat-panel` → `#chat-scroll` → `#chat-log`; `layout-probe.js:26-34`
routes by `hidden` on those exact ids. Both must gain the collapsed rows and the
per-agent ids in the same commit as the shell — a fixture that models a state the
app cannot reach *"reports failures the app does not have, and hides the ones it
does"* (`layout-probe.js:22-25`).

**Unmounted components stop publishing signals (15H, `main.rs:85`).** Two signals
are published by `ChatPane`: `tokens` (`chat.rs:30`) and, indirectly, `tick`. If
every thread were collapsed, no `/chat` poll would run — and the meter survives
anyway, because `x-tokens` also rides `/board` (`board.rs:151-153`) and the
Heartbeat reads it (`frame.rs:183-193`). This was already fixed for the Dashboard
launcher and it covers this case unchanged.

**The pane that stays mounted off-route.** `stage.rs:114-124` keeps the chat pane
mounted on every view so a turn's poller survives. That stays true of **the
focused thread's pane and only it** — one instance, exactly as today. Non-focused
open panes live inside the Chat view and unmount when you leave it; their turns
keep running in their own Workers and the Heartbeat keeps observing them, which
is precisely what 15M built it for (`board.rs:5-12`).

**Duplicate ids.** This is the one real breakage and it must be fixed in the first
increment: `chat-panel` (`chat.rs:123`), `chat-scroll` (`chat.rs:141`) and the
core's `chat-log` (`transcript.rs:27`) are fixed strings, so two mounted panes put
two of each in the document and `route::newest_turn`'s `#chat-log > :last-child`
(`route.rs:150`) silently scrolls the wrong conversation. All three become
per-agent: `chat-panel-{who}`, `chat-scroll-{who}`, and `id("chat-log-{who}")` in
`transcript.rs`. `newest_turn` takes `who`; its two callers are `route.rs:133` and
`turn.rs:101`, and `turn::show` already has the name (`turn.rs:67`).

---

## 8. The smallest first increment

**Put every agent's state and one open conversation on the Chat view. One
expanded thread, the routed one; no multi-open yet.**

That is already strictly more than today — you see what all five agents are doing
*and* read one of them, without leaving the view — and it needs no `live` prop, no
open-set signal, and no change to polling at all.

| file | change | size |
|---|---|---|
| `crates/ui/src/thread.rs` | **new.** `ThreadList`: one `/board` read, one `Card` per loaded agent, `Button` summary + `Badge` + `data-line`, `ChatPane` in the focused card | ~95 lines |
| `crates/ui/src/stage.rs` | render `ThreadList` inside `#chat-view`; drop the strip on Chat | +6 / −6 |
| `crates/ui/src/chat.rs` | per-agent ids; `role="region"` + `aria-labelledby="thread-{agent}"` in place of the tabpanel pair | +6 / −4 |
| `crates/ui/src/route.rs` | `newest_turn(who: &str)` | +3 / −3 |
| `crates/ui/src/turn.rs` | pass `who` | +2 / −1 |
| `crates/core/src/transcript.rs` | `.id(&format!("chat-log-{who}"))` | +1 / −1 |
| `crates/ui/src/views.rs` | the now-unread `View::Chat` arm of `picker` goes | −1 |
| `web/surfaces.css`, `web/layout.css` | `.threads`, `.thread-summary`, the 390px `order` | ~+22, no new tokens |
| `scripts/layout-probe.html` | collapsed rows + per-agent ids in the chat region | ~+16 |

`thread.rs` at ~95 lines and `stage.rs` at 194 both stay under I12; no function
approaches 40 lines if `ThreadList` delegates the row to a `fn summary(...)`.

**Then the second increment: more than one open at a time.**

- `ThreadList` gains `open: Signal<HashSet<String>>` and a collapse control on
  non-focused open rows (+~15 lines).
- `ChatPane` gains `live: bool`: when false, skip `watch::follow` and add
  `let _ = tick();` to the projection effect (`chat.rs:92`) so it refreshes on
  the heartbeat (+~8 / −2).
- The focus rule from §3 — most-recently-opened wins — is three lines in the
  press handler.

Nothing in the second increment changes the route, the core, or the fixture's
shape; it only lets more than one body be un-`hidden`.

---

## 9. Open questions

1. **Does the thread list replace the agent strip everywhere, or on Chat only?**
   *Recommend: Chat only.* Dashboard, Commands and Trace are genuinely
   one-subject views — one task field, one terminal, one trace — and the strip is
   their picker with a per-view accessible name (`views.rs:140-146`, R4-10). A
   thread list on Commands would be a second home for the conversation, which is
   R15-IA.

2. **Should a collapsed thread open itself when its agent starts working — e.g. a
   task launched from the Dashboard?** *Recommend: no.* A panel that expands under
   you moves the composer, and `DESIGN.md` §9.1 is explicit: *"the composer never
   moves, never resizes under the cursor"*. The row's live sentence already
   changes, and `x-busy` already reaches the chrome. If the owner wants an
   arrival signal, it should be on the row, not a reflow.

3. **Should a delegation record which agent asked for it, so nesting becomes
   provable later?** *Recommend: not now.* It is a new field on the fact
   `told::report_activity` writes (`told.rs:130`), i.e. a change to records
   already in every browser, bought for a view §4 argues against on its own
   merits. Revisit only if a surface appears that cannot be honest without it.
