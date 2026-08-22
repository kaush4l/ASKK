# ADR — the guest's tool surface

**Status:** Proposed. Closes tracker T18; gates T9.
**Date:** 2026-08-20.
**Decides:** whether the agent is given a general machine or a narrow, documented tool surface.

**On this file's location.** ADRs live in `DECISIONS/`, which stops at `ADR-010`. This one was
commissioned at `docs/ADR-GUEST-TOOL-SURFACE.md` by name and is written there. When it is
adopted it should be renumbered into `DECISIONS/`. **Defect found while writing:** `ADR-013` is
cited by eight source files (`crates/kernel/src/workspace.rs`, `crates/kernel/src/capability.rs`,
`crates/core/src/{app.rs,observe.rs}`, `crates/core/src/proc/convention.rs`,
`crates/core/src/workspace/gate.rs`, `crates/core/src/files/find.rs`,
`crates/agent/src/workspace.rs`) and by `docs/IMAGE-AUDIT.md:123`. **No ADR-013 exists in this
repository.** Eight files cite a document that is not there.

---

## 1. Context

### 1.1 The measured numbers, cited

| fact | value | source |
|---|---:|---|
| total shipped artifact | 48,531,419 bytes (46.28 MiB) | `docs/IMAGE-AUDIT.md:20,42` |
| emulator share | 44,683,544 bytes — **92.07 %** | `docs/IMAGE-AUDIT.md:18` |
| guest share | 3,847,875 bytes — **7.93 %** | `docs/IMAGE-AUDIT.md:19` |
| ratio | **11.6 : 1** | `docs/IMAGE-AUDIT.md:22` |
| declared memory minimum, as shipped | **9,244 pages = 577.75 MiB** | `docs/IMAGE-RECIPE.md:409` |
| same, `VM_MEMORY_SIZE_MB=512` | 9,378 pages = 586.12 MiB | `docs/IMAGE-RECIPE.md:410` |
| same, `VM_MEMORY_SIZE_MB=128` | 3,224 pages = 201.50 MiB | `docs/IMAGE-RECIPE.md:411` |
| emulated compute penalty | **13–15x** native | `docs/IMAGE-AUDIT.md:65-66`, from `d16048c` |
| in-browser *inference* penalty, for contrast | **~20 %** | `docs/research/PRIOR-ART.md:395-399` |
| guest floor, busybox + musl + baselayout | 1,028,337 bytes (−2,691,781) | `docs/IMAGE-AUDIT.md:112-113` |
| dead OpenSSL stack in the guest | 2,463,052 bytes gz — 66.2 % of the guest | `docs/IMAGE-AUDIT.md:105` |
| a guest with python3 + git + curl, for scale | 26,022,838 bytes (**+22,174,963**) | `docs/IMAGE-RECIPE.md:500-503` |
| the same plus `vim` + `build-base` | 133,760,701 bytes | `docs/IMAGE-RECIPE.md:504` |
| persistence through the PTY | ~79 KB/s | `docs/IMAGE-RECIPE.md:366-370`, **UNVERIFIED** by this round |

The 13–15x, the ~79 KB/s and the boot 26.7 s → 3.16 s are carried from `d16048c` and are marked
**UNVERIFIED from bytes on disk** by `docs/IMAGE-RECIPE.md:591-598`. They are used here as the
best evidence available and labelled as such, not re-derived.

### 1.2 What the agent can do today — read, not assumed

The whole guest-facing surface is **ten tools**, `crates/agent/src/workspace.rs:22-107`: `exec`,
`read_file`, `write_file`, `list_files`, `start_process`, `list_processes`, `read_process`,
`stop_process`, `observe`, `find_files`. `is_workspace_tool` (`:110-124`) is the closed list.

