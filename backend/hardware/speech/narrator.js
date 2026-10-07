// The narrator: what changed in an engine's state, as short spoken lines.
//
//   narrate(before, after) → [{ kind, level, text, … }]
//
// level: 1 = always spoken (the answer, an approval, an error), 2 =
// milestones (quests out, reports back, a failed step, waiting), 3 =
// every step (each tool, thinking). The pipeline speaks what its
// narration setting allows and shows every line.

const PHRASES = {
  "fs.open": "Opening a file",
  "fs.close": null,
  "fs.read": "Reading a file",
  "fs.list": "Looking at a folder",
  "fs.write": "Writing a file",
  "fs.edit": "Editing a file",
  "fs.append": "Adding a note",
  "fs.delete": "Deleting a file",
  "term.run": "Running a command",
  "term.start": "Starting a program",
  "term.stop": "Stopping a program",
  "term.ps": null,
  "term.logs": "Reading a program's output",
  "web.search": "Searching the web",
  "web.read": "Reading a web page",
  "schedule.wake": "Booking the next run",
  "skills.load": "Loading a skill",
  "skills.unload": null,
  "checklist.tick": null,
  "checklist.skip": null,
  "agent.spawn": "Creating a helper agent",
  "agent.task": "Giving a helper more work",
  "agent.keep": "Keeping a helper on the team",
  "agent.kill": "Ending a helper",
  "quest.steer": "Steering a teammate",
  "quest.recall": "Calling a quest back",
  "book.read": "Reading the book",
  "telegram.send_message": "Sending you a Telegram message",
}

const words = (name) => name.replace(/^get_?/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_.]+/g, " ").toLowerCase().trim()

// "robinhood.get_option_quotes" → "Checking robinhood: option quotes".
export function toolPhrase(name) {
  if (!name) return "Working"
  if (name in PHRASES) return PHRASES[name]
  const [server, ...rest] = name.split(".")
  if (!rest.length) return `Asking ${name}`
  const tool = rest.join(".")
  return `${/^(get|read|list|search)/.test(tool) ? "Checking" : "Using"} ${server}: ${words(tool)}`
}

const list = (names) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`)

function activityLine(activity) {
  switch (activity?.phase) {
    case "llm":
      return activity.stage === "thinking" ? { text: "Thinking" } : null
    case "tool": {
      const text = toolPhrase(activity.name)
      return text ? { text, tool: activity.name } : null
    }
    case "tools": {
      const shown = [...new Set((activity.names ?? []).map(toolPhrase).filter(Boolean))]
      if (!shown.length) return null
      return { text: shown.length === 1 ? shown[0] : `${shown.length} things at once: ${list(shown.map((s) => s.toLowerCase()))}` }
    }
    case "agent":
      return { text: `Asking ${activity.name}` }
    case "summarizing":
      return { text: "Tidying up my memory" }
    case "compacting":
      return { text: "Compacting a file" }
    default:
      return null
  }
}

function describeApproval(approval) {
  const tool = approval.tool ?? approval.name ?? "a tool"
  const path = approval.inputs?.path
  const phrase = toolPhrase(tool) ?? tool
  return `${phrase.charAt(0).toLowerCase()}${phrase.slice(1)}${path ? `: ${path}` : ""}`
}

export function narrate(before, after) {
  if (!after) return []
  const out = []
  const was = before ?? {}

  // Messages that became an answer, a failed step or a report since. A
  // streamed reply exists before it is final, so compare each message with
  // its own earlier version, not only new ids.
  const earlier = new Map((was.messages ?? []).map((m) => [m.id, m]))
  for (const m of after.messages ?? []) {
    const old = earlier.get(m.id)
    if (old === m || m.restored) continue
    if (m.role === "assistant" && m.action === "answer" && m.content && old?.action !== "answer") {
      out.push({ kind: "answer", level: 1, text: m.content, id: m.id })
    } else if (m.role === "tool" && m.ok === false && !m.skipped && old?.ok !== false) {
      out.push({ kind: "failed", level: 2, text: `That step failed: ${toolPhrase(m.name) ?? m.name}`, tool: m.name })
    } else if (m.role === "user" && m.reports?.length && !old) out.push({ kind: "report", level: 2, text: `${m.from} reported back`, from: m.from })
  }

  // Quests handed out.
  const open = new Set((was.quests ?? []).map((q) => q.id))
  const sent = (after.quests ?? []).filter((q) => !open.has(q.id))
  if (sent.length) out.push({ kind: "quest", level: 2, text: `Asked ${list([...new Set(sent.map((q) => q.to))])}` })

  // Approvals waiting.
  const asked = new Set((was.approvals ?? []).map((a) => a.id))
  for (const approval of after.approvals ?? []) {
    if (!asked.has(approval.id)) {
      out.push({ kind: "approval", level: 1, text: `I need your approval for ${describeApproval(approval)}. Say yes or no.`, approval })
    }
  }

  // The work itself.
  const a = after.activity
  const b = was.activity
  const changed = a?.phase !== b?.phase || a?.name !== b?.name || a?.stage !== b?.stage || String(a?.names) !== String(b?.names)
  if (changed) {
    if (a?.phase === "waiting" && a.names?.length && b?.phase !== "waiting") out.push({ kind: "waiting", level: 2, text: `Waiting for ${list(a.names)}` })
    const line = activityLine(a)
    if (line) out.push({ kind: "step", level: 3, ...line })
  }

  // Started; failed.
  if (after.status === "running" && was.status && was.status !== "running") out.unshift({ kind: "start", level: 3, text: "On it" })
  if (after.error && after.error !== was.error) out.push({ kind: "error", level: 1, text: `Something went wrong: ${after.error}` })
  return out
}
