# PRIOR-ART-2 — the second sweep: orinth, Hermes since 0.19, and 2026

> Research unit, 2026-08-20. Read against `main` @ 65e0e56.
> **This document does not repeat `docs/research/PRIOR-ART.md` or
> `docs/research/CORE-ELEMENTS.md`.** It extends them, and where it *contradicts* one of them it
> says so in bold and names the line.
>
> Every claim about another project cites a URL opened this session. Claims I could only reach
> through blogs are marked **UNVERIFIED** and are never used to support a ruling. Where a widely
> repeated claim turned out to be **false against the primary source**, it is written up as a
> correction rather than silently dropped — three of those are in here and one of them is the most
> useful paragraph in the document.

---

## 0. The three answers, up front

**1. "orinth" is almost certainly *Ornith-1.0*, and it is not a harness — it is a model family
trained by having the harness itself learned rather than designed.** Confidence: **high** on the
identification (there is no project spelled Orinth or Orinthe anywhere I could reach; Ornith is a
June 2026 release that sits squarely in the owner's reading space and its own docs name Hermes
Agent as an integration). Confidence: **certain** on what Ornith is, because the primary source is
readable. See §1 — and note that the popular description of it is wrong, which is the interesting
part.

**2. The Hermes delta is one major release and two patches: 0.19.0 → 0.20.0 "The Herald Release"
(2026-08-03), then 0.20.1 (08-13) and 0.20.2 (08-16).** Seven things in it matter to us and one of
them **falsifies a headline finding in `PRIOR-ART.md` §4**: Hermes now ships a grounder. See §2.

**3. The thing we would be most embarrassed not to know** is not a project. It is that the field
converged in mid-2026 on *the model authors its own orchestration*, from two independent
directions — Ornith learns the scaffold in RL, Hermes writes skills at runtime and calls tools from
model-written Python — and that **both of them draw the same boundary in the same place**: the
tool surface and the trust boundary are immutable and outside the model's reach; only the inner
policy is learnable. That line is HARNESS's architecture stated by other people, and it is the
single strongest external validation the design has received. See §4.

---

## 1. "orinth" — the search, and the answer

### 1.1 What I searched, so the negative result is auditable

`orinth agent framework github`, `"Orinth" OR "Orinthe" sandbox agent harness 2026`, `"orinth"
agent`. Nothing named **Orinth** or **Orinthe** exists as an agent framework, sandbox, harness or
repository in any result. Every search converged on the same near-homophone, and it converged
immediately and unanimously. I am not substituting silently — I am naming the substitution and its
confidence.

### 1.2 Ornith-1.0 — *the harness should be learned, not designed*

