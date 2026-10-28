// An agent's visual state (VISUAL_STATES, backend/live/visual.js) → classes, shared by the dashboard's desk
// (components/kernel/desk-levels.jsx), the canvas (components/canvas/) and the key to them (StateLegend). -500 lines read on white and on OLED
// black; text pairs a dark shade (light theme) with a light one (dark theme).
export const TONE = {
  llm: { line: "border-violet-500", soft: "border-violet-500/70 bg-violet-500/10", dot: "bg-violet-500", text: "text-violet-700 dark:text-violet-300", stroke: "stroke-violet-500", live: true },
  tool: { line: "border-amber-500", soft: "border-amber-500/70 bg-amber-500/10", dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-300", stroke: "stroke-amber-500", live: true },
  quest: { line: "border-blue-500", soft: "border-blue-500/70 bg-blue-500/10", dot: "bg-blue-500", text: "text-blue-700 dark:text-blue-300", stroke: "stroke-blue-500", live: true },
  waiting: { line: "border-sky-500", soft: "border-sky-500/70 bg-sky-500/10", dot: "bg-sky-500", text: "text-sky-700 dark:text-sky-300", stroke: "stroke-sky-500", dashed: true },
  error: { line: "border-red-500", soft: "border-red-500/70 bg-red-500/10", dot: "bg-red-500", text: "text-red-700 dark:text-red-400", stroke: "stroke-red-500" },
  done: { line: "border-emerald-500", soft: "border-emerald-500/70 bg-emerald-500/10", dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-300", stroke: "stroke-emerald-500" },
  idle: { line: "border-border", soft: "border-border", dot: "bg-muted-foreground/50", text: "text-muted-foreground", stroke: "stroke-border" },
}

// The border and the dot as drawn: a waiting one dashed, a live one pulsing.
export const ring = (t) => `${t.line}${t.dashed ? " border-dashed" : ""}`
export const pulse = (t) => `${t.dot}${t.live ? " motion-safe:animate-pulse" : ""}`

// A link with a quest out on it (lead → member).
export const QUEST_LINK = "bg-blue-500 motion-safe:animate-pulse"
