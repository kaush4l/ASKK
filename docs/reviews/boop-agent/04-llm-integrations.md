# 04 — LLM & integrations review (boop-agent)

> Scope: LLM transport + external integrations. Siblings: lifecycle
> (`01-app-lifecycle.md`), state (`02-state-storage.md`), sync
> (`03-cross-device.md`), proactivity (`05-proactivity.md`), agent loop
> (`06-agent-loop-tools.md`).

## 1. How boop talks to LLMs and services

The defining fact: **boop's LLM access is subscription-auth, not API-key
HTTP.** Both runtimes are child processes riding a local CLI login:

- **Claude runtime** — the Claude Agent SDK's `query()` drives the locally
  installed `claude` binary and its login session
  (`server/runtimes/claude.ts:7` imports `@anthropic-ai/claude-agent-sdk`;
  the agentic loop is the `for await (const msg of query({...}))` at
  `server/runtimes/claude.ts:77`, running with
  `permissionMode: "bypassPermissions"`).
- **Codex runtime** — a spawned `codex app-server` binary spoken to over
  stdio JSON-RPC (`spawn("codex", args)` at
  `server/runtimes/codex-app-server.ts:130`, Windows variant at `:122`).
  Auth is a copied `~/.codex/auth.json` login file
  (`server/runtimes/codex-app-server.ts:62-71`). The protocol surface is
  ~6.3k lines of generated types
  (`server/runtimes/codex-app-server-protocol/`, 6251 LOC).

Everything else is plain HTTPS:

- **Embeddings** — provider picked by env at `server/embeddings.ts:34-35`:
  Voyage (`fetch("https://api.voyageai.com/v1/embeddings")`,
  `server/embeddings.ts:46`) → OpenAI
  (`fetch("https://api.openai.com/v1/embeddings")`, `:64`) → local
  `@huggingface/transformers` pipeline (`:85`) so `recall()` works with no
  key.
- **Composio** — hosted integration proxy: one server-side
  `COMPOSIO_API_KEY` (`server/composio.ts:59`) fronts 1000+ OAuth'd
  toolkits (`server/composio.ts:22`); Composio holds the user OAuth
  tokens, boop never sees them. Tool calls are toolkit-scoped per spawn,
  and Composio injects real creds on execute (`server/composio.ts:249`).
  A webhook subscription (`server/composio-webhook.ts:103`,
  `POST <publicUrl>/composio/webhook`) delivers `GMAIL_NEW_GMAIL_MESSAGE`
  events that drive the proactive email watcher
  (`server/proactive-email.ts:1-18`).
- **Sendblue (iMessage)** — HTTPS out
  (`https://api.sendblue.com/api/send-message`, `server/sendblue.ts:11,94`)
  and an HMAC-verified inbound webhook (`sb-signing-secret` header checked
  at `server/sendblue.ts:227` via the SHA-256 HMAC derivation in
  `server/sendblue-webhook-auth.ts`).

**Review.** The subscription-runtime lock-in is the single biggest browser
blocker: child processes, filesystem auth files, and CLI logins have no
browser equivalent, full stop. Composio is an elegant pattern — it
outsources the entire secrets/OAuth problem to one vendor key — but it
assumes exactly the two things a browser lacks: a server-held API key and
a public webhook receiver. Strip those two assumptions and boop's
integration layer is nothing exotic: `fetch` calls.

## 2. Browser LLM transport — the practical core

What replaces the runtimes when everything runs in the page:

| Tier | Mechanism | Status |
|---|---|---|
| Local server | OpenAI-compatible `fetch` + SSE against LM Studio / Ollama / vLLM on localhost | **PROVEN in ASKK** — LM Studio answers browser `fetch` with `access-control-allow-origin: *`; SSE via `fetch` + `ReadableStream` |
| Hosted, direct | Anthropic API from the page with the `anthropic-dangerous-direct-browser-access: true` request header, BYOK | Works by design; Anthropic explicitly supports it |
| Hosted, resold | OpenRouter (CORS-open, OpenAI-compatible) fronting OpenAI/Google/etc. | Works; OpenAI's own API does **not** send CORS headers to browsers |
| Zero-external | transformers.js / WebGPU in-page models | ASKK features-lab precedent; Gemma-class small models only |

Notes, honestly stated:

- **BYOK exposure.** A key in `localStorage`/OPFS is readable by any XSS on
  the page and by anyone at the keyboard. Mitigate with per-provider keys,
  spend caps at the provider, and scoping — but the exposure is real and
  should be named in the UI, not hidden.
- **OpenAI directly is out.** `api.openai.com` returns no
  `Access-Control-Allow-Origin`; the browser needs a CORS-open reseller
  (OpenRouter) or a user-run proxy (which, from the browser's view, is
  still just an HTTP endpoint — same code path as LM Studio).
