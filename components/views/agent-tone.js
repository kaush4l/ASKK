// An agent's visual state (VISUAL_STATES, backend/live/visual.js) → classes, shared by the home tree
// (components/home/constellation.jsx) and the canvas (components/canvas/). -500 lines read on white and on OLED
// black; text pairs a dark shade (light theme) with a light one (dark theme).
export const TONE = {
  llm: { line: "border-violet-500", dot: "bg-violet-500", text: "text-violet-700 dark:text-violet-300", stroke: "stroke-violet-500", live: true },
  tool: { line: "border-amber-500", dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-300", stroke: "stroke-amber-500", live: true },
  quest: { line: "border-blue-500", dot: "bg-blue-500", text: "text-blue-700 dark:text-blue-300", stroke: "stroke-blue-500", live: true },
  waiting: { line: "border-sky-500", dot: "bg-sky-500", text: "text-sky-700 dark:text-sky-300", stroke: "stroke-sky-500", dashed: true },
  error: { line: "border-red-500", dot: "bg-red-500", text: "text-red-700 dark:text-red-400", stroke: "stroke-red-500" },
  done: { line: "border-emerald-500", dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-300", stroke: "stroke-emerald-500" },
  idle: { line: "border-border", dot: "bg-muted-foreground/50", text: "text-muted-foreground", stroke: "stroke-border" },
}

// A link with a quest out on it (lead → member).
export const QUEST_LINK = "bg-blue-500 motion-safe:animate-pulse"
