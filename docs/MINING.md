# What the others do, and what we take

## The substrate decision

**Cross-origin isolation is available to a static page, and C1 is false as written.** A page
served by `python3 -m http.server` with no COOP, COEP or CORP on the wire reaches
`crossOriginIsolated === true`, gets `SharedArrayBuffer`, and runs a genuinely blocking
`Atomics.wait` — 252 ms in Chromium 140, 251 ms in WebKit 26.0, and 200 ms two worker hops deep,
which is the `page → backend worker → sandbox worker` shape this tree already has
(`ARCHITECTURE.md` realms diagram; `src/backend/AgentWorkerPool.js:38`). The page sets the headers
on itself through a service worker; the host never has to. The claim **survived** all three
refuters: one re-executed the whole experiment independently and reproduced every load-bearing
cell, one confirmed it at a `/ASKK/` subpath matching `next.config.js` `basePath`, and the one that
returned "REFUTED" refuted the *price list*, not the verdict — it caught that the probe measured
`GET api.openai.com/v1/models` instead of this app's real request, then ran the real one
(preflighted streaming `POST https://api.anthropic.com/v1/messages` with `x-api-key` +
`anthropic-dangerous-direct-browser-access`, the POST at
`src/core/inference/AnthropicCompatible.js:61-64` and the headers at `:109-113`) and
found it survives both COEP modes in both engines. **So one published sentence in that report is
wrong** — it says Anthropic fails for CORS reasons; the preflight actually returns 200 with
`access-control-allow-origin: *` once the browser-access header is included. The price is real and
itemised: one forced extra navigation on first visit, isolation lost on a service-worker-bypassing
hard reload, `credentialless` ignored by WebKit so Safari must be sent `require-corp` or it
reload-loops, and every cross-origin `no-cors` subresource without CORP dies (this tree loads
none — its entire cross-origin surface is three fetched hosts). **A pty has since been booted** and
the experiment now lives in the tree at `scripts/probe/`, one command, with its results committed
under `scripts/probe/results/`. **What is still not measured:** nobody ran it on
`https://kaush4l.github.io/ASKK/` or on an iPhone or on Safari.app or on Firefox; nobody tested
`COOP: same-origin` against a popup/OAuth flow; and no probe has loaded this tree's own built app,
so `C2wSandbox.available` has never been observed to be anything but `false`.

The recommended substrate does not depend on any of that. **Delete the emulator from the critical
path and run compiled tools directly in the backend worker over an OPFS filesystem.** Of nineteen
candidate wasm binaries measured, exactly one declares shared memory, so esbuild-wasm,
`typescript@5.9.3`, `@biomejs/wasm-web`, Pyodide 3.14.2 with real `pytest`, `@astral-sh/ruff-wasm-web`,
`isomorphic-git`, and wa-sqlite's `AccessHandlePoolVFS` all ran to real results with
`SharedArrayBuffer === undefined` — cross-origin isolation is an option we now have, not a
prerequisite. That stack gzips to roughly 27.2 MB, lazily, against the 40,064,757 gzipped bytes one
`ls` pays today (`ARCHITECTURE.md`, ship profile), and it dissolves rather than improves all three
limits the owner named: no 1024-byte command line because there is no command line
(`src/backend/sandbox/C2wSandbox.js:18`), no filesystem death because OPFS is the filesystem
(408 MB/s measured through one sync access handle, 8 GB quota reported), no ~100x because the tools
are compiled instead of emulated. Keep `public/sandbox/sandbox.wasm` — it is the only thing measured
anywhere that runs unmodified binaries without isolation — but demote it from *the environment* to
one lazily-loaded tool for shell-shaped tasks. Two things do not come back and must be said out
loud: there is no browser answer for a native compiler toolchain, and `git push` to github.com is
CORS-blocked (measured `Failed to fetch`), leaving `api.github.com` (ACAO `*`) as the only
server-free write path. Isolation is then held in reserve for the two things it alone buys —
threaded ORT for local weights (`CAPABILITIES.md`, *Finding things out*, local-model-weights row)
and a real pty later — not spent up front.

## Five harnesses, side by side

