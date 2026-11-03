# core — a single chat engine, skeleton first

This replaces the earlier loop engine. There is no loop, no tool calls,
no gates, no inbox here — that engine was a first sketch of what an
agent was in the old system, and it has been superseded. The skeleton
now is deliberately the smallest thing that can chat:

1. **User query in.** The main screen (`src/app/page.js`) takes the
   user's input and the session's message history.
2. **One infer call.** `chat()` prepends the engine's instructions as
   the system message and calls the model once, via
   `src/core/inference.js`.
3. **Reply out.** The reply string is shown in the chat. No streaming,
   no second turn inside the engine — the next user message starts a
   new single call with the full history.

## The engine

`src/core/engine.js`:

- `createEngine({ instructions, metadata })` — an engine is an object
  created with string instructions. `metadata` is an optional plain
  object, stored on the engine and unused for now; it is the expansion
  point for name, role, model defaults, or anything else, without
  changing the engine's shape.
- `loadEngineFromLocation(location)` — server-side (Node `fs`). Reads
  `instructions.md` from that location and returns
  `createEngine({ instructions, metadata: { location } })`. The
  personal folder is the location for now: `personal/instructions.md`
  at the project root, a short template Kaushal edits.
- `chat(engine, { endpoint, apiKey, model, messages })` — prepends
  `{ role: "system", content: engine.instructions }` and calls
  `infer()` exactly once.

The chat API route re-reads `personal/instructions.md` on every
request, so editing that file takes effect without a restart. The
client never sends instructions: the server is the only source of
them.

## Inference

`src/core/inference.js` is abstract and OpenAI-standard, with no agent
library and no bundled model:

- `listModels({ endpoint, apiKey })` — `GET {endpoint}/models`,
  returns the `data[].id` strings, in the server's order. No model
  name is invented here.
- `infer({ endpoint, apiKey, model, messages })` —
  `POST {endpoint}/chat/completions` with `{ model, messages }`,
  returns `choices[0].message.content`.

Endpoints are normalized (trailing slashes trimmed). Non-OK responses
throw a clear error carrying the status and the server's message.
`apiKey` is optional and, when given, is sent only as a Bearer header.

## The UI and API routes

- `src/app/page.js` (`/`) — the main screen is the chat. A model
  picker section (endpoint input, optional API key input, "Fetch
  models", a model dropdown, "Save") sits above a simple messages
  list and a Send input. Saved endpoint, model, and key persist in
  browser localStorage only — they are never written to the repo.
- `src/app/api/models/route.js` — server proxy: `POST { endpoint, apiKey }`
  → `listModels`. The browser never calls the model server directly,
  so local servers with no CORS headers still work.
- `src/app/api/chat/route.js` — server proxy: `POST { endpoint, apiKey,
  model, messages }` → loads the engine from `personal`, then `chat()`,
  and returns `{ reply }`.

## Tests

`src/core/engine.test.js` — `bun test src/core/engine.test.js`.
Engine creation, location loading (temp directory), the single
infer call with the system message prepended, and the models list
shape. Fetch is mocked; no real model is called.

## What is NOT here yet

Everything else is for Kaushal to direct: how metadata expands, what
other files live in the personal folder, streaming, persistence of
chats, and any loop or tools — none of those are in this skeleton.
