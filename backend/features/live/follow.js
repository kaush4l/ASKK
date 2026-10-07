// Live follow: every tool call of every engine as one feed, plus the host's
// terminal runs streamed as they print (GET term/stream). Read by the Live
// follow page (components/live/live-page.jsx); nothing here changes an engine.
//
//   liveFeed(engines, states) -> events, oldest first:
//     { id, engineId, agent, name, kind, inputs, state: "running" | "approval" | "done",
//       ok?, skipped?, output?, at }
//   termRuns — a store of the terminal's runs: subscribe(listener), getSnapshot()
//     -> { connected, available, runs: [{ id, agent, command, cwd, at, text, exit?, ms?, done }],
//          procs: [{ id, name, command, status, urls, text, … }] }  (background processes, term.start)
//   liveArtifacts(engines, states) -> every artifact's newest UI snapshot by type
//     (Artifact.live(), published by the engine as state.live):
//     { [type]: { title, view, data, version, at, agent } }

import { parseToolPlan } from "@/backend/core/tool-plan"
import { withBase } from "@/backend/platform/base-path"
import { detectHost, hasCapability } from "@/backend/platform/host"

const MAX_EVENTS = 300
const MAX_RUNS = 20
const RUN_CHARS = 40000

export function liveFeed(engines, states) {
  const events = []
  engines.forEach((engine, index) => {
    const state = states[index]
    if (!state) return
    const agent = engine.name ?? engine.id
    const base = { engineId: engine.id, agent }
    // Restored memory keeps the calls in the assistant step only: a tool
    // message without inputs takes them from that step's plan, in order.
    let planned = []
    for (const message of state.messages ?? []) {
      if (message.role === "assistant") {
        planned = (message.action ?? message.structured?.action) === "tool" ? planOf(message) : []
        continue
      }
      if (message.role !== "tool" || !message.name) continue
      const index = planned.findIndex((call) => call.name === message.name)
      const call = index === -1 ? null : planned.splice(index, 1)[0]
      events.push({
        ...base,
        id: message.id,
        name: message.name,
        kind: message.kind ?? "tool",
        view: message.view ?? viewOf(message.name, message.kind),
        inputs: message.inputs ?? call?.inputs ?? {},
        state: "done",
        ok: message.ok,
        skipped: message.skipped ?? false,
        output: message.output ?? "",
        at: message.at,
      })
    }
    // A call waiting for the owner shows once, as an approval.
    const pending = new Set((state.approvals ?? []).map((a) => `${a.tool} ${JSON.stringify(a.inputs)}`))
    for (const approval of state.approvals ?? []) {
      events.push({ ...base, id: `${engine.id}-${approval.id}`, name: approval.tool, kind: "tool", view: viewOf(approval.tool), inputs: approval.inputs ?? {}, state: "approval", summary: approval.summary, at: approval.at })
    }
    const activity = state.activity
    for (const [i, call] of (activity?.calls ?? []).entries()) {
      if (pending.has(`${call.name} ${JSON.stringify(call.inputs)}`)) continue
      events.push({
        ...base,
        id: `${engine.id}-live-${activity.since}-${activity.stage ?? 0}-${i}`,
        name: call.name,
        kind: call.kind ?? "tool",
        view: call.view ?? viewOf(call.name, call.kind),
        streams: !!call.streams,
        progress: call.progress ?? null,
        inputs: call.inputs ?? {},
        state: "running",
        at: activity.since,
      })
    }
  })
  events.sort((a, b) => String(a.at).localeCompare(String(b.at)))
  return events.slice(-MAX_EVENTS)
}

// A call's view when its message predates the `view` field (restored memory):
// the same names the tools declare (backend/core/tool.js).
export function viewOf(name = "", kind = "tool") {
  if (kind === "agent" || name.startsWith("quest.") || name.startsWith("agent.")) return "quest"
  if (name.startsWith("term.")) return "terminal"
  if (/^fs\.(list|read|write|edit|append|delete|open)$/.test(name)) return "file"
  if (name.startsWith("web.")) return "web"
  if (name.startsWith("checklist.")) return "checklist"
  if (name === "schedule.wake") return "schedule"
  if (name.startsWith("browser.")) return "browser"
  return null
}

function planOf(message) {
  try {
    return parseToolPlan(message.structured?.response ?? message.content ?? "").flat()
  } catch {
    return []
  }
}

export function liveArtifacts(engines, states) {
  const out = {}
  engines.forEach((engine, index) => {
    for (const [type, snapshot] of Object.entries(states[index]?.live ?? {})) {
      if (!out[type] || String(snapshot.at) > String(out[type].at)) out[type] = { ...snapshot, agent: engine.name ?? engine.id }
    }
  })
  return out
}

// What an event touched, in a few words: the command, the path, the quest.
export function eventTarget(event) {
  const inputs = event.inputs ?? {}
  if (event.name === "term.run") return inputs.command ?? ""
  if (inputs.path) return inputs.path
  if (event.kind === "agent") return inputs.quest ?? ""
  if (inputs.query) return inputs.query
  if (inputs.url) return inputs.url
  return Object.values(inputs).find((v) => typeof v === "string") ?? ""
}