| | agent-zero | elizaOS | pi | bolt.diy | deepseek-harness |
|---|---|---|---|---|---|
| **1 Environment** | pty on host bash, Kali + supervisord `tty_session.py:259` | `child_process.spawn`, 3 sandbox modes `shell-execution-router.ts:493` | host `spawn('/bin/bash')` behind one seam `env/nodejs.ts:145` (`spawn`), `:230` (`/bin/bash`), the seam at `harness/types.ts:315` | WebContainer in-tab `webcontainer/index.ts:21`, commercial licence `README.md:515` (the COI requirement is WebContainer's, uncited in their tree) | `spawn` at `spawn.ts:350`; Landlock/Seatbelt/bwrap backends live behind a separate seam (`packages/README.md:44`) |
| **2 Loop selection** | none; one `while(true)`, no cap `agent.py:391` | two-stage router, `simple` skips planner `packages/core/src/runtime/message-handler.ts:366-372` | none; one loop, doctrine `docs/usage.md:309` | human toggles discuss/build `stream-text.ts:283` | none; strategies are tools, human-gated `packages/workflow/tool-ralph/README.md:12` |
| **3 Sub-agents** | new `Agent` in the same process `call_subordinate.py:158` | separate ACP process, depth capped at one `acp.ts:18` | fresh `pi` process, `--no-session` `subagent/index.ts:300` | none; `grep subagent` returns zero | child composed from its parent, tools restricted `child-agent.ts:199`, `:217` |
| **4 Improve-till-passes** | none; prose plus a skill rubric `skills/a0-review-plugin/SKILL.md` | runtime refuses to finish unverified edits `planner-loop.ts:4101` | none; fixed three-step prompt chain `implement-and-review.md` | none; a human clicks "Ask Bolt" `ChatAlert.tsx:71-87` | Ralph rounds; worker self-certifies `tool-ralph/src/index.ts:151` |
| **5 MCP** | client and server, both stateless-per-call `mcp_handler.py:1332` | client only, spawn allowlist `mcp-server-config.ts:32` | none shipped, by stated policy `docs/usage.md:309` | clients server-side, executors stripped `mcpService.ts:219` | client only, stdio + streamable-http `packages/mcp/mcp-client/src/transport.ts:31` |
| **6 Long-running** | 60 s tick, cron JSON; run dies on restart `job_loop.py:10,34` | 1 s tick, daemon or serverless `task.ts:76` | none; JSONL tree with lanes and fork `session/types.ts:359` | none; snapshot keyed to message id `useChatHistory.ts:308` | JSONL log; overdue until a session resumes `packages/schedule/schedule/README.md:12` |
| **7 Context window** | ~8,000 tok system, six-bucket live audit `usage.py:12` `USAGE_KEYS` | stable/dynamic split is physical `context-renderer.ts:92-100` | ~1,320 tok floor (measured, no line); the only per-turn hook is an optional `transformContext` `agent-loop.ts:286-290` | files whole both ways, cache broken by block 2 `utils.ts:57` | ~18,170 tok in both mode; snapshots committed `snapshots/session/both-mode-turn` |
| **8 What a human sees** | ACE editor, typed log switch, no cost `webui/js/messages.js:146` | trajectory inspector, real `cost_usd` `trajectories/pricing.ts` | a hand-written TUI, no file tree `packages/tui/` | CodeMirror 6 + xterm + jsdiff `CodeMirrorEditor.tsx` | slot-registered tool views, no editor, no cost `client/ui-tool` |
| **9 The one thing** | extensions as a sorted directory of files `extension.py:347` | verification refusal `planner-loop.ts:4101` | `ExecutionEnv` seam + browser-smoke CI `harness/types.ts:315` | stream file writes mid-token `action-runner.ts:132` | change-only runtime snapshot `runtime-context.ts` |

## What is worth stealing

**1. A successful edit that no passing check follows refuses to end the turn** — elizaOS
`codingMutationRequiresVerification`, `planner-loop.ts:4101`, which synthesises a failing verdict,
clears the plan queue, and regex-classifies the model's own shell command into test/typecheck/lint/build
(`:4310`) so `grep` cannot be passed off as proof (`:4351`).
**Here** — `src/core/engine/ReActEngine.js:116` (`while (true)`) and `:235` (`observe`), plus a gate object
built where the agent is, `src/backend/services/ChatService.js:127` (`buildAgent`).
**Cost** — extra turns and tokens on every write; a repair budget and a no-progress check are
mandatory or a failing project loops forever. The loop is no longer unbounded — `Budget` closes it
at `ReActEngine.js:127` (`if (budget.closing)`) and the repeat-detector at `:203-207` informs rather than stops — but neither
counts repairs, so a failing check can still consume a whole budget.

**2. Quarantine every host dependency behind `FileSystem` + `Shell` and enforce it with a build that
fails on a leaked import** — pi `packages/agent/src/harness/types.ts:315`, one implementation file
`env/nodejs.ts`, gated by `scripts/check-browser-smoke.mjs` which esbuilds for `platform:"browser"`.
**Here** — `src/core/sandbox/Sandbox.js:30` grows a filesystem half; `src/backend/sandbox/C2wSandbox.js`
becomes one implementation beside an OPFS one; a check script joins `scripts/`.
**Cost** — a port rewrite, and the check is a new gate that will fail builds; the compensation is
that it is the only mechanism cited anywhere that would have caught this tree's eight
declared-but-never-wired capabilities (`CAPABILITIES.md`, rule 1).

**3. Iterate by fresh child per round with a bounded handoff, the workspace as the only memory** —
deepseek `packages/workflow/tool-ralph/src/index.ts:151` (the fresh-agent round loop), with a
schema-validated report (`:92-98`) capped at 16,384 characters (`:26`), and `complete` requiring
evidence, zero `nextSteps` and an empty blocker or the round throws (`:129-131`).
**Here** — `src/backend/agentWorker.js` (already stateless by design, `:68-73`),
`src/backend/AgentWorkerPool.js:38`, and a strategy tool registered in `src/core/tools/index.js:24` (`BUILTIN_TOOLS`).
**Cost** — every round re-reads the workspace, so it is only affordable once the filesystem persists;
and taken alone it certifies nothing, which is why it is ranked below idea 1 rather than beside it.

**4. Run the MCP server in a worker and speak JSON-RPC over a transferred `MessagePort`** — the
official SDK's `InMemoryTransport.createLinkedPair()` (`packages/core-internal/src/util/inMemory.ts:29`,
the class at `:16`) and `@mcp-b/transports` `TabServerTransport.ts:12`, which listens for
`MessageEvent` and answers through `postMcpMessage` (`:3`, `:38`) — both against the unmodified
`Transport` interface, which the spec explicitly permits
(`2026-07-28/basic/transports/index.mdx:60`, "Custom Transports").
**Here** — a new `src/core/mcp/PortTransport.js`; `src/core/mcp/discover.js:29` becomes three-way;
`src/core/mcp/SandboxTransport.js` is deleted whole; `src/protocol/Envelope.js:116` gains a name.
**Cost** — a dedicated worker is a thread, not a sandbox: a server we did not write runs with full
origin authority over the plaintext keys at `src/backend/services/SettingsService.js:24` (`apiKey`), so we
delete the only isolation we had, and 0 of the 7 reference servers port unmodified.

