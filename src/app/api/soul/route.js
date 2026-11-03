// GET /api/soul — the soul of the desk: the agent's full
// instructions/persona text, for the render template's Soul
// section. Uses the desk loader's personal/public fallback:
// personal/instructions.md wins if present, otherwise
// public/defaults/instructions.md. A missing personal folder is
// never an error — it simply yields the public default.
// Returns { instructions, source: "personal" | "public" } only:
// no keys, no absolute paths, no .env content.
import { createDesk } from "@/core/desk.js";

export async function GET() {
  try {
    const desk = createDesk("personal");
    return Response.json({
      instructions: desk.engine.instructions,
      source: desk.engine.metadata?.source ?? "public",
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }
}
