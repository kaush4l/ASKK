# OpenAlice — prior-art study

## 0. Identification

**TraderAlice/OpenAlice** — https://github.com/TraderAlice/OpenAlice — AGPL-3.0, TypeScript,
~6.5k stars, HEAD `0114f78` (2026-08-11). **Confidence: high.** It is the only `openalice` on
GitHub that is an agent system with tools and a control loop, it is under heavy active
development, and every other `openalice` hit in the search index is a fork or satellite of it
(`OpenErii`, `openalice-desktop`, `OpenAlice-JP`, `alice-india`, `trader-mcp`, `LearnedAlice`,
`StartAlice`). Studied from a shallow clone of the source.

Rejected candidates:
- **A.L.I.C.E. / AIML / program-ab (ALICE AI Foundation)** — a pattern-matching chatbot. No loop,
  no tools, no agency. Dead lineage.
- **SeanTheSheepCS/OpenAlice** — a C++ farming game clone, last pushed 2021.
- **2233admin/openalice-data** — a Chinese OpenBB data platform, satellite of the above.
- **cyptokoz-svg/OpenErii, XSirch/OpenAlice, colinchin/OpenAlice, …** — direct forks.

Caveat for the reader: OpenAlice is a **trading desk**, not a Jarvis. The domain is irrelevant to
HARNESS; the *substrate* is what is worth stealing.

## 1. What it is

A local, file-backed Electron/Node workspace that turns an **existing coding-agent CLI**
(`claude`, `codex`, `opencode`, `pi`) into a long-running domain agent by giving it a git repo, a
persona file, skills, markdown issues, an inbox, an entity graph, and a set of domain CLIs on
`PATH`. It ships no model loop of its own. Alive and moving fast (merge to `dev` the day before
this clone; 1060+ PRs). State lives under `~/.openalice` as ordinary files and git repos — "no
Postgres or Redis to provision" (`README.md`).

## 2. The agent loop

**There is no agent loop in this codebase.** That is the central architectural decision and the
most interesting thing about the project.

> "OpenAlice runs the model loop inside that native runtime so you keep its conversation state,
> provider login, and tool behavior." — `README.md`

The only residue of an in-process loop is a dead config key `maxSteps: z.number().int().positive().default(20)`
(`src/core/config.ts:238`) referenced by nothing but its own spec. There is no `streamText`,
`generateText`, or step counter anywhere in `src/`.

What exists instead is a **process supervisor** with two spawn shapes, both defined by
`CliAdapter` (`src/workspaces/cli-adapter.ts:247`):

```
interactive:  composeCommand(base, ctx) -> argv         # node-pty, TUI, stays alive
headless:     composeHeadlessCommand(base, ctx, prompt) # plain pipe, exits at turn boundary
```

The unattended control flow (`src/workspaces/schedule/scanner.ts:1-26`,
`src/workspaces/headless-task.ts:316`):

```
every ~60s (a plain timer, NOT a scheduled task):
  for ws in registry.list():                       # scanner.ts
    issues = readWorkspaceIssues(ws.dir)           # issues/declaration.ts:253 — live working tree
    for issue in issues where issue.when and status not in {done, canceled}:
      base = lastFiredAt ?? (cron ? now - interval : epoch)
      if computeNextRun(issue.when, base) <= now:
        prompt = issue.what                        # the markdown body, verbatim, uninterpreted
        argv   = adapter.composeHeadlessCommand(base, ctx, prompt)
        result = spawn(argv, {stdio:['ignore','pipe','pipe']})   # headless-task.ts:445
          -> per stdout LINE:
               adapter.extractHeadlessSessionId(line)     # capture the CLI's own session id
               adapter.extractHeadlessOutputEvents(line)  # vendor JSONL -> neutral blocks
          -> exit IS the done signal (no timeout unless caller arms a watchdog)
        markFired(issue.id)   # only AFTER a successful dispatch
```

Termination is `process exit`. Success is `headlessTaskStatus()` (`headless-task.ts:125`):
exit 0, not killed, and the last structured block is not an `error` that no later assistant text
recovered. Note the explicit anti-pattern comment: this path is *not* routed through the
session pool, "whose respawn-on-exit circuit is anti-semantic for a one-shot task".

