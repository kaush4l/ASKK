# HARNESS — the interface

Date: 2026-09-23 (round 3). Companion to `docs/rewrite/ARCHITECTURE.md`, which decides what
exists. This file decides what a person sees of it, in what order, and why. The implementer
builds `src/ui/` from this file alone: vanilla JS and CSS, no framework, one `index.html`,
light and dark themes from CSS custom properties, usable at 390px.

Section numbers written `§n` refer to ARCHITECTURE.md; `U§n` refers to this file. Round 2
applied the architect's decisions of 2026-09-23 (U12) and the critique-user's findings.
Round 3 adds approvals and permissions, memory, learned layers and dreaming, and traces.
The Critique log at the end records each decision.

---

## U1. The user

**The owner.** One person. They wrote, or are writing, the folders under `agents/`. They
publish the page themselves (GitHub Pages, or `bun scripts/serve.js`, or the bridge's
`--serve`). They bring their own model: a hosted key, or a local server on their machine.
They read JavaScript and Markdown. They will not read a manual for the page, and they should
not need one: every word on screen is a word from their own folders or from the architecture.

There is no second user. No sign-in, no sharing, no onboarding tour, no marketing copy.

### The jobs, in order of how often they come

| # | Job | What they need to know at that moment |
|---|---|---|
| J1 | **Ask main something and read the answer.** | Is it working? What is it doing now? When is it done? |
| J2 | **Watch parallel work.** main has called agents; which threads are running, is anything stuck or circling? | Per thread: status, step n of max, seconds, the call now running, whether it is circling. **Trouble must be visible even while main looks busy.** |
| J3 | **Check what a thread did**, today or after a reload. | Its history, the call now running, the exact prompt it was given. |
| J4 | **Steer or stop a run under way.** | Which run, and that the note was read (or the abort landed). |
| J5 | **After editing a folder: reload and confirm.** | *Which* files changed, *which* agents failed to load and why, which tools were shadowed or left out. Names, never only counts. |
| J6 | **Connect or change the model.** (First visit; then rarely.) | Which model each agent will use next step, and whether the list is current. |
| J7 | **Pair or unpair the host bridge.** (Rarely.) | Is it answering, what root, which capabilities, which tools that adds. |
| J0 | **Answer an approval.** A run wants to write, execute or reach the network under an `ask` policy and is stopped until the owner says yes or no. Interrupts every other job. | Which agent, the exact call, its risk, why it was asked, and what "always" would allow from now on. |
| J8 | **Review what dreaming learned.** After tasks; a few times a week. | Which prompt changes are proposed, for which agent, why, from which run; what memory was saved without asking. |
| J9 | **Keep memory and permissions honest.** Occasionally, usually after a surprise ("why did it remember that?", "why didn't it ask?"). | Each memory entry and its source; each tool's risk and effective policy, and where that policy came from. |
| J10 | **Export a trace** to study a slow or wrong task elsewhere. Rarely. | Where the time went; one file holding the whole task. |

J1 happens every visit. J2–J4 happen during most non-trivial turns. J0 happens whenever a
run needs it and is the only job that *blocks* the system. J5 and J8 come in bursts. J6, J7,
J9 and J10 are rare.

**This ordering is the whole layout.** The screen belongs to J1. J0 comes to the owner: it
appears in the transcript where the work is, and first in the header, because a run is
stopped on it. J2 is one press away and always summarised in one line, and that line never
hides trouble. J3, J4 and J10 are a view you enter from J1 or J2 and leave with Back. J5, J8
and the memory half of J9 live together in Team, because all three answer "what is in each
agent's prompt?". J6, J7 and the permission half of J9 share Settings: "how the page is
wired to the outside", and rare.

---

## U2. Words

Defined once here; used only this way everywhere on screen, in `aria-label`s and in
`data-testid`s.

| Word | Means | Architectural source |
|---|---|---|
| **agent** | A folder under `agents/` with an `agent.md`. Has a name and a path (`coder/reviewer`). | manifest row |
| **thread** | One Web Worker running one agent. | §6.1 |
| **run** | One piece of work on a thread, from `invoke` to `answer`. Has an id and a parent. The roster lists live runs; the runs store keeps the last 200 finished ones. | roster slot `run`; runs store |
| **status** | The one word the loop posts for a run: `idle thinking calling waiting compacting done failed interrupted`. | slot `status` |
| **step** | One model call and what followed it. Counted `steps / maxSteps`. | slot `steps` |
| **call** | A tool call the model wrote, verbatim: `name({...})`. An agent called as a tool is a call too. | event `call` |
| **observation** | What a call returned. For an agent call, the child's answer text. | event `observation` |
| **circling** | A run that has made the same call again. Shown as **`same call ×n`**, where **n = `repeats` + 1**, the number of times that call has now been made. Circling starts at `repeats ≥ 2`, i.e. ×3: one repeat can be a legitimate retry, two is a circle. This is the only place ×n is defined. | slot `repeats` |
| **nudge** | A note left in a run's inbox, read before its next step. On screen it is called a **note**. | message `nudge`, event `heard` |
| **board** | The shared notes of one task: plans, questions, findings, notes. | §6.7 |
| **bridge** | `host/bridge.js` on the owner's machine. | §7 |
| **model** | What answers a step. An alias from `models.json` or a model id. | settings + catalogue |
| **prompt** | The rendered sheet a step sent to the model. | event `prompt` |
| **trouble** | Anything the owner must act on or at least know: approvals awaiting the owner, circling runs, failed runs not yet opened, the bridge down. | approvals, slots, bridge state |
| **risk** | What a tool can do: `read`, `write`, `exec`, `net`. Built-ins declare it; a local tool that declares none is `write`. | manifest tool row |
| **policy** | What happens to a call: `allow`, `ask`, `deny`. The settings default for its risk, overridden by the agent's `permissions:` frontmatter (by tool name or risk), overridden by an *always* rule the owner added. | settings, frontmatter |
| **guardrail** | A pattern denied always, whatever the policy (`rm -rf /`, `sudo`, `curl … \| sh`, a write outside the root). | hub |
| **approval** | A call whose policy is `ask`, paused until the owner answers **Allow** or **Deny**. | event `approval`, `hub.approvals` |
| **memory** | Short notes kept by an agent (`agent`) or for everyone (`shared`), shown in every prompt up to 2,000 characters each, newest first. | `hub.memory` |
| **learned** | A prompt layer after an agent's body, grown only from proposals the owner accepted. | `hub.dreams`, IndexedDB |
| **dream** | A run of the `dreamer` agent over a finished task. It saves memory and writes **proposals**: suggested additions to an agent's learned layer, never applied without the owner. | `hub.dreams` |
| **trace** | A whole task: the root run and every run below it. The root run id is the trace id. | slot `trace` |
| **span** | One timed piece of a trace: a step (prompt → reply) or a call. | trace spans |

Words that do **not** appear: session, chat, conversation list, workspace, dashboard,
widget, task (except in "this task" on the board), assistant, AI.

### Time, one format

- **A moment** is clock time `HH:MM` in the owner's locale, 24-hour when the locale is.
  Anything older than today is placed under a **day divider**: `Today`, `Yesterday`, then
  `Mon 21 Sep`, and `21 Sep 2025` for another year. A lone moment outside a list (e.g.
  `checked 14:02`) that is not today reads `yesterday 14:02` or `21 Sep 14:02`.
- **A duration** is `38s`, `4m 12s`, `1h 03m`. Durations never carry a clock time and clock
  times never carry seconds.

---

## U3. The map

```
 ┌──────────────────────────────────────────────────────────────────┐
 │ HARNESS    ● main waiting on coder +1 · 1 circling    Team  Settings │  header, every view
 ├──────────────────────────────────────────────────────────────────┤
 │   #/            Conversation with main        (J1)               │
 │   #/run/<id>    Thread                        (J3, J4)           │
 │   #/team        Team                          (J5)               │
 │   #/settings    Settings: Model, Bridge, Permissions, Data      │
 │                                                                  │
 │   Runs panel    beside any view ≥1100px, sheet below (J2)        │
 └──────────────────────────────────────────────────────────────────┘
```

Four views, one panel. Routing is the URL hash, so Back works and a thread can be linked;
because finished runs are kept (U12), a `#/run/<id>` link still works after a reload.

### What the architecture implied, and what was decided

