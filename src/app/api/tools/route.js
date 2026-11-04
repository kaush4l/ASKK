// GET /api/tools — the core tools, for the UI's Tools panel.
// Returns plain specs (name, description, input, expectation) plus
// live state, and nothing else: no run functions, no keys, no
// physical filesystem paths (the files state shows logical paths
// only), and no web tools — web is ignored for now.
import { getEngineObject } from "@/core/engine-object.js";

export async function GET() {
  try {
    const desk = getEngineObject("personal").desk;
    const core = desk.coreTools;
    return Response.json({
      tools: desk.listTools(),
      files: core.files.stateForUI(),
      terminal: core.terminal.stateForUI(),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }
}
