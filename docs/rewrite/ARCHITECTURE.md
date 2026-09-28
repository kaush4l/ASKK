# ASKK architecture: seven contracts

Updated 2026-09-28. This describes the current rewrite and its intended boundaries. [Implementation status](IMPLEMENTATION-STATUS.md) separates tested behavior from remaining release gates. [Remote reconciliation](REMOTE-RECONCILIATION.md) preserves behavior added after the rewrite's local ancestor.

ASKK is a browser-owned agent harness with a Next.js static-export workbench. Agent decisions run in dedicated Web Workers. Files and commands use an explicitly selected adapter: a persistent container2wasm Linux guest in the browser, or an optional Bun companion on the owner's machine. The browser Linux image has compiled and passed native guest probes, but its complete browser handshake and cross-browser acceptance are still pending. A native guest test is not a browser runtime test.

The implementation uses JavaScript/JSX, Next 16.3.6, React 19.3.0, CodeMirror 6, and xterm.js. Bun runs development, build, test, and companion commands. **Bun is not the browser guest runtime**: the guest image contains Linux ARM64 and Node 24/npm. xterm.js renders terminal output; it does not execute commands.

## 1. Contract boundaries and lifecycle

These are logical contracts with concrete owners, not seven mandatory base classes. Higher layers consume published records instead of reading private state or interpreting terminal text.

| Layer | Owner and structure | Lifecycle / contract to the next layer |
| --- | --- | --- |
| 1. Kernel | `src/core/engine.js`, `responses.js`, `calls.js`: loop state, history, inbox, response contract, progress. | Construct → invoke → assemble → infer → validate → act/observe → finish. Nudges enter the inbox; events expose measured progress. |
| 2. Strategies | Engine limits, response stages, agent role definitions, resident or fresh workers. | A long-running agent and delegated roles use one protocol; calls in a stage run together and stages run in order. A general strategy DSL is not implemented. |
| 3. Composition | `folder.js`, `prompt.js`, `context.js`, `public/agents/**/agent.md`, templates and model catalogue: hashed `AgentSpec`. | Discover → resolve settings/grants/templates → compose each prompt → construct or replace a worker. Instructions are configuration; parsing and enforcement remain code. |
| 4. Capabilities | Built-in tools, permissions, MCP, workspace contracts, execution adapters, files, companion, browser guest. | Advertise → validate authority → invoke with binding/signal/call ID → return a receipt. Workspace/Execution capabilities own prepare, mount, jobs, PTYs, revisions, checkpoint, explicit transfer, and disposal. Browser failure cannot select host execution. |
| 5. Task coordination | `src/runtime/hub.js`, `agent.worker.js`: identities, parent/child runs, queues, delegation, approvals, saved plans. | Dispatch → route requests → settle callers → persist terminal results. Explicit continuation links a new attempt; page reload never automatically replays side effects. |
| 6. Observable state | Hub events/traces and `workspace/controller.js`, `artifacts.js`: prompt, request, call, command, source, build, artifact, check receipts. | Capture each attempt → publish state → package immutable export → inspect interactions → invalidate on change. UI consumes these records; artifact existence is separate from verification. |
| 7. Workbench | `app/**`, `src/workbench/**`: conversation, CodeMirror drafts, files, commands, terminal, agents, artifacts, settings. | Subscribe → render state → request action → await receipt. Drafts and committed files are separate. Generated content cannot mark itself verified. |

Single-agent loops and delegated parallel work use the same engine and tool protocol. Roles are configured as different folders. A general strategy/workflow DSL, arbitrary user-selected browser-tab automation, and complete unattended orchestration are not claimed as implemented.

## 2. Composition, prompts, and receipts

An agent is a published folder containing `agent.md`. Frontmatter chooses tools, agents, context, model settings, loop limits, response contract, and prompt template; its body defines the job. Nested agent folders define owned sub-agents, while declared peers add callable agents. `scripts/prepare-app.js` publishes a content-hashed index and native module-worker graph beside the Next export. Next bundles the UI; the worker graph retains native module imports.

Template slots are `soul`, `job`, `learned`, `tools`, `context`, `conversation`, `response`, and `note`. `<!-- user -->` separates system and user sections in a Markdown template. Substitution is literal: it neither executes code nor recursively expands inserted text. Tools and response definitions generate the same instructions used for dispatch/parsing.

Production main declares `contract_version: 2` and JSON:

```json
{"do":"tool","act":[[{"name":"workspace_read","args":{"path":"package.json"}}]]}
```

```json
{"do":"done","act":"The final answer."}
```

Version 1 remains available for legacy TOON/text-call agents and explicitly pinned test fixtures. Malformed legacy actions do not dispatch a valid-looking prefix. Version 2 does not silently accept the legacy string form. Historical v2 assistant turns containing a strictly valid bare nested call array receive their missing envelope on session load; live response acceptance remains unchanged.

