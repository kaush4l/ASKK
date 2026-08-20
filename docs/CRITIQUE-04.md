# CRITIQUE-04 — the T1–T4 round: briefs as data, and a loop with an exit code

> ## THE ONE THING TO CARRY OUT OF THIS ROUND
>
> **An assertion that a capability RESOLVES is not an assertion that its description is TRUE.**
>
> Four passes found that one error at four depths, and each time it was invisible to a green
> suite because a test asserted the thing resolved and stopped there:
>
> 1. **A grant that resolves but is unreachable.** The shipped critic held three read tools
>    that no path in this build can reach, and its own file described a path where they work.
> 2. **A block that renders but describes tools the agent lacks.** `## space` named `observe`
>    and `find_files` to an agent with an empty toolbox — one of them a grant deleted, in the
>    same round, for being inert.
> 3. **A description true of the AGENT but false of the TURN.** The same block is fed the
>    agent's resolved toolbox, not the stage-scoped one, so shipped `main` says "No tools are
>    installed" and names three tools five lines later, on the call that opens every turn
>    (`tracker.md` T25).
> 4. **A default-ALLOW list in a default-deny codebase.** `brief::acts` lists what is
>    EXCLUDED where its two siblings list what is INCLUDED, so a sixth stage would receive the
>    full toolbox by omission, and the tests pin a case rather than the direction
>    (`tracker.md` T26).
>
> The tell is always the same: the test names one instance where the rule should be named.
> **Look for it first.**


Bar-raiser rounds 4 through 7, 2026-08-20, against the uncommitted working tree on `main`
(HEAD `c3f4855`). FOUR passes by four independent read-only reviewers: pass 1 judged the
round as landed, passes 2, 3 and 4 each judged the remediation before it. **All four
returned NO-GO.** Every one found something the previous pass had missed, and three of the
four found it in the architecture lead's own verification rather than in the code.

Written to disk because the first draft of `docs/STATUS.md` cited this reasoning as
`docs/CRITIQUE-03.md`, which is the *Faculty seam* review of 2026-08-19 and carries a
**GO** — so STATUS called one document both a GO and a NO-GO seventeen lines apart, and a
reader following the citation landed on a verdict about a different increment. Pass 2
found that. The document you are reading is what those citations should have pointed at.

## What was under review

- **T1** — the loop's own stage prompts were Rust constants (`brief.rs:22-52`); they became
  `public/stages/*.md`.
- **T2** — a standing `goal.outcome` / `goal.check` / `goal.done_when` whose continue
  condition is a verification command's observed exit code.
- **T3** — `web_search` granted to `main`; the `role: critic` agent shipped.
- **T4** — spawn observability: the delegated goal and answer on the board, in
  `activity_since`, on the failed-callee `postMessage`, and a delegated failure readable.

---

# PASS 1 — NO-GO

## What it verified that would have caught a fake fix

These are recorded because a verdict is only worth the checks behind it.

**T1 constraint 1 — the core parses none of the brief. HOLDS.** It enumerated every read of
brief text: `brief::load` does `contains` on the *key list*, trim, is_empty, insert;
`brief::directive` clones and pushes once; `Directive::render` trims. No split, no find, no
keyword search. It then attacked from the other side, grepping `crates/*/src` for the words
the prose itself contains — `CHECK`, `OUTCOME`, `done_when` — and got nothing.

**T1 constraint 2 — no silent fallback. HOLDS.** `include_str!` under `crates/*/src` is two
hits, both skills, no brief. It traced the refusal end to end and confirmed **no `CallModel`
is emitted**, and that the person-facing sentence names the file to create.

**I2 — no default network allowlist. HOLDS.** `FetchNet::new()` returns empty; `allow`
*removes* the entry when the URL is blank, so an unset endpoint denies; the settings
`SUGGESTED` appears only as placeholder, in an error example, and in prose.

**The negative-control tests were preserved, not weakened.** This was the most likely place
to cheat and it was not taken.

**The Worker brief path is correct end to end**, read rather than trusted, including the
Trunk `copy-dir` that actually deploys `public/stages`.

## Blocking findings

**S1 (severe).** The shipped critic's three-tool grant is **inert in every path this build
has**, and its own file claimed a path where the tools work. Chatting to a non-entry agent
routes through `runtime/requests.rs:101` -> `batch::run_on` -> `port.delegate` into that
agent's own Worker, whose workspace port refuses. The agent was functionally the
`engine: base` shape its own frontmatter argued against — "a setting that looks applied",
inside the increment whose thesis is deleting those.

**S2 (severe).** Files at exactly 200 lines went **11 (HEAD) -> 17**, and not one new one
landed at 197–199. `docs/CRITIQUE-02.md` certified the previous round on this exact measure
falling 23 -> 9; a tree still driven by a ceiling does not do that.