| Implied | Decision | Why (know your user) |
|---|---|---|
| Conversation with main | **View, home.** | J1 is every visit. |
| Roster of threads | **Panel**, opened from the header status line. | J2 is a glance *during* J1. A separate view would take the conversation away at the moment the owner is waiting on it. |
| One thread's detail | **View.** Also used for main's own run. | J3 is reading a dense record; it needs the full width and its own Back. One view for every thread, main included, so there is one place the prompt lives. |
| Board of the current task | **Merged into the Runs panel**, below Running, shown only while the task has entries. | The board answers the same question as the roster ("what is the team doing on this task?") and lives exactly as long as the root run (§6.7). It sits below Running because the owner opens the panel to find what is stuck. |
| Agents (manifest, notes, Reload) | **View: Team.** | J5 comes in bursts, needs the whole tree, and its primary action (Reload agents) is unrelated to anything else. |
| Models | **Merged into Settings**, first section. Per-agent overrides shown in **both** Settings (one list) and Team (each row's model). | J6 is rare. The override is where the owner looks when "why did coder use the wrong model?" — they are looking at coder, i.e. in Team. |
| Host bridge | **Merged into Settings**, second section. Down state in the header's trouble; unavailable host tools in Team. | J7 is rare. Its effect (tools appear or leave) is seen where tools are listed, and its failure is trouble. |
| Approvals (HITL) | **Not a view.** One `ApprovalCard`, shown in up to three places, one state: inline in the transcript under the work line that leads to it; first in the Runs panel (`Awaiting you`); and in that run's thread view. The header's first trouble item opens the panel at it. | J0 interrupts. The owner is almost always in the conversation when it comes, so it appears there, at the work it belongs to. A separate queue view would be one more place to look while a run is stopped. Parallel runs can ask at once and need one list: the panel is that list, one press from the header. |
| Permissions | **Section in Settings** (defaults per risk, rules you added, guardrails). Each tool's effective policy, and where it came from, on its tool line in Team. | Setting a default is rare. "Why didn't coder ask?" is asked while looking at coder. |
| Memory | **Section of each agent's row in Team**, plus **Shared memory** near the top of Team. | Memory is part of what an agent's prompt contains, which is Team's question. |
| Learned layer | **Section of each agent's row in Team**, beside Memory. | Same reason: it is a prompt layer. |
| Dream proposals | **Top section of Team, `Proposals`**, with `Dream now`. The pending count sits on the `Team` link. Not a view. | J8 accepts changes *to agents*; Team is where agents are, and accepting one visibly changes that agent's row on the same screen. A view of its own would be empty most days. The count is on the link, not in trouble, because nothing is blocked on it. |
| Tracing | **Timeline section in the thread view**, and `Export trace` there. | J10 starts from "this run was slow", and the thread view is where a run is read. |
| — | **Cut:** dashboard, conversation switcher, attach, dictation, theme toggle, example prompts, a raw event log view, owner posting to the board, an owner "add memory" form, system notifications, a trace viewer beyond the timeline. | Dashboard: equal-weight widgets answer no single question. Switcher: main has one session (`session:`), no message renames or clears it. Attach and dictation: no tool or message receives them. Theme toggle: the OS already answered it; two places disagree in one. Examples: fixed examples lie when main lacks the tool; replaced by one derived line (U5.4). Event log: every event kind already has a home in the thread's history (U7). Board posting: §6.7's tools are for agents; the owner steers with a note. Add memory: there is no `hub.memory.add`; telling main "remember …" is the same act and gives the entry a source. Notifications: a permission prompt for one job the page title already covers (U4). Trace viewer: the export exists so the owner can use a better viewer than this page would build. |

---

## U4. The header

Present on every view. 48px tall. One row.

```
 HARNESS    ● main waiting on coder +1 · 1 circling · bridge down     Team   Settings
 wordmark   status line (button: opens Runs panel)                    view links
```

- **Wordmark** `HARNESS`: link to `#/`. Mono, 13px, letter-spaced.
- **Status line**: the only live element in the header. A `<button>`; pressing it toggles the
  Runs panel. It has two parts.

  **The state part**, first match wins:
  1. Boot not finished: `starting · 2 of 4 threads`.
  2. Another tab leads: `running in another tab`.
  3. main has no resolved model id (U9.1): `no model`.
  4. main's current run is active: `● main <status>`; when `current` is set,
     `● main calling host_exec` or `● main waiting on coder` (the call's name; the agent
     name for an agent call), plus ` +n` when the stage runs n more calls at once (U12 D3).
     If other runs are active and none of them is in trouble: ` · <n> running`.
  5. Anything else: `idle` in `--faint`, no dot.

  **The trouble part**, always appended after the state part, in `--bad`, each item only
  when non-zero, in this order: `· <n> awaiting you` (pending approvals, weight 600: the one
  thing that blocks a run), `· <n> circling` (active runs with `repeats ≥ 2`),
  `· <n> failed` (failed runs of any task not yet opened in a thread view this page load
  or since they failed), `· bridge down` (bridge state `down`). The trouble part is **never
  dropped** for width: the state part is shortened first.
- **When approvals are pending**, pressing the status line opens the Runs panel scrolled to
  `Awaiting you`, with focus on the oldest card's call text (not its `Allow` button), so a
  keyboard user reads before acting (U5.5).
- When only the dreamer is active, the state part reads `● dreaming` in `--dim`.
- **Page title**, for the tab the owner switched away from: `(<n>) awaiting you — HARNESS`
  while approvals are pending, else `HARNESS`. It is the only signal outside the page.
- Seconds are **not** in the header: the owner does not need a ticking number while reading;
  it is in the transcript's working line and the panel.
- **Team**, **Settings**: text links. `Team` carries the pending proposal count, `Team · 2`,
  in `--dim` (not trouble: nothing waits on it). The current view's link is `aria-current="page"` with
  `--text` weight 600; others `--dim`.

**At 390px** the wordmark becomes `H` (still the link) and the state part shortens in this
order until the line fits: drop ` · n running`; drop ` +n`; drop the call name
(`● main waiting`); drop `main` (`● waiting`). The trouble part keeps its words but uses the
short forms `2 awaiting you`, `2 circling`, `1 failed`, `bridge down`, joined by ` · `. If it still does not
fit, `Team` and `Settings` fold into one `Menu` button holding both links; the trouble part
still shows.

**Announcements.** `aria-live="polite"` on the status line fires when main's status word
changes, when a trouble item appears or clears (a new approval says `coder asks to run host_exec`), and once when the bridge recovers
(`bridge answering again`, U9.2). Never on a seconds tick.

---

## U5. Conversation (`#/`)

**Question the owner brings:** "What did main say, and is it still working on my question?"

Reads: main's resident run (the roster slot whose `agent` is `main` and `depth` is 0), its
`history {turns}` (which carry their time), and live `event`s for that run.

### U5.1 Reading order

1. **Transcript**, one column, 66ch measure, oldest at top, with day dividers (U2 Time)
   between turns on different days, and each of your turns showing its clock time in
   `--faint`. Auto-scroll is pinned to the bottom unless the owner has scrolled up; then a
   `Jump to latest` button appears bottom-right.
   - **Your turn**: the owner's text, right-aligned block, `--raise` background.
   - **Work** (between a question and its answer): one line per call, U5.2.
   - **main's answer**: 18px proportional, left, no bubble. Streamed from `delta` and
     `field answer` events; replaced by the final `answer` event.
   - **Notes** you left during a turn, in place, U5.3.
   - **Approvals** from any run of this task, under the work line they belong to, U5.5.
2. **Working line**, only while main's run is active, directly under the last work line:
   `● waiting · step 3 of 20 · 12s` (status word, steps/maxSteps, seconds from the slot). If
   main is circling: append ` · same call ×n` in `--bad`. While any run of this task awaits
   an approval: ` · waiting on you` in `--bad` replaces the status word.
3. **Composer**, sticky at the bottom (U5.3).

### U5.2 A work line (the step)

```
 ▸ Asked coder                                   waiting · 8s   ›
 ▸ Ran a command on your machine                 1.2s          ⌄
     host_exec({"command": "ls"})
     README.md  src  test
```

- **Verb** comes from the call's **name only** (text before the first `(`), never from its
  arguments:

  | Name | Line |
  |---|---|
  | an agent tool (the call has an `event child`) | `Asked <agent>` |
  | `host_exec` | `Ran a command on your machine` |
  | `host_read` / `host_write` / `host_list` | `Read a file on your machine` / `Wrote a file on your machine` / `Listed a folder on your machine` |
  | `host_fetch` | `Fetched a page through the bridge` |
  | `board_post` / `board_resolve` / `board_tell` / `board_list` | `Posted to the board` / `Resolved a board entry` / `Left a note for another run` / `Read the board` |
  | `skill` | `Loaded a skill` |
  | anything else | `Called <name>` |

  A built-in set whose tool names are not yet fixed (`files`, `web`) falls to `Called <name>`
  until they are; add a row here when they are named.
- **Binding a work line to its child run.** A line is created by `event call`. When the
  hub starts a child for it, the parent run receives `event child {name: <verbatim call
  text>, value: <child run id>}`; the line whose call text equals `name` and has no child
  yet takes that id (first unbound match, so two identical calls in one stage bind in
  order). The line reads the child's status only by that id: from the roster while the
  child is live, from the runs store once it has finished. It never looks a child up by
  parent and agent name.
- **Right side**, on the same line as the verb at every width:
  - agent call, child live: the child's status word and seconds, then `›` → `#/run/<child>`.
  - agent call, child finished and kept: `done 8s ›` or `failed ›` (`--bad`).
  - agent call, child not in the store (older than the last 200 runs): `run not kept ·
    answer below`, no `›`; expanding the line shows the observation, which is the child's
    answer.
  - other calls: `running` with a pulsing dot until the observation arrives, then its
    duration (`ms` from the observation), or `failed` in `--bad` when `ok` is false.
  - a call (or a call anywhere below an agent call) awaiting an approval: `waiting on you`
    in `--bad`, and the `ApprovalCard` directly under the line (U5.5).
  - a call the owner denied: `denied by you` in `--dim` (a choice, not a fault). A call a
    policy or guardrail denied: `denied` in `--bad`; expanded, the observation (the
    refusal and its reason) is shown first.
- **Expanded** (press the line): the call verbatim in mono, then the observation verbatim in
  mono, max 12 lines with `Show all <n> lines`. Horizontal scroll inside the block only.
- **Collapsed by default.** The line for the call now running is expanded automatically,
  and collapses when its observation arrives, unless the owner opened it.
- Staged calls `[[a, b], [c]]`: each stage's lines are grouped with a 2px `--rule` bar on
  the left; lines in one stage run together.

`reasoning` events: one folded line `Reasoning` (`--faint`), expanded shows the text in
`--dim`. Absent if the run produced none.

`error` events for main's run: an inline line in `--bad`: `Model call failed: <value>`, and
while `retry` events follow, `retrying (2 of 3)`.

### U5.3 Composer and notes

```
 ┌───────────────────────────────────────────────┐
 │ Ask main                                 Send │
 └───────────────────────────────────────────────┘
```

- Textarea, grows to 8 lines then scrolls. Enter sends; Shift+Enter is a newline. On a
  touch device (`hover: none` and `pointer: coarse`) Enter is a newline and only the button
  sends.
- **While main's run is idle or done**: placeholder `Ask main`, button `Send`, sends
  `invoke {query}` to main's thread.
- **While main's run is active**: placeholder `Add a note main reads before its next step`,
  button `Note`, sends `nudge {text}`. Beside it **`Stop`**, a two-press control like the
  thread view's Abort (U7.1): first press relabels it `Stop main and <n> below` (n counted
  from the roster; `Stop main` when n is 0), a second press within 4s sends `abort` to
  main's run, which reaches every run below it (§6.5). Otherwise it reverts after 4s. After
  it is sent: `Stopping…` until the slot reads `failed` or `done`.
- **A note, once sent**, appears in the transcript at the point it was sent:
  `Note for main · waiting for next step`, which becomes `Note for main · read at step 4`
  when `event heard` arrives for that run. The same line, with the same wording and
  behaviour, appears in the thread view's history (U7.1) for a note sent to any run.
