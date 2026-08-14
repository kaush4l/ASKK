# bolt.diy — prior-art study

Source read: shallow clone of `https://github.com/stackblitz-labs/bolt.diy` at commit
`2e254ac19a696394030601bc602f54945b12bfc4` ("feat: add web URL content fetcher for chat context",
2026-02-05). All line numbers below are from that commit.

## 1. What it is

bolt.diy is the community fork of bolt.new: a Remix/React app where an LLM writes a whole project
into **WebContainer** — StackBlitz's proprietary in-browser Node runtime — and a live preview iframe
serves the dev server from inside the tab. The differentiating trick is not the agent: it is the
**protocol**. The model emits one XML-ish `<boltArtifact>` block containing `<boltAction>` children;
a streaming parser fires callbacks on every tag boundary, so files are written to the FS and shell
commands are run *while the response is still being generated*. There is no server-side sandbox and
no per-user VM: everything but the LLM call runs in the tab. Alive but slow: 19.7k stars, not
archived, last push `2026-02-07`, and the commit before the Feb cluster was `2025-10-23` — i.e.
bursty maintenance, roughly two active days in four months.

## 2. The agent loop

There is **no multi-step agent loop for coding**. The coding path is single-shot: one LLM stream per
user turn, a parser that executes as it parses, and a human in the loop for the next turn. The only
real loop is (a) the AI-SDK `maxSteps` loop, which exists solely for MCP JSON tool-calls, and (b) a
"ran out of output tokens" continuation, capped at 2 segments.

```
POST /api/chat                                        # app/routes/api.chat.ts:42
  messages = mcp.processToolInvocations(messages)     # :102   resolve pending MCP approvals
  if files && contextOptimization:                    # :108
      summary       = createSummary(messages)         # :121   LLM call #1  (history → md summary)
      filteredFiles = selectContext(messages, files)  # :163   LLM call #2  (paths → ≤5 files)
      messageSliceId = len(messages) - 3              # :104-106  keep only last 3 messages
  result = streamText(...)                            # :310   LLM call #3  (the real one)
      options.maxSteps = maxLLMSteps                  # :214   default 5, MCP tools only
  onFinish(finishReason):                             # :221
      if finishReason == 'length' and switches < 2:   # :252   MAX_RESPONSE_SEGMENTS = 2
          push(assistant partial); push(CONTINUE_PROMPT); streamText(...) again   # :262-283
  # stream is piped to the client raw; nothing server-side reads the artifact tags

# client, per SSE chunk:
useMessageParser.parseMessages(messages)              # app/lib/hooks/useMessageParser.ts:60
  EnhancedStreamingMessageParser.parse(id, fullText)  # resumes at state.position
    onArtifactOpen  -> workbenchStore.addArtifact     # :11  opens the workbench panel
    onActionOpen    -> addAction (file only)          # :22
    onActionStream  -> runAction(data, isStreaming)   # :46  partial file content, sampled 100ms
    onActionClose   -> addAction (non-file) + runAction(data)   # :34-44
```

`CONTINUE_PROMPT` verbatim (`app/lib/common/prompts/prompts.ts:711`):

```
Continue your prior response. IMPORTANT: Immediately begin from where you left off without any
interruptions. Do not repeat any content, including artifact and action tags.
```

Verification, planning, and retry are all delegated to the user pressing a button (§6). Honest
summary: **stream + runner, not a loop.** Everything clever is in the protocol and the runner.

## 3. The artifact/action protocol — the high-value part

### Grammar (from the system prompt, `prompts.ts:333-356`)

```
4. Wrap the content in opening and closing `<boltArtifact>` tags. These tags contain more
   specific `<boltAction>` elements.
5. Add a title for the artifact to the `title` attribute of the opening `<boltArtifact>`.
6. Add a unique identifier to the `id` attribute ... kebab-case (e.g., "example-code-snippet").
8. For each `<boltAction>`, add a type ...
   - shell: For running shell commands.
     - When Using `npx`, ALWAYS provide the `--yes` flag.
     - ULTRA IMPORTANT: Do NOT run a dev command with shell action use start action
   - file: For writing new files or updating existing files ... add a `filePath` attribute ...
     All file paths MUST BE relative to the current working directory.
   - start: For starting a development server.
     - ULTRA IMPORTANT: do NOT re-run a dev server if files are updated.
```