**S3 (severe).** T4's board fold worked for a model-delegated run and not a person-launched
one: only `delegate()` appended the goal record, and the Dashboard path calls `run_on`
directly. The original defect was fully reproducible from the UI.

**S4 (severe).** `last_delegated_failure` was public API with **no production caller** — its
only callers were the tests certifying it. Worse, the test's fake sent `last_failure(...)`
(a rendered sentence) where production sends `last_failure_payload(...)` (typed JSON), so it
was green over a branch the browser never takes.

**M5 (moderate).** `docs/STATUS.md` still asserted the two things the round reversed, while
the new `docs/PARITY.md` banner pointed readers at it.

## What the tests were silent about — pass 1's answer

**The brief refusal is erased from the screen by the next roster reconcile.**
`agents/briefs.rs` PUSHES onto `agent_problems`; `agents/roster.rs` and `agents/install.rs`
both ASSIGN it. Boot order is safe, but `reconcile` runs at every turn boundary, so the
first `write_agent` silently deletes the message telling a person which file to add. And
`agent_problems` has **zero test coverage anywhere**. T1 is what put brief refusals into
that channel — the round added a new producer to a channel it knew was lossy.
Carried forward as `tracker.md` T23. (It was numbered T13, then T20; a concurrent session was appending to the same file and had taken both. IDs in this tracker are not safe to choose without re-reading it — see the round record.)

## Pass 1's deferred MODERATE findings, recorded in full

Pass 3 found that five of these existed in neither this document nor `tracker.md`, against a
STATUS claim that this file "holds both passes in full". A deferred finding that vanishes
from the record is a finding. Their state, re-checked against the tree on 2026-08-20:

- **M1 — the brief refusal is erased by `roster::reconcile`.** OPEN. `tracker.md` T23.
- **M2 — `yaml.rs` reintroduced the two-list bug**: `const KEYS` beside the `match` arms in
  `set_field`, with nothing keeping them in agreement — the shape `faculty/mod.rs` documents
  this codebase as having already paid for once. **FIXED during T2**, which chose a test over
  derivation: `crates/agent/tests/frontmatter.rs::every_key_the_refusal_offers_is_a_key_the_reader_accepts`
  reads the vocabulary out of the real refusal message and walks every name through
  `parse_agent_file`, so a key added to one and not the other fails a test instead of shipping.
- **M3 — the stage vocabulary is now several hand-maintained Rust lists** (`BRIEF_KEYS`,
  `keyed`, `STAGES`, `skill_only`, `acts`) that must agree. Adding a key to `BRIEF_KEYS`
  without adding it to `keyed` yields a stage that `load` demands a file for and that then
  enters with an EMPTY directive and no refusal — the exact silent fallback T1 exists to
  delete, one forgotten line away. **OPEN.** The honest statement of what T1 achieved: the
  BRIEFS became data; the stage VOCABULARY did not.
- **M4 — `main` names every built-in this build ships**, so its non-empty allowlist resolves
  to what an empty one would, and nothing pins it. OPEN. `tracker.md` T24.
- **M6 — the board's `is_busy` is the raw status fact where its own doc says it is the shown
  one**, so between a launcher queueing a task and the status fact flipping, a row can read
  "working" beside the PREVIOUS run's answer. OPEN.
- **M7 — `activity_since` documents a filter it does not implement.** Re-checked:
  `crates/core/src/log/store.rs:60` still matches `UserMessage { text, .. }` with no `from`
  guard, while the sibling fold in `board/errand.rs` enforces exactly that rule. One concept,
  two folds, the rule in one of them. OPEN.
- **M8 — no `onerror` on the sub-agent Worker.** Re-checked: `set_onmessage` only, so a hard
  Worker death posts nothing, the waiting resolver is never taken, and the caller's await
  never settles. OPEN.

---

# PASS 2 — NO-GO (on the remediation)

S1's *mechanism*, S3 and S4 were cleared on evidence. No test was weakened — several were
materially strengthened, and the round **found and fixed a test that could not fail**
(`capability29`-family slicing that asserted `!contains` against an empty string). No work
was destroyed by the incident repair.

## What it still blocked on

**1. Nine files carried unrepaired rustfmt residue** (+53 net lines), and the architecture
lead's verification method **structurally could not see them**: `rustfmt --check -l` lists
the files rustfmt *would change*, i.e. the correctly restored ones. A file left in rustfmt's
output is *absent* from that list. The correct detector compares each file's token stream
against HEAD with whitespace and commas stripped **and `use` lines compared as a sorted
set**, which tolerates both rewrap and import reordering — the two things that defeat the
naive version.

Consequence: `crates/core/src/agents/authoring.rs` (200 -> 199) was the *only* file that had
left the exact-200 list, so **S2's headline "10, below HEAD" was an artifact of the incident
it claimed to have repaired.** Restored honestly the count is **11 — level with HEAD.**

