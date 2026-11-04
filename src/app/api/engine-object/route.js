// GET /api/engine-object — the single engine object, as data.
// Returns the CURRENT state/elements of the one engine object
// for this server process (getEngineObject): state snapshot,
// element strings in insert order, the rendered prompt, tool
// names, and the current goal. Every call returns the SAME
// object's current values — never a per-request fresh desk and
// never a cached stale copy. This is what the home page's
// live-agent section subscribes to (client-side signal fed by
// this route plus the live-event bus). There is no server push
// (no SSE/WebSocket): the next call returns the object's
// current state. No keys, no absolute paths.
import { getEngineObject } from "@/core/engine-object.js";

export async function GET() {
  try {
    const engine = getEngineObject("personal");
    return Response.json({
      state: engine.snapshot(),
      elementStrings: engine.elementStrings(),
      templateOrder: engine.templateOrder(),
      prompt: engine.renderPrompt(),
      tools: engine.tools.map((t) => t?.name ?? t),
      goal: engine.goal ? engine.goal.snapshot() : null,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }
}
