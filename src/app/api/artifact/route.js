// GET /api/artifact — the live artifact, for the UI's panel.
// Read-only in effect: it returns the artifact twin, bounded open
// file previews, and parsed history entries, and it creates NO
// history entry and writes NO state. Building the desk loads (never
// creates) the saved artifact, so this route has no side effects.
// No keys, no absolute paths, no .env content are returned.
import { getEngineObject } from "@/core/engine-object.js";

export async function GET() {
  try {
    const desk = getEngineObject("personal").desk;
    const artifact = desk.liveArtifact;
    const openFiles = await artifact.openPreviews();
    return Response.json({
      artifact: artifact.twin(),
      openFiles,
      history: artifact.history(),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }
}
