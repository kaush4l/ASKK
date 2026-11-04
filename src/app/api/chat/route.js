// POST /api/chat — LEGACY single-turn path, kept for
// single-turn compatibility only. It is NOT the harness chain:
// it makes exactly one model call and returns one reply, with
// no goal.create, no developer, no plan -> execute -> critique.
// The primary entry is POST /api/harness (harness -> goal ->
// developer -> complete -> report back), and the dashboard chat
// (src/app/page.js send()) uses /api/harness, not this route.
// This route is deliberately NOT removed yet because external
// single-turn callers may still use it; it must not be mistaken
// for the success-criterion path. See PR.md Milestone 2.
// Server proxy for one chat turn.
// Body: { inferenceId?, endpoint?, apiKey?, model?, messages }.
// Instructions are NOT accepted from the client. The prompt is
// rendered from the SINGLE engine object (getEngineObject):
// engine.renderPrompt() — the same ordered elements the UI
// shows — so what the model reads and what the UI shows are one
// object, not two lists. (The old path sent only instructions +
// history, which is exactly how the model could answer "what
// tools do you have" generically while the card showed Tools.)
// The engine object is cached per server process: a second tab
// or reload sees the same object, not a fresh desk. That also
// means desk config edits take effect on server restart, not
// per request — the singleton trade-off, stated plainly.
// Resolution: an explicit inferenceId, else an explicit
// endpoint+model one-off, else the desk default (the first entry
// in personal/model.json). If no model is configured at all,
// askEngine() throws a clear "no model configured" error instead
// of inventing one. Returns { reply } — shape unchanged.

import { askEngine, getEngineObject } from "@/core/engine-object.js";
import { createInference } from "@/core/inference.js";

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
  if (!Array.isArray(body?.messages)) {
    return Response.json(
      { error: "messages must be an array" },
      { status: 400 },
    );
  }
  try {
    const engine = getEngineObject("personal");
    const desk = engine.desk;
    let inference = desk.defaultInference;
    if (typeof body?.inferenceId === "string" && body.inferenceId !== "") {
      inference = desk.inferences.find(
        (entry) => entry.id === body.inferenceId,
      );
      if (!inference) {
        return Response.json(
          { error: `no inference with id ${body.inferenceId}` },
          { status: 400 },
        );
      }
    } else if (
      typeof body?.endpoint === "string" &&
      body.endpoint.trim() !== "" &&
      typeof body?.model === "string" &&
      body.model.trim() !== ""
    ) {
      inference = createInference({
        endpoint: body.endpoint,
        apiKey: body.apiKey,
        model: body.model,
      });
    }
    const { reply } = await askEngine(engine, {
      inference,
      messages: body.messages,
    });
    return Response.json({ reply });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }
}