There is no per-workspace lock: "if a fire collides with a still-running run or a live
interactive session in the same checkout, the coding agent absorbs it (it lives in
multi-AI-on-one-repo all day)" (`scanner.ts:11-15`). The only bound is a global headless
concurrency cap.

## 3. Modes

Not plan/ask/agent. The mode axes are:

- **Attended vs headless** — interactive PTY TUI, or one-shot pipe. Same workspace, same files,
  same tools; only the delivery contract differs (see §8).
- **Trading mode** `lite | readonly | pro` (`src/services/trading-mode.ts:5`), resolvable from
  env (`OPENALICE_TRADING_MODE`, which *locks* it), config, or auto-detected from whether any
  broker account is configured. This is a capability gate on the whole tool surface, not a
  prompt-level mode.
- **Trading-as-Git** — the real "plan mode". Mutations are staged, not executed (see §5).

## 4. Context window

OpenAlice does not assemble a prompt. It **assembles a directory**, and the CLI does the rest.
`injectWorkspaceContext` (`src/workspaces/context-injector.ts:40`) runs once at workspace
creation, after the template bootstrap and before the initial commit:

1. `persona = data/brain/persona.md` (live user override) `?? default/persona.default.md`.
2. `instruction = <template>/instruction.md`.
3. `composed = persona + "\n\n---\n\n" + instruction`, written **byte-identically to both
   `CLAUDE.md` and `AGENTS.md`** — "The CLIs disagree on the filename; we don't pick a side."
4. Skills copied into **both** `.claude/skills/<name>/` and `.agents/skills/<name>/`, deduped
   from three sources: `ALWAYS_SKILLS = ['self-scheduling']`, the template's `bundledSkills`,
   and `CLI_TOOLS_SKILLS = ['alice','alice-analysis','alice-uta','alice-workspace','traderhub']`
   when the template sets `injectTools`.

Deliberately *not* copied into `.pi/skills`: Pi discovers both locations and reports duplicates
as startup collisions "which can bury the first user prompt."

History and memory persistence:
- **Conversation history** belongs to the CLI (its own transcript files, resumed by id).
- **Personality** is one file, `persona.md`, ~10 lines, injected at creation only — it does not
  follow live edits into existing workspaces.
- **Long-term memory** is the filesystem plus a wiki-link graph: any markdown may write
  `[[name]]`, and `src/core/entity-graph.ts` projects entities + artifacts (notes, issues) into a
  node/edge graph with backlinks. Names are **global and team-wide**, not workspace-scoped.
- **Compaction**: none. Not the harness's problem — the CLI owns its own window.

## 5. Tools

Tools reach the agent as **plain executables on `PATH`**, not as MCP servers and not as model
tool definitions:

> "The launcher injects NO MCP into workspaces at all (no `.mcp.json`, no Pi bridge); these
> skills are how the agent learns the CLI surface that is now its ONLY path to OpenAlice's
> tools." — `context-injector.ts:26`

Four shims, boundary-separated (`templates/chat/files/instruction.md`):

| CLI | Owns |
|---|---|
| `alice` | RSS archive, symbol search, K-line quant analysis |
| `traderhub` | fundamentals, macro series, calendars, boards |
| `alice-workspace` | peers, agent-to-agent conversation, inbox, issues, provenance, tracked entities |
| `alice-uta` | broker accounts, quotes, orders, trading-as-git |

Calling convention: argv in, **JSON on stdout, reason on stderr, non-zero exit means failed**.
Every skill repeats the same instruction: *discover, don't guess* — `alice <group> <verb> --help`.

Registration is two-layer. Tools are Zod/`ai`-SDK `tool()` definitions registered once into a
`ToolCenter` (`src/core/tool-center.ts:17`) under a group name, with a disabled-list read from
disk at call time; the shims then reach them over a **loopback-only HTTP gateway** bound to
`127.0.0.1` (`src/server/local-tool-gateway.ts:52`), separate from the web listener so a Docker
or public-web topology can keep an unauthenticated CLI surface on a private port. The same
registrations are also exported over MCP (`src/server/mcp.ts`) — "it is *one* registration behind
both."