- Disabled, with the reason as placeholder, when: main has no model (`Connect a model
  first`); another tab leads (`Running in another tab`); main failed to load (`main did not
  load — see Team`).

### U5.4 States

| State | Words |
|---|---|
| **First visit, no model** | Heading `No model yet`. Line: `HARNESS brings no model. Point it at one and main can answer.` Button: `Connect a model` → `#/settings`. Under it one line derived from the manifest: `main can use 6 tools and ask 2 agents: coder, researcher.` with `See the team` → `#/team`. |
| **Model set, empty history** | Only the derived line above, in `--dim`, centred, and the composer focused. |
| **Loading** | Boot screen, U10. |
| **main interrupted** | Banner above the composer: `The last turn was cut off when the tab closed at 14:02.` Button **`Resume`** sends `resume` to main's thread; the banner then reads `Resuming from step 4…` until the slot leaves `interrupted`. Secondary text link `Dismiss` hides the banner for this page load and leaves the run interrupted. |
| **main failed** | The turn ends with a `--bad` line: `main stopped: <slot.error>` and `Open the thread` → `#/run/<id>`. |
| **Stale** (main marked for reload) | Under the composer, `--faint`: `main restarts with your edits when this turn ends.` When `event restarted` arrives it becomes `main restarted with your edits at 14:05.` for the rest of the page load. |

### U5.5 Approvals (J0)

**Question:** "Should this exact call run?"

An `event approval {name: tool, value: verbatim call, risk, reason}` on any run pauses it
(slot `waiting`) and the hub queues it. The UI reads the queue with `hub.approvals.list()`
(on load and on every `approval` / `approved` event) and draws one **ApprovalCard** per
pending entry. The same card, with one shared state, appears:

- **in the transcript**, directly under main's work line that leads to the asking run: the
  call itself if main asked, else the agent call whose child tree contains it (followed
  through `event child` ids). Several cards under one line stack oldest first;
- **in the Runs panel**, section `Awaiting you` (U6.1);
- **in the asking run's thread view**, in place of the Now block (U7.1).

Answering in one place answers everywhere.

```
 ┌───────────────────────────────────────────────────────────────────┐
 │ coder/reviewer wants to call host_exec          exec · asked 14:02 │
 │ host_exec({"command": "rm -rf build && bun run build"})            │
 │ Asked because: exec is set to ask (default)                        │
 │ Note to coder/reviewer (optional)  [                             ] │
 │ [ ] Always allow host_exec for coder/reviewer                      │
 │ [ Allow ]  [ Deny ]                                   waiting 42s  │
 └───────────────────────────────────────────────────────────────────┘
```

Reading order and rules:

1. **Who and what**: `<agent path> wants to call <tool>`, then the risk word (mono) and the
   clock time it was asked. Border `--bad` 1px: a run is stopped on this.
2. **The call verbatim**, mono, never truncated: it wraps inside the card only here, because
   this is the one block the owner must read whole before acting. Long arguments fold at
   12 lines with `Show all <n> lines`; `Allow` stays disabled until any fold is opened.
3. **`Asked because:`** the event's `reason` verbatim (e.g. `exec is set to ask (default)`,
   `agents/coder/agent.md sets write: ask`).
4. **Note** (optional, one line): sent as `note`; the agent reads it with the observation
   (`Allow`) or with the refusal (`Deny`).
5. **Always**: checkbox `Always allow <tool> for <agent path>`, with `--faint` help
   `Adds a rule in Settings → Permissions.` When checked, the Allow button reads
   `Always allow`. It has no effect on Deny, so Deny's label never changes.
6. **Allow** and **Deny**: equal weight, neither pre-focused, no Enter shortcut on the
   card, one press each (the card is the confirmation). They send
   `hub.approvals.answer(id, {approved, note, always})`. Right side: `waiting <duration>`,
   ticking at 1 Hz.

After an answer, until `event approved` arrives: buttons disabled, `Sending…`. Then the card
collapses to one line that stays in the transcript and thread history:
`You allowed host_exec · 14:03 · note: "only inside build/"`, or `You denied host_exec ·
14:03`, or `You always allowed host_exec for coder/reviewer · 14:03`.

States:

| State | Words |
|---|---|
| The run stopped or was aborted while asking | Card becomes one `--faint` line: `No longer needed — coder/reviewer stopped.` |
| Answer failed to reach the hub | `Could not send your answer. Try again.` Buttons re-enabled. |
| Another tab leads | Card shown, buttons disabled: `Answer in the other tab.` |
| Several pending | Each its own card; the header counts them. There is no "allow all": each call is read. |

At 390px: the header line wraps (risk and time on a second line); `Allow` and `Deny` are
each half width, 44px tall; the note field is full width.

### U5.6 At 390px

Measure becomes full width minus 16px gutters. Your turn blocks become full width with a
left 24px indent. **Work lines stay one line**: the right side (status, seconds or duration,
`›`) keeps its width and the verb truncates with an ellipsis; the full verb is in the
expanded block's first line and the line's `aria-label`. The composer sits above the
keyboard (`visualViewport` resize → `--kb` inset) and respects
`env(safe-area-inset-bottom)`. `Note` and `Stop` sit side by side under the textarea.

---

## U6. The Runs panel (J2)

**Question:** "What is running right now, and is any of it stuck?"

Reads: every roster slot of the current task tree (the root is main's latest run), the runs
store for the finished runs of that tree, and the hub's board for that root.

Opens from the header status line. ≥1100px: docked right, 360px wide, pushes the view; it
stays open across views until closed. <1100px: bottom sheet at 85dvh with a grab handle,
closed by Esc, a swipe down on the handle, or tapping the scrim. Its open state is kept in
`localStorage` (wrapped in try/catch; default closed).

### U6.1 Reading order

0. **Awaiting you · n** (only while approvals are pending): one `ApprovalCard` each (U5.5),
   oldest first, across every run of every task. First because it is the only thing in the
   panel that blocks work.
1. **Running**: the tree of active runs (status `thinking calling waiting compacting`),
   indented by `depth`, children under their `parent`, siblings ordered by `startedAt`.
   Circling runs are not moved (the tree is the structure) but carry the `--bad` marker
   (U6.2), and the section heading counts them: `Running · 4 · 1 circling`.
2. **Board — this task** (only if the board has entries). U6.3.
3. **Finished** (collapsed by default: `Finished · 5`; expanded by default if any is
   failed: `Finished · 5 · 1 failed`): done, failed and interrupted runs of this task, most
   recent first. Opening a failed run's thread view clears it from the header's trouble.

Older task trees are not listed here: the owner's question in this panel is about now. Their
runs are still reachable from the conversation's work lines (U5.2).

### U6.2 A roster row

```
 ● coder/reviewer    calling       4/20   38s
   same call ×3 · host_exec({"command": "bun test"})
```

- Line 1: status dot, agent path (mono), status word, `steps/maxSteps`, `seconds`.
- Line 2 (only when `current` is set): the call now running, verbatim, one line, ellipsis,
  plus ` +n` when the stage runs n more. If circling, prefixed `same call ×n · ` in `--bad`.
- If `steps/maxSteps ≥ 0.9`: the fraction is `--bad`; ≥ 0.7: `--text` weight 600. Else
  `--dim`. (The 70% and 90% budget warnings, §1.)
- If the slot's `model` differs from the default: a third line in `--faint`: the model.
- Press anywhere on the row → `#/run/<run>`. On ≥1100px the panel stays open.

### U6.3 The board section

```
 Board — this task                                  3 open
 question  Which test runner does this repo use?   researcher · rev 2
 plan      1. read package.json 2. run tests …      main · rev 1
 finding   bun test, 142 tests, 0 failing           coder · rev 1
 Resolved · 4
```

- Open entries grouped in this order: **question, plan, finding, note**. Kind label mono
  `--dim`, text proportional (2 lines, then `more`), author and `rev` right in `--faint`.
- Resolved entries collapsed under `Resolved · n`; expanded they are `--faint`, with the
  kind label struck through (never the text: struck text cannot be read).
- Read-only. When the root run ends the board is released (§6.7); the section then reads
  `The board was released when the task ended at 14:09.` until the next task starts, so an
  entry the owner was reading does not simply vanish.

### U6.4 States

| State | Words |
|---|---|
| Nothing running, nothing finished | `No runs yet. Runs appear here when main starts working.` |
| A dream is running | It is its own task tree: `dreamer` rows appear under Running like any run, headed `Dreaming over the task from 14:02`. |
| Nothing running, some finished | Running section reads `Nothing running.`; Finished expanded. |
| Another tab leads | `Runs are in the other tab.` |

Live: rows update on every `status {slot}`. Seconds advance locally at 1 Hz from the last
slot's `seconds` while the status is active, and re-anchor on each new slot. All roster
repaints are coalesced into one `requestAnimationFrame`.

---

## U7. Thread (`#/run/<id>`) (J3, J4)

**Question:** "What exactly did this thread do, what is it doing now, and what did it see?"

This is the evidence register: dense, mono for anything machine-written, gridded. Used for
every run, main's included. The id is looked up in the roster first, then the runs store,
so a link from yesterday's work line opens the kept record.

### U7.1 Reading order

1. **Back**: `← Conversation` (or `← Runs` if entered from the panel on <1100px). Then the
   **agent path** as the title, mono 21px, and the run id `--faint` 12px.
2. **Slot header**: one grid of label/value pairs from the slot:
   `status` · `step 4 of 20` · `38s` · `model qwen2.5-coder` · `called by main` (link to the
   parent run; absent at depth 0) · `depth 1` · `started 14:02` (day-qualified if not
   today) · `trace <root id>` (link to the root run; absent when this run is the root).
   Right of the title: **`Export trace`** (U7.2). Then `goal`: the query that started the
   run, proportional, 3 lines then `more`.
3. **Trouble** (only when present), `--bad` blocks:
   - failed: `Stopped: <slot.error>` (this includes `sent no ready after 10s`, U8.6).
   - circling: `Same call ×n: <current call verbatim>`.
   - interrupted: `Cut off when the tab closed at 14:02.` with **`Resume`** (sends
     `resume`), then `Resuming from step 4…` until the slot leaves `interrupted`.
4. **Approval** (only while this run awaits the owner): its `ApprovalCard` (U5.5), in
   place of the Now block.
   **Now** (only while active and not awaiting the owner): the call now running, verbatim in mono, with a pulsing dot
   and its seconds, ` +n` if the stage runs more; or `thinking` / `compacting`; or
   `waiting on <child path>` with each child as a link (by the ids from `event child`).
5. **Note** (only while active): one-line input, placeholder `Note for <agent>, read before
   its next step`, button `Send note`, sends `nudge {text}` to this run. Beside it
   **`Abort`**, two-press: first press relabels it `Abort this run and <n> below` (`Abort
   this run` when n is 0), a second press within 4s sends `abort`; otherwise it reverts.
   After abort: `Aborting…` until the slot reads `failed` or `done`.
6. **Timeline**, U7.2.
7. **History**: the run's turns, oldest first, with day dividers when the run crosses a
   day, from `history {turns}` and extended by live events:
   - user turns: the query; notes shown as `Note · waiting for next step` then
     `Note · read at step n` on `event heard` (same wording as U5.3).
   - assistant turns: the model's raw reply in mono (evidence: TOON/JSON as written, not
     re-rendered), with `step n` in the gutter.
   - calls and observations: the call verbatim, the observation verbatim, folded at 12
     lines; an agent call's line links to its child by `event child`.
   - system lines in `--faint`: `repaired reply (1 of 2)`, `retrying model call (2 of 3)`,
     `budget 70%` / `budget 90%` (the latter `--bad`), `compacted history: 41 turns →
     1 summary`, `final summary, no tools` (the step-cap call, §1), `restarted with your
     edits at 14:05`.
   - approval records, as collapsed in U5.5: `You allowed host_exec · 14:03`.
