// Inference — abstract, OpenAI-standard, no agent library, no bundled model.
//
// The engine never talks to a model directly. It talks to these two
// functions, which speak the OpenAI HTTP shape that local servers
// (Ollama, LM Studio, vLLM, and OpenAI itself) all implement:
//
//   GET  {endpoint}/models           -> { data: [{ id, ... }] }
//   POST {endpoint}/chat/completions -> { choices: [{ message: { content } }] }
//
// `endpoint` is the base URL the user enters in the UI, for example
// http://localhost:11434/v1. No model name is invented here: the model
// list comes from the server, and the chat model is the one the user
// picked and saved. `apiKey` is optional (local servers often need
// none) and is only sent as a Bearer header when given.

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

// List the model ids a server reports. Returns an array of strings.
export async function listModels({ endpoint, apiKey, fetchImpl = fetch }) {
  const base = normalizeEndpoint(endpoint);
  const response = await fetchImpl(`${base}/models`, {
    method: "GET",
    headers: authHeaders(apiKey),
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
    .filter((id) => typeof id === "string");
}

// One chat-completions call. Returns the reply text, nothing else.
export async function infer({
  endpoint,
  apiKey,
  model,
  messages,
  fetchImpl = fetch,
}) {
  const base = normalizeEndpoint(endpoint);
  if (typeof model !== "string" || model.trim() === "") {
    throw new Error(
      "inference needs a model id (pick one from the models list)",
    );
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("inference needs at least one message");
  }
  const response = await fetchImpl(`${base}/chat/completions`, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify({ model, messages }),
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
}
