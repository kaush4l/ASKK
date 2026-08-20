# tracker.md — the lead's running record

The lead does not write code. It holds the goal, names one increment at a time,
spins up an architecture lead, and refuses a go until a bar-raiser gives one.

History, rulings and measured findings live in `docs/STATUS.md`. This file is
the LIVE list: what is open, who owns it, what closes it. Nothing is removed
when it is done — it is marked and dated, so the record stays readable.

## The goal, as stated by the owner (2026-08-20)

Backend and core run in the BROWSER. The agent is given an environment as a
container2wasm image. It must be easy to **define a flow, modify a strategy,
add a tool, or trace a run**. Portable, simply declared, clean at every level —
high-level design, package level, method level. A tool is understood as
*anything invokable that accepts variable input and produces a result for a
query*. Only the 20% that carries 80% of the workflow's value.

**The phase mandate.** Given any query the agent decides what the next step is,
by phase: answer a simple query directly; run a react loop for a simple task;
for deep work, rewrite the query into an engineered prompt, pick up the skills
needed, and run not one long react agent but a react agent PLUS a separate
verifier and a separate grounder.

**The skeleton mandate.** It must be able to work like a software developer:
create projects, run long-running agents, research agents, cron jobs, loops.

**The bar.** Hermes Agent, Eliza OS, DeepSeek harness, plus what the research
finds (agent-zero, open swe, docker agent sandbox, and unknowns).

## Open — the lead's queue