8. **Prompt**: collapsed section `Prompt at step 4 · 3,812 tokens`. Expanded: the whole
   rendered sheet verbatim, mono 12px, `white-space: pre`, in its own horizontally
   scrolling box capped at 70dvh with its own vertical scroll; above it `Step ‹ 4 ›` to step
   through this run's earlier prompts, and `Copy`. This is acceptance 3's evidence: an edit
   to `agent.md` is visible here at the next step.

The prompt shows the `memory` context piece and the **learned** layer where they render, so
the owner can see a memory or an accepted proposal reach the agent (acceptance 3's evidence,
extended).

**Primary action:** Allow / Deny (while awaiting the owner), Send note (while active),
Resume (while interrupted). **Secondary:**
Abort, Copy prompt, Export trace. A finished run has no primary action: it is a record.

### U7.2 Timeline and trace export (J10)

**Question:** "Where did this run's time go?"

Reads the run's spans: steps `{n, ms, tokens}` (prompt → reply) and calls `{name, ms, ok,
child}`, each with a start offset.

Collapsed by default, and the collapsed line already answers the question:

```
 Timeline · 1m 12s · model 48s · tools 21s · agents 3s        ⌄
```

`model` sums step spans, `tools` sums non-agent call spans, `agents` sums agent call spans
(time spent waiting on children). Expanded, one row per span of **this run only**, in start
order; an agent call is one row with `›` to the child's own thread, so the list stays short
and each run's detail is in its own view:

```
 step 1           ▇▇▇▇▇▇░░░░░░░░░░░░░░░░░    6.2s  1,204 tok
 host_exec        ░░░░░░▇▇░░░░░░░░░░░░░░░    1.1s  ok
 coder            ░░░░░░░░▇▇▇▇▇▇▇▇▇▇▇▇▇░░     38s  ok  ›
 step 2           ░░░░░░░░░░░░░░░░░░░░▇▇▇    4.0s    980 tok
```

- Label mono, 16ch, ellipsis. Track: offset and width as a share of the run's duration,
  min 2px. Step bars `--signal` (measured), call bars `--dim`, failed calls `--bad`. The
  numbers on the right are the readout; the bar is only where it sits in time.
- Tokens are shown as the architecture measures them: estimated, so the column header
  reads `tok (est.)`.
- While the run is active, rows appear as spans close; the open span is drawn to "now".

**Export trace** (button right of the title, on every run of the trace):
`hub.traces.export(trace)` hands the browser a file `harness-trace-<trace id>.json`, which
the browser saves (the owner pressed it; nothing else happens). Under the button, once,
`--faint`: `One JSON file of the whole task. It is saved to your computer and sent
nowhere.` While building: `Preparing…`. On failure: `Could not build the trace: <error>`.

At 390px: label 10ch, track at least 96px, the right readout keeps its width; the
collapsed summary wraps after the total.

### U7.3 States

| State | Words |
|---|---|
| Id in neither roster nor store | `This run was not kept.` `HARNESS keeps the last 200 runs; its answer is in the work line that called it.` Link `← Conversation`. |
| History not yet received | Slot header shows; history area: `Waiting for the thread's history…` |
| No prompt yet (run just started) | `No prompt yet. The first step has not been composed.` |
| Thread died | Slot header `failed`; block: `The thread stopped: <fatal message>. Its caller was told.` |

### U7.4 At 390px

Slot header grid becomes two columns. The note input is full width, `Send note` and `Abort`
side by side under it. Every mono block scrolls horizontally inside itself; the page never
scrolls sideways.

---

## U8. Team (`#/team`) (J5)

**Question:** "Did my edit load, and what is each agent now given: its tools, their
permissions, its memory, and what it has learned?"

Reads: `manifest()` (§5.3), `hub.memory.list()`, `hub.dreams.list()`, settings (policy
defaults and always rules), `ready {tools, notes}` from each live thread, the roster (for
stale and resident state), `event restarted`, settings (for resolved models), bridge state
(for unavailable reasons), and the last `hub.reloadAgents()` result.

### U8.1 Reading order

1. Title `Team`, and the primary action **`Reload agents`** on the same line, right. Under
   the title in `--faint`: `build <build>` (from `index.json`), so the owner can tell a
   stale deploy from a stale edit.
2. **Result of the last reload** (only after one, this page load). Every item is named; a
   count is only a heading:

   ```
   Reloaded 14:02 · build 7f3a1c2
   Failed (1)
     agents/coder/agent.md — frontmatter line 3: expected "key: value"
   Changed (2)
     main       agents/main/agent.md, agents/main/tools.js
     researcher agents/researcher/agent.md
   Added (1)
     writer     agents/writer/agent.md, agents/writer/tools.js
   Removed (0)
   Waiting to restart (1)
     main       restarts with your edits when its turn ends
   ```

   - Groups with nothing in them are omitted, except that an all-empty result reads
     `Reloaded 14:02 · build 7f3a1c2 · nothing changed.`
   - `Failed` comes first, in `--bad`, with the error verbatim.
   - `Waiting to restart` rows change to `restarted 14:05` when `event restarted` arrives.
3. **Proposals**, U8.2 (always present: it holds `Dream now`).
4. **Shared soul**: `soul.md · shared by 4 agents` (agents with their own `soul.md` are
   named: `· main has its own`). Expand shows the text.
5. **Shared memory**: `Shared memory · 5 entries · 1,340 of 2,000 characters in every
   prompt`. Expand shows the entries, U8.3.
6. **Broken folders**, each a `--bad` block: `agents/coder/agent.md — <error>`, verbatim.
   The others still load (§10).
7. **The tree**: agents in folder order, owned sub-agents indented under their owner. Each
   row collapsed:

   ```
   coder                      resident · local (qwen2.5-coder) · override · changed
   Writes and runs code in the root.
   6 tools · 1 unavailable · 1 note
   ```

   - line 1: name (mono), thread kind (`resident` or `per call`, §6.2), model as `alias
     (resolved id)`, `override` if the frontmatter `model:` differs from the default,
     `changed` (`--signal`: it is measured, a hash differed) from the last reload until the
     next one, `restarts when idle` (`--dim`) while stale, `failed` (`--bad`) if its thread
     failed to start.
   - line 2: `description`, proportional, 1 line.
   - line 3: counts, as a summary of the expanded lists below:
     `6 tools · 2 ask · 1 unavailable · 1 note · 4 memories · learned 3`. Rows with a note, an
     unavailable tool, a shadowed name, or a failed thread are **expanded by default**, so
     every name is on screen without a press.

   Expanded, in this order:
   - **Notes**, first, each verbatim from `ready {notes}` and the manifest, e.g.
     `agents/main/tools.js did not import: SyntaxError: Unexpected token '}' (line 14)` in
     `--bad` followed by `main is running without the tools in that file.`, or
     `unknown key "temprature" — ignored` in `--dim`.
   - **Tools**, grouped by tier in resolution order: `local`, `common`, `built-in`, `agent`.
     Each name mono, its description `--dim`, and on the right its **risk · policy** and
     where the policy came from:

     ```
     host_exec    exec · ask     default
     write_file   write · allow  agents/coder/agent.md
     add          write · ask    default · risk not declared
     host_fetch   net · allow    always rule, added 14:03
     ```

     Policy words are plain `--text`; `deny` is `--dim` with the source (a choice, not a
     fault). An agent call is `agent` with no policy: calls inside it are judged in the
     child. Markers:
     - `shadows built-in add` (`--dim`) on the local tool that wins, per §5.2.
     - unavailable: name struck through, then the reason in words, e.g.
       `host_exec — needs the bridge (down since 14:02)`. A tool granted but missing from the
       prompt is never silently absent.
     - tools from a file that did not import are listed under that file's note, struck
       through, reason `its file did not import`.
   - **Memory**: this agent's entries, U8.3.
   - **Learned**: this agent's learned layer, U8.4.
   - **Files**: `agent.md`, `tools.js`, `soul.md` paths, mono, `--faint`.
   - For a resident agent: `Open thread` → its current run.

### U8.2 Proposals and dreaming (J8)

**Question:** "What does the dreamer suggest each agent learn, and is it right?"

Reads: `hub.dreams.list()` (pending proposals `{id, agent, kind, text, why, from}` and the
last dream: when, which task, memories saved, proposals made, its run id, error), the
dreamer's run from the roster/runs store.

```
 Proposals · 2                                               Dream now
 Last dream 14:20 over the task from 14:02 · saved 3 memories · 2 proposals · Open run

 coder · learned                                     from run 3f2a · 14:20
 ┌────────────────────────────────────────────────────────────────┐
 │ When bun test fails with ENOENT, run bun install first.        │
 └────────────────────────────────────────────────────────────────┘
 Why: in run 3f2a coder ran bun test three times before installing.
 [ Accept ]   Reject
```

