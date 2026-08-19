# CRITIQUE-02 — the structural remediation, judged against CRITIQUE-01's nine criteria

Bar-raiser round 2. Scope: the nine exit criteria of `docs/CRITIQUE-01.md`, the four gates run by
me, and one question the criteria did not ask — whether the reorganisation removed bloat or wrapped
it in folders.

---

## VERDICT: GO

The failure mode I was hunting is not present. This round did not move fragments into folders and
delete the comments that admitted why they existed — it deleted files outright, merged functions
back into their callers, put one home under `crates/core/src/words.rs` for the two duplicated
sentence shapes, replaced the four-way tool fallthrough with a table at `crates/core/src/tools.rs:107`,
and wrote a 37-row turn trace at `ARCHITECTURE.md:280-347` that I spot-checked hop by hop and found
true at every line I opened. The evidence that the 200-line ceiling stopped driving the design is
arithmetic, not rhetoric: files sitting at *exactly* 200 lines fell from 23 to 9 while the tree grew
by 26 files, and the ten worst functions — including the 177-line `transcript` and the 151-line
`drive` — are all under 40 with the function gate now on by default against a shrink-only baseline.
The file count rose 252 → 278 and that rise is fully accounted for: 13 of the 26 are `mod.rs` index
files, which is what a directory *is*. All four gates pass with the exit codes I captured myself. All
nine criteria are met. Three defects remain and none of them is structural — the largest is that the
rename pass left thirteen doc comments pointing at filenames it deleted, which is the same
comprehension cost as F6 in miniature and is one `sed` away from fixed. GO.

---

## The nine criteria