Permissions:
- The workspace id is **bound by the router, never supplied by the agent** (`inbox-store.ts`).
- Credentials never appear in argv — "Credential material belongs exclusively in `env`"
  (`cli-adapter.ts:204`); issue files carry a vault *slug*, never a key.
- Reads are global, **writes are local**: `issue list`/`show` scan every workspace;
  `create`/`update`/`comment` only touch the caller's own `.alice/issues/`.
- Money is gated by a git metaphor: `alice-uta git status | show | commit | reject | push | sync`.
  An agent stages; a human commits and pushes in the Web UI. "A timer never moves money on its
  own." (`skills/self-scheduling/SKILL.md:272`)

## 6. Loop strategies

Planning, reflection, and retry are **not implemented** — they are the CLI's job, or they are
methods written as skills (`build-thesis`, `sector-rotation`, `scan-value-chain`,
`retrospective`), described in the workspace instruction as "methods, not mandatory ceremony."

What the harness does own:

- **Sub-agents are durable addressable peers, not spawns.** `alice-workspace conversation ask
  --ws-id | --resume-id | --inbox-id | --harness <name> --prompt '…' [--await]`. Omit `--await`
  and you get a `taskId` to `await` / `read` / `collect` later; fan out to several peers, then
  collect. Explicitly: "There is deliberately no unsolicited Agent-to-Agent completion
  notification bus… Do not build shell sleep loops."
- **Ownership continuity.** Assignee `@new-then-resume` recruits once, then *rewrites the issue
  file* to the concrete `@resumeId`, so every later fire returns to the same accountable
  coworker; `@new-each-run` recruits a newcomer every time.
- **Retry** = the next scan tick. The last-fired marker is written only after a successful
  dispatch, so a capacity-rejected `every`/`at` fire simply retries next minute.
- **Failure classification** is post-hoc over the structured block timeline (`headlessTaskStatus`),
  tolerating transient in-band `error` events that a later assistant reply recovered.

## 7. Configuring a new agent

Two files. A **template manifest** (`src/workspaces/templates/chat/template.json`, verbatim):

```json
{
  "displayName": "Chat",
  "groupOrder": 10,
  "description": "General-purpose Alice workspace — Alice's full tool surface (market/research data + trading) via the alice*/traderhub CLIs on PATH.",
  "defaultAgents": ["claude", "codex"],
  "injectTools": true,
  "injectPersona": true,
  "upgradeStrategy": "managed-context",
  "bundledSkills": ["scan-value-chain", "build-thesis", "sector-rotation", "retrospective", "opencli-reader", "delegate-autoquant"]
}
```

And a **unit of work** — one markdown file per issue at `.alice/issues/<id>.md`, where the
filename stem *is* the id (`skills/self-scheduling/SKILL.md:106`, verbatim):

```markdown
---
title: Pre-market brief
status: todo
priority: high
assignee: "@resume-calm-amber-river-a1b2c3"
when: { kind: cron, cron: "30 8 * * 1-5", timezone: America/New_York }
---

Pull pre-market movers and overnight news for my watchlist. Every trading
morning at 08:30, assemble the pre-market picture before the open, write a short
brief to `research/premarket.md`, then push it to Inbox. Cover movers, gaps, and
overnight headlines that move the thesis.
```

Optional per-run runtime tuple, valid only for `@new-*` assignees:
`agent: codex`, `credential: openai-primary` (a vault slug) XOR `credentialSource: native`,
`model: gpt-5.6`, `effort: none|minimal|low|medium|high|xhigh|max`. A fixed `@resumeId` owner
already carries its own immutable runtime, and the schema *rejects* those overrides with
"session assignee owns its runtime; remove the X override" (`issues/declaration.ts:200-208`).

Three notes worth stealing wholesale: (a) there is no `enabled` flag — `status: done|canceled`
is how you silence a timer; (b) the visible markdown body **is** the headless prompt, so the
human-readable work definition and the runtime prompt cannot drift; (c) the retired `execution`
key is kept in the schema as `z.never().optional()` so stale files fail loudly instead of being
silently misread.

## 8. Spaces, artifacts, and VOICE