- **Streaming.** Default is `fetch` + `ReadableStream` over SSE; WebSocket
  where a provider offers it (e.g. some realtime APIs). Both are
  first-class browser primitives — no gap here.
- **Subscription auth is unreachable.** Claude Code / ChatGPT plan logins
  are CLI/device-bound and cannot be exercised from a web page. Say it
  plainly: the browser model is BYOK or local server. There is no third
  option today.
- **Embeddings** map cleanly: Voyage and OpenAI embeddings are just
  `fetch` (CORS posture of `api.voyageai.com` — **verify**; OpenAI's is
  closed, so route via proxy or skip), and boop's own third tier — local
  transformers.js — is *already* the browser-native answer. The fallback
  chain inverts: local first, HTTPS as upgrade.

## 3. Integrations without Composio

Composio's job was (a) OAuth custody, (b) uniform tool schemas, (c) webhook
fan-in. Browser-side, classify each target service:

| Class | Pattern | Real examples |
|---|---|---|
| (a) CORS-open APIs | Direct `fetch`, BYOK or keyless | SearXNG/Wikipedia/HN/SO (ASKK-proven), Telegram Bot API, GitHub REST (CORS-open with token) |
| (b) OAuth via PKCE, token client-side | Browser runs the OAuth dance; tokens land in local storage | GitHub OAuth device/PKCE flow; Google APIs via GIS token client — **Gmail IS callable from the browser** (CORS-enabled REST + OAuth PKCE access token) |
| (c) Webhook-dependent flows | Replace push with **polling** from the page | Gmail `history.list` polling instead of Composio's push trigger; GitHub notifications polling |
| (d) Truly server-required | No browser equivalent; substitute or drop | Inbound SMS/iMessage (Sendblue). Nearest substitutes: Web Push notifications, an ntfy.sh-style relay topic, or Telegram Bot API `getUpdates` long-poll — which is CORS-callable from a page |

Class (b) costs registration friction (each user or the project registers
an OAuth app; Google verification for sensitive Gmail scopes is real
paperwork) and puts refresh/access tokens in client storage — same
exposure class as BYOK LLM keys. Class (c) costs latency (poll interval vs
push) and battery/quota; it also only runs while a tab (or its service
worker, within browser limits) is alive — see `05-proactivity.md`.

## 4. Secrets model consequence

Composio collapsed N secrets into one server key. The browser model
re-expands it: **BYOK-per-service, stored client-side, scoped
per-service.** Consequences:

- Every key/token is only as safe as the origin (CSP, no third-party
  script, XSS hygiene) and the device.
- Scope minimally: read-only Gmail scope if reading is all the agent does;
  per-provider spend caps.
- **No HMAC-verifiable inbound anything.** The browser cannot receive a
  signed webhook, so the trust model for "events" shifts from
  verify-the-sender to trust-what-you-polled over TLS — an authenticated
  poll is actually a *simpler* trust story than webhook signature
  verification, at the price of freshness (cross-ref `05-proactivity.md`
  for the wake-up problem, `06-agent-loop-tools.md` for tool-call
  plumbing).

## 5. Verdict table

| boop channel | browser-only equivalent | fidelity loss |
|---|---|---|
| Claude Agent SDK → `claude` CLI (subscription) | Anthropic API BYOK w/ direct-browser-access header, or OpenAI-compatible local server | Lose subscription pricing + the SDK's built-in tool harness; agent loop is reimplemented in-page (already ASKK's design) |
| Codex `app-server` stdio JSON-RPC (subscription) | OpenRouter / any OpenAI-compatible endpoint | Lose ChatGPT-plan auth and the 6.3k-line protocol entirely; plain chat-completions replaces it |
| Voyage/OpenAI embeddings HTTPS | transformers.js local embeddings first; Voyage direct if CORS allows (**verify**) | Model quality drop local vs voyage-3; zero-key operation is a gain |
| Composio toolkit calls (server key) | Direct `fetch` for class (a); PKCE + client tokens for class (b) | Lose 1000-toolkit uniformity and hosted OAuth custody; each integration is hand-wired |
| Composio Gmail push webhook | Gmail `history.list` polling with GIS PKCE token | Push → poll latency; runs only while the app is open |
| Sendblue iMessage out | Web Push / ntfy relay / Telegram `getUpdates` | Loses iMessage as a surface entirely — no browser path to SMS/iMessage |
| Sendblue HMAC webhook in | (none — no inbound listener) | Inbound-initiated conversations are gone; the browser must poll or be the initiator |

**Bottom line.** Of boop's five external channels, four reduce to `fetch`
once you accept BYOK + polling. The one genuine loss is
subscription-priced frontier models and any inbound push surface
(iMessage). For ASKK's target — state, logic, and app all in the page,
talking out only via HTTP/WebSocket — the transport layer is the *solved*
part; the honest costs are key custody in the client and push→poll
freshness.