Canonical instance (`prompts.ts:644-658`):

```xml
<boltArtifact id="snake-game" title="Snake Game in HTML and JavaScript">
  <boltAction type="file" filePath="package.json">{ "name": "snake", ... }</boltAction>
  <boltAction type="shell">npm install --save-dev vite</boltAction>
  <boltAction type="file" filePath="index.html">...</boltAction>
  <boltAction type="start">npm run dev</boltAction>
</boltArtifact>
```

Action types in code (`app/types/actions.ts:33`): `file | shell | start | build | supabase`
(`supabase` carries `operation="migration|query"`; `build` is emitted by the deploy path, not the
model). `type="bundled"` is reserved: *"CRITICAL: You must never use the 'bundled' type when
creating artifacts, This is non-negotiable and used internally only."* (`prompts.ts:43`) — it is
what snapshot restore uses (§8).

### The streaming parser

`app/lib/runtime/message-parser.ts` is a hand-written character scanner, not a regex or an XML
parser, because it must be **resumable over partial input**. Per message it keeps
`{position, insideArtifact, insideAction, currentAction, actionId}` (`:50-58`) and on every re-parse
resumes at `state.position` (`:99`), which the AI SDK makes cheap because it hands you the whole
accumulated text each tick.

The three cases that make execution-before-completion work:

1. **Action opens** — `indexOf('<boltAction', i)`, then `indexOf('>')`. If the closing `>` has not
   arrived yet, `break` and leave `position` where it was (`:224-226`). Otherwise attributes are
   pulled with `#extractAttribute` (`:383`, a per-attribute regex) and `onActionOpen` fires with
   `actionId: String(state.actionId++)` (`:219`).
2. **Action body still streaming** — `closeIndex === -1`. For `type="file"` only, it emits
   `onActionStream` with the *partial* content (`:190-199`) and then breaks **without advancing
   `position`**, so the next tick re-reads the same body from the start and re-emits the whole
   prefix. Non-file actions emit nothing here: a half-typed `npm inst` must never run.
3. **Action closes** — content is trimmed, markdown fences are stripped for non-`.md` files
   (`cleanoutMarkdownSyntax`, `:60`), `&lt;`/`&gt;` are un-escaped (`cleanEscapedTags`, `:73`), and
   `onActionClose` fires with `actionId: String(state.actionId - 1)` — decremented because open
   already incremented (`:167-172`).

Text outside artifacts is copied to `output` byte by byte (`:320`); the artifact itself is replaced
in the rendered markdown by a placeholder div `<div class="__boltArtifact__" data-message-id=...>`
(`:389-398`) which React later swaps for the live action-list component. A partial `<boltArt` at the
end of the buffer is detected and *not* emitted as text (`:312-314`) — no flicker of raw tags.

### Ordering guarantees in the runner

`ActionRunner` (`app/lib/runtime/action-runner.ts`) serialises everything through one promise chain:

```ts
this.#currentExecutionPromise = this.#currentExecutionPromise
  .then(() => this.#executeAction(actionId, isStreaming))
  .catch(...)                                            // action-runner.ts:138-144
```

with a second queue one level up in the store (`workbench.ts:53`, `addToExecutionQueue`). So
`package.json` → `npm install` → `src/App.jsx` → `npm run dev` execute in emission order even though
they arrived interleaved with text. Streaming file writes are rate-limited by
`actionStreamSampler = createSampler(..., 100)` (`workbench.ts:603`) and are marked
`executed: !isStreaming` (`:136`) so the final close still does the real write and save.

`type="start"` is deliberately **not** awaited: it is fired, `.then`-ed for status, and the runner
sleeps 2s and returns (`:188-220`), with the comment *"adding a delay to avoid any race condition
between 2 start actions / i am up for a better approach"*. That is the whole dev-server concurrency
story.

