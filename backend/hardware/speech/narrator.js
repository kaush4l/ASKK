// The narrator: what changed in an engine's state, as short spoken lines.
//
//   narrate(before, after) → [{ kind, level, text, … }]
//
// level: 1 = always spoken (the answer, an error), 2 = milestones
// (reports back, a failed step, waiting), 3 = every step (each tool). The pipeline speaks what its
// narration setting allows and shows every line.

// 2026-10-23: keyed to the kernel's own tool names (backend/kernel/builtin/*.js); the old fs.* / term.* / quest.* keys
// named tools no desk has any more.
const PHRASES = {
  "files.list": "Looking at a folder",
  "files.read": "Reading a file",
  "files.write": "Writing a file",
  "files.edit": "Editing a file",
  "files.append": "Adding to a file",
  "files.search": "Searching the files",
  "terminal.run": "Running a command",
  "terminal.start": "Starting a program",
  "terminal.wait": "Waiting on a program",
  "terminal.read": "Reading a program's output",
  "terminal.send": "Typing into a program",
  "terminal.stop": "Stopping a program",
  "web.search": "Searching the web",
  "web.read": "Reading a web page",
  "browse.open": "Opening a web page",
  "browse.search": "Searching the web",
  "browse.click": "Following a link",
  "browse.back": "Going back a page",
  "browse.more": "Reading further down the page",
  "browse.find": "Looking for something on the page",
  "browse.links": "Looking at the page's links",
  "browse.submit": "Sending a search form",
  "preview.open": "Opening a page in the preview",
  "preview.goto": "Going to another page",
  "preview.click": "Clicking on the page",
  "preview.type": "Typing on the page",
  "preview.press": "Pressing a key on the page",
  "preview.scroll": "Scrolling the page",
  "preview.text": "Reading the page",
  "preview.eval": "Checking the page",
  "preview.console": "Reading the page's console",
  "preview.shot": "Taking a screenshot",
  "preview.show": "Drawing a picture of it",
  "preview.answer": "Answering your question on the preview",
  "dispatch.start": "Handing work to a teammate",
  "dispatch.wait": "Waiting for the team",
  "dispatch.read": "Reading a teammate's report",
  "dispatch.stop": "Stopping a teammate's job",
  "plan.write": "Writing the plan",
  "talk.say": "Telling you something",
  "talk.ask": "Asking you a question",
  "agent.spawn": "Creating a helper agent",
  "agent.dismiss": "Ending a helper",
  "agent.catalog": "Looking at what helpers can do",
  "agent.update": "Changing a helper",
  "desk.list": "Looking at the desks",
  "desk.create": "Setting up a desk",
  "desk.check": "Checking a desk",
  "desk.load": "Loading a desk",
  "desk.ask": "Asking another desk",
  "desk.read": "Reading another desk's files",
  "desk.propose": "Proposing a new tool",
}

// Bookkeeping calls: nothing to say.
const QUIET = new Set(["files.focus", "terminal.list", "preview.close", "preview.focus", "preview.drop", "dispatch.list", "plan.tick", "plan.skip", "talk.drop"])

// Tools named after the agent that holds them (`<agent>.practice.tick`): matched by what follows the agent's name.
const SUFFIXES = {
  "practice.tick": null,
  "practice.skip": null,
  "practice.edit": "Updating its standing orders",
  "practice.reflect": "Looking back on the run",
}

const words = (name) => name.replace(/^get_?/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_.]+/g, " ").toLowerCase().trim()

// "github.search_issues" → "Checking github: search issues".
function toolPhrase(name) {
  if (!name) return "Working"
  if (QUIET.has(name)) return null
  if (name in PHRASES) return PHRASES[name]
  const suffix = Object.keys(SUFFIXES).find((k) => name.endsWith(`.${k}`))
  if (suffix) return SUFFIXES[suffix]
  const [server, ...rest] = name.split(".")
  if (!rest.length) return `Asking ${name}`
  const tool = rest.join(".")
  return `${/^(get|read|list|search)/.test(tool) ? "Checking" : "Using"} ${server}: ${words(tool)}`
}

const list = (names) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`)

function activityLine(activity) {
  switch (activity?.phase) {
    case "tool": {
      const text = toolPhrase(activity.name)
      return text ? { text, tool: activity.name } : null
    }
    case "tools": {
      const shown = [...new Set((activity.names ?? []).map(toolPhrase).filter(Boolean))]
      if (!shown.length) return null
      return { text: shown.length === 1 ? shown[0] : `${shown.length} things at once: ${list(shown.map((s) => s.toLowerCase()))}` }
    }
    default:
      return null
  }
}

export function narrate(before, after) {
  if (!after) return []
  // 2026-10-23: the tab's empty state (backend/live/agent.js EMPTY_STATE, status "created": nothing from the server yet)
  // is no baseline — the first snapshot carries the whole restored history, and every old answer would be spoken
  // again. That snapshot becomes what was there; only what changes after it is said.
  if (!before || before.status === "created") return []
  const out = []
  const was = before

  // Messages that became an answer, a failed step or a report since. A
  // streamed reply exists before it is final, so compare each message with
  // its own earlier version, not only new ids.
  const earlier = new Map((was.messages ?? []).map((m) => [m.id, m]))
  const spokenErrors = new Set()
  for (const m of after.messages ?? []) {
    const old = earlier.get(m.id)
    if (old === m) continue
    if (m.role === "assistant" && m.action === "answer" && m.content && old?.action !== "answer") {
      // 2026-10-23: a failed run's answer row ("Error: …", with `error`) comes in the same patch as the state's `error`
      // (companion/team/kernel-team.js) — said once, as the error.
      if (m.error) {
        spokenErrors.add(m.error)
        out.push({ kind: "error", level: 1, text: `Something went wrong: ${m.error}`, id: m.id })
      } else out.push({ kind: "answer", level: 1, text: m.content, id: m.id })
    } else if (m.role === "tool" && m.kind === "agent") {
      // A quest's result is its member's report (backend/live/team-rows.js rows.result: kind "agent", name = the member).
      if (m.ok === false && old?.ok !== false) out.push({ kind: "failed", level: 2, text: `${m.name} could not finish`, from: m.name })
      else if (m.ok !== false && !old) out.push({ kind: "report", level: 2, text: `${m.name} reported back`, from: m.name })
    } else if (m.role === "tool" && m.ok === false && old?.ok !== false) {
      out.push({ kind: "failed", level: 2, text: `That step failed: ${toolPhrase(m.name) ?? m.name}`, tool: m.name })
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
  if (after.error && after.error !== was.error && !spokenErrors.has(after.error)) out.push({ kind: "error", level: 1, text: `Something went wrong: ${after.error}` })
  return out
}