**5. Make a sub-agent's tool set a required parameter of its construction, with inheritance declared
**Make a child's composition source a required parameter of its construction** — deepseek
`packages/subagent/subagent/src/child-agent.ts:199`, `applyChildComposition(childCtx, parent,
composition)`, calling `composeFrom(childCtx, parent.ctx)` at `:204` and
`childCtx.tools.restrict(...)` at `:217`, with a comment at `:190-194` naming our exact defect: a
child composed without the join "sees an empty tool registry". Two things the previous draft said
about this are withdrawn — the tool *filter* is optional (`ChildComposition.toolFilter?`, `:163`),
and `inheritsParentContext` is not a tool-inheritance switch: their own note says it "describes
conversation seeding, not scope, services, tools, or authority". What is required is the *parent*.
Plus pi's per-agent `--tools` list from frontmatter (`subagent/index.ts:307`).
**Here** — `src/backend/agentWorker.js:59` (`tools: []`), `src/core/agent/AgentFile.js`,
`src/backend/services/ChatService.js:116` where `peers` is computed.
**Cost** — the depth limit currently enforced by giving sub-agents nothing (`agentWorker.js:9-12`)
must be re-stated explicitly, or nested workers become a fork bomb; and a sub-agent with `shell`
doubles the environment's concurrency demands.

