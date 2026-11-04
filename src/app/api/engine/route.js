// GET /api/engine — the live engine object for the UI.
// Uses the single engine object (getEngineObject) and returns
// { engine: engine.twin(), defaultInference, hasDefault,
// inferenceCount }. The twin carries model id, metadata, and a
// short instructions preview only. No key is ever returned, and
// apiKeyEnv is omitted entirely — even a key name is not needed
// by the UI, and omitting it avoids leaking anything secret-adjacent.
import { publicDesk } from "@/core/desk.js";
import { getEngineObject } from "@/core/engine-object.js";

export async function GET() {
  try {
    const desk = getEngineObject("personal").desk;
    const pub = publicDesk(desk);
    return Response.json({
      engine: desk.engine.twin(),
      defaultInference: pub.defaultInference,
      hasDefault: pub.hasDefault,
      inferenceCount: pub.inferences.length,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }
}