Every parse attempt records a frozen prompt snapshot: `attemptId`, model, structured messages, contract version, and estimated budget. Every transport attempt separately records the provider request body, URL, method, and redacted headers. A rendered sheet alone cannot reveal provider-specific formatting or retries. Stable `callId` values distinguish identical repeated calls and are available in tool context.

Completion metadata retains provider finish reason and exact usage where supplied. Separate diagnostics count reasoning/content characters; truncated replies retain only the final 512 content characters, never raw reasoning in that diagnostic. Truncation, unexpected streaming EOF, and failed CLI exits prevent dispatch even when the text looks valid. Authentication fields are redacted; secrets placed inside prompts, files, or tool results are **not** automatically removed. Evidence export stays local unless the owner shares it.

Budget accounting estimates the entire assembled input plus reserved output. It is not tokenizer-exact provider usage. Repairs are bounded. Compaction replaces history only after a usable, smaller summary succeeds; failure preserves the original history.

## 3. Runs and termination

The page hub owns identities, parent/child links, worker routing, approvals, and persistence. Resident agents queue on their worker; other calls receive fresh workers. Published status slots remain readable while a worker is busy. A Web Lock coordinates agent ownership across tabs; it does not coordinate arbitrary external filesystem writers.

States include `idle`, `thinking`, `calling`, `waiting`, `compacting`, `done`, `failed`, `incomplete`, `cancelled`, and `interrupted`. Owner cancellation is distinct from runtime failure; tab-close/reload interruption is separate. Explicit continuation retains the original run and creates a new attempt linked by `taskId`, `resumedFrom`, and `resumeAttempt`, carrying its pinned context and saved plan without inheriting verification or restarting a process. No automatic replay occurs after reload.

- Invalid replies exhaust bounded repairs and fail; raw rejected text is not promoted to success.
- Step exhaustion may produce an explanation, but remains `incomplete`.
- A failed command, tool, provider, or capability request retains its actual error.
- Mutable calls execute again. Only explicitly cacheable tools can reuse successful results; failures are not cached as success.
- `do: done` proposes completion. A configured `verifyCompletion` hook must accept current evidence. Rejection becomes an observation within the remaining loop budget.

The coding workbench currently requires a new artifact and meaningful interaction checks against unchanged sources. Other agents can omit that gate. The coding policy is not a general classifier of noncoding questions.

IndexedDB holds run records and resident histories. Reopening marks interrupted work honestly. Current `resume` starts a new invocation; it is not process continuation or exactly-once replay. Conversation goals and run plans are implemented; unread delegated results, durable plan acknowledgements, and current-browser acceptance remain tracked in [remote reconciliation](REMOTE-RECONCILIATION.md). Closing the page stops its live workers and guest processes.

## 4. Browser Linux and optional capabilities

The browser runtime uses container2wasm v0.8.4, QEMU Wasm, a Debian/Node ARM64 guest, and a JavaScript supervisor. See [build and provenance](../../scripts/browser-linux/README.md). The profile allocates 1536 MiB to Linux and a larger Wasm heap; actual startup, memory pressure, and throughput still require measurements in both target browsers.

A trusted runtime frame loads integrity-checked assets. A separate 9p mount carries request-ID mailboxes and sequenced output records. Control never waits for a shell prompt. Agent jobs use process pipes; human sessions use real PTYs with input, resize, close, and exit events.

The intended canonical workspace is IDBFS-backed storage mounted into Linux through 9p. Startup restores it before readiness; mutation acknowledgements and completed job receipts wait for synchronization. Implementation and native protocol tests exist, but browser reload durability remains a release gate. The editor's bounded recovery checkpoint is a recovery copy, not another authoritative filesystem or an atomic backup of an arbitrary project.

Browser networking forwards HTTP/HTTPS through browser fetch and retains CORS restrictions. An explicit authenticated companion relay can add networking without changing command execution location. Arbitrary native sockets are not equivalent to browser fetch.

`host/companion.js` provides authenticated loopback HTTP(S), content-revision file operations, streamed jobs, native PTYs, model relay, and optional network relay. `LocalExecution` consumes its typed endpoints. File APIs confine paths to the selected root; commands have the owner's OS privileges, so a working directory is not an OS sandbox. Host execution requires explicit selection/authorization and is never an automatic substitute for unavailable browser execution.

`host/bridge.js` separately retains older CLI-provider and stdio-MCP support. The companion does not imply all legacy endpoints, a packaged installer, or general browser automation.

Direct hosted-page access to HTTP loopback depends on browser policy, origin, CORS, and local-network permission. Safari mixed-content blocking was observed. The intended hosted Chrome/Safari route uses a trusted HTTPS companion. Certificate loading and relay code exist; the complete installer/trust/pairing flow is not yet a verified product claim.

## 5. Immutable artifacts

The initial profile is one-page Next static export, JavaScript/JSX, plain CSS, `next build --webpack`, and resources emitted with the build. Artifacts carry source revision/fingerprint, execution target, build ID, and inspection receipt. Source/execution changes invalidate acceptance; previous successful previews remain separate immutable records.

