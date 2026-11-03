// POST /api/chat — server proxy for one chat turn.
// Body: { endpoint, apiKey?, model, messages }.
// Instructions are NOT accepted from the client. The engine is always
// loaded from personal/instructions.md on the server, re-read on every
// request, so editing that file takes effect without a restart.
// Returns { reply }.
import { chat, loadEngineFromLocation } from "@/core/engine.js";

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
  if (typeof body?.endpoint !== "string" || body.endpoint.trim() === "") {
    return Response.json({ error: "endpoint is required" }, { status: 400 });
  }
  if (typeof body?.model !== "string" || body.model.trim() === "") {
    return Response.json({ error: "model is required" }, { status: 400 });
  }
  if (!Array.isArray(body?.messages)) {
    return Response.json(
      { error: "messages must be an array" },
      { status: 400 },
    );
  }
  try {
    const engine = loadEngineFromLocation("personal");
    const reply = await chat(engine, {
      endpoint: body.endpoint,
      apiKey: body.apiKey,
      model: body.model,
      messages: body.messages,
    });
    return Response.json({ reply });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }
}
