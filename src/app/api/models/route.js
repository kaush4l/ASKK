// POST /api/models — two jobs, kept apart by the body:
//   1. Provider actions: body { action: "use"|"test"|"edit"|"delete",
//      id, patch? } — Use/Test/Edit/Delete against providers.js
//      (Test is mocked, no real model call, no CLI). The provider
//      list is seeded from the desk snapshot's template providers
//      (memory/model.json). Persistence: when a personal desk
//      folder exists, the updated list is written back to
//      personal/memory/model.json; otherwise the action applies to
//      an in-memory store for this server process and the response
//      says persisted: false plainly. Never writes to public/.
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

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  defaultApiKeyEnv,
  readEnvFile,
  resolvePersonalDir,
} from "@/core/desk.js";
import { readDeskSnapshot } from "@/core/desk-reader.js";
import { createInference } from "@/core/inference.js";
import {
  applyProviderAction,
  listProviders,
} from "@/core/providers.js";
// listProviders is used only for the seed default, above.

let memoryStore = null;

function seedProviders() {
  if (memoryStore) {
    return memoryStore;
  }
  try {
    const snap = readDeskSnapshot({
      personalDir: resolvePersonalDir("personal"),
      defaultsDir: `${process.cwd()}/public/defaults`,
      agent: "developer",
    });
    memoryStore = {
      providers: snap.models ?? [],
      defaultId:
        listProviders(snap.models).default?.id ?? null,
    };
  } catch {
    memoryStore = { providers: [], defaultId: null };
  }
  return memoryStore;
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
      const store = seedProviders();
      const { state, result } = applyProviderAction(store, body);
      memoryStore = state;
      let persisted = false;
      const personalDir = resolvePersonalDir("personal");
      if (existsSync(personalDir)) {
        try {
          const file = join(personalDir, "memory", "model.json");
          writeFileSync(file, `${JSON.stringify(state.providers, null, 2)}\n`, "utf8");
          persisted = true;
        } catch {
          persisted = false;
        }
      }
      return Response.json({
        ...result,
        // Raw entries, with isDefault marked — not normalized here,
        // so a template entry with an unlisted kind still round-trips.
        providers: state.providers.map((entry) => ({
          ...entry,
          isDefault: state.defaultId ? entry.id === state.defaultId : Boolean(entry.isDefault),
        })),
        defaultId: state.defaultId,
        persisted,
        ...(persisted
          ? {}
          : { note: "not persisted: no personal desk folder; in-memory only for this server process" }),
      });
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