`packageArtifact` resolves local scripts, stylesheet URLs, embedded CSS, style attributes, and supported static assets. It rejects missing/external references it encounters, additional application routes, nested frames, module scripts, custom base URLs, redirects, responsive `srcset`, and unsupported CSS resource syntax. Standard Next error pages are tolerated. Runtime-created assets, lazy loading, and arbitrary Next hosting are unsupported.

Packaged stylesheets retain an initially disabled link with their original identity alongside the embedded CSS. React uses the link to recognize an already represented resource; CSS order, media, and precedence survive in the adjacent style. The [HTML stylesheet fetch rules](https://html.spec.whatwg.org/multipage/links.html#link-type-stylesheet) prevent an initially disabled link from fetching. CSP still denies external styles if application code later enables or creates a link. Switchable stylesheets are rejected. Browser fixtures include real Next CSS imports, because successful server rendering alone does not prove hydration.

The package loads as `srcdoc` under `sandbox="allow-scripts allow-forms"`, **without** `allow-same-origin`. Form events permit React client handlers to run; the unchanged `form-action 'none'` CSP blocks actual form navigation/submission. Without `allow-forms`, the [HTML submission algorithm](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#form-submission-algorithm) stops before dispatching the submit event. The frame inherits the embedding page’s isolation policy while retaining an opaque security origin. A narrow compatibility shim resolves only the frame’s own non-hierarchical URL and canonical root to `https://artifact.invalid/`; ordinary URL resolution and Blob APIs remain native. Same-root history state changes are supported without navigation; other navigation is rejected. Inlined scripts retain `document.currentScript.src` metadata without a network `src` attribute. Arbitrary route-aware hooks and navigation remain outside this profile.

The artifact CSP blocks network connections and form submission and restricts resources to packaged forms. No model key, pairing token, workspace filesystem, or host capability enters generated code. The deliberately exposed scoped storage API accepts JSON values:

```js
const count = await window.askkArtifact.storage.get('count')
await window.askkArtifact.storage.set('count', (count ?? 0) + 1)
```

A private inspection channel starts before application code, captures native DOM operations, validates handshakes and result correspondence, and records runtime/CSP errors. Plans must contain concrete resulting-state assertions after every final interaction. Observation-only plans can inspect state, but do not satisfy an interaction requirement. Explicit reload drains pending scoped-storage writes, recreates the opaque frame in the same inspection scope, and requires a restored-state outcome. Each independent inspection starts with a fresh storage scope that is deleted afterward; human previews retain their project scope. The explicit `blur` action delivers captured native DOM blur/focusout events for React commit handlers; it does not grant the frame permission to move native keyboard focus. Model-controlled `ok: true` messages are not evidence. This is bounded behavioral checking, not proof of arbitrary program correctness or a complete security audit.

The current isolated renderer passed eight Chrome 153 checks of actual Next output, including hydration, scoped reload persistence, fresh repeated inspections, React blur commits, forged result rejection, native URL/Blob behavior, and composer focus/draft preservation. Earlier Chrome/Safari HTTP-shell checks do not verify this renderer; current Safari acceptance is pending. These checks concern artifact rendering, **not a browser-guest build**. See [status](IMPLEMENTATION-STATUS.md).

## 6. Deployment and UI

`bun run build` exports the Next workbench to `out/`; `bun run build:pages` uses `/ASKK`. Deployment includes agent folders, prompts, worker modules, artifact shell, and isolation service worker. A complete runtime distribution also needs generated image/network assets and provenance; an ordinary UI build does not compile or install them.

Browser Linux requires cross-origin isolation and SharedArrayBuffer. `prepareIsolation` installs a scoped service worker where a static host cannot set the required headers, asks the UI to preserve drafts, and performs a bounded reload. Failure leaves editing available and the guest unavailable. Actual Pages headers/reload, asset size, and browser operation remain deployment checks.

A saved, revision-checked conversation goal is independent of individual messages. Goal and run-owned plan context are read each prompt; plan updates also appear live. The independent inline boot watchdog reports missing hydration before React can report it.

The conversation-first UI subscribes to controller state for files, CodeMirror drafts/conflicts, command receipts, xterm terminals, agents, and previews. Human controls and agent workspace tools reach the same project owner. Drafts remain separate until saved; evidence follows real commits and inspections rather than status badges.

## 7. Verification boundary

Tests cover response contracts, provider receipts, workers, permissions, file revisions, companion processes/PTys, packaging, and the native supervisor protocol. They do not replace browser integration or a real model completing an application task.

The release boundary lives in [IMPLEMENTATION-STATUS.md](IMPLEMENTATION-STATUS.md). Preserve remote behavior through [REMOTE-RECONCILIATION.md](REMOTE-RECONCILIATION.md) rather than reviving the old framework. The earlier [UX document](UX.md) is historical design material: its framework-free page and former navigation references do not override the implemented Next workbench.
