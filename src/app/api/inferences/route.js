// POST /api/inferences — save a user-added inference between
// restarts. Body: { provider, endpoint, model, apiKey?, apiKeyEnv? }.
// The entry is appended to personal/model.json WITHOUT any key (the
// list entry keeps only id/provider/endpoint/model/apiKeyEnv). If an
// apiKey was supplied, it is written/updated in personal/.env under
// apiKeyEnv (default: derived from the provider, e.g. OLLAMA_API_KEY).
// Returns { inference } as { id, provider, endpoint, model } —
// never the key. personal/.env itself is never committed (personal/
// is gitignored): see public/defaults/.env.example and the desk
// README warning. Saves always write to personal/ (creating it if
// needed), never to public/defaults/ — those are read-only fallback.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendInference,
  defaultApiKeyEnv,
  readModelList,
  resolvePersonalDir,
  upsertEnvText,
} from "@/core/desk.js";

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
    typeof body?.provider !== "string" ||
    body.provider.trim() === "" ||
    typeof body?.endpoint !== "string" ||
    body.endpoint.trim() === "" ||
    typeof body?.model !== "string" ||
    body.model.trim() === ""
  ) {
    return Response.json(
      { error: "provider, endpoint, and model are required" },
      { status: 400 },
    );
  }
  try {
    const dir = resolvePersonalDir("personal");
    mkdirSync(dir, { recursive: true });
    const nextList = appendInference(readModelList(dir), {
      provider: body.provider,
      endpoint: body.endpoint,
      model: body.model,
      apiKeyEnv:
        typeof body.apiKeyEnv === "string" && body.apiKeyEnv.trim() !== ""
          ? body.apiKeyEnv.trim()
          : defaultApiKeyEnv(body.provider),
    });
    writeFileSync(
      join(dir, "model.json"),
      `${JSON.stringify(nextList, null, 2)}\n`,
      "utf8",
    );
    if (typeof body.apiKey === "string" && body.apiKey !== "") {
      const envName =
        typeof body.apiKeyEnv === "string" && body.apiKeyEnv.trim() !== ""
          ? body.apiKeyEnv.trim()
          : defaultApiKeyEnv(body.provider);
      const envFile = join(dir, ".env");
      const current = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
      writeFileSync(
        envFile,
        upsertEnvText(current, envName, body.apiKey),
        "utf8",
      );
    }
    const saved =
      nextList.find((entry) => entry.id === appendInference([], body).id) ??
      nextList[nextList.length - 1];
    return Response.json({
      inference: {
        id: saved.id,
        provider: saved.provider,
        endpoint: saved.endpoint,
        model: saved.model,
      },
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }
}