| # | Criterion | Result | Evidence I personally verified |
|---|---|---|---|
| 1 | `core/src` ≤ 40 entries with the seven clusters as directories; `ui/src` ≤ 25 with five | **MET** | `ls crates/core/src` = 26 entries, 14 of them directories (`agents board chat failure files log proc runtime space terminal trace workspace` + `agents`/`board` nesting); `ls crates/ui/src` = 15, 14 directories. Every cluster F3 named exists as a folder. `crates/core/src/lib.rs:7-30` is a 24-line sorted `mod` list; `crates/ui/src/main.rs:8-21` is 14, sorted — the unsorted-append defect of F3 is gone. |
| 2 | Every naming-table rename applied or declined in writing; the two F9 renames unconditional | **MET** | `docs/STATUS.md:315-345` is the written record. I checked all 19 ui targets exist (`shell/boot_reads.rs`, `authoring/key_help.rs`, `board/read_attrs.rs`, `terminal/attribution.rs`, `files/breadcrumbs.rs`, `shell/warmth.rs`+`shell/heartbeat.rs`, `shell/token_meter.rs`, `chat/retry_actions.rs`, `space/empty_states.rs`, `chat/inflight_row.rs`, `chat/poller.rs`, `chat/state.rs`, `shell/status_pills.rs`, `shell/agent_switcher.rs`, `settings/linux_engine.rs`, `settings/endpoint_copy.rs`, `chat/header.rs`, `centre/`, `trace/`) and the ~25 core targets. Both F9 renames applied: `ui/src/stage.rs` → `ui/src/centre/`, `ui/src/tools.rs` → `ui/src/trace/`. The four declines at `docs/STATUS.md:328-336` are real reasons, not excuses: three are *deletions* (a stronger outcome than the rename asked for) and the fourth, `fold.rs`, argues that its symbols are called from `board/`, `failure/` and `chat/` alike so splitting doubles cross-folder imports. I checked that claim and it holds. |
| 3 | No source file's doc comment cites the line rule as its reason to exist | **MET** | The stated grep over all nine `crates/*/src` returns nothing. I ran a wider one (`line count\|line limit\|line rule\|I12\|split out\|split from\|was at exactly\|line budget\|at 200\|under 200\|the ceiling`) and got 15 hits, every one of which I opened. None is a file-origin story. The survivors are function-cohesion claims with a second half — `crates/ui/src/composer/voice.rs:147-149` ("a fn so the component stays under the 40-line rule **and so the wording has one home**"), `crates/ui/src/chat/retry_actions.rs:141` ("Its own fn so `ChatPane` stays one job"), `crates/ui/src/space/empty_states.rs:62-63`, `crates/ui/src/authoring/agentfile.rs:114-115`, `crates/ui/src/board/mod.rs:64` — plus `crates/adapters_web/src/c2w.js:9-15`, a 239-line JS binding that is over the ceiling and argues why it cannot be split (shared module state + wasm-bindgen `snippets/` emission). That is the invariant's own "split, or justify" clause used correctly. |
| 4 | `--functions` gated against a shrink-only checked-in baseline; the F1 ten under 40 | **MET** | `python3 scripts/check-size.py` → `size OK: 278 files … no function over 40 lines outside the 52-entry baseline`, exit 0. Shrink-only verified by reading the code, not the docstring: `scripts/check-size.py:220-228` fails on `set(current) - allowed` (new debt) **and** on `allowed - set(current)` (a fixed entry left in the list), and `bless()` at `scripts/check-size.py:180-186` prints `REFUSING to bless` and returns 1 for any addition. The baseline is keyed on `path::name`, so a rename drops the entry and the function re-reads as new debt — the gate cannot be widened by moving code. The F1 ten: none appears in `--functions` output. `AgentEditor` (`crates/ui/src/authoring/mod.rs:44`), `TaskLauncher` (`crates/ui/src/board/launch.rs:102`), `ChatPane` (`crates/ui/src/chat/mod.rs:109`), `Artifacts` (`crates/ui/src/files/artifacts.rs:113`), `ToolTrace` (`crates/ui/src/trace/mod.rs:128`), `Files` (`crates/ui/src/files/mod.rs:99`), `transcript` (`crates/core/src/chat/transcript.rs:63`), `drive` (`crates/core/src/runtime/mod.rs:44`), the board `row` (`crates/core/src/board/row.rs:21`) and `Stage`/`centre` all still exist and are all under 40. Offender count 82 → 52. See Finding 2 — the baseline file is not yet `git add`ed. |
| 5 | One tool dispatch table; the `batch.rs` fallthrough chain gone | **MET** | `crates/core/src/tools.rs:107` `tool_entry(&ToolId) -> Option<ToolHandler>` is a four-arm match mirroring `dispatch.rs:42`. `crates/core/src/batch.rs:170-182` `invoke` is now eleven lines: one table lookup, one await, one append-and-push. The five repeated bodies of F4 are one. `crates/core/src/tools.rs:95-106` states why the three awaiting handlers are outside `run` (borrow-across-await) rather than leaving a reader to infer it. |
| 6 | `ARCHITECTURE.md` §6 holds the real trace; `transport.js`/htmx gone; `MODULES/core.md:4` corrected | **MET** | `ARCHITECTURE.md:280-347`, 37 rows across 6a/6b/6c. I resolved nine of them against the tree — `composer/mod.rs:101` is the `onsubmit`, `lib.rs:126` is `pub fn handle`, `runtime/mod.rs:25` is `pub fn pump`, `tools.rs:107` is `tool_entry`, `chat/poller.rs:94` is the `GET /chat`, `effect.rs:16` is `pub enum Effect`, `lib.rs:76` is `answer`, `chat/pane.rs:153` is `submit`, `seam.rs:23` is `WebApp::handle` — all correct. `transport.js`/htmx gone from `ARCHITECTURE.md`; the status banner at `ARCHITECTURE.md:3-6` now reads SHIPPED and dated. `MODULES/core.md:6-10` states the real numbers (`pump` 10 lines, `drive` 28) and names the old claim as false. See Finding 3 for the copy that survived one document over. |
| 7 | A `core/src` README naming every directory, plus the pane-pairing rule | **MET** | `crates/core/src/README.md` — a 12-row directory table, a "loose files" paragraph, and the pane-pairing rule stated as `core/src/P/pane.rs` serves ↔ `ui/src/P/mod.rs` mounts, with a seven-row proof table. It then lists **four exceptions and three unpaired ui directories by name**. A rule that publishes its own exceptions is the version a cold developer can actually use; the tempting version was to state the rule and let them find the exceptions. |
| 8 | F8 duplicates removed; the `runstatus.rs` façade deleted with its nine call sites | **MET** | `grep -rn "fn listed" crates/` → one hit, `crates/core/src/words.rs:10`. `grep -rn "m{:02}s"` → one hit, `crates/core/src/words.rs:27`; `crates/core/src/proc/table.rs:117` `ago` now delegates to `crates::words::spanned` and adds only its own "no end recorded" case, and `crates/core/src/observe.rs:124` does the same. `proctable::secs` is now `crates/core/src/proc/table.rs:103` `parse_secs` — the inverse-meaning collision is gone. `"x-failed"` is hand-parsed in exactly one place, `crates/ui/src/board/read_attrs.rs:93`. `crates/ui/src/shell/rail.rs:24` now goes through `listing::read`. The façade file is gone: `crates/ui/src/runstatus.rs` → `crates/ui/src/board/launch/outcome.rs`, and `grep -rn runstatus crates/` returns only four stale *comments* (Finding 1), no code. |
| 9 | `Effect::Persist`/`Sleep` deleted or emitted; the `transcript` doc comment moved | **MET** | `crates/agent/src/effect.rs:16-50` — four variants, `CallModel`, `InvokeTool`, `Emit`, `Delegate`. `grep -rn "Persist\|Sleep" crates/agent/src crates/core/src` returns nothing. `ARCHITECTURE.md:356-359` records the deletion and cites F10 rather than quietly dropping it. The doc block now sits on the function it describes: `crates/core/src/chat/transcript.rs:57-62`, immediately above `pub(crate) fn transcript` at `:63`. |

