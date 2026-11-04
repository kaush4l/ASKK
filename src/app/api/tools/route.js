// GET /api/tools — the tools, for the UI's Tools panel.
// Milestone 4: these specs come from the ONE local registry
// (engine.toolsRegistry), never from a second list. The specs
// here, the registry's describeAll(), and the prompt's tools
// element string are the same tools, via the single reader
// (tool.js describeTool). Returns plain specs (name,
// description, input, expectation) plus live state, and nothing
// else: no run functions, no keys, no physical filesystem paths
// (the files state shows logical paths only), and no web tools
// — web is ignored for now.
import { getStartedEngine } from "@/core/startup.js";

export async function GET() {
  try {
    const engine = getStartedEngine("personal");
    const desk = engine.desk;
    const core = desk.coreTools;
    const registry = engine.toolsRegistry ?? null;
    return Response.json({
      tools: registry ? registry.specs() : desk.listTools(),
      toolNames: registry
        ? registry.list().map((t) => t.name)
        : desk.listTools().map((t) => t.name),
      describeAll: registry ? registry.describeAll() : null,
      files: core.files.stateForUI(),
      terminal: core.terminal.stateForUI(),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }
}