What this buys: the user sees files appear in the editor and `npm install` scrolling in the terminal
within ~2s of hitting send, on a response that takes 90s to finish. What it costs: an action that
turns out to be wrong has already run.

## 4. Context window

Assembled in `app/lib/.server/llm/stream-text.ts:152-220`, in order:

1. **System prompt** — `PromptLibrary.getPropmtFromLibrary(promptId || 'default')`, or
   `discussPrompt()` instead if `chatMode !== 'build'` (`:283`). The build prompt is ~700 lines
   (constraints, Supabase rules, artifact grammar, design instructions, mobile/Expo section, three
   worked examples).
2. **`CONTEXT BUFFER`** — `createFilesContext(contextFiles, true)` appended to the system string
   (`:165-175`). Files are rendered *as the same protocol*:
   `<boltArtifact id="code-content"><boltAction type="file" filePath="...">…</boltAction>…`
   (`utils.ts:88`). One vocabulary for input and output.
3. **`CHAT SUMMARY`** — the markdown summary, also appended to system (`:177-184`).
4. **Locked files** — *"The following files are locked and MUST NOT be modified"* (`:212-217`).
5. **Messages** — sliced to the last 3 (`api.chat.ts:104`, applied at `stream-text.ts:186-194`).

File selection is an LLM call, not a retriever (`select-context.ts:122-177`): the model is given all
non-ignored paths plus the current buffer and must answer only with
`<updateContextBuffer><includeFile path="…"/><excludeFile path="…"/></updateContextBuffer>`,
under *"context buffer is extremlly expensive… Only 5 files can be placed in the context buffer at a
time"* (`:167`). Malformed output throws (`:183`); selecting zero files throws
`Bolt failed to select files` (`:228`).

Compaction is a rolling summary into a **fixed template** (`create-summary.ts:104-161`) with
sections `Project Overview / Conversation Context / Implementation Status / Code Evolution
(incl. Failed Approaches) / Requirements / Critical Memory / Next Actions`. It is fed the previous
summary plus only the messages after the summary's `chatId` (`:82-92`) — incremental, not
re-summarising the world. Before summarising or selecting, assistant messages are shrunk by
`simplifyBoltActions`, which replaces every file body with `...` (`utils.ts:47-55`) — the file
*contents* never re-enter history, only the fact that a file was written.

User messages carry `[Model: x]\n\n[Provider: y]` headers that are regex-stripped server-side
(`utils.ts:16-42`), and user edits made in the editor are appended to the next user message as a
synthetic artifact (`Chat.client.tsx:512-516`, `filesToArtifacts`). `computeFileModifications` /
`fileModificationsToHTML` in `app/utils/diff.ts` (which picks diff-vs-whole-file by whichever is
smaller, `:38-44`) is dead code in this fork — inherited from bolt.new, no live caller.

## 5. Tools

Two disjoint mechanisms.

**XML-in-the-stream (the real tool surface).** The catalogue is exactly the five action types of §3:
`file`, `shell`, `start`, `build`, `supabase`. There is no read tool, no search tool, no list tool —
the model cannot look at the filesystem; the app pushes files into the prompt instead.

- Buys: actions stream, so partial file bodies render and execute progressively — impossible with a
  JSON tool-call, which is only valid once complete. No provider tool-calling support needed, so a
  weak local model works. File bodies need no JSON escaping (a 500-line React file inside a JSON
  string is a token tax and an escaping hazard). One artifact = one user-visible unit of work.
- Costs: no schema, no validation, no arity checking. Attribute extraction is
  `new RegExp(name + '="([^"]*)"')` (`message-parser.ts:384`) — a `"` in a filePath breaks it. A
  model that emits `<boltAction type="file">` with no `filePath` is only `logger.debug`'d (`:372`).
  Fenced code inside a file body must be heuristically unwrapped (`:60`). And because there is no
  result channel, **the model never sees its own tool output** unless the human pastes it back.