### The gates, run by me

| Gate | Exit code |
|---|---|
| `cargo test --workspace` | **0** (captured directly, no pipeline) |
| `cargo check -p adapters_web --target wasm32-unknown-unknown` | **0** |
| `cargo check -p ui --target wasm32-unknown-unknown` | **0** |
| `python3 scripts/check-size.py` | **0** |

---

## The file-count question: 252 → 278 is honest

The lead's number was 253 → 278; the tracked count at `HEAD` is 252 `.rs` files under `crates/*/src`,
so the delta is **+26**. It decomposes exactly, with no residue:

| | Count | What it is |
|---|---|---|
| New `mod.rs` index files | **+13** | `mod.rs` under `crates/*/src` went 6 → 29. Ten of the 29 arrived as *renames* of an existing file into `dir/mod.rs` (e.g. `agent/src/spec.rs` → `agent/src/spec/mod.rs`), so only 13 are genuinely new: twelve in `core` and `ui/src/shell/mod.rs`. |
| New source files | **+22** | Nine in `core`, twelve in `ui`, one in `agent`. |
| Deletions | **−9** | `core/src/{form,rowwords,loopline,boardrow,runtime,transcript}.rs`, `ui/src/stage/intro.rs`, `adapters_web/src/warmth.rs`, `module/src/install.rs`. |

13 + 22 − 9 = 26. ✔

**The 13 index files are not fragmentation** — they are the directory. `crates/core/src/failure/mod.rs`
is 18 lines: a header naming what the folder is for and one clause per module. That file replaced the
old `crates/core/src/failure.rs`, whose header opened *"Its own file so `chat.rs` holds the 200-line
rule (I12)"* — a file that carried logic **and** an excuse is now a file that carries an index and no
excuse. That trade is the whole point.

**The 22 new source files are the function fix, not a second round of splitting.** The largest cluster
is `crates/core/src/chat/transcript.rs` + `transcript/{headers,noted,spoken}.rs`: that is where the
177-line `transcript` fold went, split by *what each part renders* — message-shaped facts, machine
notes, response headers — and `transcript.rs:4-7` says so. `crates/core/src/board/row.rs` +
`row/{live,reading}.rs` is the 152-line `boardrow::row` split into "what the row reads off the log"
and "the second line about the turn in flight", with `row/live.rs:1-5` giving a reason a reader can
check (the clock is read in one place, R6-7). `crates/core/src/words.rs` is a net *reduction* — it
exists because two duplicated shapes were removed.

**The decisive number the lead did not have.** Files at exactly 200 lines: **23 → 9**. In the
190–199 band: 21 → 26. Combined 190–200 density: 44/252 (17.5%) → 35/278 (12.6%). A tree still under
a ceiling does not shed 14 of its 23 exact-200 files while adding 26 files. The ceiling is still
visible in the 190s and will need watching, but it stopped being the thing that decides where a file
ends.

**Renames are renames.** `git status` records 121 (60 pure `R`, 61 `RM`), matching the lead's claim.
Spot-checks resolved: `crates/ui/src/runstatus.rs → board/launch/outcome.rs`,
`crates/ui/src/boardcell.rs → board/read_attrs.rs`, `crates/ui/src/frame.rs → shell/warmth.rs` (with
its second job split out to `shell/heartbeat.rs`, which is what F6 asked for),
`crates/adapters_web/src/model/asked.rs → model/choice.rs`.

---

## Findings

### F1 — HIGH. The rename pass left thirteen doc comments pointing at filenames it deleted.

**Observation.** Eight in shipped source, four in tests, one file referring to its own dead name:

