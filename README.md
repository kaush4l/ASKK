# ASKK

ASKK is a client-side Dioxus 0.7 agent workspace compiled to WebAssembly. It stores workspace state in browser IndexedDB and uses OpenAI-compatible browser fetch calls for model requests.

## Model Providers

ASKK is a static hosted app. It calls browser-reachable OpenAI-compatible APIs directly from the page, using the configured base URL plus `/chat/completions` for runs and `/models` for diagnostics.

Supported presets:

- OpenAI: `https://api.openai.com/v1`, bearer token auth.
- Ollama local: `http://localhost:11434/v1`, no auth by default.
- LM Studio local: `http://localhost:1234/v1`, no auth by default.
- Local Bridge: `http://127.0.0.1:8874/v1`, no auth by default.
- Custom: any browser-reachable OpenAI-compatible base URL.

Provider keys entered in the page are visible to browser code. Use testing keys unless you are comfortable with that browser-local trust model. Key persistence is opt-in and stored in IndexedDB.

Provider profiles are stored in IndexedDB so you can save named base URL/model/auth settings and switch between them without retyping. Profiles follow the same key persistence rule: profile API keys are saved only when that profile has `Persist key in browser storage` enabled.

### Localhost and CORS

A hosted HTTPS page can attempt to call local loopback endpoints such as `http://localhost:11434`, but browser CORS still applies. ASKK does not bypass CORS or mixed-content policy. If the browser reports a failed fetch before an HTTP response, confirm the local model server is running and allows the hosted page origin.

If direct browser access fails, run the ASKK local bridge on the same machine as the browser. The bridge adds browser CORS and Private Network Access response headers, then forwards requests to your OpenAI-compatible provider.

For a provider running on another LAN machine:

```sh
node scripts/askk-local-bridge.mjs --target http://192.168.11.154:8873/v1 --port 8874
```

Start the bridge from the project root, or pass `--workspace-root /path/to/askk`, when you want the hosted app to read and update Markdown prompt files.

Then use the ASKK `Local Bridge` preset, or manually set:

```text
Base URL: http://127.0.0.1:8874/v1
Auth: No auth
```

If the upstream provider requires a bearer token, set ASKK auth to `Bearer token`; the bridge forwards the `Authorization` header.

You can test the bridge directly:

```sh
curl http://127.0.0.1:8874/v1/models
```

### Markdown Workspace Files

ASKK keeps broad behavior and agent prompts in Markdown:

- `soul.md` is the shared behavior prompt prepended to every agent call.
- `agents/*.md` defines agents with frontmatter (`id`, `name`, `enabled`, `tools`, `response_format`) and a Markdown body as the agent prompt.
- `skills/**.md` defines reusable skills with frontmatter (`id`, `name`, `enabled`) and a Markdown body.

The hosted app cannot read your local filesystem directly. Use the local bridge from the repo root to enable the Soul page and Agents page to load these files:

```sh
node scripts/askk-local-bridge.mjs --workspace-root "$(pwd)"
```

Bridge file routes:

- `GET /askk/files` reads `soul.md`, `agents/`, and `skills/`.
- `POST /askk/files/soul` updates `soul.md`.
- `POST /askk/files/agents` writes current agents back to `agents/*.md`.

If the bridge is unavailable, the app uses bundled Markdown defaults plus the browser IndexedDB snapshot.

## Agent Loop, Workers, and Orchestration

Simple goals run as a single bounded ReAct loop. Each model turn receives the assembled soul prompt, selected agent instructions, enabled skills, live state, validator feedback, and the schemas for the agent's allowed compiled tools. The model may either request a registered tool or emit a final answer; tool results and final answers are validated before they are promoted to state.

Decomposable batch goals are handled by the orchestrator. The orchestrator owns task decomposition, child-agent selection, worker-pool scheduling, progress monitoring, cancellation, joining, and result aggregation. In the browser build, child agents run through the same loop inside Web Workers via the typed worker transport.

State is the source of truth. Runs, messages, tool calls/results, worker progress, workflow state, jobs, and trace events are serializable and persisted in IndexedDB. If the page reloads during a run, ASKK recovers it as a paused resumable job and exposes a `Resume` action.