**Voice: none. Zero.** No STT, no TTS, no wake word, no audio anywhere in the repo — the only
matches for "whisper" are an earnings-estimate pun and a code comment. Nothing to learn here.

**Spaces.** A workspace is a directory + a git repo + a persistent PTY running one agent CLI +
`.alice/issues/`. There is no workspace file-read API by design: "`peer path` owns addressing;
the Coding Agent owns file operations." Cross-workspace reads are normal; headless runs write
only their own workspace; an attended cross-workspace edit needs human approval and must be
committed in the peer repo so its owner can revert it.

**Artifacts.** Delivery is an **Inbox**, an append-only JSONL notification log
(`data/inbox/entries.jsonl`) where each entry is `{docs[], comments}` — docs are **pointers to
live workspace files, never snapshots**, "matches Linear's 'inbox row is a notification, the
issue is the SOR'… snapshotting into the inbox would just create a stale parallel copy."
Read/unread state lives in a *separate* file so the entry log stays append-only. The push records
the exact published content hash, and a push during a scheduled run is auto-linked back to the
triggering issue. Binary media is content-addressed by SHA-256 mapped through a 256-word table
into names like `bright-ocean-leaf.png` (`src/core/media-store.ts`).

The delivery contract is the sharpest line in the whole project
(`skills/self-scheduling/SKILL.md:239-261`):

> "The scheduled run is **headless — nobody is watching, and it cannot see this conversation.**…
> A headless run that does real work and surfaces nothing has vanished… If the run is a check
> that didn't trigger, **exit silently — that is the correct outcome**, not a failure. Don't
> manufacture noise. The Agent Runtime returning a reply only means the scheduler received the
> run's control-plane result. It does **not** mean the user saw it."

Provenance: every artifact traces to a `resumeId` (product session) distinct from a `taskId`
(one execution) and from the CLI's native session id (backend-only). You can then interrogate the
author: `alice-workspace inbox ask --id <entryId>`, `issue ask --id <name> --creator|--owner|--run-id`,
resolving `exact` / `reconstructed` / `unavailable`.

## 9. What it gets RIGHT that HARNESS lacks

1. **Work items as markdown-with-frontmatter files that the agent itself writes, where the
   visible body IS the prompt.** HARNESS already has agents-as-markdown; it has no equivalent for
   *tasks*. An `.alice/issues/<id>.md` analogue would give `crates/core` a projection surface
   (board), `crates/agent` a durable queue, and the user a legible artifact — one object serving
   three roles. Target: new `crates/core` projection + a reader in `crates/agent`. **Medium.**
2. **The delivery contract: "a headless run that surfaces nothing has vanished," and silence is
   a valid success.** HARNESS's sub-agents (`crates/agent/subagent.rs`) return to a parent; there
   is no user-facing inbox and no rule about when to write to it. An append-only inbox is a
   natural `EventLog` projection in `crates/core`, and the *rule* costs one paragraph in a system
   prompt. **Small** (the rule), **medium** (the surface).
3. **Tools as CLI shims on `PATH` inside the workspace, discovered by `--help`, teaching-material
   in `skills/`, rather than model-visible tool schemas.** HARNESS's workspace is Alpine-on-Wasm
   over a PTY — the single best possible host for this pattern, and `crates/agent/toolbox.rs`
   currently spends context on schemas the shell could carry for free. A shim writing JSON to
   stdout and talking to `handle(Request)` over the existing seam collapses "tool registration"
   into "put a file in `/usr/local/bin`". **Medium.**
4. **Persona and instruction written to both `CLAUDE.md` and `AGENTS.md`, byte-identical, at
   creation.** HARNESS has one persona per `agent.md`; it has no *user-level* persona that
   composes over every agent. One file, one concatenation, in `crates/context`. **Small.**
5. **The `@new-then-resume` assignee that rewrites itself to a concrete `@resumeId` after the
   first dispatch.** Durable agent identity across scheduled runs, expressed as a two-state field
   in a text file, no session table. HARNESS's `crates/agent/space.rs` + `window.rs` have the
   pieces but nothing names an accountable long-lived worker. **Small.**
