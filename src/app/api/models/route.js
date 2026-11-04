// GET /api/models — the providers list from the SINGLE live
// engine object (getEngineModels): the one models store, not a
// per-request seed. POST /api/models — two jobs, kept apart:
//   1. Provider actions: body { action: "use"|"test"|"edit"|
//      "delete", id, patch? } — Use/Test/Edit/Delete through
//      the engine object (src/core/engine-models.js).
//      Persistence: when the desk folder exists, the updated
//      list is written back to <desk>/memory/model.json;
//      otherwise the action applies in-memory for this server
//      process and the response says persisted: false plainly.
//      Never writes to public/.
//   2. Server proxy for the OpenAI-standard models list (the old
//      behaviour): body { endpoint, apiKey?, provider?, apiKeyEnv? }.
//      Returns { models: [id, ...] }. The browser never calls the
//      model server directly, so local servers with no CORS headers
//      still work. Key resolution for a one-off fetch (before
//      anything is saved): an explicit apiKey wins; otherwise, if
//      apiKeyEnv or provider is given, the key is resolved
//      server-side from personal/.env (or process.env) under that
//      name, or under the provider-derived name (e.g.
//      OLLAMA_API_KEY). Keys are never returned to the browser.
//
// This is the PROVIDERS template store (the models page list).
// It is NOT the chat inference list: /api/inferences writes
// personal/model.json (order = chat default). See the route
// audit in PR.md Milestone 2.

import {
  defaultApiKeyEnv,
  readEnvFile,
  resolvePersonalDir,
} from "@/core/desk.js";
import {
  applyEngineModelsAction,
  getEngineModels,
} from "@/core/engine-models.js";
import { createInference } from "@/core/inference.js";
import { listProviders } from "@/core/providers.js";
import { getStartedEngine } from "@/core/startup.js";

export async function GET() {
  try {
    const engine = getStartedEngine("personal");
    const store = getEngineModels(engine);
    const listed = listProviders(store.providers, store.defaultId);
    return Response.json({
      providers: listed.providers,
      defaultId: listed.default?.id ?? store.defaultId,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }
}

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
  if (
    typeof body?.action === "string" &&
    ["use", "test", "edit", "delete"].includes(body.action)
  ) {
    try {
      const engine = getStartedEngine("personal");
      const result = applyEngineModelsAction(engine, body);
      return Response.json(result);
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }
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
