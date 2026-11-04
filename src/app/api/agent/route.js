// GET /api/agent — the default agent twin for the combined view.
// Builds the desk via src/core/desk.js createDesk() and returns
// desk.agent: id, name, source (personal | public | built-in),
// soul (instructions/fallback/preview), model (desk default note
// + resolved desk default, if any), tools (16 core, 0 web),
// live artifact (id/location/state/history as logical strings),
// and the initialization steps. No keys, no absolute paths, no
// .env content — the agent.md loader drops any key value it finds.
import { createDesk } from "@/core/desk.js";

export async function GET() {
  try {
    const desk = createDesk("personal");
    return Response.json({ agent: desk.agent });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }
}