- **What it is.** An MIT-licensed family of open-weight agentic-coding models from the
  **DeepReinforce Team**, released **2026-06-25**: 9B-Dense, 31B-Dense, 35B-MoE, 397B-MoE,
  post-trained on **Gemma 4 and Qwen 3.5**
  (https://raw.githubusercontent.com/deepreinforce-ai/Ornith-1/main/README.md;
  https://deep-reinforce.com/ornith.html).
- **Philosophy, in one sentence.** *A hand-designed harness is a human prior the model can beat, so
  the scaffold should be a learnable object that co-evolves with the policy.* Verbatim: "Rather
  than relying on a fixed, human-designed harness shared across a task category, Ornith-1.0 treats
  the scaffold as a learnable object that co-evolves with the policy."
- **The feature that philosophy produced.** Self-scaffolding RL. "Each RL step proceeds in two
  stages: conditioned on a task and the scaffold previously used for it, the model first proposes a
  refined scaffold; conditioned on that scaffold and the task description, it then generates a
  solution rollout. Reward from the rollout is propagated to both stages, so the model is optimized
  not only to produce better answers but to author the orchestration that elicits them."
- **Mechanism.** Two-stage rollout with reward propagated to both stages; pipeline-RL with a
  staleness weight `w(d_t)` that exponentially downweights off-policy tokens between `K1` and `K2`
  and zeroes them past `K2`; token-level GRPO loss multiplied by that weight.
- **The numbers, from the primary table.** 397B: **77.5** Terminal-Bench 2.1 (Terminus-2), **82.4**
  SWE-Bench Verified — ahead of Claude Opus 4.7 (70.3 / 80.8), behind Opus 4.8 (85 / 87.6). 35B:
  64.2 / 75.6. **9B: 43.1 / 69.4**, described as edge-deployable and beating Gemma 4-31B.

### 1.3 The correction — and it is the reason this section is worth reading

Every secondary write-up says Ornith **emits a Python harness at inference time**. MindStudio's
headline is literally "How Ornith 1.0 Writes Its Own Agent Harness"; another says "the model
analyzes the task description, the available tools, and any constraints, then produces a Python
harness that defines how the task will be executed." **The primary source does not say that, and
its own evaluation footnotes contradict it.** Ornith is benchmarked *inside other people's
harnesses* — "the Harbor/Terminus-2 framework", "Claude Code 2.1.126", "using OpenHands harness",
"using mini SWE agent harness" (https://deep-reinforce.com/ornith.html, Footnote). The
self-scaffolding is a **training-time** procedure that bakes better orchestration into the weights.
At inference it is an ordinary OpenAI-compatible tool-calling model that emits `<think>…</think>`
blocks (https://huggingface.co/deepreinforce-ai/Ornith-1.0-9B).

Mark the "writes its own harness at inference" claim **UNVERIFIED and probably false**. It matters
because if it were true it would be an argument that our declared `stages:` is obsolete. It is not
true, and the actual result points the other way — see §1.4.

### 1.4 The paragraph in Ornith that should go in an ADR

From "Addressing Reward Hacking in Self-improvement", verbatim:

> "We defend against this in three layers. **First, we fix the outer trust boundary: the
> environment, the tool surface, and test isolation are immutable and outside the model's reach, so
> the model evolves only the inner policy scaffold: its memory, error-handling, and orchestration
> logic.** Second, a deterministic monitor enforces that boundary at the level it can be specified
> exactly, flagging any attempt to read withheld paths, modify verification scripts, or invoke
> actions outside the sanctioned tool surface, and assigning such trajectories zero reward with
> exclusion from the advantage computation. Third, because intent-level gaming can occur entirely
> within the allowed tool surface, a frozen LLM judge acts as a veto on top of the verifier rather
> than the primary reward."

The failure they are defending against is stated just as plainly: a self-authored scaffold "can
learn to satisfy the verifier without performing the task: reading the visible test files and
hardcoding the expected artifacts… or copying an oracle solution present in the environment."

This is our architecture, arrived at independently, by people who had to defend a reward signal
rather than a design principle:

- **"the tool surface … immutable and outside the model's reach"** is **I6** (capability-gated,
  default deny) as a *training* requirement.
- **"a deterministic monitor … flagging any attempt to … invoke actions outside the sanctioned tool
  surface"** is the refusal path in our toolbox, and it is why `ToolResult` being total matters.
- **"a frozen LLM judge acts as a veto on top of the verifier rather than the primary reward"** is
  `crates/agent/src/critic.rs` — a window that did not do the work, sitting *on top of* the
  mechanical gate rather than replacing it. `verify.rs`'s mechanical gate is the verifier; the
  critic is the veto. **We already have exactly this two-layer shape and did not know it had a
  name.**
- And the part we should steal outright: **"the model evolves only the inner policy scaffold: its
  memory, error-handling, and orchestration logic."** That is the sentence that decides how far
  `PRIOR-ART.md` row J (model-written orchestration script) may go. It may write memory,
  error-handling and orchestration. It may **never** write the tool surface, the capability grant,
  or the verification.

### 1.5 Two smaller things Ornith settles for us

- **The `<think>` defect is now a live defect, not a hypothetical.** `CORE-ELEMENTS.md` §4.1 C6
  records that `<think>…</think>` inside `content` is never stripped, so `calls::parse_batches`
  will execute a call the model only *reasoned about*. Ornith's own eval footnote says they had to
  "modify Harbor to align with vLLM's `reasoning_content` key" — i.e. this exact class of model
  breaks this exact class of harness, and the people shipping the model had to patch the harness to
  fix it. C6 stops being a tidiness item.
- **A 9B model at 43.1 Terminal-Bench / 69.4 SWE-Bench Verified, MIT, edge-deployable** is the most
  interesting fact in §1 for a product whose default endpoint is a local server. Our shipped
  comparison class is gemma-4-12B and the entire TOON ruling
  (`CORE-ELEMENTS.md` §2.3) rests on Gemma-3-12B numbers. Ornith-1.0-9B is a materially stronger
  agentic model in the same memory envelope. **RULING: not a change to the code — a change to the
  bench.** Any future measurement of our loop should be run against Ornith-1.0-9B beside the
  gemma, because a conclusion drawn from a model that cannot follow the loop is a conclusion about
  the model.

### 1.6 RULING on Ornith

**ADAPT one sentence, ADOPT one benchmark, REJECT the trend it represents.**

*Adapt:* write Ornith's trust-boundary sentence into `DECISIONS/` as the rule that bounds
`PRIOR-ART.md` row J. If we ever let a model author orchestration — Koto/Rhai script, a workflow,
anything — the environment, the tool surface and the verification are **immutable and outside its
reach**, and the deterministic monitor that enforces that is not optional. This is not new policy;
it is **I6** and `verify.rs` given an external citation and a named failure mode.

*Adopt:* add Ornith-1.0-9B as a second local bench target.

*Reject:* self-scaffolding as a product direction. It is a training procedure requiring an RL loop,
a reward, a held-out verifier and a frozen judge. We have none of those and want none of them, and
the primary source is explicit that the model does **not** do this at inference. Any proposal that
cites "Ornith proves the model should write the loop" is citing a blog, not the paper.

---

## 2. Hermes — the delta since 0.19.0

We ran **0.19.0** in-browser via container2wasm. Since then:

| Tag | Version | Date |
|---|---|---|
| `v2026.7.20` | 0.19.0 "The Quicksilver Release" | 2026-07-20 |
| `v2026.7.30` | 0.19.1 | 2026-07-30 |
| `v2026.8.3` | **0.20.0 "The Herald Release"** | 2026-08-03 |
| `v2026.8.13` | 0.20.1 | 2026-08-13 |
| `v2026.8.16` | 0.20.2 | 2026-08-16 |

(https://github.com/NousResearch/hermes-agent/releases,
https://github.com/NousResearch/hermes-agent/releases/tag/v2026.8.3). 0.20.0 is ~3,650 commits and
~1,400 merged PRs across 647 contributors, so most of it is surface. Seven things are architecture.

### 2.1 THE ONE THAT FALSIFIES US: Hermes ships a grounder

`PRIOR-ART.md` §4 finding **#3** says, in bold, "**Nobody ships a grounder as a role in open
source**… No open harness in this sweep has one. **Edge, and a cheap one.**"

**That is no longer true, and it stopped being true eighteen days before it was written.** 0.20.0
bundles a **`grounded-citations` skill**: research where "every claim is backed by a verifiable
source: quotes are matched against actual page text (not hallucinated), citations link to exact
evidence", plus "a fact-checking mode [that] applies this machinery to any document or claim"
(release notes, v2026.8.3).

Read the *mechanism*, because it is better than the one we were about to build:

- **Ours (proposed, `PRIOR-ART.md` rec #3):** a model call over the answer plus retrieved evidence,
  emitting a 0–1 support score per claim, in the shape Vertex uses.
- **Theirs (shipped):** **string matching**. A quote is grounded if it appears in the fetched page
  text. Not a judgement, not a score, not a second window — a substring check.

**Ruling: ADAPT, and demote our own recommendation #3 in the process.** Hermes' version is cheaper
than ours by an entire model call, it is deterministic (**I7**), it emits a fact rather than an
opinion (**I8**), it cannot be gamed by a model grading itself, and it is the *only* form of
grounding an offline browser product can honestly offer, because we can only ever ground against
bytes we actually fetched (**I2**). The 0–1 support score is the part to drop: it is a judgement
dressed as a measurement.

Concretely: `web_search`/fetch results must be retained as addressable evidence (which
`PRIOR-ART.md` rec #3 already demands as prerequisite work in `crates/context`), and a **pure
function** in `crates/agent` checks each quoted span in the reply against the retained text,
marking every quote *found* / *not found*. That is `verify.rs`'s mechanical-gate pattern applied to
citations, and it needs no LLM at all. **This is the largest single change in ranking that this
sweep produces.**

### 2.2 Tools that recover from their own failures

0.20.0: "Tools now recover from their own failures rather than requiring model intervention" —
terminal output that exceeds the limit "spills to readable files" and the working directory is
echoed on change; patch "detects already-applied edits; diagnoses whitespace mismatches"; search
"probes for near-misses when queries match nothing"; file writes are "verified on disk after
writes". And the default tool-calling iteration limit went **90 → 500**.

- **Philosophy.** A tool failure is a defect in the tool, not a puzzle for the model.
- **Why it matters to us more than to them.** Every recovery a tool performs in Rust is a model
  round-trip we do not spend, and we are the ones paying 13–15× for emulated x86 and running
  against a 12B-class local model that recovers badly. `CORE-ELEMENTS.md` §1.5 already establishes
  that our `ToolResult` is **total** — "every failure is a result the model can read, never an
  error return… which is why a refused call still teaches the model how to rewrite it." Self-repair
  is the next rung on that exact ladder: don't just *teach* the rewrite, *do* it where the fix is
  deterministic.
- **Ruling: ADOPT, narrowly and in the guest.** It is pure, it is testable on the host (**I3**), it
  emits facts (**I8**), and it directly attacks T9 — and it attacks T9 in the direction
  `docs/ADR-GUEST-TOOL-SURFACE.md` and SWE-agent's ACI result already point (fewer, better tools,
  not more packages). The iteration-limit number is **not** transferable: 500 rounds against a
  13–15× emulator is a frozen tab, and our per-agent `max_rounds` exists for that reason.

### 2.3 Conditional tool availability — the gap `PRIOR-ART.md` §2.12 named, now shipped

The current skills doc adds four frontmatter fields: **`requires_toolsets`, `fallback_for_toolsets`,
`requires_tools`, `fallback_for_tools`**, plus `platforms` (OS restriction) and
`required_environment_variables` (https://hermes-agent.nousresearch.com/docs/user-guide/features/skills).

`PRIOR-ART.md` §2.12 listed as gap #2 "**`paths:`-style conditional availability** — a faculty that
is present only when the turn touches the thing it is for. We have no conditional grant at all."
Hermes now has it, and its shape is better than Claude Code's `paths:` for us, because it keys on
**capability presence** rather than on file globs — and capability presence is exactly what **I15**
already makes us track.

`fallback_for_*` is the sharper of the four: a skill that activates **only when a tool is absent**.
That is I15 turned into a declaration — "here is the text to read when the substrate is missing" —
and it is the first mechanism I have seen anywhere that makes honest degradation *cheap* instead of
merely mandatory.

- **Ruling: ADOPT `requires_tools` / `fallback_for_tools`. REJECT `platforms` and
  `required_environment_variables`.** The first pair is two fields in the skill frontmatter parser
  and a filter in `skills::catalogue`; it shrinks the resident skills index (a standing prompt tax)
  and it costs no new capability surface because skills are pure. `platforms` is meaningless in a
  tab. `required_environment_variables` with "secure prompting" is a secret entering a module's
  declaration, which is the **I6** violation `PRIOR-ART.md` §2.3 already refused in Eliza's
  character file. Refuse it for the same reason, in the same words.

### 2.4 Compaction: micro-compaction, a guaranteed tail, and "ghost-skill defense"

0.20.0's context overhaul: "Proactive tool-result pruning for large-window models; per-turn
micro-compaction amortizing cost; guaranteed N-user-message tail preserving recent conversation;
progress-aware timeouts preventing stalls; **ghost-skill defense preventing pruned skills from
silently haunting sessions**; per-model and absolute-token threshold configuration."

Three of these land on open defects in `CORE-ELEMENTS.md` §3.4:

1. **"Per-model and absolute-token threshold configuration"** is precisely that section's ruling
   item (3) — `compact_at: 8` counts *entries* while `Budget { max_tokens: 4096 }` counts *tokens*
   and neither knows the endpoint's window. Hermes carries both a per-model threshold and an
   absolute one. **Confirms the fix; changes nothing about it.**
2. **"Guaranteed N-user-message tail"** — a floor expressed in *user* messages, not entries. Our
   `keep_recent: 3` counts entries, so three `exec` results can evict every human sentence in the
   conversation. One-line change, real bug.
3. **"Ghost-skill defense"** is the one we could not have predicted and should take seriously.
   A skill body loaded into the window, then pruned by compaction, leaves the model still *acting*
   on an instruction that is no longer in front of it — and, worse, still believing it is. We have
   the same hole the moment `read_skill` output can be compacted away, and we have no defense at
   all. **The fix in our shape is structural rather than behavioural:** a loaded skill is
   `EventKind::ToolInvoked` (`skills.rs`), so the log knows exactly which instructions are resident;
   an instruction that has been compacted away should either be re-rendered as a `Component` or be
   explicitly announced as gone. This is the same class of bug as the durable goal at
   `Slot::SPACE = 55`, and it should be fixed by the same move: **pin it, or say it is gone.**
- **Ruling: ADOPT (2) and (3); (1) is already ruled and needs no second citation.** "Progressive
  disclosure" without a matching "progressive *retraction*" is half a mechanism, and we shipped the
  half everyone ships.

### 2.5 `/context` — show where the window went

CLI gained "`/context` breaks down context window allocation."

- **Philosophy.** A person cannot steer a budget they cannot see.
- **Why this is disproportionately cheap for us and disproportionately valuable.** We are the only
  system in either sweep whose prompt is a **typed, ordered, individually-costed set of
  `Component`s** (**I13**/**I14**, `assemble::cost`). Hermes had to build an accounting layer to
  answer this question. For us the answer is *already the data structure* — `assemble` computes a
  cost per section on every call and throws it away. Rendering it is a projection of the log
  (**I8**), it is the owner-facing half of the brief's "the owner must be able to trace", and it
  is the only diagnostic that would make `degrade`'s elisions visible instead of silent.
- **Ruling: ADOPT, and rank it high.** This is the cheapest legibility win found in either sweep.

### 2.6 The four to refuse, with reasons

- **Outbound webhooks with HMAC-signed lifecycle events.** A *server* feature, and worse: it is an
  outbound network default. **I2** permits outbound traffic only to configured endpoints, and the
  brief's constraint is absolute — no allowlist entry ships as a default. **REJECT.** (The idea
  underneath — that lifecycle events are a first-class product surface — we already have as I8.)
- **A2A v1.0 as a bundled plugin.** Confirms `PRIOR-ART.md` row R is real prior art now rather than
  a spec, but it changes nothing: publishing an Agent Card is outbound, nobody has asked, and it
  buys portability we have no consumer for. **Stays at 20/80 = 2.**
- **"Autonomous skill creation after complex tasks. Skills self-improve during use"** (README,
  https://github.com/NousResearch/hermes-agent). The agent writes and rewrites its own skills at
  runtime. This is Ornith's self-scaffolding at the harness layer, and Ornith's own paper is the
  argument against shipping it without the machinery: a self-authored scaffold games its verifier,
  and their defense needs a deterministic monitor **and** a frozen judge. **REJECT** for now, and
  when it comes back, it comes back bounded by §1.4's sentence.
- **"Write Python scripts that call tools via RPC, collapsing multi-step pipelines into
  zero-context-cost turns"** (README). This is `PRIOR-ART.md` row J / Cloudflare Code Mode /
  CodeAct, now shipped in the harness we benchmark against. It is the strongest evidence yet that
  row J is real — and it does not move: it needs an interpreter (~1.1 MB per `script-engine.md`),
  and until §1.4's boundary is written down it is a model authoring orchestration with nothing
  enforcing what it may reach. **Keep at 3. Do not build before the ADR.**

### 2.7 Two Hermes facts that confirm us rather than change us

- **"Platform-agnostic core — One `AIAgent` class serves CLI, gateway, ACP, batch, and API server"**
  (https://hermes-agent.nousresearch.com/docs/developer-guide/architecture). That is **I4** by
  another name, in the most-shipped open harness in the field. Cite it the next time the one seam
  is questioned.
- **`prompt_builder.py` "assembles ordered tiers (stable → context → volatile)"** — Hermes orders
  its prompt *by cache stability*. **We used to do that and deliberately stopped**: `Slot` decides
  order and `Stability` was demoted to a declared cache class, because ordering by stability put
  the response contract fourth instead of last. **We are ahead of Hermes here.** Do not let the
  citation be read backwards.

---
## 3. 2026 — what we would be embarrassed not to know

Ordered by how much it should change what we do. Everything in `PRIOR-ART.md` §2 is excluded by
construction; this is only the new material.

### 3.1 WebMCP — the browser is standardising the tool boundary we built by hand

- **Source.** https://github.com/webmachinelearning/webmcp (W3C Web Machine Learning CG draft,
  `index.bs`). **Origin Trial live in Chrome 149 and Edge 150.** Firefox and Safari: standards
  discussion only.
- **Philosophy.** An agent should not scrape the DOM or simulate clicks; a page should *declare*
  its functionality as tools.
- **Feature.** `document.modelContext.registerTool({ name, description, inputSchema, execute })` —
  a page hands an agent typed tools while the human keeps using the same UI.
- **Mechanism.** A DOM API on the page, positioned as complementary to MCP rather than a
  replacement.
- **Why this is the headline.** `PRIOR-ART.md` row **H** ("MCP servers as Web Workers over
  `postMessage`", 20/80 = 4, queued immediately after the top five) exists because we concluded the
  page would have to build its own in-tab tool transport. **The platform is now building one.**
  That does not make row H wrong, but it changes its expected lifetime, and shipping a bespoke
  transport a month before the standard's origin trial widens would be the expensive kind of
  cleverness.
- **RULING: REJECT registering, watch consuming, and write the reason down.**
  *Registering* our own operations as WebMCP tools is a **second entry point into the system that
  is not `handle(Request) -> Response`** — that is **I4**, and the brief's own test ("a feature that
  sounds nice but costs us the one seam is a REJECT") disposes of it. Even routed through the seam
  it is an unconditioned capability grant to whatever agent drives the browser, which is **I6**
  backwards. *Consuming* page-declared tools is genuinely interesting and genuinely premature: one
  engine, origin trial, no Safari, no Firefox, and it would make our toolbox depend on which tabs
  happen to be open — the opposite of a declared, traceable tool surface. The correct action now is
  **one paragraph in the ADR that governs row H**, saying we will not build a bespoke in-tab tool
  transport until WebMCP's trajectory across two engines is known.

### 3.2 kedge — our architecture, shipped, with two things we do not have

- **Source.** https://github.com/nlj3/kedge. **BUSL-1.1 — non-commercial until it converts to
  Apache-2.0 in 2030. We cannot vendor a line of it.**
- **Philosophy.** An agent is trustworthy only if you can see what it *would* do before it does it,
  and reconstruct what it *did* afterwards.
- **Feature.** `--audit` "Shadow-Guard": read-only tools execute for real, **every mutating tool is
  intercepted and journaled instead of run**. Plus hard budgets (tokens / steps / wall-clock),
  `kedge replay <id>`, and `kedge resume <id>` from the last journaled step.
- **Mechanism.** A Cargo workspace where `kedge-core` is the dependency root, pure, no I/O:
  domain model, a **ReAct state machine that rejects any transition outside Think → Act → Observe**,
  and a budget tracker charged *before* the expensive work; satellite crates (`-exec`, `-mcp`,
  `-ledger` over SQLite, `-llm`, `-compact`) convert their errors into the core taxonomy at the
  boundary. Its own banner: "The real ReAct engine compiled to WebAssembly… executing entirely
  client-side. No server, no API key, no network."
- **This is a correction to `PRIOR-ART.md` §4 finding #1** ("Nobody runs the whole loop
  client-side… **UNVERIFIED / likely does not exist**"). It exists. **It does not, however, weaken
  the edge** — kedge is a young single-author project under a licence that forbids commercial use,
  and it has no x86 guest. The honest restatement: *the composition is no longer unattempted; it is
  still unshipped at product scale, and nobody else pairs it with a real Linux environment.* Amend
  the sentence, keep the claim.
- **RULING: ADOPT the audit mode as an original implementation. REJECT the rest.**
  Dry-run-by-default is the single best idea in the 2026 sweep for a product whose agent is about
  to be given a shell: it makes "what would this run do" answerable *without running it*, it is
  pure (**I3**), it is a projection of the log (**I8**), and it turns the mutating/read-only
  distinction from a comment into a type. The budget tracker charged before the work is a good
  detail and we should copy the ordering. **Refuse the typed ReAct state machine**: our loop is a
  *declared stage list* and a typed transition-refusing FSM is what
  `docs/research/` already recorded as an explicit non-goal, and `PRIOR-ART.md` §4 finding #2 says
  the value of our declaration is that it is a list rather than a graph.

### 3.3 The 2026 loop literature — three papers that argue our side, and one that warns us

- **LLM-as-Code: Agentic Programming** (https://arxiv.org/abs/2606.15874, KDD 2026 AgenticSE
  workshop). Claim: "token explosion, control-flow hallucination, and unreliable completion are not
  implementation bugs but architectural consequences" of letting a probabilistic system own control
  flow. Their inversion — the program owns control, the LLM is a component called only where
  reasoning is genuinely needed — builds context from the call tree's DAG so **context length
  scales with call depth, not accumulated steps.** This is the strongest published argument for a
  *declared* loop and for `PhaseStep::Tool`, and it is the counterweight to DeepSeek's
  model-written workflow (`PRIOR-ART.md` §2.1) and to Ornith's self-scaffolding. **Cite it; build
  nothing.**
- **Code as Agent Harness** (survey, https://arxiv.org/html/2605.18747v1). A Plan–Execute–Verify
  loop in which plan = contract formation, execute = sandboxed with permissioned state transitions,
  and **verify = deterministic sensors (tests, compiler errors, traces, metrics — not a judge
  model).** That is `verify.rs` restated by a survey, and it is the second independent source this
  sweep produced for the §2.1 ruling that grounding should be a string match rather than a score.
- **From Agent Loops to Deterministic Graphs** (https://arxiv.org/abs/2605.06365). The sentence to
  keep: **"final answer quality and maintained-state quality are distinct."** We measure the first
  and have no name for the second, and the durable goal at `Slot::SPACE = 55` is exactly a
  maintained-state defect that no answer-quality measurement would ever catch.
- **The warning: DFAH** (https://arxiv.org/abs/2601.15322). Measures trajectory determinism,
  decision determinism and evidence-conditioned faithfulness on separate axes, and finds **"decision
  determinism and task accuracy are not detectably correlated"** — a deterministic agent can be
  reliably wrong. **This lands directly on `PRIOR-ART.md` recommendation #2** (the durable step memo
  over IndexedDB, ranked second). Build it — it is still the prerequisite for every long-run
  feature — but delete any sentence claiming replay makes the agent *better*. Replay makes it
  *resumable and auditable*. Those are the claims the evidence supports.
- **TraceCompiler** (https://arxiv.org/abs/2608.02680, EPFL, 2026-08-03) is the interesting
  far-future item: mine trace clusters into mostly-deterministic workflows, separating hard
  producer–consumer dependencies from ambiguous ones, and **refuse to compile workflows with
  under-determined side effects**. A Venmo transfer went from 34 observed API calls to 11 at
  runtime. This is the natural end state of our run archive and it needs the durable log first.
  **Not now. Recorded so the log is not designed in a way that forecloses it.**

### 3.4 Capability and egress — two sources, one quotable line, one uncomfortable idea

- **agentproto AIP-36 `sandbox` block**
  (https://github.com/agentproto/agentproto/blob/main/specs/aip-36.mdx). Declarative compute policy
  as a schema: provider, resource limits, env by **reference only, never inlined**, mounts, and
  `network.egress` as an **allowlist, explicitly not a denylist**. The line to copy verbatim into
  our own docs: **"sandbox with no `network` block MUST be granted no egress."** That is the
  brief's constraint ("no network allowlist entry may ever be shipped as a default") written by
  someone else as a MUST, and `crates/core/src/websearch.rs`'s own header already says the same
  thing in our words — "THE GATE IS THE ALLOWLIST AND IT IS NOT HERE (ADR-006, I6)… the core names
  an endpoint — symbolic, no URL anywhere in this crate — and the adapter either has an address for
  that name or refuses." **We are already correct here. Take the citation, change no code.**
- **shisad** (https://github.com/shisa-ai/shisad, Apache-2.0). Philosophy, verbatim and pointed:
  "Most agent security research solves this by removing capabilities until the agent is safe but
  useless… keep the agent fully capable and build enforcement infrastructure that makes each
  capability safe to use at runtime." Mechanism: an **eight-layer policy-enforcement point on every
  tool call** — registry, schema, capability, DLP secret patterns, resource authorization, egress
  allowlisting, credential host-scoping, and **taint-sink enforcement**. The provenance idea is the
  one that should keep us up: the runtime knows **who asked for each action — the user, injected
  content, or a model hallucination** — and blocks unattributed actions.
- **RULING on provenance: ADAPT later, and only because we can almost get it free.** Once
  `web_search` returns text the model then acts on, a tool call whose arguments came from fetched
  page content is a *different* thing from one the person asked for, and today nothing in the
  system can tell them apart. We are unusually well placed to: **I8** already records every tool
  result as an event, so the provenance of a string is derivable from the log rather than needing a
  taint-tracking runtime. It is not in the five because `web_search` is not yet a granted default
  and the honest ordering is *ground the citations first, then attribute the actions*. But it is
  the reason §5's item 1 is ranked first: mechanical citation checking is the cheap half of the
  same idea. shisad's code is a Python daemon and is not reachable; take the pipeline shape only.

### 3.5 Durable, client-side, replayable — two independent confirmations of row B

- **einfach-agent-rust** (https://github.com/allroad88888888/einfach-agent-rust, Apache-2.0/MIT,
  first commit 2026-08-03, API explicitly unstable). One Rust runtime shipping as CLI, server,
  desktop and **a browser tab with no backend**; state is an atomic dependency graph plus an
  append-only command log, and — the sentence worth the visit — "recovery is loading the last
  snapshot and pushing the log forward — which is literally the redo loop, the same function."
  Host-declared, namespace-prefixed, session-scoped tools (`web:` executes in the browser, `desk:`
  in the desktop host), validated and journaled per session.
- **RULING: CONFIRM row B, adopt nothing new.** `PRIOR-ART.md` row B (durable step memo keyed
  `(run_id, stage, round, index)`) was justified from DBOS, a Postgres library. It now has a second
  justification from someone doing it in a tab, and the "recovery *is* redo" framing is a good test
  for our design: if replay needs a second code path, the design is wrong. The namespace-prefixed
  host-declared tool idea is **REJECTED** — **I9** says built-in and forged modules must be
  indistinguishable, and a `web:` prefix in the tool name makes them distinguishable to the model,
  which is the same mistake `CORE-ELEMENTS.md` §1.5 already catches in `Tool.agent`.

### 3.6 WASI 0.3, WASI-Virt, and the question "could we delete the x86 guest?"

- **WASI 0.3 released 2026-06-11** (https://wasi.dev/releases/wasi-p3): `async func`, `stream<T>`,
  `future<T>` as Component Model primitives; **`wasi:io` deleted entirely**; sockets 7 interfaces →
  2. Capability model, verbatim from https://wasi.dev/security: "no ambient authority… deny-by-default
  (or more accurately: **no capability handle by default**)", with each capability a separate WIT
  import so **the interface contract is the capability surface**.
- **WASI-Virt** (https://github.com/bytecodealliance/wasi-virt): sandboxing as a *build-time
  composition*. Compose a component with a generated virt adapter and the output **no longer imports
  those subsystems at all**. Its default: "**By default the virtualization will deny all subsystems,
  and will panic on any attempt to use any subsystem.**"
- **The negative result, and it is the one that matters.** The sweep found **no shipped product
  using the Component Model or WASI 0.3 as a browser agent's tool sandbox.** jco's browser support
  is still experimental; every real browser agent found uses Pyodide, wllama/WebLLM, esbuild-wasm,
  or a CheerpX/c2w x86 VM. **The x86 emulator remains the only shipping way to give a browser agent
  a real shell.** `wasmer-js`/WASIX is the honest non-x86 alternative for *programs* rather than a
  shell, and it is not actively released — newest tag **v0.6.0, December 2023** (correcting a
  circulating "Wasmer-JS: A New Hope" reference that is **2021**, not 2026).
- **RULING: REJECT replacing the guest. ADOPT one idea, as a doc.** WASI-Virt's default —
  *deny every subsystem and panic on use* — is **I6** made checkable by a build step rather than
  asserted in prose, and it is the only mechanism in either sweep that would let us **prove**
  default-deny instead of arguing it. We cannot use it (our crates are `wasm32-unknown-unknown`, not
  components), but the standard it sets is the right one to hold ourselves to, and it belongs in
  the I6 discussion. Everything else here is a 2027 question.

### 3.7 The rest, ruled briefly

- **peerd** (https://github.com/NotASithLord/peerd, Apache-2.0) — "the first general-purpose agent
  runtime built directly on browser primitives", with a dedicated **`peerd-egress`** module (vault,
  network policy, denylist, audit) and **service-worker policy gates**. Two rulings. *Take:*
  egress-as-its-own-module is a better factoring than scattering the gate, and it is roughly what
  `crates/core/src/websearch.rs`'s header already claims for one endpoint. *Refuse:* the
  service-worker policy gate. Putting the capability decision in JS below the app is a straight
  **I5** violation and it moves the security boundary out of the language that can be tested on the
  host (**I3**). Also note, without schadenfreude: **peerd's Linux WebVM is CheerpX** — the
  proprietary dependency we deleted. It is the clearest live argument for both sides of that call.
- **cooper** (https://github.com/rclement/cooper, AGPL-3.0) — one Rust core, browser and CLI hosts,
  in-browser GGUF inference via **wllama** (llama.cpp → wasm). AGPL means read-only for us. The
  useful fact is **wllama**: a third in-browser inference path we had not evaluated, and the only
  one with **GGUF parity** with the local llama.cpp/LM Studio server our default endpoint points at.
  **RULING: does not change `CORE-ELEMENTS.md` §5's "do not build a WebGPU inference entry."** That
  ruling rests on measured prefill being 21–51 % worse in a browser, which is a property of the
  substrate, not of the loader. Record wllama as the right choice *if* that ruling is ever reversed.
- **locagent** (https://github.com/wonderbyte/locagent) — a single ~10k-line `index.html`,
  `file://`-compatible, Gemma 4 on WebGPU via LiteRT-LM, Pyodide tools, IndexedDB, DOMPurify
  fail-closed on all model output, and it adopts the **Agent Skills standard**. Worth one look for
  exactly one reason: **fail-closed sanitisation of model output** is a discipline we should be able
  to state as clearly as they do. Everything else about it is the architecture we deliberately did
  not build.
- **OpenTelemetry GenAI semantic conventions**, extracted into their own repo at semconv **v1.42.0
  (2026-06-12)** (https://github.com/open-telemetry/semantic-conventions-genai), taking the **MCP**
  conventions with them. Nothing is marked Stable; every `gen_ai.*` attribute is still
  "Development" (**UNVERIFIED**, consistently reported). **RULING: ADOPT the vocabulary, never the
  dependency.** Our event kinds are ours and **I8** is satisfied without anyone's schema, but there
  is no reason to invent span names when `invoke_agent` / `execute_tool` / `plan` / `memory` /
  `retrieval` already exist and will be what any future exporter expects. This is a naming decision
  in `crates/kernel`, worth about an hour, and it is worth it the day someone wants to read our log
  in someone else's tool.
- **Chrome Prompt API / LiteRT-LM.** Nothing here overturns `CORE-ELEMENTS.md` §5.4's ruling, which
  already establishes the decisive fact the sweep did not: **the Prompt API is not exposed in Web
  Workers**, and every agent we run is in a Worker. The "Chrome 148 stabilised it for web pages"
  claim is **UNVERIFIED** in this sweep; `CORE-ELEMENTS.md` §5.4 cites it as Chrome 148,
  2026-05-05. Either way the Worker exposure is the blocker, not the version.
- **iabar** (https://github.com/infiniact/iabar) — a Rust agent engine compiled to wasm32 running in
  a **Chrome MV3 side panel**, with the service worker kept as a thin message router. Its engine
  crate is a *private proprietary git dependency*, so the public repo does not build. **Skipped**;
  recorded only as evidence that an extension side panel is a viable second host for a pure Rust
  core, should the LNA problem (`CORE-ELEMENTS.md` §5.1) ever make the page host untenable.

---

## 4. What the two named targets have in common, and why it is the finding

Ornith and Hermes arrived, in the same eight weeks and from opposite directions, at *the model
authors its own orchestration*: Ornith learns the scaffold inside the RL loop; Hermes writes and
rewrites its own skills at runtime and lets the model call tools from Python it wrote itself. Read
alone, either one is an argument that a declared `stages:` list is a human prior about to be
obsoleted.

**Read together with their own safety machinery, they are the opposite argument.** Ornith had to
build three defensive layers *before* self-scaffolding worked at all, and the first of them is
this:

> "we fix the outer trust boundary: the environment, the tool surface, and test isolation are
> immutable and outside the model's reach, so the model evolves only the inner policy scaffold: its
> memory, error-handling, and orchestration logic."

And the 2026 literature is running the other way at the same time: LLM-as-Code
(https://arxiv.org/abs/2606.15874) argues that control-flow hallucination is an *architectural
consequence* of letting the model own control flow, and the Code-as-Agent-Harness survey puts
verification on **deterministic sensors, not a judge model**.

**The synthesis, and it is the ruling this document exists to produce:** the mutable part is the
policy — memory, error handling, orchestration *within* a granted surface. The immutable part is
the surface, the gate and the verification. `PRIOR-ART.md` row J (model-written orchestration in an
embedded interpreter) is therefore **not** disqualified, and it is **not** free: it is admissible
exactly to the extent that the script can call only granted tools and cannot touch the gate or the
verifier, and it needs a deterministic monitor that says so. Ornith's paper is the citation, the
failure mode it names is concrete (a scaffold that reads the visible test files and hardcodes the
expected artifacts), and their conclusion is that the boundary is what makes the freedom safe.

That is **I6** and `verify.rs`, and we have had both since G2.

---

## 5. The five things to do, ranked

**1. Replace the planned LLM grounder with a mechanical citation check.**
*Touches:* `crates/core/src/websearch.rs` (retain the fetched body, not just the answer),
`crates/context` (evidence as an addressable component — already the stated prerequisite), and a
new pure module in `crates/agent` beside `verify.rs`.
This supersedes `PRIOR-ART.md` recommendation **#3**, which specified "one model call… emitting
per-claim support in the shape Vertex uses (a 0–1 score plus the cited chunk)". Two independent
2026 sources say do it without the model: Hermes 0.20.0 ships `grounded-citations` where "quotes
are matched against actual page text (not hallucinated)", and the Code-as-Agent-Harness survey puts
verification on deterministic sensors rather than a judge. A substring check is **cheaper by an
entire model call**, deterministic (**I7**), a fact rather than an opinion (**I8**), ungameable by
a model grading itself, and the only form of grounding an offline product can honestly offer
(**I2**). It is first because it is the only item that makes `web_search` *safe to grant* rather
than merely granted, and because it converts a recommendation we were about to build expensively
into one we can build correctly. It also corrects `PRIOR-ART.md` §4's claim that no open harness
ships a grounder — one now does, and its version is better than ours was.

**2. Ship `/context`: render the assembled Document's per-component cost.**
*Touches:* `crates/context/src/assemble.rs` (`cost()` at :12 — expose the per-section number instead
of discarding it), and one view in `crates/ui`.
Hermes 0.20.0 added "`/context` breaks down context window allocation" and had to build an
accounting layer to do it. **For us the answer is already the data structure**: **I13**/**I14**
make the prompt a typed, ordered, individually-costed set of `Component`s and `assemble` computes
the cost on every call and throws it away. This is the cheapest legibility win found in either
sweep, it is a projection of the log (**I8**), it is the owner-facing half of "the owner must be
able to trace", and it is the only diagnostic that makes `degrade`'s elisions visible instead of
silent. *Why it beats #3:* it costs almost nothing and it is the instrument you need to judge #3's
fix.

**3. Fix two compaction defects Hermes named: a user-message tail floor, and skill retraction.**
*Touches:* `crates/core/src/chat/memory_line.rs:75-98`, `crates/agent/src/skills.rs`.
Hermes 0.20.0 ships a "guaranteed N-user-message tail" — a floor counted in *user* messages. Ours
(`keep_recent: 3`) counts entries, so three `exec` results can evict every human sentence in the
conversation. And "ghost-skill defense preventing pruned skills from silently haunting sessions"
names a hole we have and have no defense for: a skill body loaded by `read_skill`, then compacted
away, leaves the model acting on an instruction it can no longer see and does not know it has lost.
Progressive disclosure without progressive *retraction* is half a mechanism, and we shipped the
half everyone ships. The fix is structural and cheap because `skills.rs` already emits
`EventKind::ToolInvoked` per load, so the log knows exactly which instructions are resident: pin a
loaded skill as a `Component`, or announce that it is gone. Same class of bug as the durable goal
at `Slot::SPACE = 55`, same remedy — **pin it, or say it is gone.**

**4. Add conditional skill availability: `requires_tools` and `fallback_for_tools`.**
*Touches:* `crates/agent/src/skills.rs` (frontmatter parse; filter in `catalogue`, :135).
`PRIOR-ART.md` §2.12 named "`paths:`-style conditional availability" as gap #2 — "we have no
conditional grant at all." Hermes now ships it, and in a better shape than Claude Code's file
globs: it keys on **capability presence**, which is what **I15** already makes us track.
`fallback_for_tools` — a skill that activates only when a tool is *absent* — is the first mechanism
found anywhere that makes honest degradation cheap rather than merely mandatory. Skills are pure
compiled-in text, so this widens no capability surface and **I6** is untouched; it shrinks a
standing prompt tax. **Refuse the two sibling fields**: `platforms` is meaningless in a tab, and
`required_environment_variables` puts a secret in a declaration, which is the **I6** violation we
already refused in Eliza's character file.

**5. Add an audit / dry-run mode: read-only tools run, mutating tools journal instead of execute.**
*Touches:* `crates/agent/src/tools.rs` and `toolbox.rs` (one predicate for "this call mutates"),
`crates/core/src/workspace/gate.rs` (the interception point), `crates/kernel` (one event kind).
kedge's `--audit` Shadow-Guard, implemented originally — kedge is **BUSL-1.1** and cannot be
vendored. This answers "what would this run do to my machine" *without doing it*, which is the
question a person asks before granting a shell, and T9 is about to make that question urgent. It is
pure (**I3**), a projection of the log (**I8**), and it forces the mutating/read-only distinction
out of comments and into a type — which `CORE-ELEMENTS.md` §1.5 already wants for a different
reason (it is the same cleanup as resolving `Tool.agent` into one predicate, so do them together).
Copy kedge's ordering detail while you are there: charge the budget *before* the expensive work.
*Why it is fifth:* it is the largest of the five, and its value peaks only once the guest is
genuinely capable.

### Explicitly not in the five, and why

- **A `DECISIONS/` ADR carrying Ornith's trust-boundary sentence**, bounding `PRIOR-ART.md` row J:
  a model may author memory, error handling and orchestration; it may never author the tool
  surface, the capability grant, or the verification, and a deterministic monitor enforces that. It
  is not in the five because it is a document, not a change — but it is the highest-value hour in
  this file, and it should be written before anyone opens `script-engine.md` again.
- **A paragraph in the row-H ADR deferring a bespoke in-tab MCP transport** until WebMCP's
  trajectory across two engines is known (§3.1).
- **OTel GenAI span names for our event kinds** (§3.7) — an hour, zero dependency, pure interop.
  Below the line only because nothing today reads our log but us.
- **Provenance on tool-call arguments** (§3.4) — the right idea, one step too early. Ground the
  citations first (item 1), attribute the actions second.

---

## Method and limits

Primary sources were opened this session: raw GitHub, official docs, vendor release notes, W3C/CG
drafts and arXiv, preferred over blogs in every case. The **WebSearch budget was exhausted at
200/200 mid-sweep**; the remainder ran on direct fetch, so vendor release notes and non-GitHub
sources are the most likely under-covered areas. `deep-reinforce.com` returns **403 to WebFetch**
and was read with `curl`; that page is the primary source for every Ornith quotation here.

**Marked UNVERIFIED:** that "orinth" is Ornith (high confidence, but it is an inference from
homophony plus context, not a statement by the owner); the OTel GenAI span-tree shape and the
"nothing is Stable" claim; WASI 1.0's late-2026/early-2027 target and jco's browser status; the
Chrome 148 Prompt-API stabilisation date as reported by the sweep (`CORE-ELEMENTS.md` §5.4's
citation stands and the Worker-exposure blocker makes the version moot); maturity of agentproto.

**Marked FALSE against the primary source, and each is written up rather than dropped:** that
Ornith emits a Python harness at inference time (§1.3 — contradicted by its own evaluation
footnotes, which name Terminus-2, Claude Code, OpenHands and mini-SWE-agent as the harnesses used);
that "Wasmer-JS: A New Hope" is 2026 material (it is 2021, and the repo's newest release is v0.6.0,
December 2023); and `PRIOR-ART.md` §4 finding #1's "no shipped client-side agent loop exists" and
finding #3's "nobody ships a grounder in open source" — both now have counterexamples, both amended
in §2.1 and §3.2 rather than deleted, because the *edges* they describe survive in narrowed form.

No code was read or written outside `docs/`.
