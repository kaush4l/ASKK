# ASKK

A browser-owned agent workbench: describe a goal, inspect actual tool calls, edit files, run commands, and verify a generated application beside the conversation.

The UI is a Next.js static export written in JavaScript/JSX. Agents run in Web Workers. Commands use an explicitly selected runtime: a container2wasm Linux guest with Node/npm in the browser, or an optional Bun companion on your computer. **Chrome has passed guest boot, real Node commands, filesystem checks, and acknowledged-file recovery after reload. A private candidate also installed and executed an uncached npm package with both companions stopped. Next builds and current Safari acceptance remain unverified.** The first candidate Next build exceeded its 15-minute bound; the public site still uses the earlier image, and Browser Linux remains an engineering preview.

A local Qwen model completed a native task-board verification with 37 passing check steps, after eight repeated failures and targeted owner steering over roughly 24 minutes. This proves a guided recovery on an existing application, not one-shot reliability. The [published Chrome workbench](https://kaush4l.github.io/ASKK/) has passed shell, worker, draft-reload, missing-chunk, and trusted HTTPS model-relay connection checks; hosted model generation and browser-guest application builds remain separate gates.

- [Current architecture and seven contracts](docs/rewrite/ARCHITECTURE.md)
- [Measured status and remaining gates](docs/rewrite/IMPLEMENTATION-STATUS.md)
- [Remote behavior reconciliation](docs/rewrite/REMOTE-RECONCILIATION.md)
- [Browser Linux build/provenance](scripts/browser-linux/README.md)

## Develop the workbench

Development is currently tested with Bun 1.4.2. Dependencies are pinned in `package.json` and `bun.lock`.

```sh
bun install --frozen-lockfile
bun run dev
```

Open `http://127.0.0.1:5187`. Configure an OpenAI-compatible model in Settings. The current catalogue points to the owner's local service; the owner supplies a usable endpoint and any required authorization. A successful model listing is not proof that generation or a tool loop works.

```sh
bun test ./test
bun run build
bun run serve
```

The export is served at `http://127.0.0.1:5188`. For the repository's Pages path:

```sh
bun run build:pages
NEXT_PUBLIC_BASE_PATH=/ASKK bun run serve
```

These commands build the UI and publish its worker graph. They do **not** compile the Linux image. `dev:legacy`/`build:legacy` retain the previous plain-module UI, not the current product.

## Choose where commands run

**Browser Linux** is the default selected target. It requires generated assets, cross-origin isolation, and a successful guest handshake. The selected persistent ARM64 Linux image contains Node 24/npm; Bun is not running inside the browser. Follow the [runtime instructions](scripts/browser-linux/README.md) to build it. Missing assets or unsupported isolation produce a failure rather than host execution.

**Local Bun** requires the companion and explicit runtime selection:

```sh
bun host/companion.js --root /absolute/path/to/project --allow-origin http://127.0.0.1:5187
```

Pair the printed URL and token in Settings → Runtime. Pairing a model relay does not itself select native commands. Moving an existing workspace requires an explicit snapshot transfer into an empty destination. Commands run as your user; filesystem API confinement is not an OS sandbox.

A hosted HTTPS page needs a browser-trusted HTTPS companion for the intended Chrome/Safari flow. Given an already trusted certificate/key valid for `127.0.0.1`:

```sh
bun host/companion.js --root /absolute/path/to/project \
  --tls-cert /path/to/loopback-cert.pem --tls-key /path/to/loopback-key.pem \
  --allow-origin https://kaush4l.github.io
```

That command does not issue/install certificates or provide a bundled application installer. Keep tokens and private keys out of source control and artifacts. The older `host/bridge.js` separately supports model CLIs and stdio MCP; those interfaces are not all implemented by the companion.

## Define agents and tools

Agents live in `public/agents/<name>/agent.md`, with local JavaScript tools beside them. Model configuration comes from `public/models.json` and owner settings. Tool descriptions, templates, and response contracts are separate inputs.

```yaml
---
name: coder
description: Implements and checks a requested change.
agents: [researcher]
tools: [workspace, board, todo]
context: [time, budget, board]
contract_version: 2
response_format: json
prompt_template: prompts/workbench.md
max_steps: 20
require_verification: true
---
Read the current files, implement the requested result, and verify it.
```

The main and coder agents use compact version 2 JSON. Calls within a stage may run concurrently; stages run in order. Policy decides whether tools run, are denied, or need approval. Exact structured prompt attempts and redacted provider requests are recorded separately.

Malformed or truncated replies do not dispatch tools. Exhausted budgets are incomplete. Repeated mutable calls execute again. A configured completion gate can reject a final-answer proposal until current evidence passes.

## Build and inspect an application

The first profile is a **single-page Next static export** with JavaScript/JSX, plain CSS, local emitted resources, and `next build --webpack`. Configure `output: 'export'` and unoptimized images. Remote resources, server APIs, dynamic routes, lazy imports, route-dependent behavior, and general Next hosting are outside this profile.

The immutable artifact renders in an opaque `srcdoc` sandbox with client-side form handlers and CSP-blocked external submissions. Generated code receives no host/model authority. Use asynchronous `window.askkArtifact.storage.get/set` for persistence inside that sandbox; direct storage access is unavailable there.

Concrete interaction checks bind verification to the artifact and source revision. A successful command exit alone is not verification. A previous preview remains available when a new build fails, but stale previews cannot satisfy completion.

Current Chrome checks pass real Next stylesheet hydration, form interaction, scoped storage across reload, and adversarial isolation cases. Current Safari checks remain pending; an earlier renderer’s Safari result is not proof for this version. The full path **real model → browser guest → build → verified artifact**, cold-start performance, fresh hosted isolation setup, and hosted generation remain release gates. The checked Pages export is published and an existing cached client passed worker/storage migration with its draft preserved; see [implementation status](docs/rewrite/IMPLEMENTATION-STATUS.md) for exact identities and evidence limits.

The historical tree remains at `pre-folder-threads`. Later remote contributions are recorded against exact commits in the reconciliation document rather than silently discarded.
