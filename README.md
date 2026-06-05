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

## Agent Loop

Runs use the first enabled agent as a single ReAct loop. On each model turn the agent returns the configured structured response format, chooses either `action: tool` with one tool invocation or `action: answer` with final text, and the runner continues until the agent chooses an answer.

The bundled default agent is generic and stored in `agents/planner.md`; the file name is only a source path. Edit `soul.md`, `agents/*.md`, and `skills/**/*.md` through the hosted app plus local bridge when you want to change behavior without changing Rust code.

## Web Tools

ASKK exposes one active Hermes/OpenClaw-style compiled tool to agents:

- `web_search({ query, count?, country?, language?, freshness?, date_after?, date_before? })`

The tool calls the local bridge at `http://127.0.0.1:8874/askk/tools/web_search`. Configure the bridge URL, provider, default count, optional country/language/freshness, and optional provider keys on the Tools page. Search-provider keys entered there are visible to browser code and are persisted only when `Persist web-search API keys` is enabled.

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