| # | Item | Owner | Closes when | State |
|---|---|---|---|---|
| T1 | Stage briefs move out of Rust into configuration. Core parses none of the brief; a missing/malformed brief fails LOUDLY | arch lead | briefs are data, gate green, bar-raiser GO | **DONE 2026-08-20** — `public/stages/*.md`; both hard constraints verified against the tree by `docs/CRITIQUE-04.md`. RULING: a brief belongs to the STAGE, not the agent (`docs/STATUS.md`) |
| T2 | A standing `goal:` with outcome / verification / done_when whose continue condition is a **verification command's exit code**, not a model's opinion | arch lead | `passes::again` reads an observed exit status | **DONE 2026-08-20** — two-phase (`passes::again` emits `InvokeTool`, `step` folds it); `acted` no longer consulted when a goal is declared. RULING: `ToolInvoked` NOT widened — `ok` IS `status == 0` from the port |
| T3 | Grant `web_search` to `main`; ship the `critic` agent | arch lead | `main` holds it; a second agent ships; `critic.rs:112-115` updated deliberately | **DONE 2026-08-20** — the critic's tool grant was found INERT in every path (`docs/CRITIQUE-04.md` S1) and repaired: it ships `engine: base`, no tools, keeping `space:` because the space block DOES reach a Worker and is what it judges against. RULING: the `critique` stage and the `role: critic` agent are two jobs; both ship. I2 held — `web_search` refuses until configured |
| T4 | Spawn observability: callee trace pane empty, board shows neither goal nor answer, `last_failure` unset after a delegated failure, `agent-worker.js:59` strands a failed callee's activity | arch lead | an operator can read a delegated run end to end | **DONE 2026-08-20** — all four addressed; the two `docs/CRITIQUE-04.md` found half-wired are repaired. The person-launched fix landed in the FOLD, not in `batch.rs`: both facts were already in the log, the errand's test for them was wrong |
| T5 | Prior-art sweep | research | — | **DONE 2026-08-20** — `docs/research/PRIOR-ART.md`, 680 lines |
| T6 | Core elements researched | research | — | **DONE 2026-08-20** — `docs/research/CORE-ELEMENTS.md`, 1,011 lines. Settled: **text-as-tools is RIGHT** (the native alternative is measurably dangerous for the small local models we run), **TOON is a NO in both directions**, and **`Slot`/`Stability` are not to be touched**. Do not re-derive these three |
| T7 | The phase mandate: query → answer / react / deep(engineered prompt + skills + react + VERIFIER + GROUNDER). We have a 3-way strategy vote; we have no grounder and the verifier is a stage, not an agent | lead → arch lead | routing is declared data and the deep path has three distinct roles | QUEUED, blocked on T5/T6 |
| T8 | The skeleton mandate: projects, long-running agents, research agents, cron jobs, loops | lead → arch lead | each is a declaration, not a code path | QUEUED, blocked on T7 |
| T9 | The guest environment. **Ruled by `docs/ADR-GUEST-TOOL-SURFACE.md`**; three questions are the owner's alone (Q1 size/capability, Q2 persistence, Q3 network — Q3 is a SECURITY question requiring an I2 amendment) | OWNER GATE | owner answers Q1/Q2/Q3 | BLOCKED on owner — questions now stated so they can be answered with a number or yes/no |
| T10 | `gh-pages` publish (destructive-storage gate: `leftovers.rs` deletes a person's IndexedDB) | OWNER GATE | owner says publish | BLOCKED on owner |
| T11 | Free bytes, SAFE UNILATERALLY (post-build, no rebuild, no behaviour change): `gzip -9` = 475,298 B + `wasm-tools strip -a` = 510,934 B (validate passes, no `name` section to lose) = **986,232 B, 2.03%** | arch lead | the two commands run and the sizes are re-measured | READY — no owner gate |
| T11b | `VM_MEMORY_SIZE_MB` is **NOT** safe unilaterally — it is the guest's real RAM, needs Docker plus the unmeasured floor (`IMAGE-RECIPE.md:508`), and its safe value is downstream of owner question Q1(b) | arch lead | Q1(b) answered, floor measured | BLOCKED on owner |
| T19 | **`ADR-013` does not exist.** Cited by eight source files and `docs/IMAGE-AUDIT.md:123`; `DECISIONS/` stops at ADR-010 | arch lead | the ADR is written or the eight citations are corrected | OPEN |
| T20 | **The product lies to its own agent again.** `crates/core/src/proc/convention.rs:66` — the refusal text a model reads tells it to run `python3 -m http.server`, which cannot exist in this guest. Our tool documentation describes a different computer. **SHARPENED BY THE OWNER'S Q2 RULING (persistence NO, permanently):** every string that tells a model or a person that the guest KEEPS anything is now a defect BY RULING, not a judgement call — same family as the `python3` line, which describes a computer we do not ship. Scope is therefore wider than one line: sweep every tool description, refusal, pane sentence and prompt block for both claims. `docs/CRITIQUE-04.md`'s through-line is the lens — a string that describes a capability is an assertion that must be TRUE, and no test in this tree asserts prose against the machine | arch lead | no shipped string claims the guest keeps anything or offers a tool it does not have, and a test pins it | OPEN, next round |
| T21 | `docs/IMAGE-RECIPE.md:498-499` cites two paths that do not exist (now `proc/convention.rs:66` and `board/examples.rs:29`) — stale paths inside the very item written to correct a fabricated citation | lead | paths resolve | OPEN |
| T23 | The loud-failure channel is not reliably loud: `install_briefs` PUSHES onto `agent_problems` while `roster::reconcile` ASSIGNS it, so the first `write_agent` erases the message naming the brief file a person must add — and `agent_problems` has ZERO test coverage anywhere (`docs/CRITIQUE-04.md`, pass 1) | arch lead | a refusal survives a reconcile, and a test proves it | OPEN, next round |
| T24 | `main` now names every built-in this build ships, so its non-empty allowlist resolves to exactly what an empty one would. Nothing pins that: the next built-in added silently never reaches the shipped agent (`docs/CRITIQUE-04.md`, pass 1) | arch lead | a test fails when a new built-in is not granted | OPEN |
| T25 | **The `## space` block is honest per AGENT and not per STAGE.** `Sensing.tools` is fed the agent's resolved toolbox, but what a turn may call is `ask::scoped_tools`, narrowed by stage. So shipped `main` renders "No tools are installed" in `## affordances` and, five lines later, a workspace sentence naming `observe`/`find_files`/`start_process` — on the `strategy` call that opens EVERY turn, and again in `plan` (`docs/CRITIQUE-04.md` pass 3, F5). Pre-existing at HEAD, not a regression; the THIRD appearance of one error — an assertion that a capability resolves standing in for an assertion that its description is true | arch lead | the block names only what THIS STAGE may call, and a test renders a scoped stage to prove it | OPEN |
| T26 | **`brief::acts` is default-ALLOW in a codebase whose I6 is default-deny.** `acts` lists what is EXCLUDED (`!matches!(stage, STRATEGY \| PLAN \| CRITIQUE \| ANSWER)`), where its two siblings `keyed` and `skill_only` both list what is INCLUDED. A sixth entry added to `stages::STAGES` therefore receives the agent's FULL TOOLBOX by omission, and nothing catches it — the tests pin `strategy` specifically, never the direction of the default (`docs/CRITIQUE-04.md` pass 4). Pre-existing at HEAD | arch lead | the gate lists what may act, and a test pins the direction rather than a case | OPEN |
| T27 | **Guest network egress, owner-approved in DIRECTION only.** Blocked on: its own ADR, a written I2 amendment, and a person-configured allowlist with no shipped default. No code before all three | arch lead | ADR + I2 amendment exist and the lead has read them | OPEN — SECURITY, do not start with code |
| T28 | **The default model path is broken on current browsers.** `public/models.json` `local` = `http://127.0.0.1:8873/v1` and `public/agents/main/agent.md:4` says `model: local`. Chrome 142 shipped Local Network Access ("any request from a public website to a local IP address or loopback"); Chrome 147 extended it to WebSocket/WebTransport; Firefox followed. Safari cannot do it at all — WebKit 171934 still NEW since 2017. **Denial is silent and indistinguishable from a closed port**, so the one discipline this codebase is rigorous about — name the refusal in the words that name the fix — is exactly what it cannot do here. Fix is three changes: `targetAddressSpace: "loopback"`, first call behind a USER GESTURE not a boot probe, and a distinct `ModelError` surfaced through the existing `ModelPort::resolves` | arch lead | a person on Chrome and a person on Safari each get told the truth | **OPEN — #1 by the research's own ranking** |
| T29 | **Web Locks: one ~20-line change, two payoffs.** Chrome 133 freezes a hidden CPU-intensive browsing-context group after 5 minutes INCLUDING ITS WORKERS — which is every agent we have, and a wasm x86 emulator is the textbook target. Holding a CONTENDED Web Lock is a documented exemption. Closes the two-tabs-one-log hole AND buys freeze immunity | arch lead | a backgrounded run survives 5 minutes | OPEN — close runner-up to T28 |
| T30 | **Pin the durable goal to the tail.** A correctness hole in the headline capability | arch lead | the goal cannot be compacted away | OPEN — research's #2 |
| T31 | **Make the catalogue entry the whole provider truth.** One change closing five silent defects, and the landing site for the `tool_style` seam and for reachability | arch lead | a model swap changes one entry | OPEN — research's #3 |
| T32 | Storage ruling CHANGED by measurement: Safari's 7-day ITP cap is live, counts days of SAFARI USE (hence its irreproducibility), the only documented exemption is a **Home Screen web app, not `persist()`**, and eviction is **all-or-nothing per origin**. Ruling is now "call `persist()`, believe nothing, design for total wipe with a resumable sha256 manifest" | arch lead | T15 is designed for total wipe | OPEN — binds T15 |
| T33 | `ADR-008:69` still rules "no COOP/COEP, no SAB, no COI in v1" while `web/coi-sw.js` has shipped exactly that since 2026-08-18. `require-corp` is forced because Safari has no `credentialless`. Our COEP audit passes ONLY because I1 and I5 leave us no cross-origin no-cors subresources — **write that down before someone adds a CDN font** | arch lead | ADR-008 matches what ships | OPEN |
| T34 | One DNS change (Cloudflare in front of a custom domain) would delete the first-load reload, the flash, Chrome's intermittent second-load failure, and iOS's 7-day SW eviction TOGETHER | OWNER GATE | owner rules on a custom domain | OPEN — cheap, high payoff, needs a domain |
| T35 | Every agent including `main` runs in a Worker, and Chrome's Prompt API is not exposed in Workers (`adapters_web/src/lib.rs:76-79` already handles this correctly). So an on-device entry the PAGE can resolve may be one NO AGENT can use. Needs one test, not a fix | arch lead | the test exists and says which it is | OPEN — a question, not a defect |
| T12 | No CI exists. Every gate runs only when someone remembers | lead | a gate runs without being remembered | OPEN — **and it bit this round.** A subagent ran `rustfmt` on five files it owned; one was `crates/core/src/lib.rs`, and rustfmt FOLLOWS `mod` declarations, so it rewrote 43 files and silently broke I12. No instruction could have stopped it — "format only files you own" assumes a file-scoped tool. Only a check that runs AFTER a fan-out catches this class |
| T13 | **`verify` gets its own window before it gets its own agent.** The value of a separate verifier is separation of CONTEXT, not of role-name: CoVe's factored variant beats its joint variant because verification is answered without the draft in view, and judges prefer their own generations (Panickssery, NeurIPS 2024). `docs/GOAL-AND-LOOP.md:581` rejected this on the wrong mechanism and must be corrected in writing | lead → arch lead | verify runs against a window that does not contain the draft | QUEUED — top of the list |
| T14 | **Grounder as a post-pass**, evidence as a Component. Anthropic ends a research run with a CitationAgent; Google sells a 0-1 support score per claim; RARR and Self-RAG's `IsSup` are the academic form. Nobody open-sources it. Costs one call | lead → arch lead | claims carry evidence, or are marked ungrounded | QUEUED |
| T15 | **Durable step memo over IndexedDB.** DBOS's own architecture page: durable execution needs only a transactional KV store and a step-keyed memo table, no cluster. Temporal's determinism rules police hand-written loops — a DECLARED loop cannot be written non-deterministically, so our declaration buys replay for free | lead → arch lead | a run resumes across a reload | QUEUED |
| T16 | **Stop the `plan` stage for approval.** A plan the person never saw is a plan they cannot correct | lead → arch lead | the loop can pause at plan and take an edit | QUEUED |
| T17 | **MCP servers as Web Workers over `postMessage`, zero network.** MCP's 2026-07-28 revision went stateless and POST-only and explicitly permits custom transports. Closes PARITY gap 4 without a server | lead → arch lead | a conformant MCP server runs in a Worker | QUEUED, after T13-T16 |
| T18 | Rule on the guest's TOOL SURFACE before T9 spends on the image | lead | — | **DONE 2026-08-20** — `docs/ADR-GUEST-TOOL-SURFACE.md`, 351 lines. Decision: **narrow documented tool surface (ACI) over a deliberately small guest**; capability arrives as a TOOL WITH A CONTRACT, never as a package |

> **Numbering note.** `T22` does not exist. Two sessions appended to this file at once on
> 2026-08-20 and the rows had to be renumbered twice; the gap is the scar. IDs here are not
> safe to choose without re-reading the file first.

## OWNER RULINGS, 2026-08-20 — the three questions from `docs/ADR-GUEST-TOOL-SURFACE.md`

**Q1, size vs capability — DECIDE AFTER I SEE IT WORK.** Hold the image at
today's 46.28 MiB. Do NOT bake python3/git/curl and do NOT add a compiler.
Spend the rounds on the LOOP (T13 verifier-window, T14 grounder, T15 durable
step memo) and revisit the image once those land. T11's free 986,232 bytes are
still cleared to land — they change no behaviour. T11b stays blocked: the safe
`VM_MEMORY_SIZE_MB` is downstream of a size answer we deliberately deferred.

**Q2, persistence — NO. Say "scratchpad" on screen.** `durable()` stays false.
The guest forgets on reload and **the UI must tell the person that plainly, in
the words that name what to do instead.** Long-running work is carried in
browser storage, not in the guest — which is exactly what T15 builds. This
CLOSES the persistence question that has been reopened three times; do not
re-litigate it, and do not design an OPFS overlay for the guest filesystem.
NOTE FOR THE ARCH LEAD: this makes T20 sharper, not softer — every string that
tells a model or a person the guest keeps anything is now a defect by ruling.

**Q3, guest network — YES, WITH AN EXPLICIT ALLOWLIST. This is a security
change and it does not start by writing code.** The owner has approved the
DIRECTION. It requires, in this order, before one line of guest networking
exists: (1) its own ADR naming the egress mechanism, who chooses a destination
and when; (2) a written amendment to **I2**, since I2 today admits exactly one
exception and only because a person presses a key each time; (3) the allowlist
being a thing a PERSON configures — never a default, never a shipped URL. The
threat model genuinely changes: egress becomes a path a MODEL chooses at
runtime from a shell whose commands the model writes. No agent may implement
guest networking until the ADR and the I2 amendment exist and the lead has
read them. Tracked as T27.

## Done

| # | Item | Closed |
|---|---|---|
| D1 | Component architecture standard written (`docs/ARCH-COMPONENTS.md`) | 2026-08-17 |
| D2 | Structural remediation, 9 exit criteria, bar-raiser GO (`CRITIQUE-02.md`) | 2026-08-19 |
| D3 | The Faculty seam — a config attaches a prompt block and the tools that feed it | 2026-08-19 |
| D4 | A second faculty (`memory`) proves the host tool path; extension cost measured | 2026-08-19 |
| D5 | CheerpX deleted whole; container2wasm is the only engine (`main 51199eb`) | 2026-08-19 |
| D6 | The image audited and measured; recipe repaired (`docs/IMAGE-AUDIT.md`) | 2026-08-19 |
| D7 | Parity measured on the owner's own axis (`docs/PARITY.md`) | 2026-08-19 |
| D8 | The loop's own prompts became data — `public/stages/*.md`, core parses none of them, a missing one refuses loudly | 2026-08-20 |
| D9 | The continue condition became an observed exit code rather than a model's opinion of its own progress | 2026-08-20 |
| D10 | Bar-raiser rounds 4 and 5 (`docs/CRITIQUE-04.md`) — NO-GO twice; blocking findings repaired in-round | 2026-08-20 |

## Rulings the sweep settled (do not re-derive)

- **Routing-by-difficulty is closed.** GPT-5 ships a real-time router, Anthropic
  names Routing one of five workflow patterns, smolagents puts a router below
  tool-calling on its agency ladder — and `strategy.rs` already votes
  answer/react/project. The phase mandate's routing half is DONE. The open half
  is the deep path's roles.
- **Declare policy and budget, NEVER topology.** Nobody declares the loop:
  Goose declares the work, CrewAI the roster, Letta the memory, Claude Code the
  policy envelope. OpenAI's Agent Builder is deprecated and shuts down
  2026-11-30 in favour of code. Our fixed four-node `stages:` is on the right
  side of that line; the moment it grows EDGES it becomes the thing being
  switched off. This is a standing constraint on T7 and T8.
- **Split reading and judging, never writing.** The reconciliation across
  Anthropic (90.2% better, 15x tokens), Cognition ("don't build multi-agents")
  and LangChain ("restrict multi-agent to research, one-shot the report"). Open
  SWE's named four-role graph collapsed into one deep agent within a year —
  direct evidence against role-per-agent decomposition, which we already found
  once when we deleted our summarizer and critic agents. T7's "separate
  verifier and separate grounder" is therefore a separate WINDOW first (T13),
  and only a separate AGENT if the window is proven insufficient.

## The gate (four commands, never piped, own exit code)

Recorded in `docs/STATUS.md`. A gate run that reads grep's exit code is not a
gate run; that mistake was made twice and is now law.
