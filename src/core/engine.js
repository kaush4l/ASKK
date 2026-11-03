// Engine — the entry point for the agent loop in src/core/.
//
// The engine is not a separate machine from the agent: in the old system
// the agent class itself was the loop (backend/kernel/agent/agent.js), and
// a desk (backend/kernel/desk/desk.js) was just configuration in, live
// agents out. So this file is a thin factory over agent.js: it validates
// the one thing the loop cannot work without — an injected infer function
// — and hands back an Agent ready to ask().
//
// No model is bundled, and no agent library is used. A caller that wants
// a real run passes infer(prompt, agent, { signal }) -> a model reply
// (JSON or field-style, see parseReply in agent.js). A caller that wants
// a test passes a fake infer that returns canned replies.
//
// What is NOT here yet (see agent.js and src/core/README.md):
//   - a desk builder (spec -> agents, teams, shared board) — the old
//     buildDesk; agents are created one at a time for now.
//   - a host (files, web, MCP servers, local models) — tools are plain
//     functions passed in, with a context object for whatever a tool
//     needs from its host.
//   - letters, supervision digests, chat(), prompt compaction.

import { Agent } from "./agent.js";

export {
  Agent,
  AgentTool,
  parseReply,
  RESPONSE_FORMAT,
  Tool,
} from "./agent.js";

// Create an agent. config: { name (required), role, soul, model (a label
// only — the model itself lives behind infer), maxSteps, ... }.
// options: { infer (required), tools, artifacts, context }.
export function createAgent(config, options) {
  if (typeof options?.infer !== "function") {
    throw new Error(
      "engine needs infer(prompt, agent, options): no model is bundled",
    );
  }
  return new Agent(config, options);
}

// Convenience for a single run: build the agent, ask it, return its answer.
// The agent itself is returned on the result's `agent` property so a caller
// can read its history, steps (via on("step")), or twin().
export async function runAgent(config, options, request) {
  const agent = createAgent(config, options);
  const answer = await agent.ask(request, { from: options?.from ?? "owner" });
  return { answer, agent };
}