**6. Route the turn with a cheap first call, then override the model's own vote deterministically** —
elizaOS `packages/core/src/runtime/message-handler.ts:366-372` (`simple` is the shortcut marker and
Stage 1 owns the reply) with structural overrides, including a text-shape check that promotes a bare
acknowledgement into the planner (`:460-462`) — added after a production regression their own
comment records verbatim, a turn classified `contexts=["simple"]` where "user got the ack and
nothing else" (`:450-459`). The previous draft cited `:374` for that regression; `:374` is the
*other* override, for the `simple + candidateActions` contradiction.
**Here** — `src/core/engine/index.js` (loop selection is currently a subclass choice per agent file),
`src/core/agent/AgentSpec.js`, `src/core/response/ReActResponse.js`.
**Cost** — a whole extra model call per turn on the simple path it exists to make cheap; and it is a
binary, not the difficulty grading the owner asked for, so it is a floor rather than the answer.

**7. Key a filesystem snapshot to a message id, and rewind both together** — bolt.diy
`useChatHistory.ts:308`
(`takeSnapshot(messages[messages.length - 1].id, workbenchStore.files.get(), _urlId, chatSummary)`)
with `?rewindTo=<messageId>` reconstructing transcript and files as of that message (`:79-82`).
**Here** — `src/backend/repositories/IndexedDbRepository.js`,
`src/backend/services/ConversationService.js`, `src/backend/composition.js:18-19` (a third store).
**Cost** — bytes per turn proportional to the project, on the same evicted quota as the conversation
(`CAPABILITIES.md` storage-pressure row: zero `navigator.storage` calls in tree); needs a diffing
store or it will fill 8 GB.

**8. Cancel cooperatively, then terminate the thread** — the MCP spec's own escalation for
channel-shaped transports (`2026-07-28/basic/patterns/cancellation.mdx:42`: "**stdio**: There is no
per-request stream to close. The client **MUST** send a `notifications/cancelled` message"), which
maps onto `worker.terminate()`; deepseek's background jobs push completion in-session rather than
polling (`packages/jobs/`).
**Here** — the cooperative half has since landed: `src/client/BackendClient.js:124` sends `CANCEL`
by id and `src/backend/Kernel.js:90` holds the controller. What is missing is the escalation —
`src/backend/AgentWorkerPool.js:124` `terminate()` has no caller, and `:54` is where a dead thread
is already handled.
**Cost** — terminate loses everything in flight in that worker, including a partially written file,
which is exactly why it must be the second step and not the first.

## What would be a mistake to copy

- **agent-zero's environment** — `pty.openpty()` per session integer behind supervisord running
  sshd, cron and searxng (`tty_session.py:259`, `docker/run/fs/etc/supervisor/conf.d/supervisord.conf`):
  every component is a daemon or an installed binary, and our c2w guest is already a worse copy of
  the same shape, so chasing it is how a static page acquires a `docker compose up`.
- **elizaOS's ~5,000 tokens of hand-written policy prose on every call** (`messageHandlerTemplate`
  is 19,289 characters, measured, at `packages/prompts/src/index.ts:681`; `current_turn_boundary` at
  `packages/core/src/services/message.ts:4263-4264`; `MANDATORY_PLANNER_POLICY` at
  `planner-loop.ts:2189`) — on a BYOK phone paying full price for an uncached prefix it would cost
  more per turn than everything the agent knows, and their own
  `packages/core/src/runtime/message-handler.ts:450-459` records that the sentences failed and the
  structural gate worked.
- **deepseek's "both" tool presentation** — 35,991 B system plus 36,675 B schemas, ~18,170 tokens of
  the same 30 tools rendered twice before a word of conversation (`snapshots/session/both-mode-turn`):
  we have three built-in tools in `src/core/tools/index.js:24-31` and a remote model over a metered link.
- **bolt.diy's whole-file rewriting as the only edit primitive** — *"always write your code in full
  no partial/diff update"* (`prompts.ts:37`) with `createFilesContext` shipping every context file
  entire each turn (`utils.ts:57`): a critique-and-improve loop pays that cost in both directions on
  every iteration, and it grows with exactly the thing we are trying to grow.
- **bolt.diy's context selector as an unguarded critical path** — `select-context.ts:183` throws
  `Invalid response. Please follow the response format` and `:228` throws `Bolt failed to select
  files`, so a slightly off-format reply kills the turn: the same class of defect as our
  declared-but-never-emitted events, and the opposite of `src/core/response/BaseResponse.js`, which
  never throws a reply away.