The bundled default agent is generic and stored in `agents/planner.md`; the file name is only a source path. Edit `soul.md`, `agents/*.md`, and `skills/**/*.md` through the hosted app plus local bridge when you want to change behavior without changing Rust code.

## Workspace and running projects

The **Workspace** page is a browser-hosted text editor: a file tree, an editor
pane, and a runner. It has two modes:

- **Browser** (default) — everything runs in the tab. Files live in the
  in-browser virtual filesystem (IndexedDB) and code runs natively in a sandboxed
  Web Worker via the `run_js` tool. **No bridge, no install** — this works on the
  hosted GitHub Pages site. Create a file, write JavaScript, and press **Run file**.
- **Bridge** — files and commands run on a local `askk-local-bridge` so you can
  drive a real on-disk project with `bun`/`node` (see below).

The coding agent shares whichever workspace is active, so files it writes appear in
the tree, and edits you make are visible to its tools.

### Bridge mode (real bun/node on disk)

To run and test real on-disk projects, start the bridge with execution turned on:

```sh
node scripts/askk-local-bridge.mjs --allow-exec
```

- `--allow-exec` (or `ASKK_ALLOW_EXEC=1`) is required before any command runs;
  the default is **disabled**. Execution runs real processes on the bridge
  machine, so only enable it when you intend to run projects.
- `--run-root <dir>` (or `ASKK_RUN_ROOT`) sets the project directory. Default:
  `<workspace-root>/.askk-workspace`. All `fs_*` and `run_command` calls are
  confined to this directory; paths that escape it are rejected.
- `--exec-timeout-ms <n>` caps per-command runtime (default 120000).
- Commands are limited to an allow list of common dev binaries (`bun`, `bunx`,
  `node`, `npm`, `npx`, `pnpm`, `yarn`, `deno`, `tsc`, `vitest`, `git`, and basic
  shell utilities). Bun is the default runtime.

Typical flow: open the Workspace page, ask the coding agent to "create a Bun
project with an `add(a, b)` function and a passing test, then verify with
`bun test`", and watch it scaffold files, run the test, and report complete only
after the test passes. You can also edit files and run commands directly from the
editor and terminal.

## Compiled Tools

Tools are the MCP-shaped core object (`{ name, description, input_schema }` →
`{ ok, content }`); each is pre-compiled into the WASM harness. Tool output is
always treated as untrusted data, never as instructions. The default-on tools all
run **in the browser** — no bridge required, so they work on the hosted site:

- `run_js({ code, timeout_ms? })` — run JavaScript natively in a sandboxed Web
  Worker. Captures `console.log`, returns `ok`/`stdout`/`stderr`/`result`. This is
  how the agent executes and verifies code in the browser.
- `web_search({ query, count? })` — discover sources. Defaults to the **Browser**
  backend (DuckDuckGo Instant Answer + Wikipedia, key-free, CORS); switch to the
  **Bridge** backend on the Tools page for richer providers (Brave/Tavily/SearXNG).
- `web_fetch({ url })` — read one page in full as clean text. Browser backend uses
  the key-free `r.jina.ai` reader; Bridge backend uses the bridge fetcher.
- `file_write` / `file_read` / `file_list` — the in-browser virtual filesystem
  (IndexedDB), used by the Workspace in Browser mode.

Bridge-only tools (require a running `askk-local-bridge`, localhost only):

- `fs_write` / `fs_read` / `fs_list` — disk files in the bridge **run root**.
- `run_command({ command, cwd?, timeout_ms? })` — run `bun`/`node`/etc. on disk.
  Returns `exit_code`, `ok`, `stdout`, `stderr`. Requires `--allow-exec`.

Pick the search backend (and any future provider keys) on the Tools page.

### How the agent behaves

Behavior is driven by the Markdown prompts (`soul.md`, `agents/*.md`,
`skills/**`), not hard-coded into the loop:

- **Research:** the agent does not answer from the first page of results. It
  searches, fetches and reads the best sources, synthesizes, names the open gaps
  and contradictions, then searches again until the picture is complete — and
  cites the URLs it read.
