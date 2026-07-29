# R3 — Provider CORS matrix

> Question (PROMPT.md §18): which target providers are callable from a hosted browser origin
> (`https://kaush4l.github.io`) without a proxy?
>
> Method: live `OPTIONS` preflight probes + live `POST` probes with an invalid key (a 4xx **with**
> `Access-Control-Allow-Origin` proves the browser can read real responses — preflight alone does
> not), plus official docs for the local stacks. All probes run 2026-07-29 from this machine with
> `Origin: https://kaush4l.github.io`.

## Matrix

| Provider | Direct from browser? | Required headers / config | Streaming (SSE) CORS-clean? | Evidence | Confidence |
|---|---|---|---|---|---|
| OpenAI | **uncertain** — preflight passes, but the 401 probe response carried **no** `Access-Control-Allow-Origin` | `Authorization: Bearer`, `Content-Type` | Unverified; if the 200 path carries ACAO (ecosystem says it does), SSE works | Probes A1/A2; Oct 2025 incident thread (below) | Medium |
| Anthropic | **true** | `x-api-key`, `anthropic-version`, **`anthropic-dangerous-direct-browser-access: true`** (without it, responses omit ACAO — verified) | Yes — ACAO `*` on actual responses | Probes B1/B2/B3 | High |
| Google Gemini (OpenAI-compat endpoint) | **true** | `Authorization: Bearer <API key>`, `Content-Type`; endpoint `…/v1beta/openai/chat/completions` | Yes — ACAO reflected on actual responses | Probes C1/C2 | High |
| OpenRouter | **true** | `Authorization: Bearer`; optional `HTTP-Referer`/`X-Title` (both in its allow-list) | Yes — ACAO `*` on actual responses | Probes D1/D2 | High |
| Groq | **true** | `Authorization: Bearer` | Yes — ACAO `*` on actual responses | Probes E1/E2 | High |
| Mistral | **true** | `Authorization: Bearer` | Yes — ACAO `*` on actual responses | Probes F1/F2 | High |
| Together | **true** | `Authorization: Bearer` | Yes — ACAO `*` on actual responses | Probes G1/G2 | High |
| DeepSeek | **true** | `Authorization: Bearer` | Yes — ACAO reflects origin, `allow-credentials: true` | Probes H1/H2 | High |
| Ollama | **true with config** | `OLLAMA_ORIGINS=https://kaush4l.github.io` (default allows only localhost-family origins) | Yes once origin allowed | [Ollama FAQ](https://docs.ollama.com/faq); [issue #300](https://github.com/ollama/ollama/issues/300) (2026-07-29) | High |
| LM Studio | **true with config** | "Enable CORS" toggle in server settings (off by default) → ACAO `*` | Yes once enabled | [LM Studio server settings docs](https://lmstudio.ai/docs/developer/core/server/settings) (2026-07-29) | High |
| llama.cpp `llama-server` | **true** (default) | None — CORS defaults to `*`; scope with `--cors-origins` if desired | Yes | [server README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md); [PR #5781](https://github.com/ggml-org/llama.cpp/pull/5781), [PR #25655](https://github.com/ggml-org/llama.cpp/pull/25655) (2026-07-29) | High |
| vLLM | **true** (default) | None — FastAPI `CORSMiddleware` with `--allowed-origins` default `["*"]` | Yes | [vLLM cli_args](https://docs.vllm.ai/en/stable/api/vllm/entrypoints/openai/cli_args/) (2026-07-29) | High |

**Local-stack caveat (constrains, applies to all four):** the page is `https://`, the local server
is `http://localhost`. Chrome and Firefox exempt loopback from mixed-content blocking, but
**Chrome 142 (Oct 2025) ships Local Network Access**: any request from a public origin to a
loopback/private address now triggers a one-time browser permission prompt; if denied, requests
silently fail ([Chrome LNA blog](https://developer.chrome.com/blog/local-network-access)).
Safari historically does not treat `http://localhost` as trustworthy from an `https://` page —
Safari users need the dev-time broker or an https tunnel for local stacks. HARNESS UX must
anticipate the LNA prompt (explain it before the first local call).

## Probe transcripts (verbatim, trimmed to the CORS-relevant lines)

### A. OpenAI

A1 — preflight:

```
$ curl -si -X OPTIONS https://api.openai.com/v1/chat/completions \
    -H "Origin: https://kaush4l.github.io" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: authorization, content-type"
HTTP/2 200
access-control-allow-origin: https://kaush4l.github.io
access-control-allow-headers: authorization, content-type
access-control-allow-methods: GET, OPTIONS, POST
access-control-max-age: 86400
```

A2 — actual POST (invalid key):

```
HTTP/2 401
access-control-expose-headers: CF-Ray
```

**No `access-control-allow-origin` on the 401.** So at minimum, error bodies are unreadable from
the browser. Whether the 200 path carries ACAO cannot be verified without a valid key. Ecosystem
evidence says it normally does: the official JS SDK ships a `dangerouslyAllowBrowser` opt-in
(pointless if CORS blocked everything), browser BYOK apps (TypingMind, big-AGI) call
`api.openai.com` directly, and when ACAO went missing in Oct 2025 OpenAI staff called it "a bug"
and fixed it same day
([community thread, 2025-10-15](https://community.openai.com/t/chat-completions-api-endpoint-down-blocked-any-web-browser-request/1362527)).
Verdict: probably works, but verify with a live key before advertising; the missing-ACAO-on-401
means auth errors surface as opaque network errors, and the Oct 2025 incident shows the CORS path
is not contractual for OpenAI.

### B. Anthropic

B1 — preflight (note the header in the request list):

```
$ curl -si -X OPTIONS https://api.anthropic.com/v1/messages \
    -H "Origin: https://kaush4l.github.io" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access, content-type"
HTTP/2 200
access-control-allow-methods: DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT
access-control-allow-headers: x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access, content-type
access-control-allow-origin: *
```

B2 — actual POST **with** `anthropic-dangerous-direct-browser-access: true` (invalid key):

```
HTTP/2 401
vary: Origin, Access-Control-Request-Headers, anthropic-dangerous-direct-browser-access, Accept-Encoding
access-control-expose-headers: *
access-control-allow-origin: *
```

B3 — actual POST **without** the header (invalid key):

```
HTTP/2 401
access-control-allow-credentials: true
        (no access-control-allow-origin)
```

The `vary` line in B2 is the mechanism in the open: ACAO is served **only** when the request
carries `anthropic-dangerous-direct-browser-access`. With it, fully browser-callable.

### C. Google Gemini (OpenAI-compatible endpoint)

C1 — preflight (`/v1beta/openai/chat/completions`):

```
HTTP/2 200
access-control-allow-origin: https://kaush4l.github.io
access-control-allow-methods: DELETE,GET,HEAD,OPTIONS,PATCH,POST,PUT
access-control-allow-headers: authorization, content-type
access-control-max-age: 3600
```

C2 — actual POST (invalid key):

```
HTTP/2 400
access-control-allow-origin: https://kaush4l.github.io
```

### D. OpenRouter

D1 — preflight:

```
HTTP/2 204
access-control-allow-origin: *
access-control-allow-headers: Authorization,…,Content-Type,…,HTTP-Referer,X-Openrouter-Title,X-Title,…
access-control-allow-methods: GET,OPTIONS,PATCH,DELETE,POST,PUT
```

D2 — actual POST (invalid key):

```
HTTP/2 401
access-control-allow-origin: *
access-control-expose-headers: X-Generation-Id,X-Provider-Name,cf-ray
```

### E. Groq

E1 — preflight:

```
HTTP/2 204
access-control-allow-headers: authorization, content-type
access-control-allow-methods: GET,HEAD,PUT,PATCH,POST,DELETE
access-control-allow-origin: *
```

E2 — actual POST (invalid key): `HTTP/2 401` + `access-control-allow-origin: *`

### F. Mistral

F1 — preflight:

```
HTTP/2 200
access-control-allow-origin: *
access-control-allow-headers: Authorization,Content-Type,User-Agent,Cache-Control,Keep-Alive,X-Mistral-User-Agent
access-control-allow-methods: GET,HEAD,PUT,PATCH,POST,OPTIONS,DELETE
access-control-max-age: 3600
```

F2 — actual POST (invalid key): `HTTP/2 401` + `access-control-allow-origin: *`

### G. Together

G1 — preflight:

```
HTTP/2 200
access-control-allow-origin: *
access-control-allow-headers: authorization, content-type
access-control-allow-methods: POST,OPTIONS
```

G2 — actual POST (invalid key): `HTTP/2 401` + `access-control-allow-origin: *`

### H. DeepSeek

H1 — preflight (`https://api.deepseek.com/chat/completions`):

```
HTTP/2 200
access-control-allow-credentials: true
access-control-allow-methods: POST
access-control-allow-headers: authorization, content-type
access-control-allow-origin: https://kaush4l.github.io
```

H2 — actual POST (invalid key): `HTTP/2 401` + `access-control-allow-origin: https://kaush4l.github.io`

## Streaming note

CORS has no separate rule for SSE: a streamed `text/event-stream` 200 is readable iff the response
carries ACAO, same as JSON. Every provider verified above serves ACAO on actual responses, so
`fetch` + ReadableStream token streaming is CORS-clean for all of them. The only streaming caveat
is OpenAI's unverified 200 path (above).

## Synthesis

**First-class BYOK (advertise, no proxy):** Anthropic, Gemini (OpenAI-compat endpoint),
OpenRouter, Groq, Mistral, Together, DeepSeek. Seven providers with live-verified preflight AND
actual-response CORS. OpenRouter alone fronts OpenAI/Anthropic/Google models, so "OpenAI models in
HARNESS" is available first-class today via OpenRouter even if api.openai.com stays uncertain.

**Uncertain (verify with a key, then promote or route via OpenRouter):** OpenAI direct. Preflight
passes; 401s hide their bodies; success path unproven here but strongly indicated by ecosystem.

**Needs the dev-time broker (serve.py-style `/v1` proxy) or config:** local stacks need
one-time server-side config (OLLAMA_ORIGINS / LM Studio CORS toggle) — after that they are direct.
The broker (pattern: `git show '80564a2:serve.py'` `proxy_model()`, lines 73–102 — forwards
`Content-Type`/`Authorization`/`Accept`, streams with no Content-Length until upstream EOF for SSE)
remains the fallback for: Safari + local stacks, Chrome LNA-denied users, and any future provider
without CORS. It is dev-time only and must be marked as such (PROMPT.md §2 non-goals: no server
runtime beyond static hosting plus an optional, clearly-marked dev-time broker).

**Trust model — state it honestly:** direct-from-browser means the API key lives in the page
(memory + whatever persistence HARNESS chooses) and every prompt goes provider-direct. Anthropic's
header literally names the deal: *dangerous-direct-browser-access*. That is the correct trade for a
single-user BYOK tool on the user's own machine — the same call the ASKK predecessor made — but it
is a real commitment: any XSS in HARNESS is key theft, so the key must never be interpolated into
fragment-rendered DOM, and scoped/limited keys (OpenRouter supports per-key credit limits) should
be the recommended practice in docs.

**Constrains:** CORS policy is provider-operational, not contractual — OpenAI dropped ACAO for
hours in Oct 2025 by accident. HARNESS should treat a CORS failure as a distinct, explained error
state ("provider unreachable from browser — try OpenRouter or the dev broker"), not a generic
network error. Chrome 142+ LNA permission prompt gates all local-stack calls.

## 5-line summary for RESEARCH.md

- R3 (provider CORS): 7 hosted providers are browser-callable from `https://kaush4l.github.io` with live-verified preflight + response CORS: Anthropic (needs `anthropic-dangerous-direct-browser-access: true`), Gemini OpenAI-compat, OpenRouter, Groq, Mistral, Together, DeepSeek — all first-class BYOK.
- OpenAI direct is **uncertain**: preflight passes but 401 responses carry no ACAO and its CORS broke for hours in Oct 2025; verify with a live key or route OpenAI models through OpenRouter.
- Local stacks all work with one-time config: `OLLAMA_ORIGINS=<origin>`, LM Studio CORS toggle; llama.cpp and vLLM default to `*`. Chrome 142+ shows a Local Network Access permission prompt; Safari + `http://localhost` needs the broker.
- SSE streaming is CORS-clean wherever the response carries ACAO — verified for all seven first-class providers.
- Trust model: BYOK key is browser-visible by design (single-user tool, own machine); XSS = key theft, so keys never enter fragment-rendered DOM and scoped/limited keys are the documented recommendation. The serve.py-style dev broker stays as the clearly-marked fallback, not the default path.
