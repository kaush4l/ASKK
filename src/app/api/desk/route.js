// GET /api/desk — desk state for the browser. Returns
// { hasDefault, defaultInference, inferences }, each inference as
// { id, provider, endpoint, model } only. Keys are never returned:
// the desk resolves them server-side from personal/.env, and
// publicDesk() strips them before responding.
// If no model is present, hasDefault is false and the UI asks for
// a default first; if any is present, the first entry is the default.
import { publicDesk } from "@/core/desk.js";
import { getStartedEngine } from "@/core/startup.js";

export async function GET() {
  try {
    const desk = getStartedEngine("personal").desk;
    return Response.json(publicDesk(desk));
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }
}
