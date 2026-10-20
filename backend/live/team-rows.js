// A kernel desk's events as the live UI's thread rows and agent state — shared by the desk server
// (companion/team/kernel-team.js: the team stream) and a desk run in the tab (backend/browser/team.js, 2026-10-20: the
// hosted version runs one agent in the browser). Pure: no host, no storage.
//
//   freshState()                    an agent's state before its first run
//   nextStats(prev, agent, e)       its model-call stats after one more call (a step's or a chat's)
//   viewOf(agent, tool), callsOf, activityOf, isAgentTool   how a call draws, what the agent does now
//   rows.{request, step, saw, result, gate, guidance, answer, chatAsked, chatAnswer}   one builder per thread row

export const IDLE = { phase: "idle" }
export const MAX_TEXT = 20000

export const cut = (v) => {
  const s = typeof v === "string" ? v : JSON.stringify(v, null, 1)
  return s && s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : (s ?? "")
}

export const freshState = () => ({ status: "idle", activity: IDLE, messages: [], error: null, revision: 0, approvals: [], inbox: [], quests: [], working: null, stats: null, contextWindow: null })

// {calls, totalMs, avgMs, lastMs, promptChars, replyChars, model, at} after one more model call (kernel step / chat event).
export function nextStats(prev, agent, e) {
  const s = prev ?? { calls: 0, totalMs: 0 }
  const calls = s.calls + 1
  const totalMs = s.totalMs + e.ms
  return { calls, totalMs, avgMs: Math.round(totalMs / calls), lastMs: e.ms, promptChars: e.prompt_chars, replyChars: e.reply_chars, model: agent?.config.model ?? null, at: new Date(e.at ?? Date.now()).toISOString() }
}

export const isAgentTool = (agent, name) => agent.tools.get(name)?.type === "agent"
// How the Live page renders a call: the tool's own view (kernel Tool `view`: a quest, an artifact's
// view for its commands, …); a tool that declares none by its name — a web page, else data.
export const viewOf = (agent, name) => {
  const tool = agent.tools.get(name)
  if (tool?.view) return tool.view
  if (tool?.type === "agent") return "quest"
  if (/\.checklist\.(tick|skip)$/.test(name)) return "checklist"
  if (/\.schedule\./.test(name)) return "schedule"
  if (name.startsWith("web.")) return "web"
  return "data"
}
// Each call keeps its index (its place in the step): the Live feed keys a running call by it, so its row stays the
// same call while the step's other calls finish (2026-10-17: rows were keyed by position among the calls still
// running, and a selected row switched calls when an earlier one finished).
export const callsOf = (agent, calls) => calls.map((c) => ({ index: c.index, name: c.tool, inputs: c.input ?? {}, kind: isAgentTool(agent, c.tool) ? "agent" : "tool", view: viewOf(agent, c.tool) }))
// What the agent does while the step's calls run: the calls not answered yet — a quest out when all are agents.
// None left: the results go back to the model. row: the step's thread row, so the Live feed gives a call one
// identity while it runs and once it is done (backend/live/follow.js).
export const activityOf = (agent, { stage, since, row, calls }) => {
  if (!calls.length) return { phase: "llm", stage: "waiting" }
  const names = calls.map((c) => c.tool)
  const drawn = callsOf(agent, calls)
  if (names.every((n) => isAgentTool(agent, n))) return { phase: "waiting", names, calls: drawn, since, stage, row }
  return names.length > 1 ? { phase: "tools", names, calls: drawn, since, stage, row } : { phase: "tool", name: names[0], calls: drawn, since, stage, row }
}

// One builder per thread row, for the live events (team.on below) and the restored runs alike, so a run reads the
// same in the thread and the Live feed after a restart or a desk reload as it did when it streamed.
export const rows = {
  request: (request, when) => ({ role: "user", content: request.text, from: request.from === "owner" ? null : request.from, kind: request.from === "owner" ? "request" : "quest", at: when }),
  // A step with calls: its thought, then one line per call (`name({...})`).
  // images (2026-10-18): the screenshots the step's model call saw (kernel step event refs: page, n, url, caption).
  step: (thought, calls, when, images = null) => ({ role: "assistant", action: "tool", content: [thought, ...calls.map((c) => `${c.tool}(${JSON.stringify(c.input ?? {})})`)].filter(Boolean).join("\n"), at: when, ...(images?.length ? { images } : {}) }),
  saw: (images, when) => ({ role: "assistant", action: "tool", content: "(looked at its screenshots, then answered)", at: when, images }),
  // A call's result with its own call's input (paired by index, live and restored); index: the call's place in its
  // step and row: its step's thread row (message id), so the Live feed keeps the identity the call had while it ran
  // (2026-10-17), even once the thread's window has dropped that step row (2026-10-17: the feed found the step row by
  // scanning the thread, and without it the call took its message id). The tool as the kernel runs it
  // (Agent.resolveTool), as the live step draws it: 2026-10-17, a restored result written "desk.scout" drew as a
  // data call without its brief.
  result: (agent, result, input, index, row, when) => {
    const name = agent.resolveTool(result.tool)
    const output = cut(result.output)
    return { role: "tool", name, kind: isAgentTool(agent, name) ? "agent" : "tool", view: viewOf(agent, name), index, row, inputs: input ?? {}, ok: result.ok, content: output, output, at: when }
  },
  gate: (kind, content, when) => ({ role: "assistant", action: "gate", kind, content, at: when }),
  guidance: (from, text, when) => ({ role: "user", kind: "guidance", from, content: text, at: when }),
  answer: (answer, when) => ({ role: "assistant", action: "answer", content: answer, at: when }),
  // The owner's chat (kernel Agent.chat): the question and the answer, kind "chat" — beside the runs, never one.
  // guided: its GUIDE: line reached the run in progress; proposed: the request its QUEUE: line (or a GUIDE: line with
  // no run left) proposes — never started here: the owner starts it (else null).
  chatAsked: (from, text, when) => ({ role: "user", kind: "chat", from, content: text, at: when }),
  chatAnswer: (e, when) => ({ role: "assistant", kind: "chat", content: e.answer, guided: !!e.guided, proposed: e.proposed ?? null, ...(e.visual ? { visual: e.visual } : {}), ...(e.visualError ? { visualError: e.visualError } : {}), at: when }),
}
