// POST /api/inferences/default — change the desk default.
// Body: { id }. The entry with that id is moved to the front of
// personal/model.json, because the first entry IS the desk default.
// (The simpler of the two options: no separate "selected" default
// is stored; the list order is the default.) Returns the new default
// as { id, provider, endpoint, model }.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  moveInferenceToFront,
  readModelList,
  resolvePersonalDir,
} from "../../../../../personal/desk.js";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "request body must be JSON" },
      { status: 400 },
    );
  }
  if (typeof body?.id !== "string" || body.id.trim() === "") {
    return Response.json({ error: "id is required" }, { status: 400 });
  }
  try {
    const dir = resolvePersonalDir("personal");
    const nextList = moveInferenceToFront(readModelList(dir), body.id);
    writeFileSync(
      join(dir, "model.json"),
      `${JSON.stringify(nextList, null, 2)}\n`,
      "utf8",
    );
    const entry = nextList[0];
    return Response.json({
      defaultInference: {
        id: entry.id,
        provider: entry.provider,
        endpoint: entry.endpoint,
        model: entry.model,
      },
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }
}
