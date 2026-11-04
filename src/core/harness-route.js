// Harness route logic — the exact function the /api/harness
// route handler calls, kept in core so bun tests can run it
// without Next route-handler imports.
//
// POST /api/harness is the dashboard chat's entry point (see
// src/app/page.js send()): body { request } — an owner request
// in plain words, NOT a messages array. This function builds a
// harness on the SAME engine object the route resolved
// (createHarness with opts.engine, never a second engine) and
// calls harness.ask(), which is the whole chain: translate the
// request into exactly one goal.create call (statement only),
// pass the goal to the developer, the developer runs its own
// plan -> execute -> critique loop, and reports back. The
// returned report is what the dashboard shows as the assistant
// reply, and the engine object's goal/agents state is what the
// live-agent section shows — one object, both views.
//
// The Next route handler itself (src/app/api/harness/route.js)
// is a thin wrapper: it parses the body, resolves the inference
// (explicit inferenceId, else endpoint+model one-off, else the
// desk default), and calls this function. A bun test cannot
// execute that wrapper (Next Request/Response imports), so the
// test proves this function end-to-end (mocked model, mocked
// terminal) and asserts the wrapper file calls it — function
// level proven, wiring asserted, neither claimed as the other.

import { createHarness } from "./harness.js";

export async function runHarnessRequest(
  engine,
  { request, inference = null } = {},
) {
  if (!engine || typeof engine !== "object" || !engine.desk) {
    throw new Error("harness route needs an engine object");
  }
  if (typeof request !== "string" || request.trim() === "") {
    throw new Error("harness route needs an owner request");
  }
  const harness = createHarness(engine.desk, { engine });
  return harness.ask(request, { inference });
}
