// Engine — a single, configuration-driven chat engine. Skeleton only.
//
// This replaces the earlier loop engine (agent.js, deleted). There is
// no loop here, no tool calls, no gates, no inbox: one user query in,
// one LLM reply out. That is the whole skeleton, deliberately, so the
// next steps can expand it one piece at a time.
//
// An engine is an object created with string instructions:
//
//   const engine = createEngine({ instructions, metadata });
//
// - `instructions` is a string, the system message for every chat.
//   It is not bundled in code: it is read from a file (see below).
// - `metadata` is an optional plain object, stored on the engine and
//   unused for now. It is the expansion point — later steps can put
//   name, role, model defaults, or anything else here without
//   changing the engine's shape.
//
// Initialization from a location:
//
//   const engine = loadEngineFromLocation("personal");
//
// reads personal/instructions.md (relative to the project root, or an
// absolute directory) and returns an engine with
// metadata: { location }. The chat route re-reads that file on every
// request, so editing personal/instructions.md takes effect without
// a restart.
//
// Chat flow:
//
//   chat(engine, { endpoint, apiKey, model, messages })
//
// prepends { role: "system", content: engine.instructions } to the
// caller's message history and makes exactly one infer() call, via
// src/core/inference.js (OpenAI-standard, no bundled model).

import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { infer } from "./inference.js";

export function createEngine({ instructions, metadata = {} }) {
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
  return { instructions, metadata };
}

export function loadEngineFromLocation(location) {
  if (typeof location !== "string" || location.trim() === "") {
    throw new Error(
      "engine needs a location directory containing instructions.md",
    );
  }
  const dir = isAbsolute(location) ? location : join(/* turbopackIgnore: true */ process.cwd(), location);
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

export async function chat(
  engine,
  { endpoint, apiKey, model, messages, fetchImpl },
) {
  if (!engine || typeof engine.instructions !== "string") {
    throw new Error("chat needs an engine created with string instructions");
  }
  const history = Array.isArray(messages) ? messages : [];
  return infer({
    endpoint,
    apiKey,
    model,
    messages: [{ role: "system", content: engine.instructions }, ...history],
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}