6. **Trading-as-Git: stage → review → commit → push for irreversible acts.** HARNESS has
   `WorkspacePort` exec with no staging gate; the same shape (`git status/commit/push` verbs over
   a pending-mutation log) is the honest way to do "artifacts the user must approve". Applies
   directly to `kernel::NetPort` and any future write tool. **Medium.**
7. **Global `[[wikilink]]` entity graph with backlinks, names not scoped to a workspace.** A
   memory model that is just markdown plus a projection. `crates/core`. **Medium.**
8. **`z.never().optional()` for retired config keys, so stale files fail loudly.** HARNESS's
   `agent.md` frontmatter should do exactly this with `serde(deny_unknown_fields)` plus explicit
   dead keys. **Small.**
9. **Content-addressed 3-word human-readable filenames for binary artifacts.** Cute, and it
   makes artifacts referenceable in prose. `crates/kernel` `StorePort`. **Small.**

## 10. What would be a MISTAKE to copy

- **The core bet: outsourcing the loop to a vendored CLI.** OpenAlice can do this because it is a
  desktop Node app that can shell out to `claude`. HARNESS is a browser tab whose workspace is a
  Wasm Alpine with no network and no persistence; there is no `claude` binary to spawn, and
  HARNESS's entire reason to exist is owning the loop. Copying this deletes the product.
- **The adapter interface.** `CliAdapter` is a ~500-line, ~30-member interface with 4
  implementations and per-vendor JSONL translators, session-id scrapers, per-CLI env strips, and
  a Windows batch-shim resolver. That is the tax for "we don't own the loop," and it is paid
  forever, per vendor, per release. HARNESS's `ModelPort` is the right size.
- **Everything about the AI-provider config layer.** `WorkspaceAiCred`, `SessionRuntimeBinding`,
  `AgentSessionRuntimeProjection`, `wireShape`, `authMode`, `wireApi`, `vendorPolicies`,
  `legacyRequestedWireFallbacks`, plus deprecated read/write paths kept for compatibility. This
  is what happens when four downstream CLIs each need a different rendering of the same
  credential. HARNESS has one wire (OpenAI-compatible). Keep it.
- **The scan-everything scheduler.** Enumerating every workspace and re-parsing every markdown
  file once a minute is fine for a desktop with ten directories; it is the wrong shape for an
  event-log architecture where "issue changed" is already an event.
- **No per-workspace lock, on the theory that "the coding agent absorbs it."** That is a
  concurrency bug with a comment in front of it. HARNESS's `WorkspacePort` shares one PTY and one
  shell — a collision there is a shared-fate hang, not an absorbed edit.
- **The trading domain, the UTA broker abstraction, the five broker packs, the guardian runtime.**
  Irrelevant, and roughly half the repo.
- **`maxSteps` in config with no reader.** Dead config is a lie in a schema.

## 11. Citations

All paths relative to `github.com/TraderAlice/OpenAlice` @ `0114f78` (2026-08-11).

- `README.md` — product model, "runs the model loop inside that native runtime", local-first.
- `src/workspaces/cli-adapter.ts` — `CliAdapter`, spawn shapes, capabilities, credential rules.
- `src/workspaces/headless-task.ts` — one-shot runner; `headlessTaskStatus`; exit-as-done.
- `src/workspaces/schedule/scanner.ts` — ~60s tick, due-ness, dispatch, no per-ws lock.
- `src/workspaces/schedule/declaration.ts` — schedule snapshot projection, `fireBase`.
- `src/workspaces/issues/declaration.ts` — issue file schema, assignees, `parseIssueContent`.
- `src/workspaces/context-injector.ts` — persona + instruction + skills injection, no MCP.
- `src/core/tool-center.ts`, `src/server/local-tool-gateway.ts`, `src/server/mcp.ts` — tools.
- `src/core/inbox-store.ts`, `src/core/media-store.ts`, `src/core/entity-graph.ts` — artifacts, memory.
- `src/services/trading-mode.ts` — `lite|readonly|pro`.
- `default/persona.default.md`, `default/skills/{alice,alice-workspace,alice-uta,self-scheduling}/SKILL.md`.
- `src/workspaces/templates/{chat,auto-quant-v2}/template.json`, `templates/chat/files/instruction.md`.
- Voice: verified absent by repo-wide grep for whisper/speech/TTS/STT/wake-word.