- **Building code:** the agent treats *complete* as *verified*, not *written*. In
  Browser mode it writes files and runs them with `run_js`, reporting done only
  after the check prints the expected result; in Bridge mode it uses `run_command`
  and treats a verification command (e.g. `bun test`) returning `exit_code` 0 as
  proof. Either way it cites the run that verified the work.

The bundled agents are `Agent` (the default generalist, enabled), plus `Coder`,
`Researcher`, and `Synthesizer` (disabled — enable them on the Agents page).

Provider `auto` uses this order:

1. Brave Search when `BRAVE_API_KEY` or `BRAVE_SEARCH_API_KEY` is set.
2. Tavily when `TAVILY_API_KEY` is set.
3. SearXNG when `SEARXNG_URL`, `SEARXNG_BASE_URL`, or `ASKK_SEARXNG_URL` is set.
4. Key-free DuckDuckGo HTML search as the no-key fallback.

You can also select `duckduckgo`, `searxng`, `brave`, or `tavily` on the Tools page. Request-level Tools page keys and `searxng_url` override bridge environment values for that search request.

For Brave Search:

```sh
BRAVE_API_KEY="..." node scripts/askk-local-bridge.mjs --target http://192.168.11.154:8873/v1
```

`BRAVE_SEARCH_API_KEY` is also accepted. Search results are returned in the shared Hermes/OpenClaw envelope:

```json
{
  "success": true,
  "data": {
    "web": [
      { "title": "Title", "url": "https://example.com", "description": "Snippet", "position": 1 }
    ]
  }
}
```

For Tavily search:

```sh
TAVILY_API_KEY="..." node scripts/askk-local-bridge.mjs --target http://192.168.11.154:8873/v1
```

For free self-hosted SearXNG search:

```sh
SEARXNG_URL="http://localhost:8888" node scripts/askk-local-bridge.mjs --target http://192.168.11.154:8873/v1
```

The SearXNG instance must have JSON output enabled. If no Brave, Tavily, or SearXNG configuration is present, `web_search` uses the key-free DuckDuckGo HTML fallback.

LM Studio must have CORS enabled for web apps:

```sh
lms server start --cors
```

Ollama exposes OpenAI-compatible endpoints at:

```text
http://localhost:11434/v1
```

If a hosted ASKK URL needs access, include that hosted origin in `OLLAMA_ORIGINS` and restart Ollama according to your platform setup. For example:

```sh
OLLAMA_ORIGINS="https://kaush4l.github.io" ollama serve
```

## In-browser MCP (reference server)