## What nobody has solved

- **MCP with both server and client inside the browser.** None of the five does it: agent-zero's
  `MCPClientLocal` is `which()` plus a spawn (`mcp_handler.py:1530` the class, `:1551` the `which`,
  `:1570` the `stdio_client`), elizaOS and deepseek ship clients only, bolt.diy runs its clients on
  a Cloudflare function (`api.chat.ts:87`), pi ships zero
  MCP by policy (`docs/usage.md:309`: "It intentionally does not include built-in MCP, sub-agents,
  permission popups, plan mode, to-dos, or background bash" — and argues we should not want it,
  which I do not believe, because
  the SDK's own `InMemoryTransport` already runs both ends in one realm and pi's position is an
  opinion against a measurement). **Not first-because-hard:** `@mcp-b/transports` shipped it over
  `window.postMessage` a year ago. Only the worker-to-worker `MessagePort` shape is unprecedented,
  and its risk is mechanical — nested workers — not conceptual.
- **Scheduled work and cron with no daemon.** deepseek has a whole host process and *still* chose
  our semantics: "a closed or cold session keeps it overdue until a future live root agent resumes
  the session" (`packages/schedule/schedule/README.md:12`). **This contradicts our own ledger** —
  `CAPABILITIES.md` files scheduled work as `barred` under C3, and C3 bars the daemon, not the
  feature. Catch-up-on-open is `absent`, not `barred`, and is not hard.
- **An agent that picks its loop by how hard the task is.** elizaOS has the only router and it is
  binary (`packages/core/src/runtime/message-handler.ts:366-372`); deepseek's named strategies are
  gated on a human asking
  (`snapshots/session/both-mode-turn/system-prompt.expected.md:26`); the other three have one loop.
  **First-because-hard** — nobody has a difficulty signal that is not itself a model call.
- **An acceptance test somebody other than the agent wrote.** elizaOS enforces only that *a* check
  of the right family exited 0; deepseek's Ralph accepts the worker's own `status: complete`
  (`packages/workflow/tool-ralph/README.md:12`: "completion and blockers are worker reports, not
  independent certification"). **First-because-hard**, and it is the load-bearing half of
  write → critique → apply a standard → improve until it passes.
- **Nested sub-agents with a warm environment.** elizaOS forbids depth beyond one by subtracting the
  orchestrator plugin (`acp.ts:18`); pi and deepseek get isolation from fresh processes, which we
  cannot afford because our child's environment is a wasm compile. Our module workers are a stronger
  boundary than deepseek's in-process cordis scope, so we are behind on composition, not isolation —
  and `ARCHITECTURE.md:312` ("Verified: nested module workers") and `CAPABILITIES.md`'s *Structure*
  table (`AgentWorkerPool.js:38` "never reached") **contradict each other**; I believe the ledger,
  because `ChatService.js:116` computes `peers` from a roster of one.
- **A real environment with no container and no licence.** bolt.diy's WebContainer needs a
  commercial licence for commercial use (`README.md:515`), plus the isolation and Chromium
  requirements WebContainer documents and their tree does not; the other four assume a host. The
  compiled-tools-on-OPFS stack is nobody's design and would be ours. **First-because-nobody-needed-it** —
  every reference had a machine.
- **Not unsolved, and should stop being listed as ambition:** live tool-call and progress views
  (elizaOS `task-activity-store.ts`, deepseek `client/ui-trajectory`, bolt.diy
  `ProgressCompilation.tsx`), CodeMirror 6 file viewing (bolt.diy `CodeMirrorEditor.tsx`), diffs
  (bolt.diy `DiffView.tsx`), per-call cost (elizaOS `trajectories/pricing.ts`), and text-to-speech,
  which we already ship three engines of (`ARCHITECTURE.md`, Speech).

One correction this reading forced on our own documents, now applied there: an earlier draft of
`CAPABILITIES.md` said `HttpTransport` has no caller, but `src/core/mcp/discover.js:29-30`
constructs it whenever a server declares `url` (`McpConfig.js:51-52` derives `remote` from exactly
that). The dead thing is the configuration, not the code — and roughly 23% of a random
200-endpoint sample of the MCP registry's 4,381 hosted `streamable-http` servers answered a CORS
preflight from our origin, which is about a thousand servers reachable today through a file we
already have.
