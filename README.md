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

## Workspace and running projects (Bun)

The **Workspace** page is a browser-hosted text editor over the bridge's on-disk
**run root**: a file tree, an editor pane, and a terminal that runs commands in
the same directory the coding agent operates on. Files the agent writes appear in
the tree, and edits you make are visible to `run_command` and `bun`.

To enable running and testing real projects, start the bridge with execution
turned on:

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

ASKK exposes these compiled tools to agents. Every one runs in the browser or
through the local bridge, and tool output is always treated as untrusted data,
never as instructions.

Research:

- `web_search({ query, count?, country?, language?, freshness?, date_after?, date_before? })` — discover sources.
- `web_fetch({ url })` — fetch one page/document and return its cleaned text and title, so the agent can read a source in full instead of relying on search snippets.

Files and code (disk-backed, shared with the Workspace page and `bun`):

- `fs_write({ path, content })`, `fs_read({ path })`, `fs_list({ path? })` — create, read, and list files in the bridge **run root**.
- `run_command({ command, cwd?, timeout_ms? })` — run a command (bun, node, npm, tsc, git, …) in the run root. Returns `exit_code`, `ok`, `stdout`, `stderr`. Requires the bridge started with `--allow-exec`.

In-browser virtual filesystem (no bridge needed, IndexedDB-backed):

- `file_write`, `file_read`, `file_list`.

The web tools call the local bridge under `http://127.0.0.1:8874/askk/tools/`. Configure the bridge URL, provider, default count, optional country/language/freshness, and optional provider keys on the Tools page. Search-provider keys entered there are visible to browser code and are persisted only when `Persist web-search API keys` is enabled.

### How the agent behaves

Behavior is driven by the Markdown prompts (`soul.md`, `agents/*.md`,
`skills/**`), not hard-coded into the loop:

- **Research:** the agent does not answer from the first page of results. It
  searches, fetches and reads the best sources, synthesizes, names the open gaps
  and contradictions, then searches again until the picture is complete — and
  cites the URLs it read.
- **Building code:** the agent treats *complete* as *verified*, not *written*. It
  scaffolds files with `fs_write`, runs and tests with `run_command`, and only
  reports a task done after a verification command (e.g. `bun test`) returns
  `exit_code` 0, citing that passing command as proof.

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
