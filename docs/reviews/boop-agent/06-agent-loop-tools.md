# 06 — Agent loop, tools & safety

Scope: loop shape, tool contract, safety model, and their browser mapping.
Siblings: lifetime/where-it-runs (`01`), state schema (`02`), transport
(`04`). Source: boop-agent clone, cites are `file:line`.

## 1. Loop shape: dispatcher/executor

Boop splits every turn into two agent roles:

- **Interaction agent (dispatcher)** — one run per user turn
  (`server/interaction-agent.ts:319`). Loads only the last 10 turns of
  history (`interaction-agent.ts:341-347`). Its system prompt opens with
  "You are a DISPATCHER, not a doer" (`interaction-agent.ts:30`) and its
  tool surface is a hard whitelist: memory recall/write, spawn_agent,
  automation CRUD, draft list/send/reject, send_ack, and self-config
  tools (`interaction-agent.ts:531-554`). Web/file/shell built-ins are
  explicitly blocked belt-and-suspenders via `disallowedTools:
  [WebSearch, WebFetch, Bash, Read, Write, Edit, Glob, Grep, Agent,
  Skill]` (`interaction-agent.ts:558-569`). The prompt forbids answering
  factual questions from training data — "if the user asks for
  information … spawn_agent. No exceptions" (`interaction-agent.ts:45-59`)
  — and makes `recall()` mandatory before any claim about the user,
  including negative claims (`interaction-agent.ts:73-89`).
- **Execution agent (executor)** — ephemeral per-task worker spawned via
  `spawnExecutionAgent` (`server/execution-agent.ts:125`). It receives a
  crisp task string, not the conversation; only the *named* integrations
  are loaded for that spawn (`execution-agent.ts:156-175`), each backed
  by a per-spawn Composio session scoped to exactly one toolkit
  (`server/composio.ts:579-587`) — tens of tools in context instead of
  the 1000+ toolkit catalog (`composio.ts:22`). Every text chunk, tool
  use, and tool result is appended to `agentLogs` in Convex
  (`execution-agent.ts:196-225`), and the run is cancellable via an
  `AbortController` registry (`execution-agent.ts:15,279-284`).

Both roles run through the same runtime seam: `runAgentRuntime` switches
Claude SDK vs Codex (`server/runtimes/index.ts:15-20`), with
`RuntimeMode = "dispatcher" | "execution" | "background"`
(`server/runtimes/types.ts:6`).

**Why this works.** Three diets at once:

- *Context diet* — the dispatcher never sees tool spam; the executor
  never sees chat history. Each context stays small and on-topic.
- *Tool-count diet* — the dispatcher has ~20 tools total; the executor
  gets one toolkit's worth. Tool-choice accuracy degrades with tool
  count; this keeps both sides in the reliable range.
- *Blast-radius control* — the only path from "user said something" to
  "something touched the world" runs through an explicit spawn with an
  explicit integration list, logged per-call.

**Where it is fragile.**

- *The dispatcher gates everything.* Routing quality, ack quality, draft
  matching, memory hygiene all hang off one prompt-disciplined model
  call. The empty-reply fallback (`interaction-agent.ts:594-601`) is
  evidence the seam is real: the model does sometimes lose the thread
  mid-tool-cycle. A bad dispatcher turn silently swallows an executor's
  good result.
- *Fire-and-forget extraction loses memories on crash.* Post-turn memory
  extraction is deliberately not awaited (`interaction-agent.ts:642-651`)
  and its only failure handling is `console.error`
  (`server/memory/extract.ts:141-143`). Process death between reply and
  extraction drops the turn's durable facts with no retry queue.
- *`bypassPermissions` on every run.* The Claude runtime sets
  `permissionMode: "bypassPermissions"` unconditionally
  (`server/runtimes/claude.ts:86`) — for dispatcher, executor, and
  background extraction alike. The safety story is entirely
  allowlist + prompt + draft gate; there is no per-call human approval
  layer underneath. Trust-the-draft-gate is the whole model.

## 2. The draft-before-send gate — the pattern to keep verbatim

Side-effects are **data rows, not actions**. The executor's system prompt
is blunt: "Anything that sends a message, creates an event, or takes an
external action: call save_draft … Only the interaction agent's
send_draft tool commits. You never commit"
(`execution-agent.ts:104-106`). `save_draft` writes `{draftId, kind,
summary, payload}` to Convex (`server/draft-tools.ts:30-43`); release is
a separate tool on the *dispatcher's* surface — `send_draft` flips the
row to `sent` and spawns a fresh executor whose task is "execute this
approved draft" from the stored payload (`draft-tools.ts:82-103`);
`reject_draft` cancels (`draft-tools.ts:106-118`). The dispatcher prompt
routes any user confirmation intent through `list_drafts` first
(`interaction-agent.ts:137-151`).

This is the single most portable idea in boop. It has no runtime
dependency at all: a draft is a row in a table plus a discipline about
which agent holds the release tool. It survives any transport, any
model, any host — including a browser. Keep it verbatim in any ASKK
adoption; it is also exactly the two-click-arm pattern ASKK already uses
for destructive UI actions (clear-chat).

One real wart to not copy: `send_draft` marks the draft `sent` *before*
spawning the executor (`draft-tools.ts:87-95`), so an execution failure
leaves a draft claiming "sent" that never went out. Status should follow
the executor's result, not precede it.