Underneath, there is **one** operation. `kernel::WorkspacePort` (`crates/kernel/src/workspace.rs:64-141`)
requires exactly `exec`; `read`, `write` and `list` are *default methods built on it* — `cat --`,
`mkdir -p && base64 -d`, `ls -1Ap --`. `find_files` is a `find … -exec grep -IHns -m1 … +` script
(`crates/core/src/files/find.rs:22-29`). `observe` is one `printf`/`cut`/`pwd`/`ls`/`wc`/`awk`/`df`
script (`crates/core/src/observe.rs:49-63`). The four process tools are a shell convention over
`.harness/proc/<name>/` with a `state()` function prepended to every script
(`crates/core/src/proc/convention.rs:38-46`). So the "tool surface" is already a *narrow ACI*
written in busybox — it just was not designed as one, and is not documented as one.

The adapter (`crates/adapters_web/src/c2w.rs:1-113`) states the machine's real shape:

- **`exec` wraps every command** as `mkdir -p -- <cwd> && cd <cwd> && ( <command> )` (`:73-74`).
- **There is no `run(argv)`.** One `/bin/sh` is booted once (`crates/adapters_web/src/c2w.js:92`)
  and every command is written into that one shell between two random sentinels (`c2w.rs:12-16`).
- **One shell serves every agent — shared fate.** A malformed command wedges it permanently for
  everyone; a watchdog at `RUN_MS = 180000` (`c2w.js:32`) writes `0x03` and resolves the call as a
  typed error (`c2w.rs:17-22`).
- **`durable()` returns `false`** (`c2w.rs:89-92`). The root is `overlay … upperdir=/run/rootfs-upper`
  — tmpfs in guest RAM. Nothing written survives a reload.
- **`interrupt()` is `Kill`** (`c2w.rs:99-101`) — a stop really stops.
- Capability: a command's `cwd` comes from the agent's `space:` grant and there is no other way to
  obtain one (`crates/core/src/workspace/gate.rs:21-33`); paths are refused, never clamped
  (`crates/agent/src/workspace.rs:152-170`).

**What it cannot do**, from `image/Dockerfile:5-9,25-42`: no network, so `apk add` is impossible at
runtime; no python, no node, no git, no curl, no make, no compiler. The Dockerfile enumerates the
entire binary inventory as busybox applets named by our own callers. `docs/PARITY.md` gap 1 is the
same finding from the product side.

**One live symptom of designing for a machine we do not have:** the refusal text a model reads when
it calls `start_process` with no command tells it to try
`start_process({"name": "web", "command": "python3 -m http.server"})`
(`crates/core/src/proc/convention.rs:66`). Our own tool documentation instructs the model to run a
binary that does not exist in the guest. The same command is the fixture in
`crates/core/tests/environment.rs:73,84` and `crates/core/tests/findings18.rs:183`. Nothing is
broken — the tests use a fake shell — but the *interface the model reads* is describing a different
computer.

(`docs/IMAGE-RECIPE.md:498-499` cites "the two places the product names `python3` to a model" as
`crates/core/src/process.rs:67` and `crates/ui/src/examples.rs:29`. **Neither path exists today.**
The first is now `crates/core/src/proc/convention.rs:66`; the second is
`crates/ui/src/board/examples.rs:29`, and that one is *not* a false promise — it asks the model to
go and find out whether python3, node and git are there, which is the honest form. Two stale paths
in the very item that was written to correct a fabricated citation.)

