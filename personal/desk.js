// Desk — the script that initializes state and gives back a desk.
//
// All agent runtime state lives in the personal folder:
//
//   personal/instructions.md — the engine's instructions (system message)
//   personal/model.json      — a LIST of user-added inferences, one
//                              entry per provider/model pair. The
//                              FIRST entry is the desk default. An
//                              empty list means no default.
//   personal/.env            — API keys only, as KEY=VALUE lines.
//                              model.json never holds a key: an entry
//                              references its key by apiKeyEnv name.
//
//   const desk = createDesk(); // defaults to "personal"
//   desk.engine            // createEngine({ instructions, model })
//   desk.inferences        // createInference() objects, keys resolved
//   desk.defaultInference  // inferences[0], or undefined
//
// createDesk() is server-side only (Node fs). It reads instructions.md
// and model.json on every call, so editing either file takes effect
// without a restart. Keys are resolved from personal/.env first, then
// from process.env, and are kept on the inference objects for the
// server-side call only — API routes must strip them before responding
// (see src/app/api/desk/route.js, which returns only id/provider/
// endpoint/model).
//
// WARNING: personal/ is included in the repo until a stable state, and
// gitignore comes later. A real personal/.env must not be committed:
// fill it locally from personal/.env.example, and keep real keys out
// of any branch, PR, or snapshot push.

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { loadEngineFromLocation } from "../src/core/engine.js";
import { createInference } from "../src/core/inference.js";

export function resolvePersonalDir(location = "personal") {
  if (typeof location !== "string" || location.trim() === "") {
    throw new Error("desk needs a personal folder location");
  }
  return isAbsolute(location)
    ? location
    : join(/* turbopackIgnore: true */ process.cwd(), location);
}

// Parse a .env-style file: KEY=VALUE lines, # comments ignored,
// surrounding quotes stripped. No new dependency.
export function parseEnvText(text) {
  const values = {};
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export function readEnvFile(dir) {
  const file = join(dir, ".env");
  if (!existsSync(file)) {
    return {};
  }
  return parseEnvText(readFileSync(file, "utf8"));
}

// Default key name for a provider, e.g. "ollama" -> "OLLAMA_API_KEY".
export function defaultApiKeyEnv(provider) {
  const slug = String(provider ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug === "" ? "API_KEY" : `${slug}_API_KEY`;
}

// Read personal/model.json. It IS a list. Absent file -> empty list.
// A non-list file is an error, not silently treated as one entry.
export function readModelList(dir) {
  const file = join(dir, "model.json");
  if (!existsSync(file)) {
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error(`desk could not parse model.json at ${file}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`desk expects model.json at ${file} to be a list`);
  }
  return parsed;
}

// Pure helper used by the Save route and by tests: append an entry to
// a model list, or update the entry with the same id in place (order
// preserved). The entry must NOT carry a key: apiKey is dropped here,
// so a key can never reach model.json through this path.
export function appendInference(list, entry) {
  if (
    !entry ||
    typeof entry.provider !== "string" ||
    entry.provider.trim() === ""
  ) {
    throw new Error("inference entry needs a provider");
  }
  if (typeof entry.endpoint !== "string" || entry.endpoint.trim() === "") {
    throw new Error("inference entry needs an endpoint");
  }
  if (typeof entry.model !== "string" || entry.model.trim() === "") {
    throw new Error("inference entry needs a model");
  }
  const id =
    typeof entry.id === "string" && entry.id.trim() !== ""
      ? entry.id
      : `${entry.provider.trim()}-${entry.model.trim()}`
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
  const clean = {
    id,
    provider: entry.provider.trim(),
    endpoint: entry.endpoint.trim(),
    model: entry.model.trim(),
  };
  const apiKeyEnv =
    typeof entry.apiKeyEnv === "string" && entry.apiKeyEnv.trim() !== ""
      ? entry.apiKeyEnv.trim()
      : defaultApiKeyEnv(entry.provider);
  clean.apiKeyEnv = apiKeyEnv;
  const next = Array.isArray(list) ? [...list] : [];
  const at = next.findIndex((item) => item?.id === id);
  if (at >= 0) {
    next[at] = clean;
  } else {
    next.push(clean);
  }
  return next;
}

// Pure helper: move the entry with `id` to the front of the list.
// That is how the desk default changes: the first entry IS the default.
export function moveInferenceToFront(list, id) {
  const next = Array.isArray(list) ? [...list] : [];
  const at = next.findIndex((item) => item?.id === id);
  if (at < 0) {
    throw new Error(`no inference with id ${id}`);
  }
  const [entry] = next.splice(at, 1);
  next.unshift(entry);
  return next;
}

// Pure helper used by the Save route and by tests: set or update one
// KEY=VALUE line in .env text, preserving the other lines.
export function upsertEnvText(text, name, value) {
  const lines = String(text ?? "").split(/\r?\n/);
  // Drop a trailing empty line produced by a final newline, so the
  // rebuilt text does not gain a blank line on every save.
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  let replaced = false;
  const next = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || !trimmed.includes("=")) {
      return line;
    }
    if (trimmed.slice(0, trimmed.indexOf("=")).trim() === name) {
      replaced = true;
      return `${name}=${value}`;
    }
    return line;
  });
  if (!replaced) {
    next.push(`${name}=${value}`);
  }
  return `${next.join("\n")}\n`;
}

function resolveApiKey(entry, envValues) {
  if (typeof entry?.apiKeyEnv === "string" && entry.apiKeyEnv !== "") {
    return envValues[entry.apiKeyEnv] ?? process.env[entry.apiKeyEnv];
  }
  return undefined;
}

export function createDesk(location = "personal", { fetchImpl } = {}) {
  const dir = resolvePersonalDir(location);
  const engine = loadEngineFromLocation(dir);
  const modelList = readModelList(dir);
  const envValues = readEnvFile(dir);
  const inferences = modelList.map((entry) =>
    createInference({
      id: entry.id,
      provider: entry.provider,
      endpoint: entry.endpoint,
      model: entry.model,
      apiKey: resolveApiKey(entry, envValues),
      ...(fetchImpl ? { fetchImpl } : {}),
    }),
  );
  const defaultInference = inferences[0];
  // Wire the desk default into the engine: engine.model is the
  // default inference's id, so chat() resolves it without the caller
  // having to pass an inference. An explicit engine model (see
  // createEngine) would override this, but createDesk always starts
  // from the desk default, per the workflow.
  if (defaultInference) {
    engine.model = defaultInference.id;
    engine.inference = defaultInference;
  }
  return { engine, inferences, defaultInference, location: dir };
}

// Alias: loadDesk() reads the same state and gives back the same desk.
export const loadDesk = createDesk;

// Public view of a desk for the browser: no keys, ever.
export function publicDesk(desk) {
  const strip = (inference) => ({
    id: inference.id,
    provider: inference.provider,
    endpoint: inference.endpoint,
    model: inference.model,
  });
  return {
    hasDefault: Boolean(desk?.defaultInference),
    defaultInference: desk?.defaultInference
      ? strip(desk.defaultInference)
      : null,
    inferences: (desk?.inferences ?? []).map(strip),
  };
}