**MCP JSON tool-calls (bolt.diy addition).** `MCPService` (`app/lib/services/mcpService.ts`) mounts
stdio/SSE/streamable-HTTP servers, passes `tools: mcpService.toolsWithoutExecute` with
`toolChoice: 'auto'` and `maxSteps: maxLLMSteps` (default 5, `app/lib/stores/mcp.ts:13`). Tools are
declared *without* an execute fn so they suspend for human approval, resolved next turn by
`processToolInvocations`. This is the only place the loop is genuinely multi-step, and it is bolted
alongside — not underneath — the artifact protocol.

`EnhancedStreamingMessageParser` (`app/lib/runtime/enhanced-message-parser.ts`) is a safety net for
models that ignore the grammar: if a response contains no artifact, it heuristically wraps
` ```bash ` blocks as `<boltAction type="shell">` (`:498-517`) and filename-looking code blocks as
file actions (`:57-171`). Guessing intent from markdown is the load-bearing fallback for a
protocol with no schema.

## 6. Loop strategies — error recovery

There is no autonomous recovery. The chain is: fail → typed error → alert → **user clicks a
button** → the error text becomes the next user message.

1. **Pre-flight command rewriting** (`action-runner.ts:577-670`, `#validateShellCommand`) — before
   any shell action runs, the runner inspects it against the real FS:
   `rm x` where nothing exists → `rm -f x`; `cd nope` → `mkdir -p nope && cd nope`; `cp/mv` with a
   missing source → warn only. Deterministic repair of the three failures models cause most.
2. **Exit code** — `if (resp?.exitCode != 0)` (`:276`) → `#createEnhancedShellError` (`:672-758`)
   pattern-matches stderr into a titled, suggestion-bearing message, e.g.
   `` `The command '${firstWord}' is not available in WebContainer.\n\nSuggestion: ...` `` — then
   throws `ActionCommandError(title, output)` whose message is
   `` `Failed To Execute Shell Command: ${message}\n\nOutput:\n${output}` `` (`:43`).
3. **Alert** — the runner calls `onAlert` (`:238-243`), the store publishes to
   `workbenchStore.actionAlert` (`workbench.ts:492`) unless the message was replayed from history
   (`#reloadedMessages`, `:488` — restored chats do not re-alert).
4. **Preview errors** get the same treatment from the other end: WebContainer boots with
   `forwardPreviewErrors: true` and an injected inspector script, and
   `PREVIEW_UNCAUGHT_EXCEPTION` / `PREVIEW_UNHANDLED_REJECTION` become alerts carrying a cleaned
   stack (`app/lib/webcontainer/index.ts:29-56`).
5. **The auto-fix message** — `ChatAlert.tsx:72-76` renders "Ask Bolt", which posts:

```ts
postMessage(`*Fix this ${isPreview ? 'preview' : 'terminal'} error* \n\`\`\`${isPreview ? 'js' : 'sh'}\n${content}\n\`\`\`\n`)
```

That is the entire error→fix path: a formatted fenced block sent as a normal user turn. One click,
no automatic retry, no bounded repair budget, no verification that the fix worked.

Other retry-ish machinery: `StreamRecoveryManager` (45s inactivity timeout, `maxRetries: 2`) only
logs; `MAX_RESPONSE_SEGMENTS = 2` bounds token-exhaustion continuation; `api.chat.ts:349-382` maps
provider errors to human strings. Nothing re-runs an action.

## 7. Configuring a new agent

You cannot add an agent. You can choose among three hard-coded prompts, flip a mode, and configure
providers. `app/lib/common/prompt-library.ts:29-45`:

```ts
static library: Record<string, {label; description; get: (options: PromptOptions) => string}> = {
  default:   { label: 'Default Prompt',     description: 'An fine tuned prompt for better results and less token usage',
               get: (o) => getFineTunedPrompt(o.cwd, o.supabase, o.designScheme) },
  original:  { label: 'Old Default Prompt', description: 'The OG battle tested default system Prompt',
               get: (o) => getSystemPrompt(o.cwd, o.supabase, o.designScheme) },
  optimized: { label: 'Optimized Prompt (experimental)', description: 'An Experimental version of the prompt for lower token usage',
               get: (o) => optimized(o) },
};
```

A fourth prompt = a new `.ts` file plus an entry here plus a rebuild. `promptId` is a UI setting sent
in the request body (`Chat.client.tsx:139`).

Modes: `chatMode: 'discuss' | 'build'` (`Chat.client.tsx:116`). `discuss` swaps in `discussPrompt()`
wholesale (`stream-text.ts:283`) — a consultant persona forbidden from writing code: *"CRITICAL:
NEVER use phrases like 'I will implement' or 'I'll add'… When providing a plan, ALWAYS create ONLY
ONE SINGLE PLAN per response. The plan MUST start with a clear '## The Plan' heading"*
(`discuss-prompt.ts`). This is bolt.diy's plan/act split: two prompts, one flag.

Providers: `.env.example` keys per provider (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GITHUB_API_KEY`,
…) or, in the browser, API keys stored in the `apiKeys` cookie and parsed server-side
(`api.chat.ts:70-74`). Per-model completion caps live in `PROVIDER_COMPLETION_LIMITS`
(`constants.ts:12-31`), reasoning models are sniffed with `/^(o1|o3|gpt-5)/i` (`:38`) and get
`maxCompletionTokens` plus a filter that strips `temperature`, `topP`, penalties
(`stream-text.ts:241-257`).

## 8. Spaces and artifacts

**Filesystem.** WebContainer boots once per tab (`webcontainer/index.ts:26-31`) with
`coep: 'credentialless'`, `workdirName` = `project`; cwd is `/home/project`. Writes go through
`webcontainer.fs.writeFile` after `mkdir -p` of the parent (`action-runner.ts:311-338`); note both
are wrapped in try/catch that only logs — **a failed write does not fail the action**. The mirror
store `FilesStore` subscribes to `webcontainer.internal.watchPaths` with 100ms event buffering
(`files.ts:592-605`), so files created by `npm install` or by a running dev server show up in the UI
and, more importantly, in the `files` map posted with the next request.

**Shell.** One long-lived `/bin/jsh --osc` process is *the* agent shell (`utils/shell.ts:134`). Its
stdout is `tee`'d three ways (terminal / command-result reader / Expo-URL watcher, `:145-146`).
`executeCommand` (`:218-259`) sends `\x03` (Ctrl-C) to kill whatever is running, waits for the
`prompt` OSC, types `command + '\n'` into the *user-visible* terminal, then reads until the `exit`
OSC and parses the exit code out of `\x1b]654;exit=…`. The user's own terminals are separate
`jsh` processes (`terminal.ts:38-46`), but agent actions all share one shell — a `start` action's
dev server and the next `shell` action are one Ctrl-C apart.

**Preview.** `PreviewsStore` listens for the WebContainer `server-ready` event and exposes
`{port, ready, baseUrl}`; `Preview.tsx` points an iframe at `baseUrl`
(`https://<id>.local-credentialless.webcontainer-api.io`), with a `BroadcastChannel` to refresh
previews opened in other tabs and `postMessage` for the element inspector. The user-visible artifact
is the running app itself, plus the "Restored Project" file tree in the code view; deployment
(`type="build"` → Netlify/Vercel) is how it leaves the tab.

**Reload.** WebContainer's FS does not survive reload either. bolt.diy fixes this in the most
economical way available to it: after every assistant turn it snapshots `workbenchStore.files.get()`
into IndexedDB keyed by chat (`useChatHistory.ts:308`, `db.ts:316` store `snapshots`), and on load it
**synthesises an assistant message containing a `<boltArtifact type="bundled">` with one
`<boltAction type="file">` per snapshot file plus detected setup commands**, marks it
`annotations: ['no-store', 'hidden']`, and lets the ordinary parser+runner replay it into the fresh
container (`useChatHistory.ts:104-155`). Restore is the same code path as generation; there is no
second restore implementation. `setReloadedMessages` then suppresses alerts for replayed actions.
Also: `?rewindTo=<messageId>` truncates history and restores the snapshot at that point — time
travel for free, because state is a message.

