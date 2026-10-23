// An engine's live work (`state.activity`), shared by engines and the UI.
//   idle | llm (waiting: the model call in flight) | tool | tools
//   | waiting (idle, quests out: `names` are the agents it waits for)
// (`tools`: a parallel group; `names` lists its calls)
// A step's calls (tool | tools | waiting, companion/team/kernel-team.js): `calls` [{index, name, inputs, kind, view}]
// not answered yet, each with its index in the step (its place in the model's reply, kept while the others finish);
// `stage` the step's number, `since` its start, `row` its thread row's id. (2026-10-17: index and row give a call
// one identity in the Live feed while it runs and once it is done, backend/live/follow.js.)

export const IDLE = Object.freeze({ phase: "idle" })

// Human-readable live status for an activity.
export function describeActivity(activity) {
  switch (activity?.phase) {
    case "llm":
      return activity.n ? `Calling LLM… (step ${activity.n})` : "Calling LLM…"
    case "tool":
      return `Calling tool ${activity.name}…`
    case "waiting":
      return `Waiting for ${activity.names.join(", ")}`
    case "tools":
      return `Running ${activity.names.length} calls in parallel: ${activity.names.join(", ")}…`
    default:
      return "Idle"
  }
}
