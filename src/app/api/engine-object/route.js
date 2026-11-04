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
import { initializeDeskObjects } from "@/core/startup.js";

export async function GET() {
  try {
    const engine = getEngineObject("personal");
    // Scan-and-initialize on every snapshot read: the dashboard
    // shows the scanned objects as they are on disk right now
    // (agents, scripts, watchers, skills), not a load-time copy.
    // A scan failure is reported as scannedError, never as a 502
    // that hides the engine object itself.
    let scannedError = null;
    try {
      initializeDeskObjects(engine, {
        personalDir: engine.desk?.location ?? null,
        defaultsDir: engine.desk?.defaultsDir ?? null,
      });
    } catch (error) {
      scannedError = error.message;
    }
    return Response.json({
      state: engine.snapshot(),
      elementStrings: engine.elementStrings(),
      templateOrder: engine.templateOrder(),
      prompt: engine.renderPrompt(),
      tools: engine.tools.map((t) => t?.name ?? t),
      goal: engine.goal ? engine.goal.snapshot() : null,
      scanned: engine.scanned
        ? {
            counts: engine.scanned.counts,
            agents: engine.scanned.agents.map((a) => ({
              name: a.name,
              tools: a.toolNames,
              missingTools: a.missingTools,
            })),
            scripts: engine.scanned.scripts.map((s) => ({
              name: s.name,
              trigger: s.trigger,
              started: s.started,
            })),
            watchers: engine.scanned.watchers.map((w) => ({
              name: w.name,
              trigger: w.trigger,
              started: w.started,
            })),
            skills: engine.scanned.skills.map((s) => s.id),
          }
        : null,
      scannedError,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }
}
