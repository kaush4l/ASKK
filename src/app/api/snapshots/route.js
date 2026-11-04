// GET /api/snapshots — list snapshots, twins only.
// POST /api/snapshots — take a snapshot from the current desk.
//
// GET returns snapshotTwin() entries only: id, at, desk model /
// provider / status, message and step counts, progress, partial.
// No keys, no absolute paths, no artifact file paths — those live
// in the full snapshot behind GET /api/snapshots/<id>, as logical
// paths, like the artifact route.
//
// POST takes a snapshot from the single live desk instance:
// getEngineObject("personal").desk gives the desk, captureFromDesk derives
// its twin, soul/tools versions, and live artifact state at that
// moment, and saveSnapshot deep-copies them into
// personal/memory/agent/<id>/snapshots/<snapshot-id>.json (+ a
// .md summary beside it). The caller may supply the session
// messages (the server holds no session) and, when a future loop
// records them, steps; when no steps are supplied, one
// message-step per message is stored, with thought null and no
// calls — labelled not captured in replay, never invented.
// Snapshot creation writes ONLY the snapshot files: it never
// rewrites state.md, never appends to history.md, and never
// writes to public/defaults/.
import { getEngineObject } from "@/core/engine-object.js";
import { snapshotTwin } from "@/core/snapshot.js";
import {
  captureFromDesk,
  listSnapshots,
  saveSnapshot,
} from "@/core/snapshot-store.js";

export async function GET() {
  try {
    const desk = getEngineObject("personal").desk;
    const snapshots = listSnapshots(desk.location, "default");
    return Response.json({ snapshots: snapshots.map(snapshotTwin) });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }
}

export async function POST(request) {
  try {
    const body = (await request.json().catch(() => ({}))) ?? {};
    const desk = getEngineObject("personal").desk;
    const snapshot = captureFromDesk(desk, {
      ...(typeof body.id === "string" ? { id: body.id } : {}),
      messages: Array.isArray(body.messages) ? body.messages : [],
      steps: Array.isArray(body.steps) ? body.steps : [],
    });
    const saved = saveSnapshot(desk.location, snapshot, "default");
    return Response.json({ snapshot: saved });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }
}