| `path:line` | Names | Now lives at |
|---|---|---|
| `crates/ui/src/chat/thread.rs:7` | `boardrow.rs` | `core/src/board/row.rs` |
| `crates/ui/src/chat/thread.rs:8` | `runstatus::LaunchedRun` | `ui/src/board/launch/outcome.rs` |
| `crates/ui/src/board/roster.rs:19` | `boardcell::cell` | `ui/src/board/read_attrs.rs` |
| `crates/ui/src/files/breadcrumbs.rs:17` | `filegone::named` | `core/src/files/empty_states.rs` |
| `crates/core/src/trace/requested_by.rs:23` | `tracerow::when` | `core/src/trace/row.rs` |
| `crates/core/src/trace/row.rs:73` | `filelist::missing` | `core/src/files/listing.rs` |
| `crates/core/src/terminal/panel.rs:63` | `scrollpanel::nothing_yet` | **this file** |
| `crates/core/src/files/empty_states.rs:9` | `procpanel::lost` | `core/src/proc/pane.rs` |
| `crates/core/tests/findings14b.rs:5`, `findings16e.rs:108`, `findings13.rs:111`, `findings17.rs:86` | `filelist`, `runstatus` ×3 | as above |

**Cost.** This is CRITIQUE-01 F6 reproduced at one-tenth scale, and it is worse in kind than the
original because the reference *looks* actionable. A developer reading `crates/core/src/trace/row.rs:73`
is told to go read `filelist::missing`; `grep filelist` returns one hit, which is this comment. The
one at `terminal/panel.rs:63` is the sharpest: the file tells the reader not to duplicate
`scrollpanel::nothing_yet`, and `scrollpanel` *is* `panel.rs`. The round's own thesis is that a
filename should let you find the thing; these thirteen lines break that in the round's own voice.

**Smallest fix.** A `sed` over the nine old-name → new-path pairs, run across `crates/*/src` and
`crates/core/tests`. No logic, no structure.

---

### F2 — MEDIUM. The gate's baseline is not in the repository, and the one hole in "shrink-only" is exactly that.

**Observation.** `git ls-files scripts/function-baseline.txt` returns nothing; `git status` shows it
as `??`, and `git check-ignore` confirms it is not ignored — it is simply untracked. `scripts/__pycache__/`
is in the same state. The shrink-only property I verified at `scripts/check-size.py:180-186` has one
documented escape: `first_time = not BASELINE.exists()` at `scripts/check-size.py:181` re-seeds the
whole list wholesale when the file is absent. So the property "the baseline cannot silently grow"
holds *only while the file is under version control*. Right now it is not, so a commit that lists
files explicitly ships a gate whose baseline is missing — and on a fresh clone `read_baseline()`
returns the empty set and all 52 entries read as new violations, failing the run.

There is no `.github/workflows` and no script anywhere invokes `check-size.py`, so criterion 4's "runs
in CI" is unmeetable by *any* round in this repo and I do not hold that half against this one. The
tracking is a different matter and is a real defect.

**Smallest fix.** `git add scripts/function-baseline.txt`; add `__pycache__/` to `.gitignore`.

---

### F3 — MEDIUM. `transport.js` survived in `MODULES/adapters_web.md`.

**Observation.** `MODULES/adapters_web.md:4` — *"composition root that boots `core` and exposes the
seam to `transport.js`"* — and `MODULES/adapters_web.md:30` — *"`web/transport.js`"*. No such file
exists; `crates/adapters_web/src/seam.rs:1-3` says the opposite in its own words, and
`ARCHITECTURE.md:282` now says so too. Criterion 6 was scoped to `ARCHITECTURE.md` and `MODULES/core.md`
and both are fixed, so this does not fail the criterion — but it is the same stale sentence one
document over, and `MODULES/adapters_web.md` is the file a developer opens to learn what that crate is.

**Smallest fix.** Two lines: point both at `crates/adapters_web/src/seam.rs`.

---

### F4 — LOW. The `Terminal` argument reaches the right answer for the wrong reason.

**Observation.** `crates/ui/src/terminal/mod.rs:76` `fn Terminal` is 125 lines and stays baselined. The
lead's stated reason is that *"every available extraction would create a file whose only honest reason
was the line count."* That premise is false — CRITIQUE-01 F1's own fix said *"pulling each named region
into its own `#[component]` in the same file — no new files"*, and the `submit` closure at
`terminal/mod.rs:97-130` is a nameable job (write a command, then poll until the scrollback grows) that
could become a free `fn` in the same file. The conclusion is nevertheless defensible for a reason the
lead did not give: `submit` closes over six `Signal`s (`terminal/mod.rs:81-86`), so extracting it
converts a closure into a six-parameter function and moves the complexity from length into signature.
That is a real trade and leaving it is a legitimate call.

