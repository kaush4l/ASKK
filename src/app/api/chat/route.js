// POST /api/chat — server proxy for one chat turn.
// Body: { inferenceId?, endpoint?, apiKey?, model?, messages }.
// Instructions are NOT accepted from the client. The desk is always
// loaded from personal/ on the server (instructions.md + model.json
// + .env, re-read on every request, so editing them takes effect
// without a restart). Resolution: an explicit inferenceId, else an
// explicit endpoint+model one-off, else the desk default (the first
// entry in personal/model.json). If no model is configured at all,
// chat() throws a clear "no model configured" error instead of
// inventing one. Returns { reply }.

import { createDesk } from "@/core/desk.js";
import { chat } from "@/core/engine.js";
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
    const desk = createDesk("personal");
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
    const reply = await chat(desk.engine, {
      inference,
      inferences: desk.inferences,
      messages: body.messages,
    });
    return Response.json({ reply });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }
}
