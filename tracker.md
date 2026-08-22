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
| T7 | **DESIGNED 2026-08-20 — `docs/DESIGN-PHASES.md`, 534 lines.** The role table came back FOUR categories, not three: prompt-engineering, skill pickup and the react worker are STAGES THAT ALREADY SHIP (`plan`/`work`); the verifier is a **WINDOW** — a toolless sheet with `History` EMPTY, because the measured effect (CoVe factored, Panickssery self-preference) is about WHAT IS IN THE WINDOW, not who answers; and the grounder is **none of the three — a pure fold, no model at all**. **ZERO new frontmatter keys**: `main` needs no edit, and `Route::Project::stages()` stays a Rust literal so no person can write an edge. A `grounding: off` key was considered, found legal, and REFUSED on this tree's own precedent — grounding costs no model call and cannot block, so a switch to disable it only lets an agent lie more cheaply. Build order S1-S5, each independently gate-green, all pure core. Original row text: The phase mandate: query → answer / react / deep(engineered prompt + skills + react + VERIFIER + GROUNDER). We have a 3-way strategy vote; we have no grounder and the verifier is a stage, not an agent | lead → arch lead | routing is declared data and the deep path has three distinct roles | QUEUED, blocked on T5/T6 |
| T8 | The skeleton mandate: projects, long-running agents, research agents, cron jobs, loops | lead → arch lead | each is a declaration, not a code path | QUEUED, blocked on T7 |
| T9 | The guest environment. **Ruled by `docs/ADR-GUEST-TOOL-SURFACE.md`**; three questions are the owner's alone (Q1 size/capability, Q2 persistence, Q3 network — Q3 is a SECURITY question requiring an I2 amendment) | OWNER GATE | owner answers Q1/Q2/Q3 | BLOCKED on owner — questions now stated so they can be answered with a number or yes/no |
| T10 | `gh-pages` publish (destructive-storage gate: `leftovers.rs` deletes a person's IndexedDB) | OWNER GATE | owner says publish | BLOCKED on owner |
| T11 | Free bytes, SAFE UNILATERALLY (post-build, no rebuild, no behaviour change): `gzip -9` = 475,298 B + `wasm-tools strip -a` = 510,934 B (validate passes, no `name` section to lose) = **986,232 B, 2.03%** | arch lead | the two commands run and the sizes are re-measured | READY — no owner gate |
| T11b | `VM_MEMORY_SIZE_MB` — **the one unfreeze with a real argument** (`docs/research/AGENT-ENVIRONMENT.md`): 577.75 MiB decides which DEVICES can run this at all, which is a bigger question than which packages ship. Still **NOT** safe unilaterally — it is the guest's real RAM, needs Docker plus the unmeasured floor (`IMAGE-RECIPE.md:508`), and its safe value is downstream of owner question Q1(b) | arch lead | Q1(b) answered, floor measured | BLOCKED on owner |
| T19 | **`ADR-013` does not exist.** Cited by eight source files and `docs/IMAGE-AUDIT.md:123`; `DECISIONS/` stops at ADR-010 | arch lead | the ADR is written or the eight citations are corrected | OPEN |
| T20 | **The product lies to its own agent again.** `crates/core/src/proc/convention.rs:66` — the refusal text a model reads tells it to run `python3 -m http.server`, which cannot exist in this guest. Our tool documentation describes a different computer. **SHARPENED BY THE OWNER'S Q2 RULING (persistence NO, permanently):** every string that tells a model or a person that the guest KEEPS anything is now a defect BY RULING, not a judgement call — same family as the `python3` line, which describes a computer we do not ship. Scope is therefore wider than one line: sweep every tool description, refusal, pane sentence and prompt block for both claims. `docs/CRITIQUE-04.md`'s through-line is the lens — a string that describes a capability is an assertion that must be TRUE, and no test in this tree asserts prose against the machine | arch lead | no shipped string claims the guest keeps anything or offers a tool it does not have, and a test pins it | **DONE 2026-08-21** — `proc/convention.rs` no longer tells a model to run `python3 -m http.server`; `main/agent.md` no longer lists `python3`/`a compiler` as things `exec` runs, and no longer says what is written there 'stays there across turns'. Enforced, not just fixed: `tests/stated.rs` sweeps shipped prose for command-shaped claims and fails on any name that is neither a declared binary nor a grantable tool |
| T21 | `docs/IMAGE-RECIPE.md:498-499` cites two paths that do not exist (now `proc/convention.rs:66` and `board/examples.rs:29`) — stale paths inside the very item written to correct a fabricated citation | lead | paths resolve | OPEN |
| T23 | The loud-failure channel is not reliably loud: `install_briefs` PUSHES onto `agent_problems` while `roster::reconcile` ASSIGNS it, so the first `write_agent` erases the message naming the brief file a person must add — and `agent_problems` has ZERO test coverage anywhere (`docs/CRITIQUE-04.md`, pass 1) | arch lead | a refusal survives a reconcile, and a test proves it | OPEN, next round |
| T24 | `main` now names every built-in this build ships, so its non-empty allowlist resolves to exactly what an empty one would. Nothing pins that: the next built-in added silently never reaches the shipped agent (`docs/CRITIQUE-04.md`, pass 1) | arch lead | a test fails when a new built-in is not granted | OPEN |
| T25 | **The `## space` block is honest per AGENT and not per STAGE.** `Sensing.tools` is fed the agent's resolved toolbox, but what a turn may call is `ask::scoped_tools`, narrowed by stage. So shipped `main` renders "No tools are installed" in `## affordances` and, five lines later, a workspace sentence naming `observe`/`find_files`/`start_process` — on the `strategy` call that opens EVERY turn, and again in `plan` (`docs/CRITIQUE-04.md` pass 3, F5). Pre-existing at HEAD, not a regression; the THIRD appearance of one error — an assertion that a capability resolves standing in for an assertion that its description is true | arch lead | the block names only what THIS STAGE may call, and a test renders a scoped stage to prove it | **DONE 2026-08-21** — capability prose is now rendered from the STAGE-scoped toolbox (`ask::per_stage_blocks`), not the agent's. Shipped `main` in `strategy` no longer says 'No tools are installed' five lines above a sentence naming three. The artifact is the class test: every shipped agent x every stage it can enter x every tool this build ships, with the grant oracle read out of the rendered `## affordances` rather than from a second copy of the scoping rules |
| T26 | **`brief::acts` is default-ALLOW in a codebase whose I6 is default-deny.** `acts` lists what is EXCLUDED (`!matches!(stage, STRATEGY \| PLAN \| CRITIQUE \| ANSWER)`), where its two siblings `keyed` and `skill_only` both list what is INCLUDED. A sixth entry added to `stages::STAGES` therefore receives the agent's FULL TOOLBOX by omission, and nothing catches it — the tests pin `strategy` specifically, never the direction of the default (`docs/CRITIQUE-04.md` pass 4). Pre-existing at HEAD | arch lead | the gate lists what may act, and a test pins the direction rather than a case | **DONE 2026-08-20** — `acts` now reads `matches!(stage, WORK | VERIFY)`: it lists what MAY act. `tests/stages.rs::a_stage_nobody_listed_may_not_act` pins the DIRECTION — every named-stage assertion in it passed under the old spelling too, and only the unlisted-name one fails, which is the point. Proved by reverting `acts` and watching it fail on `"grounder"` (exit 101) |
| T36 | Second prior-art sweep on sources the owner named: **orinth** (identity unknown — the agent must say plainly if it cannot find it rather than substitute a look-alike), the **latest Hermes** delta since the 0.19.0 we ran in-browser, and any 2026 browser/sandboxed harness we would be embarrassed not to know | research | `docs/research/PRIOR-ART-2.md` exists with a philosophy→feature→mechanism→RULING per project and five ranked changes | IN FLIGHT 2026-08-20 |
| T37 | **What an agent actually requires of an environment**, from evidence: Docker's latest sandbox work (owner's explicit ask), E2B/Daytona/Modal/Cloudflare/Fly, and what the major coding agents demand. Requirements table checked against OUR c2w guest in the actual source, ranked by value/cost, with the rows we should DELIBERATELY REFUSE named out loud | research | `docs/research/AGENT-ENVIRONMENT.md` exists and every row states what our guest does today, read from the tree not guessed | IN FLIGHT 2026-08-20 |
| T38 | **Replace the planned LLM grounder with a MECHANICAL citation check.** Hermes 0.20.0 shipped a grounder whose mechanism is better than ours: quotes matched as substrings against the fetched page text, not a 0-1 support score from a second model call. Deterministic, ungameable, one model call cheaper — and it is the thing that makes granting `web_search` SAFE. Supersedes `docs/research/PRIOR-ART.md` rec #3 and rewrites the grounder half of T7 | lead -> arch lead | a cited quote that is not in the fetched text fails without a model being asked | OPEN — research's #1, binds T7 |
| T39 | **The trust boundary must be written down before anything self-modifies.** Ornith-1.0's reward-hacking defense states it exactly: the environment, the tool surface and test isolation are IMMUTABLE and outside the model's reach; the model may evolve only its inner policy scaffold (memory, error handling, orchestration), with a deterministic monitor and a frozen judge as a VETO ON TOP of the verifier. That is I6 + `verify.rs` + `critic.rs` described by people defending a reward signal. Write it as an ADR; it bounds how far any self-improvement may ever go | arch lead | the ADR exists and names what is outside the model's reach | OPEN — cheapest high-value hour in either sweep |
| T40 | **Two compaction defects.** (a) No USER-MESSAGE tail floor — three `exec` results can evict every human sentence in the window (`crates/core/src/chat/memory_line.rs:75-98`); (b) **ghost skills** — a skill compacted out is neither pinned nor announced as gone, so the agent believes it still holds it (`crates/agent/src/skills.rs`). Hermes ships answers to both | arch lead | a human sentence survives a flood of tool output, and a dropped skill says so | OPEN |
| T41 | **Conditional skill availability**: `requires_tools` / `fallback_for_tools`, keyed on CAPABILITY PRESENCE — which is what I15 already tracks. Closes the gap `PRIOR-ART.md` §2.12 named. REFUSE the sibling fields: `platforms` is meaningless in a tab and `required_environment_variables` is an I6 violation | arch lead | a skill that needs a tool the agent lacks is not offered | OPEN |
| T42 | **`/context` — expose per-component cost.** `assemble::cost()` per component plus one UI view. Cheapest legibility win in either sweep, and it stops `degrade`'s elisions being silent. The owner's "trace" requirement lands here | arch lead | a person can see where the window went | OPEN |
| T43 | **Audit / dry-run mode**: read-only tools run, mutating tools journal instead of acting. One event kind. Original implementation only — the prior art here is BUSL-1.1 and must NOT be vendored | arch lead | a run can be rehearsed without mutating anything | OPEN |
| T44 | **Windowed read and checked edit.** `read_file` is `cat --` (`crates/kernel/src/workspace.rs:75`) and `write_file` replaces the WHOLE file via base64 (`:88-99`). SWE-agent's own ablation measures this: no edit tool = **-7.7 points** (10.3% vs 18.0%), whole-file view = **-5.3**, and 51.7% of their trajectories hit at least one failed edit. A window is `sed -n` — all busybox, no package, image stays frozen | arch lead | a model can read a region and change a region without rewriting a file | OPEN — the largest MEASURED capability gap in the tree. The research ranked it FIFTH of five on purpose and said why: it is the one row whose whole justification is "fewer round trips" and **nothing in this tree counts round trips**. Fix the counting or accept an unmeasured claim — do not skip past that |
| T45 | **The 180s watchdog throws away the partial output.** `until()` returns `null` and the buffer is never surfaced (`crates/adapters_web/src/c2w.js`); no per-call timeout; one shell means shared fate. Claude Code, OpenHands and Codex all return what was produced; OpenHands never kills at all. A timeout that discards evidence teaches the model nothing | arch lead | a timed-out call returns what it printed, and says it timed out | OPEN |
| T46 | **`exec` and `read_file` are uncapped into the Document.** `find_files` caps at 60 and SAYS so, `read_process` tails 40 — but a `cat` of a large file goes verbatim into the window, and `crates/context/src/degrade.rs:39` states outright "text and fragments: not what breaks a budget." Cheapest fix in either sweep: cap `said()` in `crates/core/src/workspace/gate.rs` | arch lead | no single tool result can eat the window, and the cap announces itself | OPEN |
| T47 | **`PAGER=cat GIT_PAGER=cat EDITOR=true` at boot.** Grepped and confirmed absent from both `c2w.js` and `image/Dockerfile`. busybox ships `vi`/`more`/`less`, and agent-zero has an issue number for this exact wedge (#1697, "spin at 100% CPU"). Severity is higher than it looks: one shell is SHARED, so `more log` wedges EVERY agent for the full 180s, and T45 then throws away what they printed. Three env vars | arch lead | no command can block on a pager | OPEN — **do T45/T46/T47 as ONE round.** Not four independent bugs: one failure mode with four contributing lines. One shared shell + a pager that waits forever + a watchdog that discards the partial output = a single `git log` costs the run three minutes and produces nothing to learn from |
| T49 | **"One Linux, shared" has an invisible consequence: commands QUEUE.** A second guest is a second 577.75 MiB, so per-agent isolation is refused — but the scheduling cost of that refusal is nowhere on screen or in the prompt. Refuse it out loud, with the consequence attached | arch lead | a person and a model can both see that two agents share one shell | OPEN — pairs with T48 |
| T48 | **An inventory component: tell the model what this computer HAS.** Pairs with T20's deletion of the `python3` line — deleting a false sentence leaves the model guessing, so the same round must state the truth: **four true sentences** the model is never told today — cwd resets every call, commands queue, there is no network (point at `web_search`), and here is what binaries exist. The research calls this the cheapest product surface in the tree, and it is an ACCIDENT rather than a refusal | arch lead | the agent is told what it has, and a test pins the prose to the machine | **DONE 2026-08-21** — the four true things are told, and told STRUCTURALLY: `environment::facts` is the single list, `lines()` renders all of it, and `tests/environment.rs` fails if a declared fact does not reach the prompt. Adding a fact is now the whole of adding it to the prompt |
| T50 | **Environment fidelity became LOAD-BEARING this week and nobody noticed.** T2 made the loop's continue condition an `exec` exit code (`crates/agent/src/goal/mod.rs:37`) — so the guest's capability now decides when a run STOPS, not just what it can do. The only shipped `goal.check` is `test -f DONE.md`, which is the honest ceiling of a guest with no test runner: the strongest verification we can express is "a file exists." Either the check vocabulary grows within busybox (exit codes from `grep`, `diff`, `sh -n`) or the ceiling is stated on screen | arch lead | the strongest available `check` is documented and the weakest is not the only one | **STATED 2026-08-21, and UNPINNABLE — recorded as such rather than given a weak test.** The ceiling is in `goal/declare.rs` and beside `goal.check` in the `builder` fixture, where a person meets it while choosing the command. There is NO machine fact for 'a passing `test -f DONE.md` proves a claim, not a result' — the only test possible would pin prose to prose, which is worse than no test because it makes drift look guarded. It rises for free as the guest gains capability (T44-T49); it needs no mechanism of its own |
| T51 | **T28's browser half is UNVERIFIED and must not be counted as closed.** The gate has no browser and `adapters_web` only gets `cargo check`, so four claims are untested by construction: that `Reflect::set` actually lands `targetAddressSpace` on the `RequestInit`, that Chrome honours it and prompts, that `location.origin` resolves in a real window AND a real Worker, and that Safari behaves as the sentence says. The arch lead said so rather than claiming coverage it does not have — that is the correct behaviour and the row exists so the honesty survives. Closing needs a real Chrome and a real Safari against a served build. **NOW FIFTEEN CLAIMS** — T52 added three (`navigator.locks.query()` reachable by `Reflect` in a window AND in a dedicated Worker; its `pending` array carries a `name` per waiting request; a Worker's queued `askk/awake` appears in `pending` while the page holds the lock) | lead | both engines exercised by a person or a browser agent, and the sentence checked against what actually happens | **EXTENDED 2026-08-20 to cover T29 as well.** T28's four (Reflect lands `targetAddressSpace`; Chrome honours it and prompts; `global().location.origin` resolves in a real window AND a real Worker; `crossing_into_loopback` fires on the hosted origin and not on localhost) plus T29's eight (`navigator.locks` reachable by Reflect in a window and a dedicated Worker; `ifAvailable` returns null rather than queueing in a genuine second tab; a never-settling callback promise holds the lock for the tab's life and releases on close; two real tabs land Leader/Follower rather than both Leader; **a backgrounded run survives five minutes** — T29's own closing condition; Chrome's freezer treats `askk/awake` as contended given a Worker waiter; a Worker's `askk/awake` request never resolves while the page lives; the forgotten Closures cost nothing). TWELVE claims, none of them testable in a gate with no browser, none of them faked. Neither T28 nor T29 closes until a real Chrome and a real Safari are pointed at a served build. **THE CONSTRUCTION HALF IS BEING CLOSED 2026-08-21 — the round's intent, verification left to the gate.** This row said `adapters_web` is untestable by construction and it was RIGHT: `grep -rn wasm_bindgen_test crates` was **0**, so the gate could only `cargo check` the crate holding every headline mechanism. The round adds a browser suite over `adapters_web` (worker C owns the runner and its name) and makes running it **gate step 5 of six** (`docs/STATUS.md`), which is what turns a claim about that crate into one a command can fail. **What that does NOT close, and this row stays open for it:** the suite exercises the browser it is pointed at, not every browser. The twelve claims above are Chrome-vs-Safari BEHAVIOUR claims — LNA prompting, `ifAvailable` in a genuine second tab, a five-minute backgrounded run, WebKit's absent `targetAddressSpace` — and no runner settles those without a person driving both engines against a served build. Construction closed; coverage open. Nothing here is claimed until the gate has run |
| T52 | **The freeze exemption has a SILENT hole, found by the agent that built it.** T29's exemption comes from a second lock (`askk/awake`) the page holds and every agent Worker queues on — the CONTENTION is the mechanism. So a roster trimmed to `main` alone has no Worker, therefore no waiter, therefore no contention, therefore no exemption — and nothing says so. The capability is real, its precondition is invisible, and the precondition is a thing a person changes by editing a roster. Same family as T20/T25/T48/T50: a true thing nobody is told | arch lead | either the single-agent case holds its own contention, or the UI says the run can be frozen when backgrounded | **DETECTION DONE, SURFACE OPEN 2026-08-21** — `locks::awake` probes `navigator.locks.query()` for a waiter on `askk/awake`, returning `Option<bool>` so an absent LockManager claims nothing either way. Corrected framing from the round: the exemption is NOT only lost on a trimmed roster — the page takes the lock at boot and Workers queue as they come up, so EVERY load has a window with a held, uncontended lock. The person-facing sentence is not written; it belongs in `core/src/failure/` and is the one half of this row still open |
| T53 | **Nothing in this tree tests the ROUTER, and the router is the mandate's first sentence.** Every deep-path mechanism is downstream of a `strategy` vote that nothing measures. A build request voted `react` produces no plan, no verify, no grounding and **no signal at all that the deep path was skipped** — and `strategy.rs` fails to the MIDDLE, into exactly the route that leaves the least evidence. All five build stages could ship gate-green and the owner's mandate still be unmet. Found by the design agent as an objection to its own design | arch lead | a fixture corpus of queries pins the route each one takes, and a skipped deep path leaves a trace | OPEN — **build this BEFORE the later build stages**, it is T12 plus a corpus |
| T54 | **A claim we must not make on screen: the grounder can only ground against THIS TURN'S tool results.** We have no page fetch, so "quotes matched against actual page text" would be false of our machine. Caught BEFORE shipping — the first prospective catch by the honesty law rather than a retrospective one | arch lead | the grounder's on-screen words describe what it actually checks | OPEN — pairs with the honesty round |
| T55 | **`docs/GOAL-AND-LOOP.md` rejected the verifier window on the wrong mechanism.** Its "No LLM judge for the verdict" bullet refused a thing T13 requires, by arguing against a different design than the one proposed. A refusal recorded against the wrong mechanism reads as settled and silently forecloses the right one | arch lead | the bullet says what was actually refused | OPEN |
| T56 | **S3 has a real regression attached: taking `exec` away from `verify` breaks any agent with no declared `goal.check`.** Ship it WITH a check on `main` or do not ship it. Conceded by the design agent rather than hidden | arch lead | no shipped agent loses verification to gain a sheet | OPEN — binds the verify-sheet stage |
| T57 | **A seventh instance, and it is in a stage brief: `public/stages/durable.md` tells the `plan` stage to call `remember`, which `plan` cannot call.** Live on every project-route turn of shipped `main`. NOT identical to T25 — the sentence says "the first thing to do in the work that follows", which is TRUE OF THE TURN and FALSE OF THE STAGE. **LEAD RULING: reword, never grant.** The two fixes point opposite ways and only one is legal: widening `plan`'s grant to match the prose would let a sentence edit a capability, which inverts I6 and makes prose the authority over the toolbox. The brief must address the stage that HOLDS the grant | arch lead | the brief instructs the stage that can act, and no grant moved | **DONE 2026-08-21** — `public/stages/durable.md` now addresses the stage that HOLDS the grant: it tells `plan` to write the two lines and says plainly that this stage calls no tools, and names `remember` as the WORK stage's first action. Reworded, never granted — widening `plan`'s toolbox to match a sentence would let prose become the authority over a capability, which inverts I6 and is a worse defect than the one being fixed |
| T58 | **A recorded CONCESSION, not a gap to quietly close: `## response_contract` is outside the class test's world scan.** `now` is both a shipped tool name and an ordinary English word, and the contract says "you can answer it now from what you already know". The alternative was rewording harness prose to dodge a tool's name, which is the tail wagging the dog. Consequence, stated: a tool named in the response contract AND NOWHERE ELSE is not caught | arch lead | the concession stays written in the test itself, where the next reader meets it | **DONE 2026-08-21** — the `## response_contract` block stays outside the world scan and the concession is written in the test where the next reader meets it: `now` is both a shipped tool and an ordinary English word, and rewording harness prose to dodge a tool's name is the tail wagging the dog. A tool named in the response contract and nowhere else is not caught — a stated blind spot, not a silent one |
| T59 | **Sweep for VACUOUS assertions — negative tests that pass because the string they deny is already absent.** Found twice this round, both by accident: `examples.rs:177` asserted a shell-less agent is not offered the shell task by checking `!contains("python3")`, a phrase a rewrite had deleted — it would have passed forever while proving nothing; and a `python3` assertion of the arch lead's own was vacuous the same way. A negative assertion needs a POSITIVE control: prove the string appears where it should before trusting its absence where it should not. Same family as the pinnability table — a test that cannot fail is prose pinned to prose | arch lead | every `!contains` in the tree has a control, or is rewritten | **DONE for this round's files 2026-08-21** — swept the `!contains` family in everything this round touched. `prompt.rs`'s negatives already carried positive controls; MINE did not: `examples.rs` asserted `!contains("python3")` after a rewrite had deleted that phrase from every string, so it could never fail. Both negatives there now share a phrase the assertion above proves IS present, which makes the pair falsifiable. **GENERALISED AND PROMOTED TO LAW 2026-08-21 — the round's intent.** The sweep was scoped to `!contains`; the class is wider and was found on the owner's headline capability: `crates/core/tests/delegation.rs:180-201` asserts an ORDER that a fully serial `for … .await` loop produces identically, under a doc comment claiming the opposite of what it measures — because the host double resolves synchronously (`adapters_test/src/lib.rs:27-29`, `adapters_test/src/agents.rs:46-63`) so `batch.rs:139`'s `join_all` cannot interleave. A POSITIVE assertion can be vacuous exactly the way a negative one is. Three things close the class rather than the case: **I17** (`INVARIANTS.md`) makes 'a claim the gate cannot execute is not a verified claim' law with a boundary and a PROVISIONAL mark; gate step 5 gives the concurrency claims a command that can turn red; and every test written or rewritten this round carries a POSITIVE CONTROL that was actually run and recorded — break it, watch exit 101, put it back. **Open:** the tree-wide sweep of pre-existing tests is still not done, and I17 is unenforced by anything but review — there is no CI here, so a gate step is only as good as someone running it |
| T27 | **Guest network egress, owner-approved in DIRECTION only.** Blocked on: its own ADR, a written I2 amendment, and a person-configured allowlist with no shipped default. No code before all three | arch lead | ADR + I2 amendment exist and the lead has read them | OPEN — SECURITY, do not start with code |
| T28 | **The default model path is broken on current browsers.** `public/models.json` `local` = `http://127.0.0.1:8873/v1` and `public/agents/main/agent.md:4` says `model: local`. Chrome 142 shipped Local Network Access ("any request from a public website to a local IP address or loopback"); Chrome 147 extended it to WebSocket/WebTransport; Firefox followed. Safari cannot do it at all — WebKit 171934 still NEW since 2017. **Denial is silent and indistinguishable from a closed port**, so the one discipline this codebase is rigorous about — name the refusal in the words that name the fix — is exactly what it cannot do here. Fix is three changes: `targetAddressSpace: "loopback"`, first call behind a USER GESTURE not a boot probe, and a distinct `ModelError` surfaced through the existing `ModelPort::resolves` | arch lead | a person on Chrome and a person on Safari each get told the truth | **CODE DONE, BROWSER UNVERIFIED 2026-08-20** — `targetAddressSpace: "loopback"` set via `Reflect` on loopback targets only (the LNA spec's enum is `public`/`local`/`loopback`; `"local"` now means the local NETWORK and would have named the wrong space); new `ModelError::LocalNetwork` decided from the ORIGIN/TARGET pair the app knows for certain, not guessed from a `TypeError` that a denied prompt and a closed port share; copy names Chrome, Safari, Local Network Access, both fixes, and the Worker limit. Does NOT close until a real Chrome and a real Safari are pointed at a served build — see T51 |
| T29 | **Web Locks: one ~20-line change, two payoffs.** Chrome 133 freezes a hidden CPU-intensive browsing-context group after 5 minutes INCLUDING ITS WORKERS — which is every agent we have, and a wasm x86 emulator is the textbook target. Holding a CONTENDED Web Lock is a documented exemption. Closes the two-tabs-one-log hole AND buys freeze immunity | arch lead | a backgrounded run survives 5 minutes | **CODE DONE, BROWSER UNVERIFIED 2026-08-20** — `askk/log/<agent>` exclusive + `ifAvailable` decides leader/follower per agent; a follower REFUSES TO TAKE TURNS (one predicate gates writing and turn-taking, because taking a turn IS writing) and says so in words that name the fix. Freeze-exemption comes from a second lock `askk/awake`, held by the page and queued on forever by every agent Worker — the queue IS the mechanism. Absent `navigator.locks` degrades to exactly today (I15). The five-minute survival CANNOT be measured in a gate with no browser and is not claimed |
| T30 | **Pin the durable goal to the tail.** A correctness hole in the headline capability | arch lead | the goal cannot be compacted away | OPEN — research's #2 |
| T31 | **Make the catalogue entry the whole provider truth.** One change closing five silent defects, and the landing site for the `tool_style` seam and for reachability | arch lead | a model swap changes one entry | OPEN — research's #3 |
| T32 | Storage ruling CHANGED by measurement: Safari's 7-day ITP cap is live, counts days of SAFARI USE (hence its irreproducibility), the only documented exemption is a **Home Screen web app, not `persist()`**, and eviction is **all-or-nothing per origin**. Ruling is now "call `persist()`, believe nothing, design for total wipe with a resumable sha256 manifest" | arch lead | T15 is designed for total wipe | OPEN — binds T15 |
| T33 | `ADR-008:69` still rules "no COOP/COEP, no SAB, no COI in v1" while `web/coi-sw.js` has shipped exactly that since 2026-08-18. `require-corp` is forced because Safari has no `credentialless`. Our COEP audit passes ONLY because I1 and I5 leave us no cross-origin no-cors subresources — **write that down before someone adds a CDN font** | arch lead | ADR-008 matches what ships | OPEN |
| T34 | One DNS change (Cloudflare in front of a custom domain) would delete the first-load reload, the flash, Chrome's intermittent second-load failure, and iOS's 7-day SW eviction TOGETHER | OWNER GATE | owner rules on a custom domain | OPEN — cheap, high payoff, needs a domain |
| T35 | Every agent including `main` runs in a Worker, and Chrome's Prompt API is not exposed in Workers (`adapters_web/src/lib.rs:76-79` already handles this correctly). So an on-device entry the PAGE can resolve may be one NO AGENT can use. Needs one test, not a fix | arch lead | the test exists and says which it is | OPEN — a question, not a defect |
| T60 | **What T29 left open in the follower tab, deliberately.** (a) `boot::migrate` stamps `meta/schema_version` and can `replace_prefix("events/")` BEFORE writership is known — gating it would thread the answer into `boot` and leave a follower un-migrated anyway; (b) Settings writes are not gated (origin-wide, last-write-wins is arguably the intent, but it is untested and unstated); (c) shared spaces are deliberately NOT gated, since a space is the one thing two agents in different contexts must both write; (d) the composer stays ENABLED in a follower tab — pressing Send is a no-op that leaves the notice standing, so the person IS told, but the draft goes nowhere and the composer itself never says why | arch lead | each is either gated or its reason is written where the code is | OPEN |
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
| D11 | The prompts-as-config round closed GREEN and committed (`main b413ab6`): four gates own-exit-code and unpiped, 548 tests, I12 11→10 at the ceiling with nothing grown into it. The verification's own failure history is written into `docs/STATUS.md` — four attempts measuring the wrong thing (wrong command, wrong granularity, wrong normalisation, wrong moment) | 2026-08-20 |
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


## Corrections the second sweep forced (do not re-derive)

- **`PRIOR-ART.md` §4 finding #3 is FALSIFIED.** Hermes 0.20.0 "The Herald Release"
  (2026-08-03) ships a grounder. We are not first, and their mechanism beats the
  one we planned. See T38.
- **§4 finding #1 survives only in narrowed form.** `kedge` and
  `einfach-agent-rust` do run the whole loop client-side. Neither pairs it with a
  real Linux guest — that pairing is what is actually ours.
- **"orinth" is Ornith-1.0** (DeepReinforce, 2026-06-25), and it is a MODEL
  FAMILY, not a harness. The popular claim that it emits a Python harness at
  inference is false against the primary source: self-scaffolding is a TRAINING
  procedure, and it is benchmarked inside other people's harnesses — including
  ones like ours. A 9B that scores 43.1 Terminal-Bench is an edge-deployable
  model, which is our lane. What we take from it is T39, not an architecture.
- **Do not claim durable execution improves QUALITY.** DFAH (arXiv 2601.15322)
  finds decision determinism and task accuracy uncorrelated. Build the memo
  (T15); claim resumability and auditability only.
- **Hermes orders its prompt by cache stability.** We deliberately stopped doing
  that when `Slot` took over ordering. We are ahead; do not drift back.
- **Their iteration cap went 90 -> 500. Not transferable.** 500 rounds against a
  13-15x emulator is a frozen tab.

- **Docker's thesis (`docs/research/AGENT-ENVIRONMENT.md`): an agent needs a
  hardware-isolated COMPUTER, not a container** — coding agents build and run
  their own containers, and Docker-in-Docker "requires elevated privileges that
  undermine the isolation you set up in the first place." Hence microVM
  sandboxes with their own kernel and daemon. The line that binds us: **"natural
  language directives are not security boundaries. Infrastructure is,"** and
  "permission prompts are not a security strategy" because "a human cannot sit in
  the control loop for thousands of actions at machine speed." We already agree —
  I6 is infrastructure. This is why T27 starts with an ADR and an I2 amendment.
- **Unimpressed by Docker where it deserves it:** their own `summary.yaml` says
  Experimental while the blog says launched; `sbx exec` has no documented timeout
  flag and no documented exit-code semantics; nobody in the survey ships live
  checkpoint/restore; and "local stdio MCP servers run on the host, OUTSIDE
  sandbox isolation" — an airtight microVM with a hole where the tools plug in.
- **Two places we BEAT the field, do not regress them:** long-running processes
  (liveness from the `exit` file not `kill -0`, two pids, log-growth as the stop
  verdict, names not pids) and refusals that quote the path back instead of
  silently clamping. And we tell the model AND the person "gone when the page
  reloads" in one tested wording — more than the vendors do.
- **Our absence-based network posture beats every allowlist proxy in the
  survey.** Anthropic admits theirs is defeatable by domain fronting and reports
  an incident where the allowlist proxy was the piece that failed. Cloudflare
  ships our exact persistence refusal ("All disk is ephemeral"). The defect is
  only that the model is never TOLD — see T48.


## The lead's ruling on the five instances (2026-08-20)

T20, T25, T48, T50 and T52 are not five bugs. They differ in DEPTH, not in
kind — prose describing a machine we do not ship; a block true of the agent and
false of the turn; a watchdog that throws away what it saw; a verification
ceiling nobody stated; a freeze exemption whose precondition can vanish in
silence. Each is **a true thing the system knows and never says.**

Five instances is no longer a list of defects. It is a **missing habit**, and a
habit is not fixed by patching its fifth instance. So the round that closes them
does not open with code:

1. **It opens with a written law.** A capability, a refusal and a limit are each
   an assertion, and an assertion that is never made is not a safe default — it
   is a lie of omission that the model then reasons from. This is the same
   through-line `docs/CRITIQUE-04.md` already carries at the top (*an assertion
   that a capability resolves is not an assertion that its description is
   true*), now with its converse: **a truth the system holds and does not state
   is a defect, whether or not anything is wrong underneath it.** PROVISIONAL,
   proposed as an addition to `INVARIANTS.md`; the owner may strike it.
2. **Then the test that makes it enforceable.** No test in this tree asserts
   PROSE against the MACHINE — that hole was named in T20 and it is why five
   instances could accumulate without a single red gate. The test is the
   round's real artifact; the five fixes are its first five cases.
3. **Then the five, as one voice rather than five patches.** They read as one
   product surface or they are not done.

Do not let this round be scoped down to "add the missing sentences." The
sentences are the cheap half. The law and the test are what stop a sixth.


## The honesty round's real output: the pinnability table (2026-08-20)

The round's generalisation, and the thing to reuse: **every honesty claim needs a
named MACHINE FACT it is checked against, and where no such fact exists, that
absence IS the finding.** A test that pins prose to prose is worse than no test,
because it makes drift look guarded.

**A lead ruling was REVERSED here on evidence, and the reversal is the point.** I ruled the substrate sentence should live in the declaration. It was moved as directed, and the class test went red within seconds: `environment::facts` is a function of the TOOLBOX, so it renders nothing for an agent with a folder and no workspace tools — which is the shipped `critic` exactly, since T28 left it with an empty toolbox. The declaration described its folder without the one property that matters. The `## space` block renders whenever there IS a folder to describe, which is precisely when the fact applies. So the space block keeps the sentence and the declaration drops it — still one voice, one place, the same doctrine resolved to the other component. Both files carry a comment saying a TEST settled it, not an argument.

| claim | machine fact it is checked against | pinnable |
|---|---|---|
| guest inventory (T20/T48) | `image/Dockerfile`'s inventory block | **yes** — fails on any add/remove/rename; proved by adding `jq` and watching exit 101 |
| capability grants (T25) | `ask::scoped_tools`, read out of the RENDERED `## affordances` — the oracle comes from the artifact under test, not a second copy of the rules | **yes** |
| persistence (T20) | `WorkspacePort::durable()` | **yes** — and this is precisely why the gated `true` arm is LEGAL |
| every declared fact reaches the model (T48) | the declaration's own field list | **yes** |
| verification ceiling (T50) | none exists | **NO — recorded unpinnable, deliberately** |
| freeze exemption (T52) | `navigator.locks.query()` | **browser-only** — joins T51, no weak host-side stand-in |

I16's boundary, which keeps the law from becoming vandalism: *a string gated on a
fact is what this invariant asks for; a string gated on nothing is what it
forbids.* **The test is not whether a sentence could be false — it is whether
anything checks before saying it.**

## The gate (SIX commands, never piped, own exit code)

Recorded in full, with the argument for each step, in `docs/STATUS.md`. A gate
run that reads grep's exit code is not a gate run; that mistake was made twice
and is now law.

    1. cargo test --workspace
    2. cargo check -p adapters_web --target wasm32-unknown-unknown
    3. cargo check -p ui --target wasm32-unknown-unknown
    4. python3 scripts/check-size.py
    5. scripts/check-browser.sh          # browser suite over adapters_web (T51)
    6. ./publish.sh --dry-run            # every publish check, stopping before the push

Steps 5 and 6 were added 2026-08-21. 5 exists because steps 1-4 never RUN the
crate holding every headline mechanism — step 2 only proves it compiles, and a
live wedge (`adapters_web/src/workers/spawn/reply.rs:138`, one resolver slot per
peer, a turn that hangs forever) sat inside that blind spot while 581 tests were
green. 6 exists because `publish.sh` verifies a pile of things nothing else checks —
assets present, manifest and folders in agreement, the engine wasm floor, the
99MB cap, the relative-URL rule — and until now none of them ran until somebody
was already deploying.

**It is `--dry-run` and that is load-bearing.** The first draft of this list wrote
bare `./publish.sh` as step 6 and called a green round reaching the phone "the
default". `publish.sh:122` is `git push origin gh-pages`, T10 is an OWNER GATE,
and CLAUDE.md §17 says destructive storage always stops — so a numbered list
headed "the gate" containing a push inverts an owner gate by formatting alone.
A gate step may only be something that can FAIL, never something that changes the
world. The push stays the owner's call, asked each time; a green gate is evidence
the answer could be yes, not the answer. **`publish.sh` is at the repo ROOT, not
under `scripts/`.**

Both are new law: **I17 — a claim the gate cannot execute is not a verified
claim** (`INVARIANTS.md`, PROVISIONAL).

## T60 — a gate command that cannot be reproduced on another machine

`.gitignore:3` ignores `Cargo.lock` for the whole tree under a bare `# Rust`
header. That is the convention for a LIBRARY, and this repo ships an
application: the root lockfile is untracked (`git ls-files --error-unmatch
Cargo.lock` exits 1), and so is `crates/adapters_web/tests/browser/Cargo.lock`,
which the nested package's own `.gitignore` does not re-include because the root
rule already caught it.

It stopped being cosmetic when the browser suite became **gate step 5**
(`scripts/check-browser.sh`, I17). A fresh clone re-resolves that package's
dependency graph from scratch, so the command that is supposed to make
`adapters_web`'s claims executable is itself not reproducible — and a gate whose
result depends on when you cloned is a weaker gate than its exit code suggests.

Found by the increment-1 gate runner and written down here by the LEAD, not by
that agent — the bar-raiser correctly flagged this section as an edit no worker's
report accounted for, and the answer is that the lead wrote it in the finder's
voice, which is its own small honesty defect. Attribution recorded. The gate
runner also caught the measurement that hid it: worker C offered `git diff --stat Cargo.lock crates/adapters_web/Cargo.toml
-> empty` as proof it had changed nothing, and that diff is empty for an ignored
path no matter what was done to it. **A clean diff on an ignored file is not
evidence** — it is the same vacuity class as T59, one layer out, in the paperwork
rather than in a test.

NOT fixed here, deliberately. Committing lockfiles reverses a standing choice for
the whole tree and changes what every future dependency bump looks like in
review; that is the standards team's call and its own increment, not a ride-along
on a ruling pass. Recorded so the next round inherits the finding rather than
rediscovering it.