**Cost.** Small, but the argument as written would license declining every future extraction. Say the
true reason so the next person can weigh it.

**Smallest fix.** Replace the justification in `docs/STATUS.md:133-135` with the parameter-passing
reason.

---

### F5 — LOW. `settings/endpoint_copy/` is named for prose and holds a control.

**Observation.** `crates/ui/src/settings/endpoint_copy.rs:1-4` declares the folder is "what Settings
*says* about an address". `crates/ui/src/settings/endpoint_copy/reset.rs:1-3` is *"the one control in
Settings that DESTROYS something"* — not copy, and not about an endpoint. It is the one place in the
new `ui` tree where the folder name does not predict the file.

**Smallest fix.** `git mv crates/ui/src/settings/endpoint_copy/reset.rs crates/ui/src/settings/reset.rs`.

---

### F6 — LOW. One header names the same file twice.

**Observation.** `crates/core/src/board/row.rs:1-6`: *"`board/row/reading.rs` holds the vocabulary, and
`reading.rs` with `live.rs` beside this file decide everything the card says"* — `reading.rs` is
introduced twice with two different jobs, which reads as three neighbours when there are two.

**Smallest fix.** Delete the first clause; the second says it correctly.

---

## What is genuinely good

Four things.

1. **`crates/core/src/README.md` publishes its own exceptions.** The pane-pairing rule is stated, then
   four cases where it does not hold are named with the reason (`core::tools` has no `ui` partner
   because nothing mounts an executor; `core::agents::roster` is an algorithm and `ui::board::roster`
   is a panel). Stating a rule is easy; the version that survives contact with a reader is the one
   that lists where it breaks, and this is that version.
2. **The deletions were deletions.** I traced each: `form.rs`'s one function is back at
   `crates/core/src/builtins.rs:114`; `rowwords.rs`'s two are private inside
   `crates/core/src/board/row/reading.rs`; `loopline.rs` merged into `agents/card_sentences.rs`;
   `intro.rs`'s `TAGLINE` is at `crates/ui/src/centre/mod.rs:107`; `module::install`'s
   `run_install_tests` is at `crates/module/src/manifest.rs:117`. Nothing was renamed and reported as
   removed.
3. **`crates/core/src/words.rs` is the right size of fix.** 56 lines, two functions, a header that
   explains *why* spelling has one home while opinion does not, and eight assertions pinning the
   duration format. `proc/table.rs:114-121` and `observe.rs:119-124` now call it and keep only their
   own edge cases. That is what removing a duplicate looks like when it is done rather than
   documented.
4. **`ARCHITECTURE.md` §6d states what is *not* in the tree.** The forge pipeline is typed and
   unwired, and the section says so with the `dispatch.rs:42` line that would have to change. A flow
   document that marks its own frontier is a document a reader can trust about the parts that are
   real.

---

## What this GO certifies, and what it does not

**I am certifying navigability and comprehension, and nothing else.** Specifically: that
`crates/core/src` and `crates/ui/src` can be navigated from the directory listing and the README
without opening files first; that filenames now predict contents; that the nine exit criteria of
`docs/CRITIQUE-01.md` are met on evidence I opened myself; that the turn flow is documented truthfully
at `ARCHITECTURE.md:280-347`; and that the four gates pass with exit code 0 as run by me.

**I am not certifying correctness.** I read `cargo test --workspace` exit 0; I did not evaluate
whether the 475 tests test the right things, and a rename pass that compiles and passes is not proof
that behaviour is unchanged. I did not run the product.

**I am not certifying product value.** Nothing in this review touches whether the loop is the right
loop, whether the agent is good, or whether `docs/STATUS.md`'s increment 2 ("an agent starts an agent
with a goal") is the right next thing.

**I am not certifying the working tree.** All 232 changed paths are uncommitted, and
`scripts/function-baseline.txt` is untracked (F2). This GO applies to the tree as it stands on disk on
2026-08-19; it does not survive a commit that drops the baseline.

The six findings above are not gates. F1 and F2 should be fixed before this is committed — both are
mechanical, and F2 in particular decides whether the gate this round built exists tomorrow.
