// Desk — the script that initializes state and gives back a desk.
//
// Folder check (the personal / public fallback rule):
//   - If the personal folder is present, load personal.
//   - If not, give a default from the public folder.
//
// This is checked PER FILE, not per folder as a whole: for each of
// instructions.md and model.json, the personal file wins if it
// exists, otherwise the public/defaults/ file is used. That way a
// user who only customises instructions still gets the default
// model list, and vice versa. personal/.env is different: keys are
// NEVER read from a public folder — .env is personal only, and a
// fresh checkout without one simply has no keys (falling back to
// process.env for the named variable, as before).
//
//   personal/instructions.md  else public/defaults/instructions.md
//   personal/model.json       else public/defaults/model.json (or [])
//   personal/.env             only (never public)
//
// personal/ is gitignored (see .gitignore). The public defaults are
// read-only fallback: user-added saves write to personal/ (creating
// it if needed), never to public/defaults/. The old personal/desk.js
// is gone — this file is the desk loader now, so a fresh checkout
// works from public/defaults/ alone, and creating personal/ locally
// customises it without touching the repo.
//
//   const desk = createDesk(); // defaults: personal + public/defaults
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

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { createCoreTools } from "./core-tools.js";
import { createEngine } from "./engine.js";
import { createInference } from "./inference.js";

export function resolvePersonalDir(location = "personal") {
  if (typeof location !== "string" || location.trim() === "") {
    throw new Error("desk needs a personal folder location");
  }
  return isAbsolute(location)
    ? location
    : join(/* turbopackIgnore: true */ process.cwd(), location);
}

export function resolveDefaultsDir(location = "public/defaults") {
  if (typeof location !== "string" || location.trim() === "") {
    throw new Error("desk needs a defaults folder location");
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

// Read model.json from one directory. Absent file -> empty list.
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

// Per-file fallback: personal file wins if it exists, otherwise the
// public defaults file, otherwise (for model.json) an empty list.
export function readInstructionsWithFallback(personalDir, defaultsDir) {
  const personalFile = join(personalDir, "instructions.md");
  if (existsSync(personalFile)) {
    return {
      instructions: readFileSync(personalFile, "utf8").trim(),
      source: "personal",
    };
  }
  const defaultsFile = join(defaultsDir, "instructions.md");
  if (existsSync(defaultsFile)) {
    return {
      instructions: readFileSync(defaultsFile, "utf8").trim(),
      source: "public",
    };
  }
  throw new Error(
    `desk could not read instructions.md at ${personalFile} or ${defaultsFile}`,
  );
}

export function readModelListWithFallback(personalDir, defaultsDir) {
  if (existsSync(join(personalDir, "model.json"))) {
    return { list: readModelList(personalDir), source: "personal" };
  }
  if (existsSync(join(defaultsDir, "model.json"))) {
    return { list: readModelList(defaultsDir), source: "public" };
  }
  return { list: [], source: "none" };
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

export function createDesk(
  location = "personal",
  { defaultsDir, fetchImpl } = {},
) {
  const dir = resolvePersonalDir(location);
  const defaults = resolveDefaultsDir(defaultsDir ?? "public/defaults");
  const { instructions, source } = readInstructionsWithFallback(dir, defaults);
  const { list: modelList } = readModelListWithFallback(dir, defaults);
  // .env is personal only — never read from public/defaults.
  const envValues = readEnvFile(dir);
  const engine = createEngine({
    instructions,
    metadata: { location: dir, source },
  });
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
  if (defaultInference) {
    engine.model = defaultInference.id;
    engine.inference = defaultInference;
  }
  // Default agent loads ALL core tools: files.* + terminal.*,
  // no web tools (ignored for now). The files tool loads the
  // project root into logical space; the terminal tool is scoped
  // to the same root. The single-turn chat does NOT invoke tools
  // yet — they are loaded, listed, and shown in the UI, and
  // tool-calling by the LLM is a later feature.
  const core = createCoreTools({ filesLocation: process.cwd() });
  engine.tools = core.tools;
  engine.listTools = () => core.listTools();
  const tools = core.tools;
  const listTools = () => core.listTools();
  return {
    engine,
    inferences,
    defaultInference,
    location: dir,
    tools,
    listTools,
    coreTools: core,
  };
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
