# ASKK

ASKK is a client-side Dioxus 0.7 multi-agent workspace compiled to WebAssembly. It stores workspace state in browser IndexedDB and uses OpenAI-compatible browser fetch calls for model requests.

## Model Providers

ASKK is a static hosted app. It calls browser-reachable OpenAI-compatible APIs directly from the page, using the configured base URL plus `/chat/completions` for runs and `/models` for diagnostics.

Supported presets:

- OpenAI: `https://api.openai.com/v1`, bearer token auth.
- Ollama local: `http://localhost:11434/v1`, no auth by default.
- LM Studio local: `http://localhost:1234/v1`, no auth by default.
- Custom: any browser-reachable OpenAI-compatible base URL.

Provider keys entered in the page are visible to browser code. Use testing keys unless you are comfortable with that browser-local trust model. Key persistence is opt-in and stored in IndexedDB.

### Localhost and CORS

A hosted HTTPS page can attempt to call local loopback endpoints such as `http://localhost:11434`, but browser CORS still applies. ASKK does not bypass CORS or mixed-content policy. If the browser reports a failed fetch before an HTTP response, confirm the local model server is running and allows the hosted page origin.

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