**2. The critic's `## space` block advertises tools it does not have.**
`components/space.rs::lines` renders "observe says what the machine is and find_files
searches it" **unconditionally**, to an agent with an empty toolbox whose own body says
"there is nothing here to call, by any route" — one of the two names being a grant this very
round deleted for being inert. I15. And it is invisible to the suite by construction:
**no test anywhere renders the shipped critic's own prompt.**

**3. The citation defect** described at the top of this document.

## Pass 2's answer to "what are the tests silent about"

Finding 2, and the reason it is silent is the point: `tests/critic.rs` asserts the space
faculty is *declared* and stops there. **The suite proves the block is reachable and never
asks what it says** — the same shape as the defect S1 fixed, an assertion that a thing
resolves standing in for an assertion that it is true.

---

# PASS 3 — NO-GO (items 2 and 3 cleared; item 1 did not)

Pass 3 cleared the space-block fix and the citation repair, and it cleared them properly:
it **reverted the fix in a scratch copy and watched the new test fail with the right
message**, then separately ruled out all three ways that test could have been vacuous. It
also audited the whole round for weakened tests — `#[test]` 522 -> 553, assertion macros
1977 -> 2118, `#[ignore]` 5 -> 5 byte-identical, exactly one test renamed and none removed —
and found none. It confirmed the I12 claim in both directions: **no file in this round ended
on the ceiling.**

It blocked on the residue, and it was right twice over.

**1. The corrected detector was still measuring something adjacent to what it checked.**
Pass 2 prescribed a whole-file comparison with `use` lines as a sorted set. Two blind spots:
a whole-file comparison cannot see residue in a file that ALSO carries a real change, and the
sorted-`use` clause classifies a no-op import edit (`use crate::proc::table as table;` ->
`use crate::proc::table;`) as a real change — which pushed `proc/convention.rs`, a file whose
every other hunk was reformat, into the bucket that is never examined.

A per-HUNK sweep found **22 pure-format hunks across 14 files, +86 net lines** — MORE than
the +53 that produced pass 2's NO-GO, merely distributed into files carrying real changes.
This is pass 2's own lesson recurring verbatim, and it is the third time this round that a
verification measured the wrong thing. **The rule that survives: normalise and compare per
hunk, never per file.**

**2. `adapters_web/src/workers/spawn.rs` needed a decision, not a revert.** It sat at 199 at
HEAD and 199 after, because ~+9 lines of real content (the `briefs` boot field and its doc)
were exactly offset by two rustfmt collapses in code the round never touched — `fn start`'s
signature 6 lines -> 1, and a `Live { .. }` literal 5 -> 1. Restoring both puts it at 208 and
fails gate 4. Pass 3 declined to call this line-count gaming (101-char lines are ordinary
here) and instead named the real point: **the round should decide the shape deliberately
rather than inherit it from a formatter.**

Decided: both constructs restored to their hand-set form, and the file split by DIRECTION —
`workers/spawn/mod.rs` (76 lines: finding the bundle, `Boot`, starting the Worker; runs once
and is finished when `postMessage` returns) and `workers/spawn/reply.rs` (150 lines: `Live`,
the side channels, the one message handler, `ask`; runs for as long as the Worker lives, on a
callback, with the app already borrowed). A folder with `mod.rs` re-exporting, so no import
anywhere changed.

Pass 3's own finding for "what the suite is silent about" is recorded as `tracker.md` T25:
the `## space` block is honest per AGENT and not per STAGE, so shipped `main` renders "No
tools are installed" and a workspace sentence naming three tools five lines apart, on the
`strategy` call that opens every turn. Pre-existing at HEAD, and the THIRD appearance in this
round of one error.

---

## The lasting lessons

1. **A measure can be satisfied by the bug it is measuring.** S2's number moved because of
   the reformat, not because of the work. Always restore the tree before reading a
   line-count measure.
2. **A verification can measure the complement of what it checks.** `rustfmt --check -l`
   named 43 files both before and after the repair and was useless as evidence either way.
3. **"Format only files you own" is not achievable with a module-walking tool.** rustfmt
   follows `mod` declarations, so naming a `lib.rs` reformats the crate. The constraint only
   holds for tools that are genuinely file-scoped.
4. **An assertion that a capability RESOLVES is not an assertion that its description is
   TRUE.** S1, pass 2's finding 2, and pass 3's F5 are all that one error at three different
   depths: the grant resolves but is unreachable; the block renders but describes tools the
   agent lacks; the description is true of the AGENT but false of the TURN. Three passes each
   found it once. Look for it first next round.
5. **Normalise per HUNK, never per file.** Every verification this round got wrong was a
   whole-object comparison standing in for a per-change one.
