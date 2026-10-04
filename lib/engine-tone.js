import { describeActivity } from "@/backend/core/activity"

// How an engine's state reads at a glance, shared by the status bar and the
// home page: `tone` (idle | running | waiting | attention | error), the dot
// colour, and a few words.
export function engineTone(state) {
  if (!state) return { tone: "idle", dot: "bg-muted-foreground/40", word: "starting" }
  if (state.approvals?.length) return { tone: "attention", dot: "bg-amber-500 animate-pulse", word: "needs your approval" }
  if (state.status === "error") return { tone: "error", dot: "bg-destructive", word: "error" }
  if (state.status === "running") return { tone: "running", dot: "bg-emerald-500 animate-pulse", word: describeActivity(state.activity) }
  if (state.activity?.phase === "waiting") return { tone: "waiting", dot: "bg-amber-500", word: describeActivity(state.activity) }
  return { tone: "idle", dot: "bg-muted-foreground/40", word: "idle" }
}

// "planner" -> "Pl", "planner 2" -> "Pl2" (as in the engine bar)
export function initials(name) {
  const [word, suffix = ""] = name.split(" ")
  return word.slice(0, 1).toUpperCase() + word.slice(1, 2) + suffix
}