**Nothing in our tree stops the image growing.** `publish.sh:66-68` refuses any single file ≥ 99 MB
(GitHub's cap). A guest fattened to 26 MB passes every gate we have.

---

## 2. The forces, weighed

**The 11.6 : 1 ratio does not mean guest bytes are free — it means guest bytes are low-leverage
downward and ordinary upward.** Trimming the guest to its floor saves 2,691,781 bytes, which is
5.5 % of the total (`docs/IMAGE-AUDIT.md:115`). Adding python3 + git + curl takes the guest from
3.85 MB to ~26 MB — roughly **+22 MB on a 48.5 MB total, +45 %**. Both statements are true at once
and the asymmetry is the point: *shrinking* the guest is nearly pointless, *growing* it is not
nearly free. Any argument of the form "the guest is only 8 %, so packages are cheap" is arithmetic
run in the wrong direction and this ADR refuses it.

**Compute is the axis with no lever.** The CPU is Bochs, an interpreter
(`docs/IMAGE-AUDIT.md:64-66`); the audit says plainly it "has no lever". Every command runs at
13–15x. The cost of a package is therefore paid twice: once in bytes at download, and again in
every second of every command the package makes possible — and the packages people want (a
compiler, `pip`, a test runner) are precisely the ones whose workloads are longest. Against this,
the ~20 % WebGPU inference penalty says that anything expressible as host-side work should never
enter the guest at all (`docs/research/PRIOR-ART.md:395-399`).

**The owner's bar and the owner's goal point in opposite directions, and neither yields.** The bar
is "match Hermes and DeepSeek at getting the task done" — and both run `bash` on the user's real
machine with real toolchains (`docs/PARITY.md`, *The machine the shell runs on*). We structurally
cannot. There is no image and no interface that makes an interpreted x86 in a tab equal to a
laptop. The goal is "the smallest most efficient image that runs on any device"
(`docs/IMAGE-AUDIT.md:4-5`), whose binding constraint is not bytes but the **577.75 MiB declared
memory minimum**, allocated up front at instantiation (`docs/IMAGE-AUDIT.md:83-85`).

**The tension, named and not dissolved: on the class of task that defines the bar — clone a repo,
install a dependency, compile it, run its tests — we lose, and no decision in this ADR wins it.**
Fattening the image narrows the gap and violates the goal. Narrowing the interface honours the goal
and does not narrow the gap. What a decision here can do is choose *which tasks we are honestly good
at* and stop paying for the ones we are not. Anyone who reads this ADR as "and then we match
Hermes" has misread it.

**The ACI evidence, and the honest objection to it.** SWE-agent found that "LM agents represent a
new category of end users … and would benefit from specially-built interfaces", and that a custom
ACI beats raw shell (`docs/research/PRIOR-ART.md:369-381`, https://arxiv.org/abs/2405.15793).
Anthropic states the same principle. **The objection, which must be stated before the evidence is
used:** SWE-agent narrowed the *interface* on top of a fully capable Ubuntu with python, git and a
test runner underneath. Its result is not evidence that a poor machine is acceptable. Citing ACI to
excuse busybox is a misreading of the paper, and this ADR would be dishonest if it pretended
otherwise.

---

## 3. The options

### Option A — a general machine: fatten the guest

Bake python3, node, git, curl and a toolchain into `image/Dockerfile` at build time (runtime
install is impossible without Option D).

- **Could do:** run a python script, clone (with D), run a real test runner, use `pip`'s stdlib-only
  half. **Could not do:** anything at tolerable speed. A `pip install` or a `cc` invocation is the
  worst possible workload for an interpreter, and there is still no network without D.
- **Bytes:** guest 3,847,875 → 26,022,838 for python3+git+curl (**+22,174,963**); total ~70 MB
  (+45.7 %). With `build-base` and `vim` the guest is **133,760,701 bytes** — nearly 3x the entire
  artifact we ship today (`docs/IMAGE-RECIPE.md:500-504`). `python3` alone is **UNVERIFIED**; the
  recipe says explicitly not to assume a share of the 22 MB.
- **Compute:** unchanged per instruction, worse in aggregate: it invites 13–15x workloads.
- **Guest RAM:** unmeasured, and upward. A python interpreter in 201.50 MiB is not obviously
  possible; `VM_MEMORY_SIZE_MB` and this option fight each other.
- **Files in our tree:** ~3, and **zero Rust** — `image/Dockerfile`, `docs/IMAGE-RECIPE.md`,
  `docs/IMAGE-AUDIT.md`. That cheapness is its seduction and is not an argument.
- **Invariants stressed:** none breached, and that is the trap — it stresses only the stated goal
  ("smallest most efficient … any device"), which no invariant encodes.

### Option B — a narrow, documented tool surface (ACI)

Keep the guest at busybox + musl + baselayout. Treat the ten tools as a designed interface: each
one a stable, versioned contract with documentation written for a model, and every future
capability added as *a tool with a contract*, never as *a package with a man page*.

- **Could do:** read, write, search, list, observe, run and supervise long-lived processes — with
  fewer round trips, because a purpose-built tool replaces the model's five exploratory commands.
  Fewer round trips is directly fewer chances to wedge the one shared shell (§1.2) and fewer 180 s
  watchdog windows. **Could not do:** anything requiring a runtime that is not there. It does not
  manufacture python.
- **Bytes:** 0, or **−2,691,781** if the guest is trimmed to its measured floor.
- **Compute:** strictly lower than today for the same task, because the unit of work moves from
  "commands the model guesses" to "one script we wrote".
- **Files in our tree:** ~6–10 in `crates/` — `agent/src/workspace.rs` (the descriptions are the
  product), `core/src/files/find.rs`, `core/src/observe.rs`, `core/src/proc/*`, `core/src/workspace/*`,
  plus the briefs. **Zero in `image/`.**
- **Invariants stressed:** I12 (every tool is a shell script in Rust string literals, and both the
  200-line file and 40-line function rules bite); I15 (a tool whose applet is absent must degrade,
  not fail); I9 (tools stay uniform); I13/I14 (the documentation is context and must render through
  the Document, not be pasted).

### Option C — move the work out of the guest

Adopt the WebLLM asymmetry as a placement rule: work that can run host-side in wasm at ~native
speed never enters an emulator at 13–15x. Concretely, the embedded interpreter R5 already priced —
Koto ~1.12 MB, Rhai ~1.30 MB `wasm-opt -Oz` (`docs/research/PRIOR-ART.md:86,499`) — plus host tools
for search and fetch.

- **Could do:** compute, transform, orchestrate, and author logic, at wasm speed, with no guest at
  all. **Could not do:** be a filesystem, be POSIX, run a foreign binary, host a server the guest
  can reach. It is not a workspace.
- **Bytes:** +1.1–1.3 MB to the app bundle; guest unchanged.
- **Compute:** near-native. This is the only option that *removes* a 13–15x multiplier rather than
  arranging around it.
- **Files:** `crates/script` (**deleted in increment 09 — the crate no longer exists**; it was 155
  lines of `todo!("G4")` with no caller, and ADR-003's engine choice survives it), plus
  `crates/agent/src/tools.rs` and capability binding. This raises C's cost from "wire up what is
  already there" to "port Spike B into a new crate", which does not change the decision below —
  Option B won on grounds independent of C's price — but it is the honest number now.
- **Invariants stressed:** **I6 is the whole risk** — a script must reach only granted tools; I7
  (the interpreter must be deterministic); I3 is satisfied (both candidates are pure Rust).

### Option D — network in the guest

c2w ships `c2w-net-proxy`, which forwards HTTP/HTTPS through the browser's Fetch API
(`docs/research/PRIOR-ART.md:400-403`). Enabling it makes `apk add`, `git clone` and `pip install`
possible at runtime.

- **Could do:** everything A could, on demand, without baking it. **Could not do:** it at speed —
  TLS handshakes inside an interpreted Bochs, and the 2.46 MB OpenSSL stack the audit calls dead
  weight becomes live weight.
- **Bytes:** small at rest; whether our vendored `dist/` even contains the proxy is **UNVERIFIED** —
  `docs/IMAGE-AUDIT.md:138-141` found only an unused `"proxy"` key in `runcontainer.js`.
- **Files:** `crates/adapters_web/src/c2w.js`, `web/c2w/worker.js`, `image/Dockerfile`, `INVARIANTS.md`.
- **Invariants stressed:** **I2, head on.** "Outbound traffic only to configured endpoints" — a
  proxy in the guest is an egress path a *model* opens at runtime, not one a person configured in
  settings. I6's default-deny likewise. This is not an engineering preference; it is a threat-model
  change and an owner gate.

---

## 4. The decision

**Option B. The agent gets a narrow, documented tool surface over a deliberately small guest.**
Option C's placement rule is adopted as a standing constraint on B — no capability enters the guest
that could have run host-side — but C is not the decision, because it answers "what should not be
in the guest" and this ADR was asked "what the guest offers". Option A is refused *as a default*
and held behind owner question 1. Option D is refused pending owner question 3.

**Why B beats A.** A is the cheaper edit — three files, no Rust — and it is the one that looks like
progress, which is exactly why it needs the harder argument. It fails on all three axes at once:
it spends 45 % of the artifact's size against a stated goal whose binding constraint (577.75 MiB of
committed linear memory) it also pushes upward; it buys capabilities whose workloads are the
specific ones an interpreted CPU is worst at, so the 13–15x is paid on every use forever; and it
does not reach the bar anyway, because Hermes and DeepSeek are not ahead of us by a package list,
they are ahead by *not being emulated*. B costs nothing to ship, can only reduce round trips, and
is the only option whose returns are not divided by 13–15. The decisive asymmetry: **A's cost is
permanent and its ceiling is still far below the bar; B's cost is design work we owe the model
regardless of which machine it ends up on.** If the owner later answers question 1 with a number
that permits A, B's work is not wasted — a fat machine with a designed interface beats a fat machine
with a bash prompt, which is precisely the SWE-agent result.

---

## 5. The consequences

**Accepted:**

- The ten tools become a versioned contract. Their description strings
  (`crates/agent/src/workspace.rs:30-105`) stop being comments and become product surface,
  maintained like code and reviewed like copy.
- The guest may be trimmed to busybox + musl + baselayout (−2,691,781 bytes), and the 2.46 MB
  OpenSSL stack — 66.2 % of the guest with no reachable use — goes first. Under Option D it would
  have to come back, which is one more reason question 3 comes before the trim.
- New capability arrives as a tool with a contract. "Add a package" stops being an available move
  without an ADR amending this one.

**Disliked, and true:**

- **This does not close `docs/PARITY.md` gap 1.** An agent still cannot run a python test suite,
  clone a repo, or compile anything. We are choosing to bound the promise, not to keep it.
- **`exec` remains, so the narrow surface is not the only surface.** SWE-agent's result depends on
  the narrow interface being the interface; ours sits beside a general shell the model can always
  fall back to. Removing `exec` is not proposed — it is the escape hatch and the thing every other
  tool is built from (`kernel/src/workspace.rs:9-12`) — so the win is *diluted by construction*
  and we should expect less than the paper measured.
- **We would be optimising without a metric.** The claim "fewer round trips per completed task" is
  the whole justification and we do not instrument it. Nothing in the tree counts `exec` calls per
  finished task. That instrument should exist before the second round of tool design, or this is
  taste wearing a citation.
- **Every tool is busybox shell inside Rust string literals.** `find.rs`, `observe.rs` and
  `proc/convention.rs` already show the shape, and it presses on I12 continuously.
- **Chrome only.** Upstream c2w: "Tested only on Chrome" (`docs/research/PRIOR-ART.md:400-403`).
  This decision does not change that and should not be read as making the guest more portable.
- **The busybox applet set is now a hard boundary, not a default.** `grep -I`
  (`crates/core/src/files/find.rs:26`) is already flagged as the one applet flag under question
  (`image/Dockerfile:41-42`). Under B, that class of question becomes load-bearing.

---

## 6. The three questions only the owner can answer

**Q1 — size versus capability. Two numbers.**
(a) *What is the maximum total first-load download you will accept for the environment, in
megabytes?* Today it is **46.28 MiB (48,531,419 bytes)**. Baking python3 + git + curl into the guest
costs **+22,174,963 bytes (~70 MB total)**; adding a compiler takes the guest to **133,760,701
bytes** — about **178 MB total**, nearly 4x today.
(b) *What is the least-memory device that must be able to run it, in megabytes of RAM?* The module
commits its declared minimum up front: **577.75 MiB as shipped**, and `VM_MEMORY_SIZE_MB=128` would
make it **201.50 MiB**. A number below ~600 forecloses Option A regardless of the answer to (a).

**Q2 — persistence. Yes or no.**
*Must a file the agent writes still be there after a page reload?* Today `durable()` returns
**false** (`crates/adapters_web/src/c2w.rs:89-92`): the root is tmpfs and a reload is a fresh
container. Persistence through the PTY was measured at **~79 KB/s**, which is ~63 seconds for a
5 MB workspace on every save *and* every boot, during which no agent can run anything — which is
why it was previously refused. **Yes** means we design an OPFS-backed overlay (not yet designed,
not priced) and accept a stall the person will feel. **No** means `durable()` stays false, the
product says "scratchpad" on screen where the person can read it, and long-running work must be
carried in browser storage rather than in the guest.

**Q3 — network. Yes or no. This is a security question.**
*Is the guest ever allowed to open a network connection of its own?* `I2` says all user data stays
in browser storage and outbound traffic goes **only to configured endpoints**; it admits exactly one
exception and only because a person presses a key each time. A proxy inside the guest is an egress
path chosen by a *model* at runtime, from a shell whose commands the model writes — a different
threat model from the guest we ship today, which cannot reach anything. **Yes** requires its own
ADR, an explicit allowlist mechanism, and an amendment to I2; it also makes Q1 partly moot, since
packages could then be installed on demand rather than baked. **No** makes `apk add`, `git clone`
and `pip install` permanently impossible and is therefore also half an answer to Q1.

---

## 7. What we can do today, without the owner

**Safe unilaterally — no rebuild, no behaviour change, both post-build steps on the shipped files:**

1. **`gzip -9` instead of the default `-6`.** The page fetches these as files and decompresses them
   in JS, so the level is ours (`docs/IMAGE-RECIPE.md:240-244`). `out.wasm.gzip`: 36,631,864 →
   36,285,390, **−346,474**. `imagemounter.wasm.gzip`: **−128,824** (`docs/IMAGE-RECIPE.md:335`).
   Total **475,298 bytes**. The decompressed bytes are identical; nothing observes the level.
2. **Strip DWARF from `out.wasm`.** 2,287,619 bytes across eight `.debug_*` custom sections and no
   `name` section to lose; `wasm-tools strip -a` yields 104,591,333 bytes and **`wasm-tools validate`
   passes** (`docs/IMAGE-RECIPE.md:540-558`). Combined with (1) the saving on that file is **857,408
   bytes**, of which 346,474 is the gzip level — so the strip itself is **510,934**. What is lost is
   Bochs DWARF in browser devtools, which nobody here debugs.

   (1) + (2) = **986,232 bytes, 2.03 % of the shipped total, for zero functional change.**
   `docs/IMAGE-AUDIT.md:87-89` reports 857,404 for the same operation; the four bytes are the gzip
   header's stored filename (`gzip -9 -c` vs `gzip -9 <file>`). Both are correct.

3. **Free and in this ADR's own scope:** `crates/core/src/proc/convention.rs:66` tells the model to
   run `python3 -m http.server` in a guest with no python. One line, and it is exactly the kind of
   interface defect Option B exists to prevent. Not edited here — this round writes no code — but it
   is named and should be the first change under this decision.

**NOT safe unilaterally — it changes behaviour:**

4. **`VM_MEMORY_SIZE_MB`.** Moving 512 → 128 takes the declared minimum from 586.12 MiB to
   201.50 MiB (`docs/IMAGE-RECIPE.md:409-411,446-449`), which is the number that decides which
   devices can run this at all. It is **the guest's actual RAM**: it needs Docker, a rebuild, and a
   measured answer to "the lowest value at which this image still boots and runs the ten tools",
   which `docs/IMAGE-RECIPE.md:508` records as still unmeasured. It is also downstream of Q1(b) and
   of this ADR: a busybox guest with a narrow surface needs far less RAM than a python toolchain, so
   the safe setting cannot be chosen before the capability question is answered. Do not touch it in
   a round that is not also measuring it.

5. **Trimming the guest** (−2,691,781 bytes) needs a build round and interacts with Q3: the OpenSSL
   stack is 66.2 % of the trim and would be needed again the moment the answer to Q3 is yes. It is
   queued behind the owner, not ahead of them.
