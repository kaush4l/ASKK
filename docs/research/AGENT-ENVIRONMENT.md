# AGENT-ENVIRONMENT — what an agent actually requires from an environment

**Date:** 2026-08-20. **Tree:** `main` @ `b413ab6`.
**Question asked:** *what does an agent actually require from an environment?* — answered from
evidence, not from first principles.

**Method.** Three parallel primary-source sweeps: (a) Docker's agent-sandbox line, which the owner
named specifically; (b) the other serious sandbox vendors — E2B, Daytona, Modal, Cloudflare, Fly,
Anthropic, OpenAI; (c) what the major coding agents demand — SWE-agent's ACI paper, Claude Code,
Codex CLI, OpenHands, Open SWE, agent-zero. Every HARNESS column below was read out of this tree
this session, at the `path:line` cited. Nothing about our own guest is inferred.

**Standing context, not re-litigated here.** `docs/ADR-GUEST-TOOL-SURFACE.md` (Option B: a narrow
documented tool surface over a deliberately small guest), `docs/IMAGE-AUDIT.md` (46.28 MiB, 92 % of
it emulator, 13–15x compute penalty, 577.75 MiB declared memory minimum),
`docs/PARITY.md` gap 1 (busybox, no network, no persistence). **The image is frozen by owner
ruling.** Any row below that would need a package baked in is marked
**[NEEDS THE IMAGE UNFROZEN]** and carries its own justification. **Persistence is refused by owner
ruling** and the guest already says "scratchpad" on screen; §5 records that and adds four more
refusals in the same voice.

---

## 1. Docker's thesis, in two sentences

