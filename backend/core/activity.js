// An engine's live work (`state.activity`), shared by engines and the UI.
//   idle | llm (waiting → thinking → responding) | parsing | tool | agent | tools | approval | summarizing | compacting
//   | waiting (idle, quests out: `names` are the agents it waits for)
// (`tools`: a parallel group; `names` lists its calls)

export const IDLE = Object.freeze({ phase: "idle" })

// Human-readable live status for an activity.
export function describeActivity(activity) {
  switch (activity?.phase) {
    case "llm":
      return (
        ({ waiting: "Calling LLM…", thinking: "Thinking…", responding: "Writing response…" }[activity.stage] ?? "") +
        (activity.retry ? ` (retry ${activity.retry}: the model failed, trying again)` : "")
      )
    case "parsing":
      return "Parsing response…"
    case "tool":
      return `Calling tool ${activity.name}…`
    case "agent":
      return `Handing a quest to ${activity.name}…`
    case "waiting":
      return `Waiting for ${activity.names.join(", ")}`
    case "tools":
      return `Running ${activity.names.length} calls in parallel: ${activity.names.join(", ")}…`
    case "approval":
      return `Waiting for your approval: ${activity.name}`
    case "summarizing":
      return "Summarizing memory…"
    case "compacting":
      return `Compacting ${activity.name}…`
    default:
      return "Idle"
  }
}
