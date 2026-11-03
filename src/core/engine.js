// Engine — a single, configuration-driven chat engine. Skeleton only.
//
// There is no loop here, no tool calls, no gates, no inbox: one user
// query in, one LLM reply out. That is the whole skeleton, deliberately,
// so the next steps can expand it one piece at a time.
//
// An engine is an object created with string instructions, plus an
// optional model parameter:
//
//   const engine = createEngine({ instructions, metadata, model });
//
// - `instructions` is a string, the system message for every chat.
//   It is not bundled in code: it is read from a file (see below).
// - `metadata` is an optional plain object, stored on the engine and
//   unused for now. It is the expansion point.
// - `model` is optional. When given, it is an inference id (an entry
//   id in personal/model.json); if no inference has that id, it falls
//   back to matching by model string. When absent, the engine uses
//   the desk default — the first entry in personal/model.json — and
//   the desk script wires that in (see personal/desk.js).
//
// Initialization from a location:
//
//   const engine = loadEngineFromLocation("personal");
//
// reads personal/instructions.md (relative to the project root, or an
// absolute directory) and returns an engine with
// metadata: { location }. It does not read model.json: model
// resolution belongs to the desk, not to the bare engine.
//
// Chat flow:
//
//   chat(engine, { inference, inferences, messages })
//
// prepends { role: "system", content: engine.instructions } to the
// caller's message history and makes exactly one infer() call on the
// resolved inference. Resolution order: the `inference` argument, then
// an entry in `inferences` matching engine.model by id and then by
// model string (so an engine model overrides the desk default), then
// an inference attached to the engine (engine.inference, set by the
// desk to its default). If nothing resolves, chat() throws a
// clear "no model configured" error instead of inventing a model.

import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export function createEngine({ instructions, metadata = {}, model }) {
  if (typeof instructions !== "string" || instructions.trim() === "") {
    throw new Error("engine needs string instructions");
  }
  if (
    metadata === null ||
    typeof metadata !== "object" ||
    Array.isArray(metadata)
  ) {
    throw new Error("engine metadata, when given, must be a plain object");
  }
  if (model !== undefined && typeof model !== "string") {
    throw new Error("engine model, when given, must be a string");
  }
  const engine = { instructions, metadata };
  if (typeof model === "string" && model.trim() !== "") {
    engine.model = model;
  }
  // The engine's live twin: plain data for the UI, nothing else.
  // It reads the engine's current model, so a desk that wires in
  // its default after creation still shows up correctly. It never
  // includes an inference object, a key, or any secret.
  engine.twin = () => twin(engine);
  return engine;
}

// Plain-data twin of an engine for the UI (the live engine object).
// instructionsPreview is the first line of the instructions,
// truncated — the full file is not sent to the browser.
export function twin(engine) {
  if (!engine || typeof engine.instructions !== "string") {
    throw new Error("twin needs an engine created with string instructions");
  }
  const firstLine = engine.instructions.split(/\r?\n/)[0].trim();
  const instructionsPreview =
    firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine;
  return {
    element: "engine",
    model: typeof engine.model === "string" ? engine.model : null,
    metadata: engine.metadata ?? {},
    instructionsPreview,
  };
}

export function loadEngineFromLocation(location) {
  if (typeof location !== "string" || location.trim() === "") {
    throw new Error(
      "engine needs a location directory containing instructions.md",
    );
  }
  const dir = isAbsolute(location)
    ? location
    : join(/* turbopackIgnore: true */ process.cwd(), location);
  const file = join(dir, "instructions.md");
  let contents;
  try {
    contents = readFileSync(file, "utf8");
  } catch {
    throw new Error(`engine could not read instructions.md at ${file}`);
  }
  return createEngine({
    instructions: contents.trim(),
    metadata: { location },
  });
}

export function resolveInference(engine, { inference, inferences } = {}) {
  if (inference) {
    return inference;
  }
  const list = Array.isArray(inferences) ? inferences : [];
  // An explicit engine model overrides the desk default: match it
  // in the inferences list first, before falling back to the
  // inference the desk attached to the engine (its default).
  if (typeof engine?.model === "string" && engine.model !== "") {
    const matched =
      list.find((entry) => entry?.id === engine.model) ??
      list.find((entry) => entry?.model === engine.model);
    if (matched) {
      return matched;
    }
  }
  if (engine?.inference) {
    return engine.inference;
  }
  return null;
}

export async function chat(engine, { inference, inferences, messages } = {}) {
  if (!engine || typeof engine.instructions !== "string") {
    throw new Error("chat needs an engine created with string instructions");
  }
  const resolved = resolveInference(engine, { inference, inferences });
  if (!resolved || typeof resolved.infer !== "function") {
    throw new Error(
      "no model configured: add a default inference to personal/model.json, or pass an inference to chat()",
    );
  }
  const history = Array.isArray(messages) ? messages : [];
  return resolved.infer([
    { role: "system", content: engine.instructions },
    ...history,
  ]);
}
