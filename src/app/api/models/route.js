// POST /api/models — server proxy for the OpenAI-standard models list.
// Body: { endpoint, apiKey?, provider?, apiKeyEnv? }.
// Returns { models: [id, ...] }. The browser never calls the model
// server directly, so local servers with no CORS headers still work.
// Key resolution for a one-off fetch (before anything is saved): an
// explicit apiKey wins; otherwise, if apiKeyEnv or provider is given,
// the key is resolved server-side from personal/.env (or process.env)
// under that name, or under the provider-derived name
// (e.g. OLLAMA_API_KEY). Keys are never returned to the browser.

import {
  defaultApiKeyEnv,
  readEnvFile,
  resolvePersonalDir,
} from "@/core/desk.js";
import { createInference } from "@/core/inference.js";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "request body must be JSON" },
      { status: 400 },
    );
  }
  if (typeof body?.endpoint !== "string" || body.endpoint.trim() === "") {
    return Response.json({ error: "endpoint is required" }, { status: 400 });
  }
  try {
    let apiKey = body.apiKey;
    if (typeof apiKey !== "string" || apiKey === "") {
      const envName =
        typeof body.apiKeyEnv === "string" && body.apiKeyEnv.trim() !== ""
          ? body.apiKeyEnv.trim()
          : typeof body.provider === "string" && body.provider.trim() !== ""
            ? defaultApiKeyEnv(body.provider)
            : undefined;
      if (envName) {
        const envValues = readEnvFile(resolvePersonalDir("personal"));
        apiKey = envValues[envName] ?? process.env[envName];
      }
    }
    const models = await createInference({
      endpoint: body.endpoint,
      apiKey,
    }).listModels();
    return Response.json({ models });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }
}