- **The text is editable** (a textarea, proportional 15px): the owner often wants the
  lesson, not the dreamer's wording. When edited, `Accept` reads `Accept edited` and sends
  `hub.dreams.accept(id, text)`; unedited, `hub.dreams.accept(id)`.
- `from run 3f2a` links to that run (runs store). `Why:` is the dreamer's reason verbatim.
- **Accept** appends to that agent's learned layer. The card becomes one line for this page
  load: `Added to coder's learned layer · 14:22 · takes effect at coder's next step`, and
  coder's row shows `learned changed` (`--signal`).
- **Reject** (one press; it discards a suggestion, not the owner's work) sends
  `hub.dreams.reject(id)`; the card becomes `Rejected · 14:22`.
- Order: grouped by agent in folder order, oldest first within an agent.
- **Dream now** (secondary, top right) sends `hub.dreams.run()`. Label `Dreaming…` while
  the dreamer runs; disabled with `Nothing to dream over yet` before any root run has
  finished.
- **Memory the dream saved** is not proposed: it is applied (source `dream`). The last-dream
  line counts it, and each entry is in the agent's Memory list marked `from a dream`, where
  the owner can edit or remove it.

States:

| State | Words |
|---|---|
| No proposals, never dreamed | `No proposals. After a task has been idle for 20s, the dreamer reads it and suggests what each agent could learn. Nothing it suggests changes a prompt until you accept it.` |
| No proposals, dreamed | `Nothing to propose from the task at 14:02.` plus the last-dream line. |
| Dream failed | `--bad`: `The last dream failed: <error>` · `Open run`. |
| No `dreamer` agent in the folders | `There is no agents/dreamer/agent.md, so nothing dreams.` `Dream now` hidden. |

### U8.3 Memory (J9)

**Question:** "What does this agent carry into every prompt, and where did it come from?"

Reads `hub.memory.list(agent)` (or `list()` for shared): `{id, agent|'shared', text, source,
at}`, newest first.

```
 Memory · 4 entries · 1,640 of 2,000 characters in coder's prompt
 Prefers bun over npm in this repo.        from run 3f2a · 14:20     Edit   Remove
 The build output goes to build/.          from a dream · 14:20      Edit   Remove
 Owner's name is Kaush.                    from you · 21 Sep         Edit   Remove
 ─ not in the prompt: over 2,000 characters ─
 Old note about the v1 API.                from run 91c0 · 2 Sep     Edit   Remove
```

- **Source** in words: `from run <id>` (link), `from a dream`, `from you` (an entry the
  owner edited). Day-qualified time per U2.
- **The cap is drawn**: entries are counted newest first and a divider marks where 2,000
  characters runs out; entries below it are `--faint` and the agent does not see them. This
  answers "why doesn't it remember that?" without reading the prompt.
- **Edit**: the text becomes a textarea with `Save` / `Cancel`; `Save` sends
  `hub.memory.edit(id, text)`, after which the source reads `from you`.
- **Remove**: two-press, `Remove` → `Remove for good` within 4s, then
  `hub.memory.remove(id)`.
- Changes reach the agent at its next step (the `memory` context piece renders per step).
- Empty: `No memory yet. An agent saves memory with memory_save when it has it; you can
  also tell main "remember …".` If the agent is not granted `memory`: `coder is not granted
  the memory tools, so it keeps none.` and no list.

### U8.4 Learned layer

**Question:** "What has this agent been taught, and does my folder have it?"

```
 Learned · 3 entries · in coder's prompt after its body
 1. When bun test fails with ENOENT, run bun install first.      accepted 14:22
 2. …
 Export learned.md    Write to ~/work/agents/coder/learned.md
```

- Read-only list of accepted entries in order, each with when it was accepted.
- **Export learned.md** hands the browser `learned.md` for this agent to save.
- **Write to <path>** is shown only while the bridge is answering with files on; the path is
  the bridge root joined with `agents/<path>/learned.md`. After writing: `Written 14:25.
  Publish your agents to keep it with the folder.` On failure, the bridge's error verbatim.
  Without the bridge: one `--faint` line, `Writing to the folder needs the bridge with
  files on.`
- Empty: section omitted; line 3 of the row omits `learned`.

### U8.5 States

| State | Words |
|---|---|
| Reloading | Button reads `Reloading…`, disabled; rows unchanged until the result arrives. |
| Index unreadable | `Could not read agents/index.json (<status>). The page was built without its agents, or the dev server is not regenerating it.` Button stays enabled to retry. |
| No agents | `agents/ has no agent.md. Add agents/main/agent.md and press Reload agents.` |
| main missing | Top `--bad` block: `There is no agents/main/agent.md, so there is no one to talk to.` |

### U8.6 A thread that never answers

A thread that has sent no `ready` 10s after `init` is `failed` with error `sent no ready
after 10s` (U12 D4). Its row shows `failed` and an expanded note: `The thread started but
never reported its tools. Check agents/<path>/ for a tool file that hangs at import.` This is
also a header trouble item until opened.

Live: the tree re-renders on reload results, on `ready` from any restarted thread and on
`event restarted`. Not otherwise; this view is stable while the owner reads it.

At 390px: line 1 of a row wraps the model onto its own line; tool descriptions go under the
name; the reload result's path lists wrap at commas.

---

## U9. Settings (`#/settings`) (J6, J7)

**Question:** "Which model will answer the next step, is the bridge there, and what may
agents do without asking me?"

Four sections, in this order (Model, Bridge, Permissions, Your data), each a heading on one page (no tabs: all four fit on one
scroll, and a tab would hide the Bridge from the owner looking for why host tools vanished).

**Committing.** Text fields (Base URL, API key, bridge URL, token) commit on blur or Enter;
a field with an uncommitted edit shows `not saved` beside it in `--faint`. Selects and
checkboxes commit immediately. Every commit of a model setting sends `settings {...}` to
every live thread (acceptance 5).

### U9.1 Model

Reads: settings (IndexedDB), `models.json` catalogue, the fetched model list, manifest rows'
`model`, and the latest `answer` / `error` event from any run for the Last call line.

```
 Model

 Provider   [ OpenAI-compatible ▾ ]
            Local servers use OpenAI-compatible with their localhost URL.
 Base URL   [ http://127.0.0.1:1234/v1       ]
 Key for local   [ ••••••••••••            ] Show
 Default    [ local (qwen2.5-coder) ▾ ]   Refresh list
            Found 14 models · 14:02
            Next step uses local (qwen2.5-coder) on every thread except coder, haiku.
 Last call  main · ok · 1.4s · 14:02

 Agents that override this
   coder     local (qwen2.5-coder)   agents/coder/agent.md
   haiku     gpt-4.1-mini            agents/main/haiku/agent.md
 Overrides are set in each agent's frontmatter.
```

- **Provider**: `OpenAI-compatible` or `Anthropic`.
- **Key**: keys are stored **per catalogue entry**, so the label names the entry the key
  belongs to: `Key for <alias>` (or `Key for <base URL host>` for a bare model id).
  Switching the Default to another entry shows that entry's key field; a key is never
  reused across entries. An empty key field reads `No key — fine for a local server`.
- **Via the bridge**: a checkbox `Send model calls through the bridge`, shown only while the
  bridge is answering (§7).
- **Default**: aliases from `models.json` first (`alias (id)`), then fetched ids. Option
  text is capped at 60 characters with ellipsis (a 258-character option once made a sheet
  1,813px wide, INTERFACE.md).
- **Refresh list** re-fetches the provider's model list. Result line: `Found 14 models ·
  14:02`, or the failure in words (U9.5).
- **Next step line**: `Next step uses <default> on every thread` when no agent overrides
  it; `… on every thread except <names>` (agents whose resolved model differs, comma-listed,
  in folder order) when some do; `Next step uses <default> on no thread — every agent
  overrides it` when all do.
- **Model set** means main's resolved model has a model id, from settings, `models.json`
  or its frontmatter. When it has none: the Default select reads `Choose a model`, the
  header reads `no model`, and the conversation shows U5.4's first-visit state.
- **Last call** is the honest check: the result of the last real model call, not a probe.
  Before any call: `No call yet. Ask main something to check it.`
- **Agents that override this**: read-only; the fix is in the file. Omitted when none.

### U9.2 Bridge

Reads: bridge state from the hub: `url`, `state ∈ paired | answering | down`, `since`, and
the last `/health` result `{name, version, root, capabilities}`. The hub polls `/health`
every 30s while paired.

**Not paired:**

```
 Bridge                                         not paired
 The bridge lets agents run commands, read your files and fetch any page, from your
 own machine. Run it in a terminal:

   bun host/bridge.js --root ~/work          Copy

 URL    [ http://127.0.0.1:7717 ]
 Token  [                        ]   (printed by the bridge when it starts)
 [ Pair ]

 A paired page can run commands as your user inside the root. Pair only a page you
 trust, and pick a root that holds nothing you would not let an agent change.
```

**Paired, first check pending** (`paired`): `Bridge · paired · checking…`.

**Answering:**

```
 Bridge                                         answering since 14:02
 harness-bridge 0.1.0 · root ~/work · checked 14:05
 exec on · files on · fetch on
 Adds host_exec, host_read, host_write, host_list, host_fetch.
 Idle threads have them now; busy resident threads get them at their next idle restart.
 [ Disconnect ]
```

**Down:**

```
 Bridge                                         down since 14:02
 No answer from http://127.0.0.1:7717.
 Host tools leave at each thread's next start. A call in flight will say so.
 [ Check now ]   Disconnect
```

- **Pair**: the page (not a worker) calls `GET /health` first, so Chrome's local-network
  prompt appears on the page (§2), then one token-bearing call. Success → `answering`, and
  the hub passes `host` in `init` to threads started from now. Idle threads restart so their
  tools update; busy resident threads are marked stale and get the tools at their next idle
  restart (same rule as Reload, §6.8).
- **Recovery** from `down` to `answering` is announced **once**: the header's live region
  says `bridge answering again`, the `bridge down` trouble item clears, and this section
  reads `answering again since 14:07 · host tools return to each thread at its next idle
  restart` until the page reloads.
- Capabilities show `off` in `--faint` for `--no-exec` / `--no-fs` / `--no-fetch`, and the
  "Adds …" line lists only the tools those capabilities keep.
- **Check now** asks the hub for an immediate `/health`.
- **Disconnect**: forgets URL and token, restarts idle threads without `host`.

### U9.3 Permissions (J9)

Reads settings: the default policy per risk and the always rules; the hub's guardrail list.

```
 Permissions
 When an agent calls a tool of this risk:
   read    [ allow ▾ ]
   net     [ allow ▾ ]
   write   [ ask ▾ ]
   exec    [ ask ▾ ]
 An agent's permissions: frontmatter overrides these. Team shows what each tool ends up with.

 Rules you added · 2
   host_exec   for coder/reviewer   allow   added 14:03 from an approval   Remove
   host_fetch  for researcher       allow   added 21 Sep from an approval  Remove

 Always denied
   rm -rf /  ·  sudo  ·  curl … | sh  ·  writes outside the bridge root
   These are refused whatever the policy says. The refusal names the pattern.
```

- The four selects commit immediately and send `settings {...}`; the next call of that risk
  on any thread is judged by the new default.
- Setting `write` or `exec` to `allow` adds one `--bad` line under it, e.g. `exec: allow —
  every agent without its own rule runs commands without asking.` No extra confirm: the
  line says what it means, and the change is one select away from being undone.
- **Remove** on a rule is one press (it makes the page ask again, never less safe).
- Empty rules: `No rules yet. Ticking "Always allow" on an approval adds one here.`
- The guardrail list is read-only and in mono.

### U9.4 Your data

```
 Your data
 Settings, rules, main's history, the last 200 runs, memory and learned layers are kept in
 this browser.
 Safari deletes them after 7 days without a visit.   (Safari only)
 Export (without your keys)   Import
```

Export writes a JSON file of settings, rules, sessions, kept runs, memory and learned
layers; keys are never exported. (Learned layers can also be exported per agent as
`learned.md`, U8.4.)
Import replaces them after a two-press confirm (`Import and replace` → `Replace`).

### U9.5 Failure words

| Cause | Words |
|---|---|
| No response / CORS refused | `No answer from <base URL>. If it is a local server, turn on its CORS setting (LM Studio) or set OLLAMA_ORIGINS (Ollama).` |
| 401 / 403 | `<provider> refused the key for <alias> (401).` |
| Safari, https page → http://localhost | `Safari blocks this page from reaching http://localhost. Open the page from the bridge instead: bun host/bridge.js --serve dist, then http://127.0.0.1:7717/app/` |
| Local network permission denied (Chrome) | `The browser was not allowed to reach your local network. Allow it in the site settings, then Refresh list.` |
| Bridge token wrong | `The bridge refused the token. Copy it again from the terminal where the bridge is running.` |
| Bridge origin not allowed | `The bridge does not accept this page's origin. Start it with --allow-origin <origin>.` |

At 390px: the label/field grid stacks (label above field); the command block scrolls
horizontally inside itself; `Copy` stays visible.

---

## U10. Boot and the second tab

**Boot screen** (full page, replaces the view until the hub is ready; the header shows with
its status line only):

```
 HARNESS
 Reading agents…  build 7f3a1c2      (index.json fetched)
 Starting threads · 2 of 4           (ready messages counted)
```

Steps appear as they complete; they do not animate. Any thread that reaches the 10s
no-ready limit is failed (U8.6); boot then finishes without it and the header carries
`· 1 failed`.

**Second tab** (Web Lock held elsewhere, §6.9): the view renders the read-only data it can
(Team, Settings, kept runs) but every sending control is disabled, and a top banner reads:
`HARNESS is running in another tab. This tab takes over when that one closes.` When the lock
is acquired: `This tab is running HARNESS now.` for 4s, then gone.

---

## U11. Look

### U11.1 Registers

Kept from INTERFACE.md, because they are still the three kinds of thing on screen:

| Register | Where | Set as |
|---|---|---|
| **Conversation** | your turns, main's answers | proportional, 15/1.65 body, answers 18px, 66ch measure |
| **Work** | work lines, working line, roster rows | proportional 13–15px sentence, mono for the call |
| **Evidence** | thread view, prompt, Team's expanded rows, commands | mono 12–13px, gridded, horizontal scroll inside its box, never wraps a command |

### U11.2 Type

System stacks only, so the page makes no request before first paint and works fully local
(bridge `--serve`) and offline:

- `--font-text: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
- `--font-mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace`
- Scale (px): `12 · 13 · 15 · 18 · 21`. Every number (steps, seconds, tokens, counts, clock
  times) is mono with `font-variant-numeric: tabular-nums`, so a ticking readout does not
  shift sideways.

### U11.3 Colour tokens

One rule from INTERFACE.md survives: **signal means live or measured.** It marks a running
dot, a duration, a count, a `changed` hash. Nothing is signal-coloured for emphasis. The only
other hue is `--bad`, and it means trouble (U2).

| Token | Role | Dark | Light |
|---|---|---|---|
| `--ink` | page background | `#0b1320` | `#f7f9fb` |
| `--panel` | evidence register, Runs panel | `#111b2b` | `#eef2f6` |
| `--raise` | controls, your turn | `#18243a` | `#ffffff` |
| `--rule` | hairlines, stage bar | `#26344d` | `#d3dbe4` |
| `--text` | what is said | `#e6edf5` | `#0f1a2a` |
| `--dim` | what is said about it | `#9aa8bb` | `#4a5a70` |
| `--faint` | there but not now | `#6b7a90` | `#6b7a8f` |
| `--signal` | live, measured | `#23b3d1` | `#0b7a93` |
| `--bad` | trouble: awaiting you, failed, circling, budget ≥90%, bridge down, a policy or guardrail denial | `#f0616d` | `#b42333` |
| `--focus` | focus ring | `#23b3d1` | `#0b7a93` |

Tokens are defined on `:root` (dark, the default) and redefined under
`@media (prefers-color-scheme: light)`; `color-scheme: dark light` is declared. The
implementer measures every text/background pair: 4.5:1 for text, 3:1 for dots and rules. A
pair that misses is changed here, not overridden in a component.

### U11.4 Status words and their marks

The dot is 8px. "Pulsing" is opacity 1 → 0.35 over 1.2s; removed under
`prefers-reduced-motion`, where the dot stays solid and the word carries the meaning.
**The word is always printed; colour never carries a status alone.**

| Status | Word on screen | Dot | Word colour |
|---|---|---|---|
| `thinking` | thinking | solid `--signal`, pulsing | `--text` |
| `calling` | calling (`<call name>` `+n` where room allows) | solid `--signal`, pulsing | `--text` |
| `compacting` | compacting | solid `--signal`, pulsing | `--text` |
| `waiting` | waiting (on `<child>` `+n` where room allows) | ring `--signal`, still | `--text` |
| `waiting`, awaiting an approval | waiting on you | ring `--bad`, still | `--bad` |
| `idle` | idle | none | `--faint` |
| `done` | done | ring `--dim`, still | `--dim` |
| `failed` | failed | solid `--bad`, still | `--bad` |
| `interrupted` | interrupted | ring `--bad`, still | `--dim` |
| (UI) stale | restarts when idle | — | `--dim` |
| (UI) circling | same call ×n (U2) | unchanged | `--bad` |

`waiting` is a ring, not a pulse: it is the run that is *not* spending tokens itself. main
is `waiting` only when every call in its stage is an agent call, and `calling` otherwise
(U12 D3), so a ring on main means all of its time is in its children.

### U11.5 Motion

Three movements and no others: the Runs panel/sheet arriving (180ms ease-out transform), the
pulsing dot, and the Jump to latest button fading in. Streaming text does not animate; lines
appear where they stay. All removed under `prefers-reduced-motion`.

### U11.6 Layout rules

- Page gutter 16px at every width; no horizontal page scroll at 390px, measured by the smoke.
- Every mono block: `overflow-x: auto; max-width: 100%` on its own box.
- One-line rows (work lines, roster rows, header) truncate their *text* part with an
  ellipsis; their right-side readouts and the header's trouble part never truncate.
- Hit targets ≥ 44×44px on touch (`pointer: coarse`).
- Focus: 2px `--focus` outline, 2px offset, on every control. Esc closes the panel/sheet and
  returns focus to the status line. Opening a thread view moves focus to its title. A
  two-press control that reverts returns its original label and keeps focus.

---

## U12. What the UI reads and sends

The architect's decisions of 2026-09-23 (D1–D11) are fact. There are no fallbacks.

### Thread → page, rendered by the UI

| Carried as | Fields the UI uses | Used by |
|---|---|---|
| `status {slot}` | `run agent parent depth status goal steps maxSteps seconds calls repeats current model error startedAt` | everything live |
| `event delta` / `field` / `reasoning` / `answer` / `error` (skeleton kinds) | `name`, `value` | U5.1, U5.2, U7 |
| `event call` | `value`: verbatim call text | U5.2, U7 |
| `event observation` | `name`: the call text; `value`: result; `ms`; `ok` | U5.2, U7 |
| `event prompt` | `name`: step n; `value`: rendered sheet; `tokens` | U7 Prompt |
| `event heard` | `value`: the note's text | U5.3, U7 notes |
| `event repair` / `retry` / `budget` / `compacted` / `final` | `value` | U5.2 error line, U7 system lines |
| **D1** `event child` (published by the **hub** on the **parent** run when it starts a child) | `name`: verbatim call text; `value`: child run id | U5.2 binding, U7 links |
| **D7** `event restarted` (hub, on a stale thread's restart) | the run / agent | U5.4, U7, U8 |
| `ready {tools, notes}` | tools with tier, shadows, unavailable + reason; notes incl. **D4** import failures | U8 |
| `history {turns}` | role, content, time, step | U5, U7 |
| `fatal {message}` | message | U7 |
| `event approval` | `name`: tool; `value`: verbatim call; `risk`; `reason`; approval id | U4, U5.5, U6, U7 |
| `event approved` | `value`: `approved` \| `denied`; `note` | U5.5 records |
| spans (per run, in its trace) | steps `{n, start, ms, tokens}`; calls `{name, start, ms, ok, child}` | U7.2 |
| slot `trace` | the root run id | U7.1, export |

### Decisions that shape behaviour

- **D1 Child id**: work lines bind by `event child`, never by (parent, agent).
- **D2 Persisted runs**: every finished run (slot + turns) is kept in IndexedDB, last 200.
  `›` links survive reload; beyond 200, `run not kept · answer below`.
- **D3 main while children run**: `waiting` when every call in the stage is an agent call,
  `calling` otherwise; `current` is the first running call, `+n` for the rest of the stage.
- **D4 Import failure**: a `tools.js` that fails `import()` is a note in `ready {notes}`;
  the agent runs without those tools. No `ready` after 10s → `failed`, error `sent no ready
  after 10s`.
- **D5 Model set**: main's resolved model has a model id; else header `no model`.
- **D6 Settings commit**: text on blur/Enter, selects immediate; keys per catalogue entry.
- **D7 Reload result**: `{build, changed:[{path, files}], added, removed,
  failed:[{path, error}], stale}`; `changed` marker until the next reload; `event
  restarted`; `index.json` carries `build`.
- **D8 Bridge**: hub polls `/health` every 30s; `state ∈ paired | answering | down` with
  `since`; tools return to a resident thread at its next idle restart; recovery announced
  once.
- **D9 Resume**: a `resume` message exists for interrupted runs.
- **D10** Header trouble always appended; **D11** Stop is two-press.
- **D12 Permissions**: each tool has a risk; policy = settings default per risk, overridden
  by frontmatter `permissions:` (tool or risk), overridden by always rules; guardrails deny
  always, with the reason.
- **D13 Approvals**: `ask` pauses the run (`waiting`) and emits `event approval`; answered
  through `hub.approvals.answer`; `always` adds an allow rule for that tool + agent; a
  denial's observation is the refusal. Several may be pending.
- **D14 Memory**: `memory_save / memory_forget / memory_search`; the `memory` context piece
  renders agent and shared memory, each capped at 2,000 characters, newest first.
- **D15 Dreaming**: after a root run is idle ≥ 20s, or on `Dream now`, the `dreamer` runs
  over the finished trace; memory it saves is applied (source `dream`); prompt proposals
  are applied only when accepted, into the agent's learned layer.
- **D16 Tracing**: root run id = trace id; spans are steps and calls; export is a local
  JSON download only.

### The hub API the UI calls

The UI never talks to a worker directly. It calls the hub on the same page:

```
hub.subscribe(fn)                     // every thread→page message and hub event, tagged with its run
hub.roster()                          // Map run → slot, read without waiting
hub.runs.get(id)                      // kept run {slot, turns} from IndexedDB, or null (beyond the last 200)
hub.runs.list(rootRun)                // kept runs of one task tree, for Finished
hub.history(run)                      // turns as last received (live runs)
hub.send(run, message)                // page→thread: invoke | nudge | abort | resume
hub.manifest()                        // manifest rows, with ready {tools, notes} merged in
hub.reloadAgents()                    // → {build, changed:[{path, files}], added, removed, failed:[{path, error}], stale}
hub.settings.get() / .set(patch)      // set → settings {...} to every live thread
hub.models.refresh()                  // → {ids, at} | {error}
hub.bridge.state()                    // {url, state: 'paired'|'answering'|'down', since, health}
hub.bridge.pair(url, token) / .check() / .disconnect()
hub.board(rootRun)                    // entries, and 'released' with its time
hub.approvals.list()                  // pending [{id, run, agent, name, value, risk, reason, at}]
hub.approvals.answer(id, {approved, note, always})
hub.memory.list(agent?) / .edit(id, text) / .remove(id)
hub.dreams.list()                     // {pending: [{id, agent, kind, text, why, from, at}], last: {at, trace, memories, proposals, run, error}}
hub.dreams.accept(id, text?) / .reject(id) / .run()
hub.learned(agent)                    // accepted entries [{text, at}]; .export(agent) → learned.md
hub.traces.spans(run)                 // spans of one run
hub.traces.export(trace)              // → a JSON file the browser saves
hub.lock()                            // 'leader' | 'follower'
hub.store.export() / .import(json)
```

`init` and `reply` are sent only by the hub. The UI sends only `invoke`, `nudge`, `abort`,
`resume` (through `hub.send`) and `settings` (through `hub.settings.set`); approvals,
memory edits and proposal answers go to the hub, which owns them.

### Open for the architect (round 3)

| # | Question | Until answered |
|---|---|---|
| Q1 | Does a denial's observation say who denied it: the owner, a policy, or a guardrail (e.g. `observation.denied: 'owner' \| 'policy' \| 'guardrail'`)? U5.2 draws the three differently. | Denials the UI answered itself are `denied by you`; every other refusal is `denied`. |
| Q2 | Do pending approvals survive a page reload (queued in IndexedDB), or does the run become `interrupted`? | The UI reads `hub.approvals.list()` on load and shows whatever it returns. |
| Q3 | `hub.learned(agent)` and `.export(agent)` are assumed; the brief names only the IndexedDB store and `learned.md`. Can the owner remove a learned entry? | Learned is read-only in the UI. |
| Q4 | Is time spent waiting on an approval its own span? It is where a slow task's time often goes. | It is inside the call's span; the Timeline cannot separate it. |

---

## U13. Component inventory

Each component is one ES module in `src/ui/` exporting `mount(el, hub)` that returns
`unmount()`. Components render with `document.createElement` and `textContent` only — never
`innerHTML` with model or folder text. `data-testid`s are stable names for
`scripts/smoke.js`; a component that changes meaning gets a new one. Clock times and
durations are formatted by one module, `ui/time.js` (U2 Time), and nowhere else.

| Component | testid | Reads | Sends |
|---|---|---|---|
| `Shell` | `shell` | hash route, `hub.lock()` | — |
| `Header` | `header` | route | — |
| `StatusLine` | `status-line` | all slots: `agent depth status current repeats`; stage size for `+n`; failed runs not yet opened; bridge `state`; resolved model for main; boot progress; lock | — (toggles `RunsPanel`) |
| `TroubleCount` | `trouble` | `hub.approvals.list()` length; slots `status repeats`; opened-run set; bridge `state` | — |
| `TitleBadge` | — | pending approval count | — (sets `document.title`) |
| `BootScreen` | `boot` | index fetch result and `build`; `ready` count vs manifest rows; 10s no-ready failures | — |
| `OtherTabBanner` | `other-tab` | `hub.lock()` | — |
| `Transcript` | `transcript` | `history {turns}` of main's resident run (with times, for day dividers); events `delta field reasoning answer error retry` for that run | — |
| `DayDivider` | `day-divider` | turn times | — |
| `Turn` | `turn-user` / `turn-answer` | one history turn or the streaming answer | — |
| `WorkLine` | `work-line` | events `call`, `observation` (`name`, `ms`, `ok`), **`child`** (binds the child id); child slot from roster by id, else `hub.runs.get(id)` | — (navigates to `#/run/<child>`) |
| `WorkingLine` | `working-line` | main slot: `status steps maxSteps seconds repeats current` | — |
| `ApprovalCard` | `approval` | one pending approval `{id, run, agent, name, value, risk, reason, at}`; **`event approved`**; lock | `hub.approvals.answer(id, {approved, note, always})` |
| `ApprovalRecord` | `approval-record` | answered approval + `event approved` | — |
| `NoteLine` | `note-line` | the sent note; **`event heard`** for that run; slot `steps` | — |
| `EmptyState` | `empty` | resolved model for main; manifest row for main (tool and agent counts) | — |
| `InterruptedBanner` | `interrupted` | main slot `status`, last saved turn time and step | `resume` |
| `StaleLine` | `stale` | roster stale flag for main; **`event restarted`** | — |
| `Composer` | `composer` | main slot `status`; resolved model; lock | `invoke {query}`, `nudge {text}` |
| `StopButton` | `stop` | main slot `status`; count of runs below main | `abort` (on second press) |
| `RunsPanel` | `runs` | slots of the current task tree; `hub.runs.list(root)`; board | — |
| `AwaitingSection` | `awaiting` | `hub.approvals.list()` | — (hosts `ApprovalCard`s) |
| `RosterRow` | `run-row` | slot: `run agent parent depth status steps maxSteps seconds current repeats model startedAt` | — |
| `BoardSection` | `board` | `hub.board(root)`: `id kind text author rev resolved`, released + time | — |
| `ThreadView` | `thread` | route id → roster slot, else `hub.runs.get(id)`; `hub.history(run)`; events for the run | — |
| `SlotHeader` | `slot` | slot: `agent status steps maxSteps seconds model parent depth goal error startedAt` | — |
| `TroubleBlock` | `thread-trouble` | slot `status error repeats current` | `resume` (interrupted) |
| `NowBlock` | `now` | slot `status current seconds`; child ids from **`event child`** | — |
| `NudgeBox` | `nudge` | slot `status` | `nudge {text}` |
| `AbortButton` | `abort` | slot `status`; count of runs below it | `abort` (on second press) |
| `Timeline` | `timeline` | `hub.traces.spans(run)`: steps `n start ms tokens`, calls `name start ms ok child` | — |
| `TraceExportButton` | `export-trace` | slot `trace` | — (calls `hub.traces.export(trace)`) |
| `HistoryList` | `history` | `history {turns}`; events `call observation child heard error repair retry budget compacted final restarted`; `fatal {message}` | — |
| `PromptSheet` | `prompt` | event `prompt` (`name` step, `value`, `tokens`) per step | — |
| `TeamView` | `team` | `hub.manifest()`; slots (resident run, stale, failed); index `build` | — |
| `ReloadButton` | `reload-agents` | reload in progress | — (calls `hub.reloadAgents()`; the hub then sends `init` to restarted threads) |
| `ReloadResult` | `reload-result` | last reload result `{build, changed[{path, files}], added, removed, failed[{path, error}], stale}`; **`event restarted`** | — |
| `AgentRow` | `agent-row` | manifest row: `name path description model remembers tools[tier shadows unavailable reason file] notes files error`; `ready {notes}` incl. import failures; `changed` marker; resolved model; bridge `state since` for reasons | — |
| `ProposalsSection` | `proposals` | `hub.dreams.list()` `pending`, `last`; dreamer run from roster/store | — (calls `hub.dreams.run()`) |
| `ProposalCard` | `proposal` | proposal `{id, agent, kind, text, why, from, at}` | — (calls `hub.dreams.accept(id, text?)` / `.reject(id)`) |
| `MemoryList` | `memory` | `hub.memory.list(agent?)`: `id agent text source at`; the 2,000-character cap; agent's grants | — (calls `hub.memory.edit` / `.remove`) |
| `LearnedLayer` | `learned` | `hub.learned(agent)`; bridge `state` + `health.capabilities` + `root` | — (calls `hub.learned.export`; bridge `/fs/write` through the hub) |
| `ToolPolicy` (inside `AgentRow`) | `tool-policy` | tool `risk`; settings defaults; frontmatter `permissions`; always rules | — |
| `SettingsView` | `settings` | — | — |
| `ModelSection` | `model` | settings `provider baseUrl model viaBridge` and keys per catalogue entry; `models.json`; refreshed ids + time; last `answer`/`error` event with run and time; manifest rows for the except-list | `settings {...}` (via `hub.settings.set`) |
| `OverrideList` | `overrides` | manifest rows whose resolved model ≠ default | — |
| `BridgeSection` | `bridge` | `hub.bridge.state()`: `url state since health{name version root capabilities}`; recovery flag | — (calls `hub.bridge.*`; the hub carries `host` in later `init`s) |
| `PermissionsSection` | `permissions` | settings: default per risk, always rules; guardrail list | `settings {...}` (via `hub.settings.set`) |
| `DataSection` | `data` | store | — (calls `hub.store.*`) |

### Build order

1. Tokens, type, `ui/time.js`, `Shell`, `Header`, routing; the smoke checks no horizontal
   scroll at 390px.
2. `BootScreen`, `OtherTabBanner`.
3. `Transcript`, `DayDivider`, `Turn`, `Composer`, `StopButton`, `EmptyState`
   (acceptance 1).
4. `WorkLine` (with `event child` binding), `WorkingLine`, `StatusLine`, `TroubleCount`,
   `RunsPanel`, `RosterRow` (acceptance 2).
5. `ThreadView` and its parts, `NudgeBox`, `NoteLine`, `AbortButton`, `TroubleBlock`,
   `PromptSheet`, `InterruptedBanner` (acceptance 3, 6, 8).
6. `TeamView`, `ReloadButton`, `ReloadResult`, `AgentRow`, `StaleLine` (acceptance 3, 4).
7. `SettingsView`: `ModelSection`, `OverrideList` (acceptance 5), `BridgeSection`
   (acceptance 7), `DataSection`.
8. `BoardSection`.
9. `ApprovalCard`, `ApprovalRecord`, `AwaitingSection`, `TitleBadge`, `PermissionsSection`,
   `ToolPolicy` (approvals block runs, so they come before the rest of round 3).
10. `Timeline`, `TraceExportButton`.
11. `MemoryList`, `LearnedLayer`, `ProposalsSection`, `ProposalCard`.
12. Light scheme contrast pass, measured.

---

## Critique log

Round 1 → round 2. Q = the critique-user's finding (or the open ask it settled); R = the
change, with the section that now carries it.

| # | Question | Resolution |
|---|---|---|
| 1 | While main is busy, the header shows only main's status; a circling or failed child, or a dead bridge, is invisible at a glance. | Header now has a trouble part (`· n circling · n failed · bridge down`, `--bad`) always appended after the state part and never dropped for width; at 390px the state part shortens first. `TroubleCount` added. U4, U11.6, U13. |
| 2 | A work line finds its child run by (parent, agent), which is ambiguous when main calls the same agent twice in a stage, and fails tomorrow because the roster forgets. | Work lines bind to the id in `event child {name: call text, value: child id}` (D1), first unbound match for identical calls; status read by id from roster then runs store (D2). Beyond 200 kept runs: `run not kept · answer below`. U5.2, U7.3, U12. |
| 3 | Reload and import failures are reported as counts (`1 failed`), not names; a `tools.js` that fails to import is invisible. | Reload result lists every path under Failed / Changed (with files) / Added / Removed / Waiting to restart; counts are only headings. Import failures are notes shown first in an auto-expanded row, with the tools from that file struck through. No-ready-after-10s is `failed` with its own note. U8.1, U8.6. |
| 4 | "Next step uses X on every thread" is false when agents override the model. | Line now reads `… on every thread except <names>`, or `on no thread` when all override. U9.1. |
| 5 | `×n` was defined two ways (`×<repeats+1>` in one place, `×<n>` in another). | Defined once in U2 (circling): n = repeats + 1, circling from repeats ≥ 2 (×3); every use refers there. |
| 6 | The note's `waiting → read at step n` feedback existed only in the conversation, not for notes sent from the thread view. | Same `NoteLine` wording and behaviour in the thread history for any run, driven by `event heard`. U5.3, U7.1. |
| 7 | Clock times without a day are ambiguous once runs survive reload. | One time format (U2 Time): `HH:MM`, day dividers `Today / Yesterday / Mon 21 Sep`, lone old moments day-qualified; durations separate. One formatter, `ui/time.js`. |
| 8 | The interrupted banner had no way to act on it. | `Resume` sends `resume` (D9) in the conversation banner and the thread view; `Resuming from step n…` until the slot changes; `Dismiss` as secondary. U5.4, U7.1. |
| 9 | At 390px the work line's duration dropped to a second line, breaking the scan for what is slow. | Work lines stay one line; the verb truncates, the right-side readout never does. U5.6, U11.6. |
| 10 | Composer Stop was one press while thread Abort was two; stopping main aborts every run below it. | Stop is two-press (`Stop main and n below`), identical in behaviour to Abort. U5.3. |
| 11 | The Runs panel put the Board above Running, so the owner opening it to find what is stuck reads notes first. | Running first, Board second, Finished last; Finished auto-expands when it holds a failure. U6.1. |
| 12 | What is main's status while its children run: `waiting` or `calling`? | `waiting` when every call in the stage is an agent call, else `calling`; `current` = first running call, `+n` for the rest (D3). U4, U6.2, U11.4. |
| 13 | "Model set" was undefined, so the first-visit state and `Connect a model first` had no test. | Model set = main's resolved model has an id (D5); else header `no model` and the first-visit state. U4, U5.4, U9.1. |
| 14 | Immediate save on every change would send `settings` per keystroke in the Base URL and key fields; one key field for all providers. | Text fields commit on blur/Enter with a `not saved` marker; selects immediate; keys stored and labelled per catalogue entry, never exported (D6). U9, U9.1, U9.4. |
| 15 | After Reload, nothing said which rows changed or when a stale thread actually restarted. | `changed` marker on rows until the next reload; `event restarted` turns `restarts when idle` into `restarted HH:MM` in Team, conversation and history; `build` shown (D7). U5.4, U8.1. |
| 16 | Bridge states and recovery were loose (`checked every 30s while paired`, no recovery signal, unclear when tools return). | States `paired / answering / down` with `since` (D8); recovery announced once in the live region and Settings; tools return at each resident thread's next idle restart. U4, U9.2. |
| 17 | Round 1 asks A1–A6 (prompt event, heard, resume, system events, startedAt, observation ms/ok) had fallbacks the implementer would have to build twice. | All accepted by the architect; fallbacks removed; U12 is now a table of what exists. |

### Round 3 (owner's additions: approvals, permissions, memory, dreaming, tracing)

| # | Question | Resolution |
|---|---|---|
| 18 | Where does an approval live? A queue view would be one more place to look while a run is stopped. | No view. One `ApprovalCard` with one state, shown under the work line it belongs to, first in the Runs panel (`Awaiting you`), and in the run's thread view. U3, U5.5, U6.1, U7.1. |
| 19 | How does the owner learn of an approval when busy elsewhere, or when it comes from a child three levels down? | `n awaiting you` is the first trouble item (weight 600, never dropped); a live-region announcement names agent and tool; the page title carries the count; the card is placed under main's work line whose child tree holds the run, found by `event child` ids. U4, U5.5. |
| 20 | What must the owner read before allowing? | The call verbatim and whole (the one block that wraps), its risk and the reason it was asked. `Allow` is disabled while any fold is closed; neither button is pre-focused; no Enter shortcut; no "allow all". U5.5. |
| 21 | What does "always" do, and where can it be undone? | Checkbox names the tool and agent and says it adds a rule; Allow becomes `Always allow`; the rule is listed, with Remove, in Settings → Permissions. U5.5, U9.3. |
| 22 | "Why didn't coder ask?" — where is a tool's effective permission visible? | On each tool line in Team: `risk · policy · source` (default, frontmatter file, always rule, risk not declared). U8.1. |
| 23 | Where are policy defaults and guardrails set or seen? | Settings → Permissions, with a `--bad` line explaining any `allow` for write or exec, and the guardrails read-only. U9.3. |
| 24 | Where does memory live, and how does the owner answer "why does it (not) remember that?" | Per agent in its Team row and Shared memory at the top of Team; each entry shows its source; the 2,000-character cap is drawn as a divider so entries the agent cannot see are visible. Edit, two-press Remove. No owner add form (say "remember …" to main). U8.3. |
| 25 | Dream proposals: Team or their own view? | Team's `Proposals` section, with `Dream now` and the last-dream line; count on the Team link, not in trouble, because nothing is blocked on it. Accepting changes the agent row on the same screen. U3, U8.2. |
| 26 | Can the owner shape a proposal rather than take it whole? | The text is editable; `Accept edited` sends the edit. Memory a dream saved is applied and shown in Memory as `from a dream`, where it can be edited or removed. U8.2. |
| 27 | How does an accepted lesson reach the folder? | Learned section per agent: `Export learned.md`, and `Write to <root>/agents/<path>/learned.md` only while the bridge is answering with files on. U8.4. |
| 28 | How does the owner see a memory or lesson actually reach the agent? | The thread view's prompt shows the `memory` piece and the learned layer where they render. U7.1. |
| 29 | Where is tracing, without building a trace viewer? | A collapsed Timeline in the thread view whose summary line already splits model / tools / agents time; expanded rows are this run's spans only, children one link away; `Export trace` saves the whole task as JSON, local only. U7.2. |
| 30 | Open points the brief does not settle. | Recorded for the architect as Q1–Q4 in U12, each with the behaviour the UI has until answered. |