## 9. What it gets RIGHT that HARNESS lacks

Ranked by value per unit of work.

1. **Execute-while-streaming, driven by a resumable parser.** (medium) HARNESS parses tool calls
   from a finished `LlmResponse`; the user waits out the whole generation before anything moves. Port
   the `{position, insideAction}` resume trick into `crates/context` or a new
   `crates/agent/src/stream.rs`: feed it the delta stream, emit `ActionOpen/ActionStream/ActionClose`
   effects, and let `crates/agent/src/step.rs` dispatch them into the existing tool path. The two
   rules that make it safe are both one-liners: only *file-shaped* actions may stream partial
   content, and `position` must not advance past an unclosed tag.
2. **Snapshot-as-replayable-message.** (small) HARNESS already has an append-only `EventLog` and a
   c2w workspace with no persistence across reload — exactly bolt.diy's problem, and it already has
   the better substrate. Emit a synthetic `Authored`/tool-call event carrying the file set and let
   the normal replay in `crates/core` rehydrate the workspace on boot; store the blob via
   `StorePort`. No second restore path, and `?rewindTo=` falls out of the projection for free.
3. **The `CONTEXT BUFFER` = same grammar as output.** (small) `crates/context/src/assemble.rs` should
   render injected file context in the *identical* syntax the model must produce for edits. Costs
   nothing, measurably improves format compliance on weak local models.
4. **Rolling summary into a fixed template with a `Failed Approaches` section.** (small)
   `crates/agent/src/window.rs` has `compact_at`/`keep_recent` but (unverified whether it templates
   the summary) — steal `create-summary.ts:104-161` verbatim as the compaction template, and steal
   `simplifyBoltActions`: never let a file body re-enter history, only the fact of the write.
5. **Pre-flight command repair.** (small) `#validateShellCommand` in
   `crates/agent/src/workspace.rs` or behind `WorkspacePort::exec`: `rm` without `-f` on missing
   paths, `cd` to a missing dir → `mkdir -p && cd`. Three rules, kills the most common self-inflicted
   nonzero exits, deterministic, testable on the host.
6. **Typed shell error with a suggestion, surfaced as one-click "fix this".** (small)
   `#createEnhancedShellError` maps stderr patterns to `{title, suggestion}`. HARNESS has typed
   errors (`crates/agent/src/error.rs`) and `crates/core/src/remedy.rs`; add the pattern table and
   render a remedy button in `crates/ui` that injects the formatted error as the next user turn.
   Cheaper and more honest than an auto-retry loop.
7. **Preview error forwarding.** (medium) bolt.diy injects a script into the preview and forwards
   uncaught exceptions/rejections back into the chat as alerts. HARNESS's equivalent is any
   process/iframe the workspace serves; an injected error hook reported over the PTY bridge into
   `crates/core/src/procwatch.rs` closes the "the app is broken but the agent doesn't know" gap.
8. **Two prompts, one `chatMode` flag, for plan-vs-build.** (small) HARNESS already has `agents/` +
   frontmatter; the point to steal is `discuss-prompt.ts`'s discipline — the plan prompt is *banned*
   from code snippets and must emit exactly one `## The Plan`. A `mode:` field in `agent.md` picking
   the prompt body beats a new agent folder per mode.
9. **A "locked files" clause in the system prompt.** (small) `stream-text.ts:208-217`. One line in
   `crates/context/src/assemble.rs`, fed from a per-space lock set. Prevents the model from
   rewriting the files the user is protecting.

## 10. What would be a MISTAKE to copy

- **The XML protocol's attribute parsing.** `new RegExp(name + '="([^"]*)"')` with no escaping rules,
  no validation, and `logger.debug` on a missing `filePath`. If HARNESS streams a tag grammar, the
  tag must be typed on the Rust side with a real error on malformed attributes — that is what
  I-invariant typed errors are for.
