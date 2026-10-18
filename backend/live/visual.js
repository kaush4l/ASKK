// One agent's live look, from its state — pure, no imports, so the server (the Telegram live status,
// companion/team/kernel-status.js) and the browser (desk.js re-exports it) read it the same way.
//
//   idle · llm (calling the model) · tool · quest (handing work to a sub-agent) · waiting (for
//   sub-agents' reports) · paused (waiting for the owner's approval) · error · done (reported)

export const VISUAL_STATES = [
  { id: "llm", label: "LLM call" },
  { id: "tool", label: "Tool call" },
  { id: "quest", label: "Quest to team" },
  { id: "waiting", label: "Waiting for reports" },
  { id: "paused", label: "Paused (approval)" },
  { id: "error", label: "Error" },
  { id: "done", label: "Reported" },
  { id: "idle", label: "Idle" },
]

const clip = (text, n) => {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim()
  return flat.length > n ? `${flat.slice(0, n)}…` : flat
}

// → { state, message, active: [tool or agent names in use now] }. subAgents: the agent's own sub-agent
// tool names (a tools step that only calls them is a quest).
export function agentVisual(state, subAgents = []) {
  if (!state) return { state: "idle", message: "idle", active: [] }
  const a = state.activity ?? {}
  const names = a.names ?? (a.name ? [a.name] : [])
  if (state.status === "error") return { state: "error", message: clip(state.error ?? "error", 160), active: [] }
  switch (a.phase) {
    case "llm":
      return { state: "llm", message: a.stage === "thinking" ? "Thinking…" : a.stage === "responding" ? "Writing…" : "Calling the model…", active: [] }
    case "approval":
      return { state: "paused", message: `Paused: waiting for your approval of ${a.name}`, active: names }
    case "waiting":
      return { state: "waiting", message: `Waiting for ${names.join(", ")}`, active: names }
    case "agent":
      return { state: "quest", message: `Handing a quest to ${a.name}`, active: names }
    case "tool":
    case "tools": {
      const quest = names.length && names.every((n) => subAgents.includes(n))
      return { state: quest ? "quest" : "tool", message: names.length > 1 ? `${names.length} calls: ${names.join(", ")}` : `Calling ${names[0]}`, active: names }
    }
  }
  if (state.status === "running") return { state: "llm", message: "Working…", active: [] }
  const last = [...(state.messages ?? [])].reverse().find((m) => m.action === "answer")
  return last ? { state: "done", message: clip(last.content, 160), active: [] } : { state: "idle", message: "idle", active: [] }
}

// How one call looks, wherever it is drawn (the canvas's chips and step rows, the Live feed): its kind, a tone (a
// colour name the views map to classes) and an icon (a lucide name, so this stays pure). By the tool's type and
// view (kernel Tool `type`, `view`): a call is { kind?: agent | tool | gate | guidance, type?, view?, name? }.
const LOOKS = {
  quest: { tone: "blue", icon: "bot" },
  web: { tone: "sky", icon: "globe" },
  terminal: { tone: "emerald", icon: "terminal" },
  mcp: { tone: "cyan", icon: "plug" },
  artifact: { tone: "violet", icon: "clipboard-list" },
  board: { tone: "violet", icon: "clipboard-list" },
  list: { tone: "violet", icon: "list" },
  checklist: { tone: "violet", icon: "list-checks" },
  schedule: { tone: "violet", icon: "calendar-clock" },
  data: { tone: "amber", icon: "database" },
  function: { tone: "amber", icon: "wrench" },
  gate: { tone: "red", icon: "octagon-alert" },
  guidance: { tone: "orange", icon: "compass" },
  spawn: { tone: "pink", icon: "user-plus" }, // 2026-10-17: agent.spawn / agent.dismiss — a helper made or let go
  files: { tone: "teal", icon: "folder-tree" }, // 2026-10-17: the inbuilt files artifact's commands (read, write, edit …)
  preview: { tone: "indigo", icon: "app-window" }, // 2026-10-17: the inbuilt preview artifact's commands (open, click, shot …)
  stage: { tone: "fuchsia", icon: "presentation" }, // 2026-10-17: the stage's commands (show, scene, go, reply) — what the owner watches
}
export const CALL_KINDS = Object.keys(LOOKS)

const ARTIFACT_VIEWS = new Set(["board", "list", "checklist", "schedule"])

// The type says what a tool is (another agent, an MCP server's tool), else its view how it is drawn.
function callKind({ kind, type, view, name = "" } = {}) {
  if (kind === "gate" || view === "gate") return "gate"
  if (kind === "guidance" || view === "guidance") return "guidance"
  if (kind === "agent" || type === "agent" || view === "quest") return "quest"
  if (view === "spawn" || type === "spawn") return "spawn"
  if (type === "mcp") return "mcp"
  if (view === "web" || type === "web" || String(name).startsWith("web.")) return "web"
  if (view === "terminal" || type === "terminal") return "terminal"
  if (view === "files" || view === "preview" || view === "stage") return view
  if (ARTIFACT_VIEWS.has(view)) return view
  if (type === "artifact") return "artifact"
  if (view === "data") return "data"
  return "function"
}

export function callLook(call) {
  const kind = callKind(call ?? {})
  return { kind, ...LOOKS[kind] }
}
