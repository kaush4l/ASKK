// GET /api/snapshots/<id> — one full snapshot, for replay.
// Read-only in effect: loading a snapshot writes nothing — no
// history entry, no state rewrite, mirroring GET /api/artifact.
// The full snapshot carries logical artifact paths (open /
// modified), like the artifact twin; it carries no keys, no
// absolute paths, and no .env content. Unknown ids are 404, bad
// ids (path traversal attempts) are 400.
import { createDesk } from "@/core/desk.js";
import { loadSnapshot } from "@/core/snapshot-store.js";
import { checkSnapshotId } from "@/core/snapshot.js";

export async function GET(_request, { params }) {
  try {
    const id = checkSnapshotId((await params).id);
    const desk = createDesk("personal");
    const snapshot = loadSnapshot(desk.location, id, "default");
    if (!snapshot) {
      return Response.json({ error: "snapshot not found" }, { status: 404 });
    }
    return Response.json({ snapshot });
  } catch (error) {
    const status = /snapshot id must be/.test(error.message) ? 400 : 502;
    return Response.json({ error: error.message }, { status });
  }
}
