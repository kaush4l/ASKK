// Live activity — the engine's live state, like the old UI
// (backend/live/activity.js, lib/engine-tone.js).
//
// Phases, exactly like the old ones:
//   idle | llm | tool | tools | waiting
// plus UI states this skeleton actually reaches:
//   connecting | no-model | error
//
// The distinction is the expectation of the answer, not a different
// kind of code (see the tools taxonomy): llm is one model call in
// flight, tool is one tool call, tools is several calls in parallel,
// waiting is a stream of events/quests outstanding. Tool, tools and
// waiting are DEFINED here but must NOT fire yet — this skeleton
// has no tools, so the UI only ever shows idle, llm, connecting,
// no-model and error. Inventing a tool call to demo them would be
// fake activity; they are placeholders for the tools feature.
//
// describeActivity() gives the human text, engineTone() gives the
// dot colour and a few words, both shared by the UI (status strip
// and live panel) so they can never drift apart.

export const ACTIVITY_PHASES = Object.freeze([
  "idle",
  "llm",
  "tool",
  "tools",
  "waiting",
  "connecting",
  "no-model",
  "error",
]);

export const IDLE = Object.freeze({ phase: "idle" });

// Human-readable live status for an activity, like the old
// describeActivity. `n` is a step number for llm, `name` a single
// tool name, `names` a list of tools/agents.
export function describeActivity(activity) {
  switch (activity?.phase) {
    case "llm":
      return activity.n ? `Calling LLM… (step ${activity.n})` : "Calling LLM…";
    case "tool":
      return activity.name ? `Calling tool ${activity.name}…` : "Calling tool…";
    case "tools": {
      const names = Array.isArray(activity.names) ? activity.names : [];
      return names.length > 0
        ? `Running ${names.length} calls in parallel: ${names.join(", ")}…`
        : "Running calls in parallel…";
    }
    case "waiting": {
      const names = Array.isArray(activity.names) ? activity.names : [];
      return names.length > 0 ? `Waiting for ${names.join(", ")}` : "Waiting…";
    }
    case "connecting":
      return "Connecting…";
    case "no-model":
      return "No model configured";
    case "error":
      return activity.error ? `Error: ${activity.error}` : "Error";
    default:
      return "Idle";
  }
}

// How an engine's state reads at a glance: tone, dot colour, words.
// `state` may be { activity } or an activity itself. No state at all
// means starting (grey dot), like the old engineTone.
export function engineTone(state) {
  if (!state) {
    return {
      tone: "starting",
      dot: "bg-muted-foreground/40",
      word: "starting",
    };
  }
  const activity = state.activity ?? state;
  const phase = activity?.phase;
  if (phase === "error" || state.status === "error") {
    return {
      tone: "error",
      dot: "bg-destructive",
      word: describeActivity(activity),
    };
  }
  if (phase === "llm" || phase === "tool" || phase === "tools") {
    return {
      tone: "running",
      dot: "bg-emerald-500 animate-pulse",
      word: describeActivity(activity),
    };
  }
  if (phase === "waiting") {
    return {
      tone: "waiting",
      dot: "bg-amber-500",
      word: describeActivity(activity),
    };
  }
  if (phase === "connecting") {
    return {
      tone: "starting",
      dot: "bg-muted-foreground/40",
      word: "Connecting…",
    };
  }
  if (phase === "no-model") {
    return {
      tone: "idle",
      dot: "bg-muted-foreground/40",
      word: "No model configured",
    };
  }
  return { tone: "idle", dot: "bg-muted-foreground/40", word: "Idle" };
}
