// POST /api/harness — the harness entry point, and the
// dashboard chat's primary path (src/app/page.js send()).
// Body: { request, inferenceId?, endpoint?, apiKey?, model? }.
// `request` is an owner request in plain words, NOT a messages
// array: the harness translates it into exactly one goal.create
// call (statement only), passes the goal to the developer, and
// returns the developer's report. The work runs on the SINGLE
// engine object (getEngineObject): the goal and developer state
// the live-agent section shows are this same object's state.
// Resolution: an explicit inferenceId, else an explicit
// endpoint+model one-off, else the desk default. If no model is
// configured at all, the harness throws a clear "no model
// configured" error instead of inventing one. Returns
// { report, goal, goalCreateCalls, developer, harnessHistory }.
// The former single-turn /api/chat route was DELETED in
// Milestone 4: it was not used by any UI, so it was removed
// rather than left as a legacy comment.

import { runHarnessRequest } from "@/core/harness-route.js";
import { createInference } from "@/core/inference.js";
import { getStartedEngine } from "@/core/startup.js";

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
  if (typeof body?.request !== "string" || body.request.trim() === "") {
    return Response.json(
      { error: "request must be a non-empty string" },
      { status: 400 },
    );
  }
  try {
    const engine = getStartedEngine("personal");
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
    const result = await runHarnessRequest(engine, {
      request: body.request,
      inference,
    });
    return Response.json({
      report: result.report,
      goal: result.goal,
      goalCreateCalls: result.goalCreateCalls,
      developer: result.developer,
      harnessHistory: result.harnessHistory,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }
}
