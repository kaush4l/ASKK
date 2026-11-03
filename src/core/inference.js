// Inference — abstract, OpenAI-standard, no agent library, no bundled model.
//
// The engine never talks to a model directly. It talks to an inference
// object, which speaks the OpenAI HTTP shape that local servers
// (Ollama, LM Studio, vLLM, and OpenAI itself) all implement:
//
//   GET  {endpoint}/models           -> { data: [{ id, ... }] }
//   POST {endpoint}/chat/completions -> { choices: [{ message: { content } }] }
//
//   const inference = createInference({
//     id, provider, endpoint, model, apiKey,
//   });
//   await inference.listModels(); // -> ["model-a", "model-b"]
//   await inference.infer(messages); // -> "reply text"
//
// `id` is the inference's identity in personal/model.json (a list, one
// entry per provider/model pair). `provider` is a free string naming
// the backend. `model` is the model id on that provider. No model name
// is invented here: the model list comes from the server, and the chat
// model is the one the user picked and saved. `apiKey` is optional
// (local servers often need none) and is only sent as a Bearer header
// when given. API keys never live in model.json — an entry there
// references its key only by apiKeyEnv name, and the desk script
// resolves that name from personal/.env (see personal/desk.js).
//
// The standalone listModels() / infer() exports are thin wrappers kept
// for callers that do not have an inference object yet.

export function normalizeEndpoint(endpoint) {
  if (typeof endpoint !== "string" || endpoint.trim() === "") {
    throw new Error(
      "inference needs an endpoint, for example http://localhost:11434/v1",
    );
  }
  return endpoint.trim().replace(/\/+$/, "");
}

function authHeaders(apiKey) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

async function readError(response) {
  try {
    const text = await response.text();
    return text ? text.slice(0, 300) : response.statusText;
  } catch {
    return response.statusText;
  }
}

export function createInference({
  id,
  provider,
  endpoint,
  model,
  apiKey,
  fetchImpl = fetch,
}) {
  if (typeof endpoint !== "string" || endpoint.trim() === "") {
    throw new Error(
      "inference needs an endpoint, for example http://localhost:11434/v1",
    );
  }
  const base = normalizeEndpoint(endpoint);
  const inference = {
    id: typeof id === "string" ? id : undefined,
    provider: typeof provider === "string" ? provider : undefined,
    endpoint: base,
    model: typeof model === "string" ? model : undefined,
    // The key lives on the object for the server-side call only. It is
    // never serialized into model.json and never returned by an API
    // route; routes strip it before responding.
    apiKey: typeof apiKey === "string" ? apiKey : undefined,
    async listModels() {
      const response = await fetchImpl(`${base}/models`, {
        method: "GET",
        headers: authHeaders(inference.apiKey),
      });
      if (!response.ok) {
        throw new Error(
          `models request failed (${response.status}): ${await readError(response)}`,
        );
      }
      const body = await response.json();
      if (!Array.isArray(body?.data)) {
        throw new Error("models response had no data array");
      }
      return body.data
        .map((entry) => entry?.id)
        .filter((entryId) => typeof entryId === "string");
    },
    async infer(messages) {
      if (
        typeof inference.model !== "string" ||
        inference.model.trim() === ""
      ) {
        throw new Error(
          "inference needs a model id (pick one from the models list)",
        );
      }
      if (!Array.isArray(messages) || messages.length === 0) {
        throw new Error("inference needs at least one message");
      }
      const response = await fetchImpl(`${base}/chat/completions`, {
        method: "POST",
        headers: authHeaders(inference.apiKey),
        body: JSON.stringify({ model: inference.model, messages }),
      });
      if (!response.ok) {
        throw new Error(
          `chat completions request failed (${response.status}): ${await readError(response)}`,
        );
      }
      const body = await response.json();
      const content = body?.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new Error("chat completions response had no message content");
      }
      return content;
    },
  };
  return inference;
}

// Standalone wrappers (no inference object yet).
export async function listModels({ endpoint, apiKey, fetchImpl = fetch }) {
  return createInference({ endpoint, apiKey, fetchImpl }).listModels();
}

export async function infer({
  endpoint,
  apiKey,
  model,
  messages,
  fetchImpl = fetch,
}) {
  return createInference({ endpoint, apiKey, model, fetchImpl }).infer(
    messages,
  );
}