Docker's claim is that an agent needs a **hardware-isolated computer of its own, not a container** —
because a coding agent routinely builds and runs its own containers, and Docker-in-Docker "requires
elevated privileges that undermine the isolation you set up in the first place"
(https://www.docker.com/blog/why-microvms-the-architecture-behind-docker-sandboxes/), so Docker
Sandboxes gives each agent a microVM with "its own kernel… its own Docker daemon, filesystem, and
network" (https://docs.docker.com/ai/sandboxes/). The second half of the thesis is that the boundary
has to be enforced **outside** the agent rather than by asking it: "guardrails matter, but only when
they're enforced outside the agent, not by it. Agents need a true bounding box", because "a human
cannot sit in the control loop for thousands of actions at machine speed", and therefore
"permission prompts are not a security strategy" and "natural language directives are not security
boundaries. Infrastructure is."
(https://www.docker.com/blog/ai-agent-security-systems-problem/,
https://www.docker.com/blog/how-to-secure-ai-agents/,
https://www.docker.com/blog/ai-coding-agent-horror-stories-security-risks/).

**What they built to deliver it.** `sbx` — a custom VMM on Hypervisor.framework / Windows Hypervisor
Platform / KVM (they rejected Firecracker: "no native support for macOS or Windows, full stop");
workspace mounted by filesystem passthrough in `--direct` or `--clone` mode; **default-deny egress
through a proxy on the host** ("All outbound TCP traffic from the sandbox routes through a proxy on
your host"; "Direct external UDP and ICMP traffic is blocked at the network layer"); **credentials
that never enter the VM** — "API keys are injected into HTTP headers by the host-side proxy…
the sandbox sees only a sentinel value" (`MY_SERVICE_API_KEY=proxy-managed`); `sbx template save`
to capture a configured filesystem; `.sbxenv.yaml` declarative environments and OCI-distributed
"Kits" (0.39.0, 2026-08-19). Around it: **Docker Agent** (ex-`cagent`), which does *not* implement
isolation itself — "it orchestrates the installed `sbx` CLI"; the **MCP Gateway/Catalog**; and
**Model Runner** for local inference.

**Three things to be unimpressed by, because they bear directly on us.**
1. **Docker has no checkpoint/restore of a running agent world.** `sbx template save` is a full-disk
   image of a sandbox ("captures its entire filesystem, **including any secrets stored on it**"),
   and the only turn-level undo is Docker Agent's *shadow-git* file snapshots
   (https://docs.docker.com/ai/docker-agent/features/snapshots/). Nobody in the survey except E2B and
   Fly Sprites ships memory-state resume. If we ever want "branch the world at turn N", there is no
   vendor to copy.
2. **Docker's own metadata says Experimental / Early Access** (`docker/docs` `data/summary.yaml`)
   while the blog says launched, and `sbx exec` has **no documented timeout flag and no documented
   exit-code semantics** — the only well-specified answer to "how does a long-running command reach
   the agent" lives one layer up in Docker Agent's `background_jobs` tool.
3. **The isolation leaks at the tool layer**: "local stdio MCP servers run on the host, outside
   sandbox isolation." The microVM is airtight and the thing plugged into it is not.

**What we should take from Docker, and what we already have for free.** We get the strong half of
their thesis by construction: a tab has no host filesystem, no host network, no credentials, and a
reload is a factory reset. Docker built a custom VMM across three hypervisors to reach a weaker
position than "there is no network in this guest." The two mechanisms genuinely worth stealing are
*the sentinel credential* (only if Q3 is ever answered yes) and *the background-job handle with a
completion signal back into the loop* — see row R4.

---

## 2. The requirements table

Verdict key: **HAVE** = we do this and the evidence says we do it well · **PARTIAL** = the mechanism
exists and the contract is incomplete · **MISS** = absent · **REFUSE** = deliberately absent, see §5.

### R1 — A working directory that is stable between calls, and says so when it moves

| | |
|---|---|
| **Who demands it** | Claude Code documents it in unusual detail — a `cd` outside the project resets and *appends* `Shell cwd was reset to <dir>` to the tool result; "Environment variables don't persist. An `export` in one command won't be available in the next"; "Subagent sessions never carry over working directory changes" (https://code.claude.com/docs/en/tools-reference). OpenHands solves it the other way — one long-lived tmux pane, so cwd and env carry by construction. agent-zero "maintains per-session shell state… so subsequent calls can reuse the same terminal session." |
| **Why** | The agent writes relative paths. If the cwd drifts, every later path is wrong and the failure looks like a missing file, not a moved directory. |
| **Absent** | `source venv/bin/activate` is silently lost; the agent starts using absolute paths for everything and burns turns rediscovering where it is. |
| **HARNESS today** | **HAVE, mechanically — MISS, as a stated contract.** Every command is wrapped `mkdir -p -- <cwd> && cd <cwd> && ( <command> )` (`crates/adapters_web/src/c2w.rs:73-74`), and `cwd` comes only from the capability grant (`crates/core/src/workspace/gate.rs:31-37` — "Private on purpose: a command's cwd comes from the grant and there is no other way to obtain one"). So the cwd is *re-established every call* and cannot drift; the subshell `( … )` also means an `export` cannot escape. This is stronger than Claude Code's guarantee. **But the model is never told either fact.** `observe` reports `cwd` (`crates/core/src/observe.rs:53`) as a value, not as a rule. A model that runs `cd ..` then `ls` gets a surprise it has no way to predict. |

### R2 — An exit status the harness reads, and reads *correctly*

| | |
|---|---|
| **Who demands it** | Claude Code publishes a per-command table: "A command that exits 1 counts as a valid result for the Bash tool **only when** Claude Code recognizes exit code 1 as a benign outcome for that command: `grep`, `rg`, `egrep`, `fgrep`, `find`, `diff`, `test`, and `[`, plus `git diff` and `git grep`. **Every other command that exits 1 counts as a failure, even when exit 1 is a benign informational outcome**: no matches for `pgrep` and `jq -e`, files that differ for `cmp`." OpenHands encodes the exit code *into `PS1` itself* because a tmux pane has no other channel, and reserves `-1` for "hit the soft timeout and is not yet finished." Docker's `background_jobs` `wait` "returns exit code and output". |
| **Why** | It is the only machine-readable fact a shell produces. |
| **Absent** | The agent reads a successful `grep` with no matches as a broken command and starts "fixing" it — the false-failure spiral. |
| **HARNESS today** | **HAVE, and it is now load-bearing — PARTIAL on semantics.** `c2w.js` closes every command with `printf '%s%s\\n' '#E<n>#' "$?"` and parses the integer (`crates/adapters_web/src/c2w.js` `run`); `said()` appends `(exit status N)` whenever it is non-zero, with the argued reason "a command that failed silently reads exactly like one that printed nothing and succeeded" (`crates/core/src/workspace/gate.rs:177-189`). **And since the goal work landed, the loop's continue-condition IS this integer**: `goal::returned(state, ok, …)` where "`ok` **is** the observed exit code" and `state.green |= ok` (`crates/agent/src/goal/mod.rs:37,120-140`). The environment's exit status now decides when a turn stops. **The semantic gap:** we have no benign-exit-1 notion, so a `grep` that found nothing paints red in the trace and is counted by `failure::within_turn::is_failure`. Note the shipped goal check is `goal.check: test -f DONE.md` (`crates/agent/tests/agents/builder.md:40`) — a file-existence test, because a busybox guest has no test runner to name. That is the honest ceiling of R2 here, and it is a consequence of the frozen image, not of the plumbing. |

### R3 — A way to know a command finished vs hung, without losing the work or the shell

| | |
|---|---|
| **Who demands it** | Every serious system, and **all four solve it differently**. SWE-agent kills on two timers (`SWE_AGENT_ACTION_TIMEOUT` 25s, plus a no-output timer) and tells the model why: `EXECUTION TIMED OUT BECAUSE NO OUTPUT WAS PRODUCED FOR MORE THAN {N} SECONDS.\nPLEASE REFINE YOUR RUNNING COMMAND SO IT WILL PRODUCE OUTPUT IN THE SPECIFIED TIME FRAME.` **OpenHands never kills** — it returns a menu of legal moves: *"You may wait longer to see additional output by sending empty command '', send other commands to interact with the current process, send keys (\"C-c\", \"C-z\", \"C-d\") to interrupt/kill the previous command before sending your new command, or use the timeout parameter in execute_bash for future commands."* (`openhands/runtime/utils/bash_constants.py`). Claude Code auto-backgrounds at the timeout (`Command did not complete within its 120s timeout and was moved to the background`) with three named exceptions — `sleep`, anything containing `git`, and any compound it cannot parse. Codex hands back a **session id** and drives it with `write_stdin`. Daytona's default `process.exec` timeout is **10 seconds**; E2B's *command* timeout is 60s while the *sandbox* timeout is 300s — the docs call that their most common surprise. |
| **Why** | A turn-based loop cannot block. Something must convert "still running" into a value. |
| **Absent** | The agent deadlocks on the first `npm run dev`, watcher, or test loop, and the run dies with no diagnosis. |
| **HARNESS today** | **PARTIAL, and this is our worst row.** There is exactly one timer — `RUN_MS = 180000` (`crates/adapters_web/src/c2w.js:32`) — and on expiry `recover()` writes `0x03`, proves the shell answers, and the call resolves as a typed `WorkspaceError::Failed` reading `no answer in 180s, so the command was interrupted; the shell recovered`. Three specific problems, each read from the code: **(a) the partial output is discarded.** `until()` returns `null` on timeout and the buffer is never surfaced — three minutes of a build's log, gone, and the agent is told only that time passed. Claude Code, OpenHands and Codex all return what was produced. **(b) there is no per-call timeout the model can set.** Codex has `yield_time_ms`, OpenHands has a `timeout` parameter, E2B has `timeout=0`. Ours is a constant, and its own comment concedes the ambiguity: "the guest is ONE permanently interpreted thread… so a slow command is not a stuck one: three minutes is a wedge threshold, not a performance budget." On a 13–15x CPU that threshold is doing two jobs. **(c) one shell serves every agent — shared fate** (`crates/adapters_web/src/c2w.rs:62-65`), and `queue` in `c2w.js` serialises every call, so agent B waits behind agent A's three minutes with nothing on screen explaining why. The 180 s watchdog is correct engineering for a wedge; it is the wrong shape for a slow command. |

### R4 — Something that outlives the call, and a way to read it back

| | |
|---|---|
| **Who demands it** | Docker Agent's `background_jobs`: `run_background_job` "return[s] a job ID immediately", `wait_background_job` "returns exit code and output" with a 60 s default, output capped at "10 MB per job", and — the good part — with `recall: true` "Docker Agent sends a **steering message** back into the running agent loop after the job finishes" (https://docs.docker.com/ai/docker-agent/tools/background-jobs/). Claude Code has `run_in_background` + `BashOutput`. E2B returns a `CommandHandle` with a `pid` you can store and reattach to "from a completely different process later." OpenHands tells the model to do it by hand: "run them in the background and redirect output to a file, e.g. `python3 app.py > server.log 2>&1 &`." |
| **Why** | A server the agent starts and cannot leave running is not a server; one it cannot see is running blind; one it cannot stop is a leak. |
| **Absent** | Either the loop blocks (R3) or the agent starts things it can never observe or kill. |
| **HARNESS today** | **HAVE, and it is the best thing in our environment — better than most vendors' one-shot `exec`.** Four tools over a `.harness/proc/<name>/` convention holding `cmd`/`pid`/`cpid`/`started`/`log`/`ended`/`exit` (`crates/core/src/proc/convention.rs`). Three details the field mostly gets wrong and we got right, each with the browser finding that forced it: **liveness is the `exit` FILE, not `kill -0`** — "On the engine this ships on, `kill -0` succeeds for pid 1, 3, 5 and 7 — long-dead `ls` processes it never reaped"; **two pids** because "killing the one it had killed the wrong process" and the command went on writing after a KILL (`proc/start.rs`); **the stop verdict is the log's growth**, not the process table, because "output still arriving is the only positive evidence a stop failed" (`proc/watch.rs:57-63`). The output the model reads is ours, tab-separated, never forwarded from `ps` — "an agent handed `ps aux` to parse will misparse it." A start that died on a typo comes back as `GONE` with the error quoted and a non-zero status. Identity is a *name the model chose*, because "a pid is not stable across a reload" (`crates/agent/src/workspace.rs:126-140`) — E2B hands back a pid; we hand back `web`. **The one gap:** no completion signal. Docker's `recall` steering message wakes the loop; our agent must poll `read_process`. On a 13–15x CPU, polling is expensive. |

### R5 — Bounded output, with the rest still reachable

| | |
|---|---|
| **Who demands it** | The ACI paper's principle 3 — "Environment feedback should be informative but concise" — and its diagnosis of `cat`: commands that print files to stdout "can easily flood a language agent's context window with too much file content, the majority of which is usually irrelevant" (§A.1). Claude Code: output streams to a working file, "a command whose output passes 5 GB is killed"; a valid result gets "Inline up to roughly 30,000 characters; past that, **the path of a file saved to the session directory**… plus a short preview from the start, and Claude reads or searches the file when it needs the rest" (https://code.claude.com/docs/en/tools-reference). Codex makes it a tool parameter: `max_output_tokens`, "Defaults to 10000 tokens". OpenHands says so in the tool description and emits `[Previous command outputs are truncated. Showing the last {num_lines} lines of the output below.]` |
| **Why** | The context window is the scarcest resource in the loop and the environment is the thing most able to blow it. |
| **Absent** | One `cat` of a large file ends the turn's usefulness; and silent truncation is worse than loud truncation, because the agent cannot tell it happened. |
| **HARNESS today** | **PARTIAL, and this is the cheapest real fix in the document.** Where we cap, we cap well and we *say so*: `find_files` is `… | head -n 60` and the result carries `(capped at 60 — narrow the search)` (`crates/core/src/files/find.rs:29,50`); `read_process` tails 40 lines above a state line and reports the total (`crates/core/src/proc/watch.rs:16-49`); `list_processes` is a formatted table. **`exec` and `read_file` are uncapped.** `read` is `cat -- <path>` (`crates/kernel/src/workspace.rs:75`) and `said()` passes the whole string through (`gate.rs:177-189`). A `cat` of a 2 MB file goes verbatim into the Document. The budget ladder cannot save it — `crates/context/src/degrade.rs:39` withholds *binary* parts and says outright of the rest: "text and fragments: not what breaks a budget." The only recovery is compaction, which costs a model call. We already own the three ingredients (a cap, a sentence saying we capped, a `find_files`/`read_file` path back to the rest); they are just not wired to `exec`. |

### R6 — A windowed file view, and an edit that is *checked and reverted*

| | |
|---|---|
| **Who demands it** | This is the single best-evidenced row in the survey. SWE-agent, arXiv 2405.15793, Table 3, against an 18.0 % baseline on SWE-bench Lite: **no edit command at all = 10.3 % (−7.7)** — the largest ablation in the paper; **edit without linting = 15.0 % (−3.0)**; **file viewer showing the entire file = 12.7 % (−5.3)**; **30-line window = 14.3 % (−3.7)**; 100-line window = 18.0 %. The result is *non-monotonic*: more context is actively worse. The lint gate is literal — `flake8 --isolated --select=F821,F822,F831,E111,E112,E113,E999,E902` after every edit, and "If however the linting command produces output… **the edit is reverted**", with the model told `Your proposed edit has introduced new syntax error(s)… Your changes have NOT been applied.` And it is not an edge case: "Out of 2,294 task instances, **1,185 (51.7 %) have at least one turn with a failed edit**"; recovery decays fast — "Any attempt at editing has a 90.5 % chance of eventually being successful. This probability drops off to **57.2 % after a single failed edit**." The paper's reason for rejecting the shell: "Redirection involves copying and rewriting entire files for even minor changes… both strategies lack immediate feedback about file updates, making these silent operations potentially confusing for models to interpret." Claude Code arrives at the same place from the other side: `Read` takes offset/limit, and `Edit` *requires* a prior `Read` and fails loudly on a non-unique match. |
| **Why** | Reading and changing a file is the majority of what an agent does, and the naive shell version of both is the worst-measured interface in the literature. |
| **Absent** | −7.7 points, measured. |
| **HARNESS today** | **MISS, and it is our highest-evidence gap.** `read_file` is `cat --` — no window, no line numbers, no offset (`crates/kernel/src/workspace.rs:75`). `write_file` **replaces the whole file**: `mkdir -p … && printf %s <b64> | base64 -d > <path>` (`crates/kernel/src/workspace.rs:88-99`), and its own tool description says so — "Replaces what was there" (`crates/agent/src/workspace.rs:43-45`). **There is no partial-edit tool at all.** So our model's only route to changing a line is: `cat` the whole file into context, regenerate it entirely, write it back — which is precisely the −7.7 configuration the paper measured, plus the R5 flooding on the way in. Note this needs **no package**: a window is `sed -n` or `awk`, line numbers are `cat -n`, and a checked replace is `grep -c` for uniqueness before the write. All busybox. The frozen image does not block this row. |

### R7 — Knowing what the machine actually contains

| | |
|---|---|
| **Who demands it** | ACI principle 1 — "Actions should be simple and easy to understand for agents… Simple commands with a few options and concise documentation are easier for agents to use." Docker's Kit spec carries an `agentInstructions` field so a capability ships with its own description. Codex's `AGENTS.md` resolution walks root-down with "at most one file per directory" and a 32 KiB `project_doc_max_bytes` cap; Claude Code's `CLAUDE.md` walks up. Codex's *prompt template* names the failure it is guarding: rerun escalated on "a likely sandbox-related network error (for example DNS/host resolution, registry/index access, or dependency download failure)" — i.e. the model must know whether `npm install` can work at all. |
| **Why** | An agent that guesses at its environment guesses with commands whose output differs between busybox and coreutils, then misreads them — a point `crates/core/src/observe.rs:1-4` already makes in its own words. |
| **Absent** | Round trips spent discovering absence, and — worse — plans built on a runtime that is not there. |
| **HARNESS today** | **PARTIAL, with one live defect.** `Affordances` renders one `name(args): description` line per tool and is correctly slotted as SemiStatic ahead of the transcript (`crates/agent/src/components/affordances.rs`); `observe` reports kernel, uptime, cwd, entry count, memory and disk, and drops any field the guest answered badly — including the measured cases where `/proc/uptime` reads `0 0` and `/proc/meminfo` has only `MemTotal` (`crates/core/src/observe.rs:70-90`). Both good. **What is missing is the binary inventory.** Nothing in the prompt says there is no `python3`, no `git`, no `curl`, no compiler and **no network**, though `image/Dockerfile:5-9` states all of it to *us*. And one place actively lies: the refusal text for an empty `start_process` tells the model to call it as `start_process({"name": "web", "command": "python3 -m http.server"})` (`crates/core/src/proc/convention.rs:66`) — our own tool documentation instructing the model to run a binary that does not exist. `docs/ADR-GUEST-TOOL-SURFACE.md` §7 item 3 already named this and left it for the first change under the decision. The honest counter-example is in the tree too: `crates/ui/src/board/examples.rs:29` asks the model to *go and find out* whether python3, node and git are there, which is the right shape for a starter task and the wrong shape for a tool contract. |

### R8 — Being told, in the same words, that the environment forgets

| | |
|---|---|
| **Who demands it** | Cloudflare states it categorically: "**All disk is ephemeral. When a Container instance goes to sleep, the next time it is started, it will have a fresh disk as defined by its container image.**" Modal: 24 h max, "we recommend using Filesystem Snapshots to preserve its state." Anthropic's code-execution container: "Containers expire 30 days after creation. After about 5 minutes of inactivity a container is checkpointed", and — a live trap — "The `expires_at` timestamp… is a shorter rolling value and **doesn't report the 30-day limit**." Docker's `sbx` inverts it: sandboxes "persist until you remove it", so "ephemeral" is marketing there. |
| **Why** | It is the one property of a workspace a person can feel, and the one a model will silently assume the wrong way. |
| **Absent** | Work is written to a disk that evaporates, and nobody finds out until the reload. |
| **HARNESS today** | **HAVE, and we do it better than the vendors, because we say it to the model *and* to the person in one wording.** `durable()` returns `false` with the mechanism named (`crates/adapters_web/src/c2w.rs:89-92`). `files::permitted::kept(false)` is the single sentence — "This page's Linux keeps its filesystem in memory, so what is written there is gone when the page reloads. No setting changes that, so copy out anything worth keeping" — with a test asserting it "states a cost, it does not shout" (`crates/core/src/files/permitted.rs:45-63,138-141`). The *prompt* carries the same clause via `components/space.rs`, marked "the one clause here that no grant may take away", plus ", and nothing start_process started is still running after one." The Processes pane says the reload "took `.harness/proc` with it, and stopped whatever was still running" (`crates/core/src/proc/rows.rs:64-76`). Cloudflare says this in its docs; we say it to the agent, in the tool surface, under test. **Keep exactly as is.** |

### R9 — Controlled network egress

| | |
|---|---|
| **Who demands it** | Docker: default-deny host proxy, "All outbound TCP traffic… is blocked unless an explicit rule allows the destination", with three presets and Cedar policies at the org tier — and an admitted gap, "The default allowed domains include broad wildcards. Some defaults like `*.googleapis.com` cover many services beyond AI APIs." Codex: "**By default, the agent runs with network access turned off**", cloud runs are two-phase — "Setup scripts still run with internet access so you can install dependencies", then the agent phase is offline and "Secrets configured for cloud environments are available only during setup and are removed before the agent phase starts" — plus the only exfiltration-shaped mitigation anyone ships: restricting requests to `GET`, `HEAD`, `OPTIONS`. Anthropic is the most honest: "the built-in proxy… **does not terminate or inspect TLS traffic**… code running inside the sandbox can potentially use domain fronting or similar techniques to reach hosts outside the allowlist", and their engineering write-up reports a real incident where "an allowlist proxy was the piece that failed." |
| **Why** | It is the exfiltration channel, and the install channel, and those are the same channel. |
| **Absent** | Either the agent cannot install anything, or a prompt-injected agent can post anything it can read. |
| **HARNESS today** | **REFUSE — see §5.** There is no network in the guest at all: `c2w.js` boots `["/bin/sh"]`, `web/c2w/worker.js` forwards only `{info, args}`, no `c2w-net-proxy`, no `--net` (`image/Dockerfile:5-9`). That is a stronger posture than every allowlist proxy in this survey, and it is free because it is *absence* rather than machinery — no TLS inspection question, no domain fronting, no `*.googleapis.com` wildcard. The cost is recorded: the 2.46 MB OpenSSL stack is 66.2 % of the guest and has no reachable use (`docs/IMAGE-AUDIT.md` §4). This is `docs/ADR-GUEST-TOOL-SURFACE.md` Q3 and it stays refused until the owner answers otherwise. |

### R10 — A blast radius small enough to run unattended

| | |
|---|---|
| **Who demands it** | Docker's incident list is the argument: `rm -rf ~/`, a WSL2 root deletion, 15–27k family photos, an AWS production deletion with a 13-hour outage, a Replit prod DB wipe, and the **s1ngularity** npm attack that probed for Claude Code / Gemini CLI / Amazon Q and invoked them with `--dangerously-skip-permissions` / `--yolo`, exfiltrating 1,000+ GitHub tokens. Their conclusion: "An AI coding agent is a junior developer with root access, the ability to type at 10,000 words per minute, and no instinct for when to stop and ask" — and "The agent gets a workspace. It does not get your machine." OpenHands gives five reasons for the container (security, consistency, resource control, isolation, reproducibility) and one warning: "**There's nothing stopping the OpenHands agent from deleting or modifying any files that are mounted into its workspace.**" agent-zero is blunter: "**Agent Zero Can Be Dangerous!**… There are no hard-coded rails." Open SWE's principle: "isolate first, then give full permissions inside the boundary." |
| **Why** | Without it every action needs a human, and "a human cannot sit in the control loop for thousands of actions at machine speed." |
| **Absent** | Permission prompts, which "are not a security strategy" and make the person the bottleneck. |
| **HARNESS today** | **HAVE, structurally — and honest about what it is not.** The blast radius is a browser tab with no host filesystem, no network, no credentials, and a factory reset on reload. We are past the boundary Docker built a VMM to reach. `docs/PARITY.md` gap 7 is right that "the blast radius is a network-less disposable VM… a genuine mitigation" and right that this flips the moment gap 1 closes. **What it is not** is per-agent isolation: one guest, one shell, and `exec` reaches all of it — the terminal footnote tells the person so in plain words: "it is a full shell: {who} can read anything in this Linux, not only this folder" (`crates/core/src/terminal/footnote.rs:78-82`). The path check on the file tools is legibility, not containment (`crates/agent/src/workspace.rs:143-170`). Saying it is the right move and we already do. |

### R11 — Interactive prompts must be unreachable, or answerable

| | |
|---|---|
| **Who demands it** | The best citation in the survey is agent-zero's, with an issue number attached: `# Pagers (more/less) would otherwise block forever waiting for input that never arrives and spin at 100% CPU; see issue #1697` → `PAGER_DISABLE_COMMAND = "export GIT_PAGER=cat; export PAGER=cat"`, injected into every new shell. SWE-agent forbids instead: `blocklist = ("vim", "vi", "emacs", "nano", "nohup", "git", "gdb")` — **`git` wholesale**, because `git commit` with no `-m` opens `$EDITOR` and hangs — plus `blocklist_standalone` for bare `python`/`bash`/`su`, and the refusal `Interactive operation '{name}' is not supported by this environment`. OpenHands issue #3031 enumerates the class: a REPL changing the prompt, a text editor breaking the display, conda prefixing `PS1`, `Password:`, and `(yes/no/[fingerprint])` — root cause, "only looks for the **next** `PS1` prompt… This will keep looking for such a pattern until it timeout." Open SWE ships `COREPACK_ENABLE_DOWNLOAD_PROMPT=0` with the comment "Prevents corepack from showing a y/n download prompt which causes the command to hang." Claude Code's devcontainer sets `ENV EDITOR=nano`. |
| **Why** | Our sentinel protocol is exactly the `PS1` protocol OpenHands describes, with exactly the same failure. |
| **Absent** | The shell wedges until the watchdog, and with one shared shell that is everybody's three minutes. |
| **HARNESS today** | **MISS, and it is a two-word fix.** Boot sets `set +m; stty -echo 2>/dev/null; PS1=''` (`crates/adapters_web/src/c2w.js`) and the image sets `TERM=linux LANG=C.UTF-8 HOME=/root PATH=…` (`image/Dockerfile`). **Neither sets `PAGER`, `GIT_PAGER` or `EDITOR`, and I grepped both files to confirm.** Busybox ships `vi`, `more` and `less`. A model that runs `more log` or `vi notes.md` — both plausible, and `more` is what a model reaches for after seeing R5's uncapped output — wedges the one shared shell for 180 s, then gets Ctrl-C'd and told a timeout happened. `recover()` saves the machine; nothing saves the three minutes. We do have the surrounding hardening: the raw-mode ioctl, `set +m` for job-control notices, escape-sequence and CRLF stripping, and `marked()` which finds our marker by name because "container2wasm's `sh` announces `Terminated` when the kill lands" and that was read as the marker once (`crates/core/src/proc/convention.rs:95-110`). The pager hole is the one left open. |

### R12 — One command at a time, and the agent knows it

| | |
|---|---|
| **Who demands it** | Three systems enforce it identically. SWE-agent's system prompt: "YOU CAN ONLY ENTER ONE COMMAND AT A TIME" and "Always wait for feedback after every command." OpenHands rejects multi-command calls outright — `ERROR: Cannot execute multiple commands at once.` — and its refusal message for a call arriving mid-command is the most reusable artifact in the whole survey: *"[Your command \"{command}\" is NOT executed. The previous command is still running - You CANNOT send new commands until the previous command is completed. By setting 'is_input' to 'true', you can interact with the current process…]"* agent-zero: "do not interleave other tools while waiting", "never claim success from timeout partial output or a still-running command." |
| **Why** | Interleaved output, unattributable exit codes, and an agent that believes a still-running command succeeded. |
| **Absent** | Two commands writing sentinels into one PTY, which is a corrupted protocol, not a race. |
| **HARNESS today** | **HAVE by construction — MISS as a statement.** `queue` in `c2w.js` serialises every call, with the reason written down: "Two commands writing sentinels into one PTY would interleave, and there is exactly one PTY: real concurrency in this guest comes from backgrounding a job, not from a second shell." Correct, and *nowhere in the model's context*. The affordances block instead tells the model the opposite-sounding thing: "Calls that do not depend on each other go on one line, separated by commas, and run at the same time" (`crates/agent/src/components/affordances.rs:43-47`) — true of tool dispatch, false of the guest, which will serialise them. Nothing is broken; the model's mental model is. |

### R13 — A refusal the agent can act on

| | |
|---|---|
| **Who demands it** | Claude Code: "When a command fails after the sandbox denied it access, Claude Code appends the violation details to the failed command's output, so Claude sees which file path or network host the sandbox blocked", then an escape hatch — `dangerouslyDisableSandbox` on the retry. Codex: `sandbox_permissions` on the rerun with a required `justification`, and "Prefer requesting sandboxed additional permissions instead of asking to run fully outside the sandbox." The shared design point, in Codex's own words, is that the denial must be legible in the command's output — an opaque permission-denied is unrecoverable, an annotated one is a retry. |
| **Why** | Principle 4: "Guardrails mitigate error propagation and hasten recovery." |
| **Absent** | The agent retries the same thing, or gives up on a capability it does have. |
| **HARNESS today** | **HAVE, and this is what we do best in the whole table.** `relative_path` refuses rather than clamps, with the reason stated — "a silently rewritten path writes a file the agent cannot find, and the refusal is what lets it correct itself" — and the refusal quotes the path back and names the shape it wanted (`crates/agent/src/workspace.rs:143-170`). `process_name` likewise. The gate's denial names *which file grants the capability* (`crates/core/src/workspace/gate.rs:21-28`). The four prose prefixes — `No folder is available here: `, `The Linux failed: `, `This agent works alone, so it has no folder: `, `You stopped ` — are a typed contract used to decide both wording and wrapping (`gate.rs:145-175`), and `unavailable()` carries the argued case that a stop a person asked for is not a failure. No escalation path exists, and none should: there is nothing here to escalate *to*. |

### R14 — Reproducible construction of the environment

| | |
|---|---|
| **Who demands it** | OpenHands' three-tag cache — a versioned tag, a *lock* tag that is the MD5 of the base image plus lockfiles, and a source tag, checked in descending specificity. Open SWE pins hard: `DAYTONA_IMAGE_NAME = "daytonaio/langchain-open-swe:0.1.0"`, `DAYTONA_SNAPSHOT_NAME = "open-swe-vcpu2-mem4-disk5"` — resources encoded in the name. Daytona's declarative `Image` builder; Docker's `sbx template save` and Kit OCI artifacts. |
| **Why** | "Sandboxed environments make it easier to reproduce bugs and issues, as the execution environment is consistent and controllable" (OpenHands). |
| **Absent** | The environment moves under the agent and under the tests. |
| **HARNESS today** | **PARTIAL, and honestly recorded.** `image/Dockerfile` carries `TODO(pin)` unresolved — the digest could not be obtained because Docker was not running — and, more sharply, **the artifact we ship was not built from it**: `docs/IMAGE-AUDIT.md` §4 found `img/` is "a single-layer, stock, unmodified `alpine:latest`… There is no derived image here — this is `c2w alpine:latest`." The build command itself was recovered from the sibling `Dev/wasmbox` repo and is byte-matched (§7 item 1). So the recipe describes an intent; the guest is upstream Alpine. This is inside the frozen-image question and is not proposed for change here. |

### R15 — A warm start

| | |
|---|---|
| **Who demands it** | Fly's own verdict is the useful one: "**Creating a Fly Machine can take over a minute.** What you're supposed to do is to create a whole bunch of them and stop them so they're ready when you need them", and Kurt Mackey: "it's always been a square peg, round hole situation… They don't want containers. They don't want 'sandboxes'. They want computers." E2B resumes in ~1 s; Daytona's advertised sub-90 ms rests on allowlist-gated warm pools. Docker's rationale post is the most transferable line in the survey: "**Isolation only survives contact with developers when it is at least as convenient as skipping it.**" |
| **Why** | If the environment is slower to reach than the unsafe alternative, the unsafe alternative wins. |
| **Absent** | People turn it off. |
| **HARNESS today** | **HAVE, with the cost stated.** 3.16 s to a shell (wizer, `d16048c`), and `prewarm()` is caller-decided rather than on every page load, with the reasoning written out: the head start is on 47 MB, "too much to spend on somebody who came to type one sentence into a chat", so the Commands pane prewarms and the header pill does not (`crates/adapters_web/src/c2w.rs:160-186`). `Warmth` carries the *phase* as a value the page renders every frame, because "a pill that said `starting…` for a minute and a half would be true and useless." Beats every vendor here on first-command latency and loses to all of them on first-visit download. |

### R16 — A per-repo instruction file the environment reads

| | |
|---|---|
| **Who demands it** | `AGENTS.md` (now under the Agentic AI Foundation) and `CLAUDE.md`, with genuinely different resolution: Codex walks root-down, "at most one file per directory", later files override, and **silently stops at `project_doc_max_bytes` (32 KiB)**; Claude Code walks up, loads subdirectory files on demand, expands `@path` to depth 4, and warns "target under 200 lines." The caveat both share, in Anthropic's words: "CLAUDE.md instructions shape Claude's behavior but are **not a hard enforcement layer**… If the instruction is something that must run at a specific point… write it as a hook instead." |
| **Why** | Project-specific knowledge that the environment, not the model, should supply. |
| **HARNESS today** | **HAVE, in a different shape, and arguably a better one.** The agent file *is* the instruction file (`public/agents/*/agent.md`), parsed with the refuse-rather-than-default discipline `docs/PARITY.md` singles out; the space carries `facts` and `notes` across agents (`crates/agent/src/components/space.rs`); `memory` carries an agent's own durable lines. And the enforcement point Anthropic concedes they lack, we have: `goal.check` is a command whose **exit code** decides the turn, not a model's opinion (`crates/agent/src/goal/mod.rs:11-13` — "Not on a verdict: a local 12B asked 'are you done?'…"). Nothing to do. |

---

## 3. The scoreboard

| | requirement | verdict |
|---|---|---|
| R1 | stable working directory | HAVE mechanically / unstated |
| R2 | exit status, read correctly | HAVE / no benign-exit-1 |
| R3 | finished vs hung | **PARTIAL — worst row** |
| R4 | outlives the call | **HAVE — best row** |
| R5 | bounded output | **PARTIAL — cheapest fix** |
| R6 | windowed view + checked edit | **MISS — highest evidence** |
| R7 | knowing what the machine contains | PARTIAL + one live lie |
| R8 | told that it forgets | HAVE — keep verbatim |
| R9 | controlled egress | **REFUSE** |
| R10 | small blast radius | HAVE structurally |
| R11 | no reachable interactive prompt | **MISS — two-word fix** |
| R12 | one command at a time | HAVE / unstated |
| R13 | actionable refusals | HAVE — best-in-survey |
| R14 | reproducible image | PARTIAL (frozen) |
| R15 | warm start | HAVE |
| R16 | per-repo instructions | HAVE |

**The three we fail hardest: R6, R3, R5.** All three are about what happens to *bytes* between the
guest and the model — a file going in, a long command's output coming out, a large result coming
out. None of the three needs a package.

---

## 4. Ranked by value to our workflow ÷ cost to deliver

Cost is measured the way this repo measures it: files touched in `crates/`, and whether `image/`
has to move.

| # | change | value | cost | ratio |
|---|---|---|---|---|
| 1 | **Cap `exec` and `read_file` output, and say the cap out loud** (R5) | High — protects every turn's context; the loop's `goal.check` runs through the same path | ~1 function, 1 file, 0 image | **highest** |
| 2 | **Stop naming `python3`; state the inventory once** (R7) | High — removes a documented lie and a whole class of doomed plans | 1 line + 1 small component, 0 image | very high |
| 3 | **`PAGER=cat GIT_PAGER=cat EDITOR=true` at boot** (R11) | Medium-high — removes the cheapest way to wedge the one shared shell | 1 line in `c2w.js`, 0 image | very high |
| 4 | **Return partial output on timeout, and name the ending** (R3) | High — 180 s of work currently discarded; and the shell is still ours | ~15 lines in `c2w.js` + the error text, 0 image | high |
| 5 | **A windowed `read_file` and a checked partial edit** (R6) | Highest measured — the paper's −7.7 and −5.3 | 2–3 files in `crates/`, 2 tool contracts, 0 image | good, but the largest |
| 6 | A per-call `timeout` argument on `exec` (R3) | Medium | 1 tool arg threaded through the port | medium |
| 7 | Benign-exit-1 semantics (R2) | Medium | a table nobody can make complete | medium-low |
| 8 | A completion signal from `start_process` into the loop (R4) | Medium | touches the loop, not just the workspace | low |
| 9 | Baking any package (R7/R14) | — | **[NEEDS THE IMAGE UNFROZEN]** +22 MB minimum, paid again at 13–15x per command | **refused, see §5** |

**Why 5 is fifth despite the best evidence.** It is right, and it is the biggest edit in the list —
two new tool contracts, and `docs/ADR-GUEST-TOOL-SURFACE.md` §5 already warns that every tool here
is busybox shell inside Rust string literals under I12's 200-line and 40-line rules. Items 1–4 are
each a handful of lines and each removes a way the environment currently *misleads* the model,
which is the class of defect Option B exists to prevent. Do them first; then 5 has room.

**On instrumentation, which the ADR was right to flag.** §5 of that ADR says the whole
justification for tool design is "fewer round trips per completed task" and "we do not instrument
it… or this is taste wearing a citation." That objection lands on item 5 and *not* on items 1–4:
a discarded 180 s output, a lie about `python3`, an uncapped `cat` and a wedging pager are defects
whether or not round trips are counted. Item 5 should wait for a counter.

---

## 5. What we should DELIBERATELY REFUSE — and say on screen

The pattern the tree already uses is the right one and should be extended, not invented:
`files::permitted::kept(false)` states a cost plainly, in one wording, to the model and the person,
under a test that asserts it does not shout. Five refusals, in that voice.

**1. Persistence. Already ruled by the owner; already said; change nothing.**
`durable()` is false, the sentence is one place, and the prompt marks it the one clause no grant may
take away. Note what the survey found: **Cloudflare ships the same refusal** — "All disk is
ephemeral. When a Container instance goes to sleep… it will have a fresh disk" — and Docker's
`sbx template save` warns it "captures its **entire filesystem, including any secrets stored on it**."
We are not behind here; we are in the same place with better copy. Do not build an OPFS overlay
(`docs/ADR-GUEST-TOOL-SURFACE.md` Q2 priced it at ~79 KB/s, a felt stall on every save and every
boot). **Refuse, and keep saying "gone when the page reloads. No setting changes that."**

**2. Network in the guest. Refuse, and start saying it to the model.**
This is ADR Q3 and I2. Our position is the strongest in the survey precisely because it is absence:
no proxy to configure, no TLS-inspection question, no domain fronting, no `*.googleapis.com`
wildcard — the three problems Docker admits to and Anthropic reports having actually been bitten by
("an allowlist proxy was the piece that failed"). **The gap is that the model is never told.** It
should read, once, in its affordances: *there is no network in this Linux — no `apk add`, no `pip`,
no `npm`, no `git clone`, no `curl`. Use `web_search` for anything outside this tab.* That converts
a refusal into an affordance and points at the capability that does exist.

**3. A general machine — packages baked into the image. Refuse by default; say what IS here.**
**[NEEDS THE IMAGE UNFROZEN, and I do not propose unfreezing it for this.]** The arithmetic is
already recorded and it does not improve on re-reading: python3 + git + curl takes the guest from
3.85 MB to 26 MB (+22,174,963 bytes, ~+45 % of the whole artifact); adding a compiler takes the
guest to 133,760,701 bytes, ~4x today's total; and every byte buys workloads that are the *worst*
case for an interpreted Bochs, paid at 13–15x forever. Against that, `docs/PARITY.md` is right that
we lose the clone-install-compile-test task class regardless — "Hermes and DeepSeek are not ahead of
us by a package list, they are ahead by *not being emulated*." **Refuse, and replace the silence
with a sentence naming what the machine is:** a busybox shell, a filesystem, and ten tools. Note the
one thing that would justify an unfreeze, so it is on record: not a package, but a **measured**
`VM_MEMORY_SIZE_MB` (`docs/IMAGE-RECIPE.md:508` records the lowest booting value as still
unmeasured), because 577.75 MiB of committed linear memory is the number that decides which devices
can run this at all — and that is a rebuild in service of the stated goal, not against it.

**4. Per-agent isolation inside the guest. Refuse, and keep saying it is one Linux.**
There is one shell and `exec` reaches everything; a `space:` grant is a cwd, not a boundary. The
terminal footnote already tells the person in an ordinary voice, and the comment beside it records
that it was rewritten out of a shouting register on purpose. Building real per-agent isolation means
a second guest — the emulator is 92 % of 46 MB and its declared memory minimum is allocated up
front, so a second one is not a feature, it is a second 577.75 MiB. **Refuse, and say: one Linux in
this tab, shared by every agent named here.** What we should add is the *scheduling* consequence,
which is currently invisible: one shell means commands queue, so a wedged command is everybody's
wait. That belongs on screen next to the busy pill, which already outranks `ready` for exactly this
reason.

**5. Checkpoint / restore of the agent's world. Refuse, and do not miss it.**
Worth stating because it is the one place the survey shows the whole field is thin: Docker has no
live checkpoint at all (only a full-disk template and Docker Agent's shadow-git file snapshots);
Cloudflare's "Snapshots are coming soon" has been on the architecture page for months; Modal's
memory snapshot is alpha and "**Snapshotting a Sandbox will currently cause it to terminate**"; only
E2B and Fly Sprites ship it. Given refusal 1, it is moot for us anyway. **Refuse silently in the
product, and record here that there is no vendor to copy** — so nobody proposes it as catching up.

**One thing we should NOT refuse, and are currently refusing by accident.** The model is never told
about R1 (the cwd resets each call), R12 (commands queue), R9 (no network) or R7 (no python, node,
git, curl, compiler). None of those is a decision; each is a silence. The whole of Option B is that
the interface is the product, and four true sentences are the cheapest product surface in the tree.

---

## 6. At most five concrete changes, ranked, each naming its file

1. **Cap what a tool result can put in the Document, and say the cap.**
   `crates/core/src/workspace/gate.rs` — `said()` is the one funnel every workspace result passes
   through. Cap at a stated character count, keep head and tail, and append one sentence in the
   existing prose-prefix style naming what was dropped and how to get it (`find_files`, `read_file`
   on a narrower path). Follows `find.rs`'s own precedent — "(capped at 60 — narrow the search)".
   *Evidence:* ACI §A.1 on `cat`; Claude Code's ~30,000-char inline ceiling; Codex's
   `max_output_tokens` default of 10000. *Image:* untouched.

2. **Stop telling the model to run `python3`, and tell it what the machine actually is.**
   `crates/core/src/proc/convention.rs:66` — replace the `python3 -m http.server` example with one
   that exists (a busybox loop writing to a log). Then add the inventory as a component beside
   `crates/agent/src/components/affordances.rs`: busybox + musl, no python/node/git/curl/compiler,
   **no network**, and the cwd resets to the workspace on every call. `image/Dockerfile:25-42`
   already holds the authoritative list — the component should read like that list, not like prose.
   *Evidence:* ACI principle 1; Docker's Kit `agentInstructions`; Codex's DNS/registry escalation
   template. *Image:* untouched. Also closes `docs/ADR-GUEST-TOOL-SURFACE.md` §7 item 3.

3. **Neutralise the pagers and the editor at boot.**
   `crates/adapters_web/src/c2w.js` — extend the boot setup line from
   `set +m; stty -echo 2>/dev/null; PS1=''` to also export `PAGER=cat GIT_PAGER=cat EDITOR=true`.
   One line, no rebuild, and it closes the cheapest route to a 180 s wedge of the shell every agent
   shares. *Evidence:* agent-zero's `PAGER_DISABLE_COMMAND` and issue #1697 ("block forever… spin at
   100% CPU"); SWE-agent's blocklist; OpenHands #3031. *Image:* untouched (belongs in
   `image/Dockerfile`'s `ENV` eventually, but must not wait for an unfreeze).

4. **Give back the partial output when the watchdog fires, and name which ending it was.**
   `crates/adapters_web/src/c2w.js` — `until()` already leaves `buf` intact on timeout; return it
   instead of only `null`, and have `c2w_exec` carry it into the error. Then
   `crates/core/src/workspace/gate.rs` renders it under the existing `FAILED`/`STOPPED` prefixes,
   in OpenHands' register rather than SWE-agent's: what ran, what it printed before the interrupt,
   whether the shell recovered, and that `start_process` is the tool for something this long.
   *Evidence:* OpenHands' non-blocking refusal text; Claude Code's `moved to the background`;
   Codex's session id. *Image:* untouched.

5. **A windowed `read_file` and a checked partial edit.**
   `crates/kernel/src/workspace.rs` (the `read` default is `cat --`; add an offset/limit form built
   the same way — `sed -n`/`awk`, all busybox) and `crates/agent/src/workspace.rs` (the tool
   contracts, which under Option B *are* the product). The edit should be
   old-string/new-string with a uniqueness check before the write and a refusal that quotes what it
   found, mirroring `relative_path`'s refuse-don't-clamp discipline. *Evidence:* arXiv 2405.15793
   Table 3 — no edit tool **−7.7**, whole-file view **−5.3**, 30-line window −3.7, unlinted edit
   −3.0; and 51.7 % of trajectories hit at least one failed edit. *Image:* untouched.
   **The honest objection, carried from the ADR:** this is the row where "fewer round trips" is the
   whole justification and nothing counts them. Land 1–4 first, add a counter, then do this with a
   number to check it against.

---

## 7. What this document does not settle

- **Whether the guest should be re-measured at a lower `VM_MEMORY_SIZE_MB`.** Named in §5 refusal 3
  as the one unfreeze with an argument behind it; still owner Q1(b).
- **Whether `exec` should keep sitting beside the narrow tools.** The ADR concedes the SWE-agent
  result is "diluted by construction" because a general shell is always available. Nothing here
  changes that, and removing `exec` is not proposed — every other tool is built from it.
- **Round-trip instrumentation.** Cited twice above as the missing measurement. It is a prerequisite
  for change 5, not for changes 1–4.
- **Every number carried from `d16048c`** — the 13–15x, the ~79 KB/s, the 26.7 s → 3.16 s — remains
  **UNVERIFIED from bytes on disk** per `docs/IMAGE-RECIPE.md:591-598`, and is used here as the best
  evidence available, labelled as such.