## 3. Browser mapping of the loop

Strip the Node packaging and the loop is: assemble prompt → POST to an
LLM API → parse tool calls → run local handlers → repeat → post-process.
That is fetch calls plus JS orchestration — fully browser-portable once
transport is solved (see `04-transport.md` for the streaming/proxy
story). Two candidate homes in the ASKK stack:

| | (a) Plain-JS loop in a Worker/SW | (b) Python agent inside the c2w guest VM |
|---|---|---|
| Precedent | ASKK's pre-rewrite Rust/WASM frontend ran a full in-browser ReAct loop — tools-as-text, one assembled prompt string per call | The current hermes gateway's in-process python agents (session.create + prompt.submit RPC, proven without node) |
| Startup cost | ~0 — a Worker spawns in ms; SW is already resident | Seconds-to-minutes: wasm chunk fetch + VM boot to `READY`; amortized only if the VM is already up |
| Tool surface | Everything the page can do: fetch, IndexedDB/OPFS, DOM/capability senses | Everything a POSIX userland can do: real python, files, pipes, shelf binaries — but network only via the SW relay |
| Debuggability | DevTools-native: breakpoints, network tab, console | Guest-side: boot markers, serial console, ingress logs — a full hop removed |
| Memory access | Direct: same IndexedDB/OPFS the UI reads | Indirect: guest must round-trip through ingress to reach browser-side stores, or keep a guest-local copy needing sync |

Verdict for ASKK: **(a) is the default home for the dispatcher and most
executors** — the dispatcher especially is latency-sensitive and
tool-light, the worst possible fit for a VM boot. Reserve (b) for
executors whose task genuinely needs a POSIX userland (run code, use a
shelf toolchain), i.e. the VM is one *tool* an executor can hold, not
the loop's home.

## 4. Tool system, browser-mapped

Boop's tool contract is already MCP-shaped: `RuntimeTool {namespace,
name, description, inputSchema, jsonSchema, handle}`
(`runtimes/types.ts:15-22`), defined once and adapted per runtime — an
SDK MCP server for Claude (`runtimes/claude.ts:32-53`), dynamic tools
for Codex. The browser translation is mechanical:

- `handle` becomes a browser function: a `fetch` to an external API, an
  IndexedDB/OPFS operation, or an in-page capability (ASKK's
  features-lab senses — camera, mic, screen, geolocation — are exactly
  this shape already).
- Per-spawn scoping carries over unchanged: build the executor's tool
  array from the named integrations at spawn time, same as
  `buildRuntimeToolsForIntegrations` (`execution-agent.ts:161-164`).
  The scoping is a list you construct, not a process boundary you need.
- **No child processes.** `spawn_agent`
  (`interaction-agent.ts:470-521`) becomes "instantiate a new loop
  object" — in a fresh Worker if you want isolation and parallelism, or
  same-thread if you don't. The `running` Map + AbortController pattern
  (`execution-agent.ts:15`) ports as-is; `AbortController` is a browser
  primitive.
- Composio-style hosted tool catalogs remain reachable (they are HTTPS
  APIs), but every call now spends a user-grade key from the browser —
  which is a safety question, not a tool-contract question:

## 5. Safety and secrets in the browser

- **BYOK keys in local storage are the new perimeter.** The server kept
  `COMPOSIO_API_KEY` etc. in env; a browser-only ASKK build keeps them
  in IndexedDB/localStorage, where any XSS is key theft. Mitigations,
  in order of value: no third-party scripts at all (ASKK's docs/ page is
  already plain ES2022, no CDN), a strict CSP with pinned `connect-src`,
  one key per service so a leak is partial, and optional passphrase
  encryption at rest (WebCrypto) accepting that the key is plaintext in
  memory while unlocked.
- **No inbound events, so no inbound-auth surface.** Boop verifies HMAC
  on Composio/Sendblue webhooks; a browser has no listening socket, so
  the whole inbound-verification class disappears. The replacement is
  polling/SSE the page initiates — covered in `04`; the safety delta
  here is strictly a reduction.
- **The draft gate matters MORE, not less.** A server can be firewalled,
  rate-limited, and given narrow service credentials. The browser agent
  acts with the user's own OAuth tokens and keys — full user-grade
  authority. Section 2's gate is then the only thing between a
  misrouted executor turn and a real email sent as the user. Do not
  weaken it for convenience; consider widening it (drafts for *all*
  mutating calls, not just messaging/calendar).
- **Append-only logs stay.** `agentLogs`-style per-call records
  (`execution-agent.ts:210-217`) into IndexedDB give the same
  after-the-fact audit trail; boop's habit of redacting sensitive tool
  input before logging (`execution-agent.ts:55-62`) ports verbatim.

## 6. Verdict

Keep: dispatcher/executor split, draft-before-send as data rows with a
dispatcher-held release tool, per-spawn tool scoping, mandatory-recall
prompt discipline, append-only per-call logs, AbortController
cancellation. Fix in passing: draft status should trail execution, and
extraction needs a durable queue instead of fire-and-forget. Replace:
the runtime layer (Claude SDK / Codex processes) with plain fetch
transports (`04`), and process spawning with Worker/loop instantiation.
The agent code itself — prompts, tool definitions, draft/memory/log
schemas — is the most portable part of boop: it is strings, JSON
schemas, and rows, none of which care where they run.
