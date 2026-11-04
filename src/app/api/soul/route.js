// GET /api/soul — soul AND instructions, separately.
// Soul is who the agent is (soul.md); instructions are how it
// answers (instructions.md). The two are never merged into one
// string. Each file has its own personal/public fallback:
// personal/soul.md else public/defaults/soul.md, and
// personal/instructions.md else public/defaults/instructions.md.
// A missing personal file is never an error — it simply yields
// the public default (soul) or the desk's instructions source.
// Returns { soul, instructions, source, soulSource,
// instructionsSource } only: no keys, no absolute paths, no
// .env content. `source` is "personal" if either file came from
// personal/, else "public" (or "none" if neither soul file
// exists); soulSource/instructionsSource give the exact
// per-file source.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createDesk } from "@/core/desk.js";

function readSoulFile(personalDir, defaultsDir) {
  const personalFile = join(personalDir, "soul.md");
  if (existsSync(personalFile)) {
    return {
      soul: readFileSync(personalFile, "utf8").trim(),
      source: "personal",
    };
  }
  const defaultsFile = join(defaultsDir, "soul.md");
  if (existsSync(defaultsFile)) {
    return {
      soul: readFileSync(defaultsFile, "utf8").trim(),
      source: "public",
    };
  }
  return { soul: "", source: "none" };
}

export async function GET() {
  try {
    const desk = createDesk("personal");
    const personalDir = desk.location;
    const defaultsDir = join(process.cwd(), "public/defaults");
    const { soul, source: soulSource } = readSoulFile(personalDir, defaultsDir);
    const instructions = desk.engine.instructions;
    const instructionsSource = desk.engine.metadata?.source ?? "public";
    const source =
      soulSource === "personal" || instructionsSource === "personal"
        ? "personal"
        : soulSource === "none" && instructionsSource === "none"
          ? "none"
          : "public";
    return Response.json({
      soul,
      instructions,
      source,
      soulSource,
      instructionsSource,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }
}