export const isFileEvent = (event) => /^fs\.(write|edit|append|delete)$/.test(event.name)

// The terminal run a term.run event in progress is printing (same agent and
// command, the unfinished one first). A finished event has its output.
export function runFor(event, runs) {
  if (event.state === "done") return null
  const runId = event.progress?.data?.runId // term.run reports the host's run id first
  if (runId) return runs.find((run) => run.id === runId) ?? null
  const matches = runs.filter((run) => run.command === event.inputs?.command && (!run.agent || run.agent === event.agent))
  return matches.findLast((run) => !run.done) ?? matches.at(-1) ?? null
}

// ── terminal stream store ────────────────────────────────────────────────

function createTermRuns() {
  let snapshot = { connected: false, available: null, runs: [], procs: [] }
  const listeners = new Set()
  let source = null
  let users = 0

  const set = (next) => {
    snapshot = { ...snapshot, ...next }
    listeners.forEach((listener) => listener())
  }
  const upsert = (id, change) => set({ runs: snapshot.runs.map((run) => (run.id === id ? change(run) : run)) })
  const upsertProc = (proc) => {
    const known = snapshot.procs.find((p) => p.id === proc.id)
    const next = { ...(known ?? { text: "" }), ...proc, text: proc.text ?? known?.text ?? "" }
    set({ procs: [...snapshot.procs.filter((p) => p.id !== proc.id), next].slice(-MAX_RUNS) })
  }

  function onEvent(event) {
    if (event.type === "snapshot") {
      const live = event.runs.map((run) => ({ ...run, done: false }))
      const ids = new Set(live.map((run) => run.id))
      set({ connected: true, runs: [...snapshot.runs.filter((run) => !ids.has(run.id)), ...live].slice(-MAX_RUNS) })
      for (const proc of event.procs ?? []) upsertProc({ ...proc, text: proc.tail ?? proc.text ?? "" })
    } else if (event.type === "start") {
      const { type: _type, ...run } = event
      set({ runs: [...snapshot.runs.filter((r) => r.id !== event.id), { ...run, done: false }].slice(-MAX_RUNS) })
    } else if (event.type === "out") {
      upsert(event.id, (run) => ({ ...run, text: (run.text + event.text).slice(-RUN_CHARS) }))
    } else if (event.type === "proc") {
      const { type: _type, ...proc } = event
      upsertProc(proc)
    } else if (event.type === "proc-out") {
      const proc = snapshot.procs.find((p) => p.id === event.id)
      if (proc) upsertProc({ id: event.id, text: (proc.text + event.text).slice(-RUN_CHARS) })
    } else if (event.type === "end") {
      upsert(event.id, (run) => ({ ...run, done: true, exit: event.exit, ms: event.ms, error: event.error ?? null, timedOut: event.timedOut ?? false }))
    }
  }

  async function open() {
    const host = await detectHost()
    if (!hasCapability(host, "term")) return set({ available: false })
    if (!users || source) return
    set({ available: true })
    source = new EventSource(withBase("/__askk/term/stream"))
    source.onmessage = (message) => {
      try {
        onEvent(JSON.parse(message.data))
      } catch {
        // a malformed event is skipped
      }
    }
    source.onerror = () => set({ connected: false }) // EventSource reconnects on its own
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      if (users++ === 0) open()
      return () => {
        listeners.delete(listener)
        if (--users === 0) {
          source?.close()
          source = null
          snapshot = { ...snapshot, connected: false }
        }
      }
    },
    getSnapshot: () => snapshot,
  }
}

export const termRuns = createTermRuns()

// ── a file before a write ────────────────────────────────────────────────

// The file's text before an fs.write, read while the call waits or runs (once
// per call), so the write can be shown as a diff. Later: what the feed knows.
const before = new Map() // key -> Promise<string | null>
const writeKey = (event) => `${event.agent}|${event.inputs?.path}|${event.inputs?.text?.length}|${event.inputs?.text?.slice(0, 200)}`

export function captureBefore(event) {
  if (event.name !== "fs.write" || event.state === "done" || !event.inputs?.path) return
  const key = writeKey(event)
  if (before.has(key)) return
  before.set(
    key,
    import("@/backend/features/filesystem/workspace")
      .then(({ workspace }) => workspace())
      .then((ws) => ws.read(event.inputs.path))
      .then((file) => (file.binary ? null : file.text))
      .catch(() => "") // not there yet: created
  )
}

// { text, source: "read" | "feed" } or null when nothing earlier is known.
export async function beforeOf(event, events) {
  if (event.name !== "fs.write") return null
  const read = before.get(writeKey(event))
  if (read) {
    const text = await read
    if (text !== null) return { text, source: "read" }
  }
  const index = events.indexOf(event)
  const earlier = events.slice(0, index === -1 ? events.length : index).findLast((e) => e.name === "fs.write" && e.state === "done" && e.ok && e.inputs?.path === event.inputs?.path)
  return earlier ? { text: earlier.inputs.text ?? "", source: "feed" } : null
}