- **`EnhancedStreamingMessageParser` guessing artifacts from markdown.** 527 lines of heuristics
  (`_looksLikeShellCommand`, filename-pattern lists, `/^code_\d+\.(sh|bash|zsh)$/`) compensating for
  a protocol with no schema. Fix the protocol; do not build the guesser.
- **The whole-file-only rule.** *"WebContainer CANNOT execute diff or patch editing so always write
  your code in full no partial/diff update"* (`prompts.ts:37`) is a WebContainer limitation bolt.diy
  turned into a prompt law. HARNESS has a real shell and can apply patches; do not inherit the
  token cost of rewriting a 600-line file to change one import.
- **Two extra LLM calls on the critical path before the real one.** `createSummary` +
  `selectContext` run serially, on the same model, and `selectContext` *throws* if the model
  misformats or picks nothing (`select-context.ts:183`, `:228`). Latency plus two new failure modes,
  and the 5-file cap is a magic number in a prompt string.
- **`await new Promise(r => setTimeout(r, 2000))` as concurrency control** for `start` actions
  (`action-runner.ts:217`), and `abortAllActions() { /* TODO */ }` (`workbench.ts:460`). HARNESS
  already has `WorkspacePort::interrupt`; use it.
- **Swallowing FS errors.** `#runFileAction` logs and continues on both `mkdir` and `writeFile`
  failure (`:326-338`), so an action reports `complete` having written nothing.
- **One shared shell for every agent action, driven by typing into the user's terminal** with a
  Ctrl-C prelude. HARNESS already knows this failure mode ("one shell = shared fate"); bolt.diy is
  the cautionary example, not the model. Sub-agents in Web Workers need their own sessions.
- **MCP tool-calls bolted alongside a second, incompatible action protocol.** Two calling
  conventions, two result paths, one of which has no result path at all. Pick one.
- **A ~700-line system prompt with Expo, Supabase, and design-manifesto sections always resident.**
  bolt.diy's own "optimized"/"fine tuned" prompts exist because of it. HARNESS's `skills/` folder is
  the right answer; keep the base prompt small.

## 11. Citations

- Repo/liveness: `git log -1` → `2e254ac`, 2026-02-05; GitHub API `pushed_at` `2026-02-07T14:36:22Z`,
  `archived: false`, 19,744 stars, prior commit cluster `2025-10-23`.
- Loop: `app/routes/api.chat.ts:42,102,104-106,121,163,214,221,252,262-283,310`;
  `constants.ts:47`; `prompts.ts:711-714`.
- Grammar: `prompts.ts:43,312-392,618-708`; `new-prompt.ts:162-181`; `app/types/actions.ts:3-33`.
- Parser: `message-parser.ts:50-58,99,141-241,167-172,190-199,242-314,338-398`;
  `useMessageParser.ts:9-51`; `workbench.ts:53,468-510,525-604`.
- Runner: `action-runner.ts:37-64,115-149,151-248,188-220,250-280,311-338,376-478,577-670,672-758`.
- Context: `stream-text.ts:152-220,241-257,283`; `select-context.ts:122-177,183,228`;
  `create-summary.ts:76-92,104-188`; `llm/utils.ts:16-45,47-55,57-89`; dead diff `app/utils/diff.ts:17-52,101`.
- Tools/MCP: `mcpService.ts:23-72`; `stores/mcp.ts:13`;
  `enhanced-message-parser.ts:57-171,264,337-339,498-517`.
- Errors/alerts: `webcontainer/index.ts:26-56`; `ChatAlert.tsx:14-18,72-76`; `BaseChat.tsx:416-425`;
  `stream-recovery.ts` (45s/2 retries).
- Config: `prompt-library.ts:29-45`; `discuss-prompt.ts:6-24`; `.env.example`; `constants.ts:12-44`.
- Workspace/preview/persistence: `app/utils/shell.ts:132-177,218-259,268-320`;
  `stores/terminal.ts:10-46`; `stores/files.ts:592-605`; `Preview.tsx:56-124,379-380`;
  `useChatHistory.ts:66-155,200-215,308`; `persistence/db.ts:37,307-330`.
