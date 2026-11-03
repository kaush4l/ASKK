// POST /api/models — server proxy for the OpenAI-standard models list.
// Body: { endpoint, apiKey? }. Returns { models: [id, ...] }.
// The browser never calls the model server directly, so local servers
// with no CORS headers still work.
import { listModels } from "@/core/inference.js";

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
  try {
    const models = await listModels({
      endpoint: body.endpoint,
      apiKey: body.apiKey,
    });
    return Response.json({ models });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }
}