ASKK can boot a [Model Context Protocol](https://modelcontextprotocol.io) server
**inside a Web Worker** and discover its tools at runtime — no install, no bridge,
no extra process. The bundled reference server lives at
`assets/mcp_reference_server.js`.

It is a **hand-written, single static file** with a deliberate constraint: **no JS
build step, no bundler, no npm dependency, no toolchain**. It is a classic Web
Worker (`self.onmessage` / `self.postMessage`), not an ES module, so it loads
directly with zero compilation. It is served same-origin via the Dioxus `asset!()`
macro at runtime, and from a `Blob` URL in the headless test.

### Wire format

The worker speaks **JSON-RPC 2.0 over `postMessage`**, exchanging **JSON strings**
(not objects):

- Inbound: each message is a JSON string containing a JSON-RPC request, parsed with
  `JSON.parse`.
- Outbound: every reply is `self.postMessage(JSON.stringify(response))` — always a
  string. Success is `{ "jsonrpc": "2.0", "id": <id>, "result": <object> }`; failure
  is `{ "jsonrpc": "2.0", "id": <id>, "error": { "code": <int>, "message": <string> } }`.
- Responses are correlated by echoing the request's `id`.
- **Notifications** — any request whose `method` starts with `notifications/` (e.g.
  `notifications/initialized`), or that carries no `id` — are processed but produce
  **no reply**.

The lifecycle is the standard MCP handshake: `initialize` →
`notifications/initialized` → `tools/list` → `tools/call`.

### Tools exposed

The reference server advertises two tools (note the camelCase `inputSchema` key per
the MCP spec):

- **`echo`** — `inputSchema` `{ text: string }` (required `text`). Returns the
  `text` argument back verbatim.
- **`add`** — `inputSchema` `{ a: number, b: number }` (required `a`, `b`).
  Computes `a + b` and returns the sum as text (inputs `2` and `3` → `"5"`).

Every `tools/call` reply is an MCP `CallToolResult`:
`{ "content": [ { "type": "text", "text": <string> } ] }`. Calling an unknown tool
returns a JSON-RPC error with code `-32602`; an unknown method returns `-32601`
("Method not found"); malformed JSON returns `-32700` ("Parse error").

### Rust client + engine integration

The Rust side lives in `src/mcp/`:

- **`protocol.rs`** — the JSON-RPC 2.0 + MCP wire types (host-testable, no platform deps).
- **`transport.rs`** — the `McpTransport` trait: the seam where HTTP (remote) and
  gateway-bridged (stdio) transports can be added later without touching the engine.
- **`worker_transport.rs`** — `WorkerMcpTransport`, the browser Web Worker transport
  (wasm only). It posts JSON-RPC frames over `postMessage` and correlates responses
  to requests by `id`, with a per-request timeout.
- **`client.rs`** — a minimal `McpClient` (`initialize` / `list_tools` / `call_tool`).
- **`registry.rs`** (wasm only) — a thread-local table of live connections. At run
  start the engine brings up each enabled browser server, discovers its tools, and
  registers them under namespaced names (`mcp__<server-id>__<tool>`) so they never
  collide with compiled built-ins. A `ToolCall` for one of those names routes to the
  owning server's client and its `CallToolResult` becomes a `ToolResult` — the same
  path, instrumentation (`AgentEvent`s), and untrusted-data handling as any built-in.

Servers are configured as `McpServerConfig` on the persisted `AppSnapshot` and managed
from the **MCP** dashboard page. The transport trait + the routing seam carry a `TODO`
for per-server capability-scoping of untrusted servers (out of scope for this slice).

### Running the headless worker test

`src/mcp/worker_transport.rs` contains a `wasm_bindgen_test` (`browser_tests`) that
boots the reference server from a `Blob` URL, runs `initialize`, asserts `tools/list`
returns `[add, echo]`, calls `add(2, 3)` and asserts `5`, then tears the worker down.
It is an in-crate test (the crate is a binary with no library target, so `tests/`
integration files cannot reach the transport). Run it against a real browser with a
matching webdriver, e.g. headless Chrome:

```sh
wasm-pack test --headless --chrome   # auto-provisions a matching wasm-bindgen + driver
```

`wasm-pack` downloads the latest chromedriver; if it does not match your installed
Chrome, point `CHROMEDRIVER` at a version-matched driver from
[Chrome for Testing](https://googlechromelabs.github.io/chrome-for-testing/) and run
the version-matched runner directly (`--headless --safari` also works once
`safaridriver --enable` has been authorized).

## Development

Serve the app locally:

```sh
dx serve --web
```

Run the local hardening gate:

```sh
cargo fmt --check
cargo test
cargo check
dx build --platform web
```

Run the deterministic browser smoke provider:

```sh
python3 scripts/mock-openai-provider.py
python3 -m http.server 8765 --directory target/dx/askk/debug/web/public
```

Then open `http://127.0.0.1:8765/`, set the provider base URL to `http://127.0.0.1:9989/v1`, choose `No auth`, and submit a decomposable bullet-list goal to exercise parallel worker orchestration. `curl http://127.0.0.1:9989/stats` reports request concurrency.

The Definition-of-Done traceability note lives at `docs/definition-of-done.md`; extension contracts live at `docs/extensibility.md`.

Clean and build the GitHub Pages artifact:

```sh
cargo clean
dx build --release --web --base-path /ASKK/ --locked
```

The generated static site is written to:

```text
target/dx/askk/release/web/public/
```

## Publish to GitHub Pages

Push source to `main`, then publish the contents of `target/dx/askk/release/web/public/` to the root of the `gh-pages` branch with a `.nojekyll` file.

The repository Pages source should be configured to deploy from branch `gh-pages`, folder `/(root)`.

Published URL:

```text
https://kaush4l.github.io/ASKK/
```
