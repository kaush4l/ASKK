# core — a single chat engine, skeleton first

This replaces the earlier loop engine. There is no loop, no tool calls,
no gates, no inbox here — that engine was a first sketch of what an
agent was in the old system, and it has been superseded. The skeleton
now is deliberately the smallest thing that can chat:

1. **User query in.** The main screen (`src/app/page.js`) takes the
   user's input and the session's message history.
2. **One infer call.** `chat()` prepends the engine's instructions as
   the system message and calls the model once, via an inference
   object from `src/core/inference.js`.
3. **Reply out.** The reply string is shown in the chat. No streaming,
   no second turn inside the engine — the next user message starts a
   new single call with the full history.

## The engine

`src/core/engine.js`:

- `createEngine({ instructions, metadata, model })` — an engine is an
  object created with string instructions. `metadata` is an optional
  plain object, stored on the engine and unused for now; it is the
  expansion point. `model` is optional: when given, it is an inference
  id, falling back to matching by model string. When absent, the
  engine uses the desk default (see below).
- `loadEngineFromLocation(location)` — server-side (Node `fs`). Reads
  `instructions.md` from that location and returns
  `createEngine({ instructions, metadata: { location } })`. It does
  not read model.json: model resolution belongs to the desk.
- `chat(engine, { inference, inferences, messages })` — resolves an
  inference (argument, then engine.inference, then engine.model
  matched by id and then by model string), prepends
  `{ role: "system", content: engine.instructions }`, and calls that
  inference's `infer()` exactly once. If nothing resolves, it throws
  "no model configured" instead of inventing a model.
- `engine.twin()` / `twin(engine)` — the engine's live twin as plain
  data for the UI: `{ element: "engine", model, metadata,
  instructionsPreview }` (first line of the instructions, truncated
  at 120 characters). It never includes an inference object, a key,
  or any secret.

The chat API route re-reads the personal folder on every request, so
editing it takes effect without a restart. The client never sends
instructions: the server is the only source of them.

## Inference

`src/core/inference.js` is abstract and OpenAI-standard, with no agent
library and no bundled model:

- `createInference({ id, provider, endpoint, model, apiKey })` — an
  inference object with `listModels()` (`GET {endpoint}/models`,
  returns the `data[].id` strings, in the server's order) and
  `infer(messages)` (`POST {endpoint}/chat/completions` with
  `{ model, messages }`, returns `choices[0].message.content`).
- Standalone `listModels({ endpoint, apiKey })` / `infer({ endpoint,
  apiKey, model, messages })` wrappers are kept for one-off callers.

Endpoints are normalized (trailing slashes trimmed). Non-OK responses
throw a clear error carrying the status and the server's message.
`apiKey` is optional and, when given, is sent only as a Bearer header.

## The desk and the personal folder

All agent runtime state lives in `personal/`. `personal/desk.js` is
the script that initializes state and gives back a desk:

- `createDesk(location)` (alias `loadDesk`) reads
  `personal/instructions.md`, `personal/model.json`, and
  `personal/.env`, and returns
  `{ engine, inferences, defaultInference }`.
- `personal/model.json` IS a list, one entry per provider:
  `{ id, provider, endpoint, model, apiKeyEnv }`. Different providers
  coexist in the same list. The FIRST entry is the desk default; an
  empty list means no default. Changing the default moves that entry
  to the front of the list.
- `personal/.env` holds API keys ONLY, as KEY=VALUE lines (parsed
  with no new dependency, falling back to process.env). model.json
  never holds a key: an entry references its key only by `apiKeyEnv`
  name (default derived from the provider, e.g. OLLAMA_API_KEY).
- `personal/.env.example` ships placeholder names only. Ship no real
  `personal/.env`: personal/ is included in the repo until a stable
  state, and gitignore comes later, so a real .env must not be
  committed in any branch or PR.

## The UI and API routes

- `src/app/page.js` (`/`) — the main screen is the chat. The model
  picker has been REMOVED from this screen: no provider/endpoint
  input, no "Fetch models", no model dropdown, no Save, and no
  client calls to /api/inferences or /api/models. The models store
  (personal/model.json, via the desk) is the source of truth, and
  the picker will be re-added improved later. If no model is
  present, the screen says "No model configured — add an entry to
  personal/model.json" and Send stays disabled; models are managed
  in the file for now. The live engine panel
  (`src/components/engine-live.jsx`) loads on page load and
  refreshes after every chat reply.
- `src/app/api/engine/route.js` — GET → `{ engine:
  engine.twin(), defaultInference, hasDefault, inferenceCount }`.
  No key is returned, and apiKeyEnv is omitted entirely.
- `src/app/api/desk/route.js` — GET → `{ hasDefault,
  defaultInference, inferences }` with id/provider/endpoint/model
  only. Keys are never returned. Still used by the server; the
  main UI now prefers /api/engine for its live panel.
- `src/app/api/models/route.js` — server proxy, KEPT but unused by
  the UI for now (for the improved picker later): `POST { endpoint,
  apiKey?, provider?, apiKeyEnv? }` → `listModels`. An explicit key
  wins; otherwise the key is resolved server-side from personal/.env
  under apiKeyEnv or the provider-derived name.
- `src/app/api/inferences/route.js` — KEPT but unused by the UI for
  now: POST `{ provider, endpoint, model, apiKey?, apiKeyEnv? }`
  appends (or updates, by id) an entry in personal/model.json
  WITHOUT any key, and writes/updates the key in personal/.env when
  one was supplied. Returns the saved inference without the key.
- `src/app/api/inferences/default/route.js` — KEPT but unused by the
  UI for now: POST `{ id }` moves that entry to the front of
  personal/model.json, making it the default.
- `src/app/api/chat/route.js` — server proxy: `POST { inferenceId?,
  endpoint?, apiKey?, model?, messages }` → loads the desk, resolves
  the inference (explicit id, else one-off endpoint+model, else desk
  default), then `chat()`, and returns `{ reply }`.

## Tests

`bun test src/core/` — engine creation and model parameter, location
loading, engine.twin() plain data (no keys), the single infer call with the system message prepended,
inference resolution by id then by model string, the no-model error,
desk list parsing, first-entry default, engine model override,
apiKeyEnv resolution from a temp .env file, Save-style append without
a key in model.json, and default reordering. Fetch is mocked; no real
model is called.

## What is NOT here yet

Everything else is for Kaushal to direct: how metadata expands, what
other files live in the personal folder, streaming, persistence of
chats, and any loop or tools — none of those are in this skeleton.
