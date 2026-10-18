// A desk (backend/kernel, main.js `start`) served as the server's team: GET team/stream, POST team/call and
// team/send (companion/server/host-api.js), announce, work, terminate. Every view of the live UI (backend/live) —
// home, agent page, Live follow, status bar, /sts — mirrors it.
//
// Each kernel agent is streamed as one entry (id = its name; the UI calls these agents, the stream's registry
// still names the list `engines`): its definition, and its events (start, think, step, call, result, gate,
// format, guide, answer, error) as the state the UI reads (status, activity, messages, working, stats).
// The owner's message to the lead (or any agent) runs it, as do the desk's schedule and its own
// background work (start's run({wake, busy, log})). Messages live in memory and in
// state/kernel-team.jsonl (one row per event); each agent's runs also in its transcript beside its
// agent.md (kernel-transcripts.js), restored at start with every step as it streamed.

//
// Every kernel element reaches the UI (the owner follows the trail): agents with their definition (role, folder,
// tool specs, artifacts held), each call drawn by its tool's view, refused answers (gate/format), model-call stats
// per agent, every artifact, and the desk's background log (watchers, schedule, wakes, Telegram) as `log` events.
//
// 2026-10-17: the agent set is not fixed at start. An agent spawned at run time (kernel Desk.spawn, tool agent.spawn)
// gets its state, a folder under <desk state>/spawned/<name>/ (an agent.md record, so its transcript records), and
// reaches every tab as {type: "registry", registry, states: {<name>: state}} then {type: "kernel", tree}; the
// artifacts are scanned again (new ones watched, holders re-sent). A dismissed one leaves the registry, its own
// artifacts leave as {type: "kernel", tree, removed: [ids]}. work() and the agent count read the live list. A spawned
// TEAM (one spawn event per agent, its lead first) arrives whole at its lead's event: every agent of it gets its state
// and folder (agent.md with team:) in one registry event; dismissed, it leaves one agent per event, members first.
//
// 2026-10-17 owner ("I want to be able to talk with the lead to understand what is currently already there and what I
// want to check"): team/call chat [text, {from}] is one model call beside the agent's runs (kernel Agent.chat): the
// answer comes back, the exchange is two thread rows of kind "chat" (never a run's request), a GUIDE: line reached the
// run in progress (guided), a QUEUE: line starts a run here (queued). stop reaches every run of the agent, however it
// was started (a lead's quest, a dispatch): kernel Agent.stop.

import { appendFileSync, existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { dirname, join, relative } from "node:path"

import { SPAWN_NAME } from "../../backend/kernel/index.js"
import { describeActivity } from "../../backend/live/activity.js"
import { createTranscripts } from "./kernel-transcripts.js"
import { retryWake, startWakes, wakesPath } from "../shared/wakes.js"
import { SSE_PING_MS, HOST_LIMITS } from "../shared/config.js"

const IDLE = { phase: "idle" }
export const MAX_MESSAGES = 400 // an agent's thread rows kept: the newest (live), the newest whole runs (restored)
const MAX_TEXT = 20000
const LOG_KEEP = 300 // background log lines kept for a tab that connects later

const cut = (v) => {
  const s = typeof v === "string" ? v : JSON.stringify(v, null, 1)
  return s && s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : (s ?? "")
}

export async function createKernelTeam({ desk, port, log: hostLog = () => {}, live = process.env.ASKK_KERNEL_FIXTURE ? false : undefined }) {
  const storageDir = desk.state
  mkdirSync(storageDir, { recursive: true })
  const eventsFile = join(storageDir, "kernel-team.jsonl")

  // Tabs on team/stream, and the desk's background log: every line the desk, its watchers, the schedule, the
  // wake book or the Telegram bridge writes goes to the server log and to every tab ({type: "log"}); the newest
  // LOG_KEEP ride in the snapshot. `source` is the line's "<word>:" prefix (watch, desk, radar, telegram, wake…).
  const clients = new Set()
  const closers = new Set() // each open stream's close (endStreams)
  const broadcast = (event) => {
    for (const send of clients) send(event)
  }
  const logs = []
  const log = (line) => {
    const text = String(line)
    hostLog(text)
    const row = { at: new Date().toISOString(), source: text.match(/^([\w.-]+):\s/)?.[1] ?? "desk", text }
    logs.push(row)
    if (logs.length > LOG_KEEP) logs.shift()
    broadcast({ type: "log", ...row })
  }
  // The desks' shared memory folder (custom/memory/), one folder per desk by its name: the desk's and its
  // teams' memory and reports; every desk's in the same place.
  const memory = desk.folder ? join(dirname(desk.folder), "memory", desk.name) : null
  const built = await desk.start({ port, live: live ?? true, log, memory })
  const { desk: team, ready = async () => {}, run: background = null } = built
  const lead = team.lead // team.list: every agent now (spawned ones come and go), never a copy taken at start

  // ---- registry: one engine per kernel agent ---------------------------------------------------
  // The agent's twin on the UI (kernel Agent.twin()): its definition (role = agent.md body, folder, model, team,
  // desk), every tool as a spec {name, type, view, description, input} (sub-agents too, type "agent", with `agent`)
  // and the artifacts it holds. The folder is shown relative to the desk's; status lives in the agent's state.
  const definition = (a) => {
    const { element, id, tools, folder, status, ...twin } = a.twin()
    return {
      ...twin,
      folder: folder ? (desk.folder ? relative(desk.folder, folder) : folder) : null,
      tools: tools.map(({ element, id, ...spec }) => spec),
      kernel: true,
    }
  }
  // Rebuilt in place when an agent is spawned or dismissed (a caller's definition gains or loses its quest tool), so
  // the next snapshot and the registry event both carry the desk as it is.
  const registry = { agents: [], edited: [], status: "ready", error: null, requiredId: lead.name, engines: [] }
  const describeAll = () => {
    registry.engines = team.list.map((a) => ({ id: a.name, name: a.name, agent: definition(a) }))
    registry.agents = registry.engines.map((e) => e.agent)
  }
  describeAll()

  // ---- the desk's shape and its artifacts ------------------------------------------------------
  // Streamed as {type: "kernel", artifact, boards?}; the snapshot carries them all. Every artifact
  // (boards, memories, checklists, quality matrices, the desk's own) by its id "<owner>.<kind>": its twin
  // (kernel Artifact.twin(): kind, view, owner, title, brief — its state in one line —, state, items for a list)
  // with the agents that hold it (Desk.artifacts()).
  let artifacts = team.artifacts() // id -> { artifact, holders: [agent names] }; scanned again on spawn / dismiss
  const view = (id) => {
    const { artifact: x, holders } = artifacts.get(id)
    return { ...x.twin(), holders }
  }

  // Saved on every change: state/artifacts/<id>.json (latest) and state/days/<ET day>/<id>.json
  // (the day's record, for navigation). Restored at start by the artifact's `keep`: "always", "day"
  // (only from the same ET day), "run" and "file" never (one run's, or a file's own).
  const etDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d)
  const artDir = join(storageDir, "artifacts")
  mkdirSync(artDir, { recursive: true })
  const fileOf = (id) => `${id.replace(/[^\w.-]/g, "_")}.json`
  const keepOf = (x) => x.keep ?? "day"
  // Each instance is read back from disk once, when it first appears (2026-10-17 critic: a live shared one re-held after
  // its last holder was dismissed was restored again by rescan, its in-memory state reset to the last save).
  const restored = new WeakSet()
  const restore = (id, x) => {
    restored.add(x)
    const file = join(artDir, fileOf(id))
    if (!existsSync(file) || ["run", "file"].includes(keepOf(x))) return
    try {
      const saved = JSON.parse(readFileSync(file, "utf8"))
      if (keepOf(x) === "day" && saved.day !== etDay()) return
      x.restore(saved.state)
    } catch (error) {
      log(`desk: ${id} not restored (${error.message})`)
    }
  }
  for (const [id, { artifact: x }] of artifacts) restore(id, x)
  const write = (id, x) => {
    if (keepOf(x) === "file") return // a file's own
    const body = JSON.stringify({ id, kind: x.kind, day: etDay(), at: new Date().toISOString(), state: x.state }, null, 1)
    try {
      writeFileSync(join(artDir, fileOf(id)), body)
      const dayDir = join(storageDir, "days", etDay())
      mkdirSync(dayDir, { recursive: true })
      writeFileSync(join(dayDir, fileOf(id)), body)
    } catch (error) {
      log(`desk: ${id} not saved (${error.message})`)
    }
  }
  const timers = new Map() // artifact id -> its save waiting out the 300 ms debounce
  const save = (id) => {
    clearTimeout(timers.get(id))
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id)
        const x = artifacts.get(id)?.artifact
        if (x) write(id, x)
      }, 300),
    )
  }
  // A save still waiting when the artifact leaves (its last holder dismissed, or another instance takes its id): written
  // now, from the instance that changed (2026-10-17 critic: the dismissal dropped it).
  const flush = (id, x) => {
    if (!timers.has(id)) return
    clearTimeout(timers.get(id))
    timers.delete(id)
    write(id, x)
  }
  const kernel = {
    title: desk.title ?? desk.name ?? null,
    tree: team.tree(),
    boards: team.board?.snapshot() ?? null,
    artifacts: Object.fromEntries([...artifacts.keys()].map((id) => [id, view(id)])), // after restore
  }
  const deskTeam = lead.board?.team ?? null
  // Every change is one {type: "kernel", artifact} event (2026-10-17: the lead's state.live second copy of the desk's
  // own artifacts is gone — nothing read it).
  const watched = new Map() // artifact id -> its onChange unsubscribe
  const watch = (id, x) => {
    watched.set(
      id,
      x.onChange(() => {
        if (artifacts.get(id)?.artifact !== x) return // no holder left (its helper was dismissed)
        kernel.artifacts[id] = view(id)
        const patch = { type: "kernel", artifact: kernel.artifacts[id] }
        if (x.kind === "board") patch.boards = kernel.boards = team.board?.snapshot() ?? null
        broadcast(patch)
        save(id)
      }),
    )
  }
  for (const [id, { artifact: x }] of artifacts) watch(id, x)
  // The artifacts again after a spawn or dismiss: a new one is restored (by keep, once per instance: a live one held
  // again keeps its state) and watched, one whose holders changed is sent again (a shared board gains its helper), one
  // no agent holds any more leaves → its id, its waiting save written first.
  const rescan = () => {
    const next = team.artifacts()
    const sent = []
    for (const [id, { artifact: x, holders }] of next) {
      const old = artifacts.get(id)
      if (old?.artifact !== x) {
        watched.get(id)?.()
        if (old) flush(id, old.artifact)
        if (!restored.has(x)) restore(id, x)
        watch(id, x)
        sent.push(id)
      } else if (old.holders.join("\n") !== holders.join("\n")) sent.push(id)
    }
    const removed = [...artifacts.keys()].filter((id) => !next.has(id))
    for (const id of removed) flush(id, artifacts.get(id).artifact)
    artifacts = next
    for (const id of removed) {
      watched.get(id)?.()
      watched.delete(id)
      delete kernel.artifacts[id]
    }
    for (const id of sent) broadcast({ type: "kernel", artifact: (kernel.artifacts[id] = view(id)) })
    return removed
  }

  // ---- state per engine, from kernel events ----------------------------------------------------
  const freshState = () => ({ status: "idle", activity: IDLE, messages: [], error: null, revision: 0, approvals: [], inbox: [], quests: [], working: null, stats: null, contextWindow: null })
  const states = Object.fromEntries(team.list.map((a) => [a.name, freshState()]))
  let seq = 0
  const at = (ms) => new Date(ms ?? Date.now()).toISOString()
  // The run in progress per agent, beside the kernel's steps (its answer event carries them): what its thread showed
  // that the steps do not hold — each step's results in the order they arrived, its refused-answer row, the owner's
  // guidance and where it fell, each row's time (the Live feed merges agents by time). Recorded with the run
  // (kernel-transcripts.js), so a restored thread reads as it streamed.
  const trails = new Map() // agent name -> {times: [ms, request first], step, steps: [{arrived: [call index], gate}], guidance: [{pos, from, text}]}
  const trailStep = (id) => {
    const t = trails.get(id)
    return t && t.step >= 0 ? (t.steps[t.step] ??= { arrived: [], gate: null }) : null
  }

  function update(id, patch, newMessages = []) {
    const s = (states[id] ??= freshState())
    const from = s.messages.length
    const trail = trails.get(id)
    // The run's rows, in order (an owner chat beside the run is not one of them: its transcript never holds it).
    if (trail) trail.times.push(...newMessages.filter((m) => m.kind !== "chat").map((m) => Date.parse(m.at)))
    let messages = s.messages
    if (newMessages.length) {
      messages = [...messages, ...newMessages]
      if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES)
    }
    const next = { ...s, ...patch, messages, revision: s.revision + 1 }
    states[id] = next
    const out = { ...patch, revision: next.revision }
    if (newMessages.length) out.messages = messages.length < from + newMessages.length ? { from: 0, items: messages } : { from, items: newMessages }
    broadcast({ type: "state", id, patch: out })
  }

  // One model call more in the agent's stats (a step's, or an owner chat's): {calls, totalMs, avgMs, lastMs,
  // promptChars, replyChars, model, at}.
  const counted = (id, a, e) => {
    const s = states[id]?.stats ?? { calls: 0, totalMs: 0 }
    const calls = s.calls + 1
    const totalMs = s.totalMs + e.ms
    return { calls, totalMs, avgMs: Math.round(totalMs / calls), lastMs: e.ms, promptChars: e.prompt_chars, replyChars: e.reply_chars, model: a?.config.model ?? null, at: at(e.at) }
  }

  const isAgentTool = (agent, name) => agent.tools.get(name)?.type === "agent"
  // How the Live page renders a call: the tool's own view (kernel Tool `view`: a quest, an artifact's
  // view for its commands, …); a tool that declares none by its name — a web page, else data.
  const viewOf = (agent, name) => {
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
  const callsOf = (agent, calls) => calls.map((c) => ({ index: c.index, name: c.tool, inputs: c.input ?? {}, kind: isAgentTool(agent, c.tool) ? "agent" : "tool", view: viewOf(agent, c.tool) }))
  // The step running now per agent: {stage, since, row, calls: [{index, tool, input}] not answered yet}; row: the
  // step's thread row (its message id). A result is its call's by the index the kernel's `call` and `result` carry
  // (the call's place in the step), never by tool name (2026-10-17: two quote calls in one step showed each other's
  // inputs; "desk.scout", run as scout, kept its row without its brief and stayed in the activity after it reported).
  const pendingCalls = new Map()
  // What the agent does while the step's calls run: the calls not answered yet — a quest out when all are agents.
  // None left: the results go back to the model. row: the step's thread row, so the Live feed gives a call one
  // identity while it runs and once it is done (backend/live/follow.js).
  const activityOf = (agent, { stage, since, row, calls }) => {
    if (!calls.length) return { phase: "llm", stage: "waiting" }
    const names = calls.map((c) => c.tool)
    const drawn = callsOf(agent, calls)
    if (names.every((n) => isAgentTool(agent, n))) return { phase: "waiting", names, calls: drawn, since, stage, row }
    return names.length > 1 ? { phase: "tools", names, calls: drawn, since, stage, row } : { phase: "tool", name: names[0], calls: drawn, since, stage, row }
  }

  // One builder per thread row, for the live events (team.on below) and the restored runs alike, so a run reads the
  // same in the thread and the Live feed after a restart or a desk reload as it did when it streamed.
  const rows = {
    request: (request, when) => ({ role: "user", content: request.text, from: request.from === "owner" ? null : request.from, kind: request.from === "owner" ? "request" : "quest", at: when }),
    // A step with calls: its thought, then one line per call (`name({...})`).
    step: (thought, calls, when) => ({ role: "assistant", action: "tool", content: [thought, ...calls.map((c) => `${c.tool}(${JSON.stringify(c.input ?? {})})`)].filter(Boolean).join("\n"), at: when }),
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
    // guided: its GUIDE: line reached the run in progress; queued: the request its QUEUE: line started (else null).
    chatAsked: (from, text, when) => ({ role: "user", kind: "chat", from, content: text, at: when }),
    chatAnswer: (e, when) => ({ role: "assistant", kind: "chat", content: e.answer, guided: !!e.guided, queued: e.queued ?? null, at: when }),
  }
  const msg = (row) => ({ id: `k${++seq}`, ...row })

  // Transcripts beside each agent's agent.md: the newest runs come back as its EARLIER RUNS and as its thread's
  // first rows — every step as it streamed: its calls (tool, view, inputs, ok, the clipped output) in the order their
  // results arrived, refused answers, the owner's guidance where it fell. 2026-10-17: a restored run was only its
  // request and answer, so research-lead's thread and the Live feed lost every call when its desk reloaded.
  const transcripts = createTranscripts({ enabled: live !== false })
  const starts = new Map() // agent name -> the request of its run in progress
  // A step from before its refused-answer row was kept (no `gate`): that row from the kernel's note past the step's
  // calls (agent.js: tool gate, format or guide), as the live gate/format case drew it; another note draws nothing.
  const noteGate = (note) => {
    const out = typeof note?.output === "string" ? note.output : ""
    const tool = note?.tool
    if ((tool === "gate" || tool === "format") && out.startsWith("answer refused: ")) return { kind: "gate", content: out.replace("answer refused: ", "Answer refused: ") }
    if ((tool === "guide" || tool === "format") && out.startsWith("answer held:")) return { kind: "gate", content: "Answer held: owner guidance arrived while it answered" }
    if (tool === "format" && out === "give calls or an answer") return { kind: "format", content: "Reply not taken: no calls and no answer" }
    if (tool === "format" && out.startsWith("answer not taken:")) return { kind: "format", content: "Reply not taken: answer beside data or agent calls" }
    return null
  }
  // A run from its transcript row as thread rows (no ids), each at its recorded time (else the run's). A row from
  // before steps were kept, or one that does not read, is its request and answer.
  const restoredRun = (a, r) => {
    const request = rows.request({ from: r.from, text: r.request }, r.at)
    const answer = rows.answer(r.answer, r.at)
    try {
      const out = []
      for (const s of r.steps) {
        const calls = Array.isArray(s.calls) ? s.calls : []
        const results = s.results.slice(0, calls.length) // past the calls: the kernel's note on a refused answer
        if (results.length) {
          out.push(rows.step(s.thought, calls, r.at))
          // results[k] answers calls[k] (the kernel keeps a step's results in call order); `order` is how they arrived.
          for (const k of s.order ?? results.keys()) out.push(rows.result(a, results[k], calls[k]?.input, k, null, r.at)) // row: withIds
        }
        const gate = s.gate ?? noteGate(s.results[calls.length])
        if (gate) out.push(rows.gate(gate.kind, gate.content, r.at))
      }
      for (const g of [...(r.guidance ?? [])].sort((x, y) => x.pos - y.pos)) out.splice(g.pos, 0, rows.guidance(g.from, g.text, r.at))
      const thread = [request, ...out]
      const times = Array.isArray(r.times) && r.times.length === thread.length && r.times.every(Number.isFinite) ? r.times : null
      return [...(times ? thread.map((x, i) => ({ ...x, at: at(times[i]) })) : thread), answer]
    } catch (error) {
      log(`desk: ${a.name}'s run of ${r.at} restored without its steps (${error.message})`)
      return [request, answer]
    }
  }
  // A restored run's rows with their ids, in thread order, before any cut: each result row gets its step row's id
  // (`row`), as a live result does, so a cut that drops the step row (keepRuns) leaves the call's identity whole. In a
  // restored run every result row follows its own step row; only guidance rows fall between them (2026-10-17).
  const withIds = (thread) => {
    let row = null
    return thread.map((x) => {
      const m = msg(x)
      if (m.role === "assistant" && m.action === "tool") row = m.id
      return m.role === "tool" ? { ...m, row } : m
    })
  }
  // The newest runs that fit in MAX_MESSAGES, whole (the oldest dropped first), so the thread opens on a request.
  // The newest run alone longer than that: its request and its newest rows, MAX_MESSAGES in all.
  const keepRuns = (threads) => {
    const kept = []
    let n = 0
    for (const t of threads.toReversed()) {
      if (n + t.length > MAX_MESSAGES) break
      kept.unshift(t)
      n += t.length
    }
    if (kept.length || !threads.length) return kept.flat()
    const last = threads.at(-1)
    return [last[0], ...last.slice(last.length - MAX_MESSAGES + 1)]
  }
  for (const a of team.list) {
    const runs = transcripts.restore(a)
    if (!runs.length) continue
    a.history = runs.map((r) => ({ from: r.from, request: r.request, answer: r.answer }))
    states[a.name].messages = keepRuns(runs.map((r) => withIds(restoredRun(a, r))))
  }

  team.on((e) => {
    const a = team.agents().get(e.agent)
    const id = e.agent
    try {
      appendFileSync(eventsFile, JSON.stringify({ ...e, steps: undefined, request: e.request ? { from: e.request.from, text: cut(e.request.text).slice(0, 2000) } : undefined }) + "\n")
    } catch {}
    switch (e.event) {
      case "spawn":
        spawned(e)
        break
      case "dismiss":
        dismissed(e)
        break
      case "start": {
        started(id, e.request)
        starts.set(id, e.request)
        const first = msg(rows.request(e.request, at(e.at)))
        update(id, { status: "running", error: null, activity: { phase: "llm", stage: "waiting" }, working: { request: first.id, at: at(e.at) } }, [first])
        trails.set(id, { times: [e.at], step: -1, steps: [], guidance: [] })
        break
      }
      case "think":
        update(id, { activity: { phase: "llm", stage: "waiting" } })
        break
      case "step": {
        // The model call behind the step (kernel Agent: ms, prompt_chars, reply_chars): the agent's stats.
        if (e.ms != null) update(id, { stats: counted(id, a, e) })
        // Step n is the run's steps[n - 1] (every reply but the answer that ends the run is one step there).
        if (trails.has(id)) trails.get(id).step = e.n - 1
        if (!e.calls?.length) break
        // The step's calls by their index; quests only: the thread now waits for its sub-agents' reports. Each name as
        // the kernel will run it (Agent.resolveTool), so the first activity already draws "desk.scout" as the quest to
        // scout (2026-10-17: it drew it as a data tool until the `call` event came). The step row keeps the names as
        // written.
        const row = msg(rows.step(e.thought, e.calls, at(e.at)))
        const step = { stage: e.n, since: at(e.at), row: row.id, calls: e.calls.map((c, index) => ({ index, tool: a.resolveTool(c.tool), input: c.input ?? {} })) }
        pendingCalls.set(id, step)
        update(id, { activity: activityOf(a, step) }, [row])
        break
      }
      case "call": {
        // The tool the kernel runs for call `index`: the step already drew it so (resolveTool); should the kernel run
        // another, the activity follows the kernel.
        const step = pendingCalls.get(id)
        const call = step?.calls.find((c) => c.index === e.index)
        if (call && call.tool !== e.tool) {
          call.tool = e.tool
          update(id, { activity: activityOf(a, step) })
        }
        break
      }
      case "result": {
        // The call this result answers, by its index: its inputs for the thread and the Live page; the rest still run.
        const step = pendingCalls.get(id)
        const i = step ? step.calls.findIndex((c) => c.index === e.index) : -1
        const call = i >= 0 ? step.calls.splice(i, 1)[0] : null
        trailStep(id)?.arrived.push(e.index)
        update(id, step ? { activity: activityOf(a, step) } : {}, [msg(rows.result(a, e, call?.input ?? e.input, e.index, step?.row, at(e.at)))])
        break
      }
      case "gate":
      case "format": {
        // The answer was refused (open checklist, report missing fields, no tool called) or the reply had neither
        // calls nor an answer: the agent goes on; the thread and the Live feed show why.
        // held: guidance arrived while the model wrote its answer, so the answer waits one step.
        const content = e.event === "gate" ? `Answer ${e.held ? "held" : "refused"}: ${(e.reasons ?? []).join("; ")}` : `Reply not taken: ${e.note ?? "no calls and no answer"}`
        const step = trailStep(id)
        if (step) step.gate = { kind: e.event, content }
        update(id, { activity: { phase: "llm", stage: "waiting" } }, [msg(rows.gate(e.event, content, at(e.at)))])
        break
      }
      case "guide": {
        // Owner guidance for the run in progress (call `guide`): a row in the thread and the Live feed; the
        // agent's next step reads it.
        const trail = trails.get(id)
        trail?.guidance.push({ pos: trail.times.length - 1, from: e.from, text: e.text }) // the run's rows before it, after its request
        update(id, {}, [msg(rows.guidance(e.from, e.text, at(e.at)))])
        break
      }
      case "chat":
        // The owner's chat (team call `chat`): its question and answer as two rows, its model call in the stats. The
        // activity and `working` stay the run's (a chat is never the request being worked on).
        update(id, e.ms != null ? { stats: counted(id, a, e) } : {}, [msg(rows.chatAsked(e.from, e.text, at(e.at - (e.ms ?? 0)))), msg(rows.chatAnswer(e, at(e.at)))])
        break
      case "answer":
        pendingCalls.delete(id)
        starts.delete(id)
        transcripts.record(a, e, null, trails.get(id))
        trails.delete(id)
        update(id, { status: "idle", activity: IDLE, working: null }, [msg(rows.answer(e.answer, at(e.at)))])
        break
      case "error":
        pendingCalls.delete(id)
        transcripts.record(a, e, starts.get(id))
        starts.delete(id)
        trails.delete(id)
        update(id, { status: "error", activity: IDLE, working: null, error: e.error }, [msg({ ...rows.answer(`Error: ${e.error}`, at(e.at)), error: e.error })])
        break
    }
  })

  // ---- agents that come and go -----------------------------------------------------------------
  // A spawned agent (kernel Desk.spawn, from agent.spawn): its folder is <desk state>/spawned/<name>/ with an agent.md
  // record of what it was made for (the transcript beside it records its runs, as an agent.md folder's does); every
  // tab gets its definition and state, the caller's new definition, the artifacts' new holders and the new tree.
  // 2026-10-17: a spawned TEAM is one spawn event per agent (kernel Desk.spawn), its lead's first, every agent of it
  // already built then: the lead's event sets them all up — each its state and folder (agent.md with team:, the lead's
  // with its members) — in one registry event; a member's own event finds itself set up.
  const spawnedDir = join(storageDir, "spawned")
  const yamlList = (xs) => `[${xs.map((x) => JSON.stringify(x)).join(", ")}]`
  // An agent's folder and its agent.md record: what it was made for (config.spawned: by, goal, keep, at, team — else
  // the event's), what it holds.
  function recordSpawn(a, e) {
    const s = a.config.spawned ?? e
    // Only a spawn name (kernel SPAWN_NAME, which Desk.spawn checks too) becomes a folder. 2026-10-17 (critic): the old
    // sanitiser (/[^\w.-]/) let ".." through, and the helper's agent.md and transcript went into state/.
    const folder = SPAWN_NAME.test(a.name) ? join(spawnedDir, a.name) : null
    if (folder) a.config.folder = folder
    else log(`desk: ${JSON.stringify(a.name)} is not a spawn name: no folder, its runs are not recorded`)
    if (!folder || live === false) return
    try {
      mkdirSync(folder, { recursive: true })
      const tools = [...a.tools.values()].filter((t) => t.type !== "agent" && t.type !== "artifact").map((t) => t.name)
      const members = (a.children ?? []).map((c) => c.name)
      const head = [`name: ${a.name}`, `by: ${s.by}`, `goal: ${JSON.stringify(s.goal ?? "")}`, `keep: ${s.keep ?? "run"}`, `at: ${new Date(s.at ?? e.at ?? Date.now()).toISOString()}`, ...(s.team ? [`team: ${s.team}`] : []), ...(members.length ? [`members: ${yamlList(members)}`] : []), `tools: ${yamlList(tools)}`, `artifacts: ${yamlList(a.artifacts.map((x) => x.id))}`]
      writeFileSync(join(folder, "agent.md"), `---\n${head.join("\n")}\n---\n${String(a.config.role ?? "").trim()}\n`)
    } catch (error) {
      log(`desk: ${a.name}'s folder not written (${error.message})`)
    }
  }
  function spawned(e) {
    const a = team.agents().get(e.agent)
    if (!a) return
    // Every agent of the desk without a state is new: this one and, at a team's lead, its members.
    const fresh = team.list.filter((x) => !states[x.name])
    if (!fresh.includes(a)) return // a member, set up at its lead's event
    for (const x of fresh) {
      recordSpawn(x, x === a ? e : { ...e, agent: x.name })
      states[x.name] = freshState()
    }
    describeAll()
    broadcast({ type: "registry", registry, states: Object.fromEntries(fresh.map((x) => [x.name, states[x.name]])) })
    rescan()
    kernel.tree = team.tree()
    broadcast({ type: "kernel", tree: kernel.tree })
    const members = fresh.filter((x) => x !== a).map((x) => x.name)
    log(`desk: ${e.by} spawned ${members.length ? `team ${a.name} (${members.join(", ")})` : a.name}: ${String(e.goal ?? "").split("\n")[0].slice(0, HOST_LIMITS.team.logPreviewChars)}`)
  }
  // A dismissed agent leaves the registry (its folder and transcript stay); the artifacts only it held leave too. A
  // team leaves one agent per event, its members first (kernel Desk.dismiss), its board with the last of them.
  function dismissed(e) {
    delete states[e.agent]
    pendingCalls.delete(e.agent)
    trails.delete(e.agent)
    starts.delete(e.agent)
    describeAll()
    broadcast({ type: "registry", registry, states: {} })
    const removed = rescan()
    kernel.tree = team.tree()
    broadcast({ type: "kernel", tree: kernel.tree, ...(removed.length ? { removed } : {}) })
    log(`desk: ${e.by ?? "owner"} dismissed ${e.agent}`)
  }

  // ---- actions ---------------------------------------------------------------------------------
  // agent name -> the AbortControllers of its runs in progress or queued: stop aborts every one (2026-10-16 critic: a
  // second run replaced the first's handle, so stop cancelled the queued run while the running one went on).
  const controllers = new Map()
  // Runs accepted (send, ask, schedule, wakes) until they end: one not started yet (waiting on ready() or behind the
  // agent's current run) is work too, so a desk reload waits for it instead of aborting it.
  const accepted = new Set() // {agent, text, from, at, started}
  // The controllers whose run reached the agent (agent.ask): its own stop() counts those, the host the ones still waiting.
  const handed = new WeakSet()
  function run(agent, text, from = "owner") {
    const controller = new AbortController()
    if (!controllers.has(agent.name)) controllers.set(agent.name, new Set())
    controllers.get(agent.name).add(controller)
    const entry = { agent: agent.name, text: String(text), from, at: new Date().toISOString(), started: false }
    accepted.add(entry)
    log(`desk: ${from} → ${agent.name}: ${String(text).slice(0, HOST_LIMITS.team.logPreviewChars)}`)
    // The desk's tools prime before a run (e.g. the broker's live tool listing, once the server listens).
    return Promise.resolve()
      .then(() => ready())
      .then(() => {
        // Stopped while it waited: it never starts (a line in the desk log, as its acceptance was).
        if (!controller.signal.aborted) {
          handed.add(controller)
          return agent.ask(String(text), { from, signal: controller.signal })
        }
        log(`desk: ${from} → ${agent.name} stopped before it started: ${String(text).slice(0, HOST_LIMITS.team.logPreviewChars)}`)
        throw new Error("stopped")
      })
      .finally(() => (accepted.delete(entry), controllers.get(agent.name)?.delete(controller)))
  }
  // A run starts: the oldest accepted one of that agent with its request (a quest from a lead is not one of them).
  const started = (agent, request) => {
    const entry = [...accepted].find((r) => !r.started && r.agent === agent && r.text === request?.text && r.from === request?.from)
    if (entry) entry.started = true
  }

  const ok = (value = null) => ({ ok: true, value })
  const fail = (message) => ({ ok: false, error: { message } })

  // The desk's schedule: due runs go to the lead with their goal (checked every 30 s).
  const schedule = [...artifacts.values()].find((x) => x.artifact.kind === "schedule")?.artifact ?? null
  const scheduleTimer = schedule
    ? setInterval(() => {
        const due = schedule.takeDue(new Date())
        if (due) run(lead, due.goal, `schedule (booked by ${due.by})`).catch((error) => log(`desk: scheduled run failed: ${error.message}`))
      }, 30000)
    : null
  scheduleTimer?.unref?.()

  // The desk's own background work (start's run): it may wake the lead when it is idle.
  const busy = () => lead.status === "running"
  const wake = (text, from = "desk") => {
    if (busy()) return false
    run(lead, text, from).catch((error) => log(`desk: ${from} run failed: ${error.message}`))
    return true
  }
  const stopBackground = background?.({ wake, busy, log }) ?? null

  // The wake book (<workspace>/state/wakes.jsonl, companion/shared/wakes.js): wakes booked by scripts/send.js while
  // the server was down, or by the desk's own code, run here when due — to their agent, else the lead. A run that
  // ends in an error books one retry. Not in fixture runs (live: false).
  const wakeBook = desk.workspace ? wakesPath(desk.workspace) : null
  const deliverWake = ({ agent, text, from }) => {
    const target = agent ? team.agents().get(agent) : lead
    if (!target) return fail(`No agent "${agent}" in this desk.`)
    const id = String(from).replace(/^wake /, "")
    run(target, text, from).catch((error) => {
      const retry = retryWake(wakeBook, { id, error: error.message })
      log(`wake: ${id} failed: ${error.message}${retry ? ` — retry ${retry.id} at ${retry.at}` : ""}`)
    })
    return ok({ agent: target.name })
  }
  const stopWakes = wakeBook && live !== false ? startWakes({ root: desk.workspace, deliver: deliverWake, log: (line) => log(`wake: ${line}`) }) : () => {}

  // Owner-level actions on the desk itself (the UI's next-run box).
  function deskCall(method, args) {
    if (!schedule) return fail("this desk has no schedule")
    if (method === "schedule") return ok(schedule.book(args[0] ?? {}, "owner"))
    if (method === "unschedule") return ok(schedule.clear())
    if (method === "defaultGoal") return ok(schedule.setDefaultGoal(args[0]))
    return fail(`unknown desk method ${method}`)
  }

  // Each answer the lead gives to a run (owner, schedule, Telegram): for reports elsewhere.
  const leadAnswers = new Set()
  lead.on("answer", (e) => {
    for (const fn of leadAnswers) fn({ request: e.request, answer: e.answer, flags: e.flags ?? [], artifacts: kernel.artifacts, deskTeam, at: new Date(e.at).toISOString() })
  })

  async function call({ target, method, args = [] }) {
    if (target === "registry") return ok(null) // autopilot, model switch, agent edits: not for kernel desks
    if (target === "desk") {
      try {
        return deskCall(method, args)
      } catch (error) {
        return fail(error.message)
      }
    }
    const agent = target ? team.agents().get(target) : lead // no target: the lead (scripts/send.js --wait)
    if (!agent) return fail(`No agent "${target}" in this desk.`)
    try {
      switch (method) {
        case "ask": // args: [text, { from }?] — resolves with the answer
          return ok(await run(agent, args[0], args[1]?.from ?? "owner"))
        case "send":
          run(agent, args[0]).catch(() => {})
          return ok(null)
        case "deposit": {
          const letter = args[0] ?? {}
          run(agent, letter.text, letter.from ?? "owner").catch(() => {})
          return ok(null)
        }
        case "stop": {
          // Every run of the agent: its own (kernel Agent.stop — in progress or queued, whoever started it: the host, a
          // lead's quest, a dispatch), then the host's runs not handed to it yet (waiting on ready()). → {stopped: n}.
          const from = args[0]?.from ?? "owner"
          const own = typeof agent.stop === "function" ? agent.stop() : null
          let waiting = 0
          for (const c of controllers.get(agent.name) ?? []) {
            if (c.signal.aborted) continue
            if (own === null || !handed.has(c)) waiting++
            c.abort()
          }
          const stopped = (own ?? 0) + waiting
          log(`desk: ${from} stops ${agent.name}: ${stopped ? `${stopped} run${stopped === 1 ? "" : "s"} stopped` : "nothing was running"}`)
          return ok({ stopped })
        }
        case "chat": {
          // args: [text, { from }?] — one model call beside the agent's runs (kernel Agent.chat) → {answer, guided,
          // queued}. A QUEUE: line (or a GUIDE: line with no run left to guide) is new work: it starts here, as a send.
          const from = args[1]?.from ?? "owner"
          const said = String(args[0] ?? "").trim()
          if (!said) return fail("a chat needs text: what to ask the agent.")
          log(`desk: ${from} asks ${agent.name}: ${said.split("\n")[0].slice(0, HOST_LIMITS.team.logPreviewChars)}`)
          let out
          try {
            out = await agent.chat(said, { from })
          } catch (error) {
            log(`desk: ${agent.name} did not answer ${from}'s chat (${String(error.message).slice(0, HOST_LIMITS.team.logPreviewChars)})`)
            throw error
          }
          if (out.queued) run(agent, out.queued, from).catch(() => {})
          return ok({ answer: out.answer, guided: out.guided, queued: out.queued })
        }
        case "guide": {
          // args: [text, { from }?] — a note for the run in progress, seen at the agent's next step (kernel
          // Agent.guide). Idle, there is no run to guide: {delivered: false}, and the caller sends it as new work.
          const from = args[1]?.from ?? "owner"
          const delivered = agent.guide(args[0], from)
          if (delivered) log(`desk: ${from} guides ${agent.name}: ${String(args[0]).trim().slice(0, HOST_LIMITS.team.logPreviewChars)}`)
          return ok({ delivered })
        }
        case "preview":
          await agent.refreshArtifacts?.() // the prompt its next step would see, with its artifacts read fresh
          return ok(agent.render({ text: String(args[0] ?? ""), from: "owner" }, []))
        case "clearMemory":
          agent.history.length = 0
          update(agent.name, { status: "idle", activity: IDLE, working: null, error: null })
          states[agent.name] = { ...states[agent.name], messages: [] }
          broadcast({ type: "state", id: agent.name, patch: { messages: { from: 0, items: [] }, revision: states[agent.name].revision } })
          return ok(null)
        default:
          return ok(null) // summarizeMemory, resolveApproval, reconfigure: nothing to do here
      }
    } catch (error) {
      return fail(error.message)
    }
  }

  function send({ agent = null, text, from = null } = {}) {
    if (typeof text !== "string" || !text.trim()) return fail("text: what the agent should do.")
    const target = agent ? team.agents().get(agent) : lead
    if (!target) return fail(`No agent "${agent}" in this desk.`)
    run(target, text.trim(), from ?? "owner").catch(() => {})
    return ok({ engine: target.name, agent: target.name, queued: true })
  }

  function stream(request) {
    const encoder = new TextEncoder()
    let sendEvent = null
    let ping = null
    let closeStream = null
    const body = new ReadableStream({
      start(controller) {
        sendEvent = (event) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          } catch {
            clients.delete(sendEvent)
          }
        }
        sendEvent({ type: "snapshot", registry, states, models: null, kernel, log: logs })
        clients.add(sendEvent)
        ping = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": ping\n\n"))
          } catch {
            clearInterval(ping)
          }
        }, SSE_PING_MS)
        const close = () => {
          clients.delete(sendEvent)
          closers.delete(close)
          clearInterval(ping)
          try {
            controller.close()
          } catch {}
        }
        closers.add(close)
        request.signal?.addEventListener("abort", close)
        closeStream = close
      },
      cancel() {
        closeStream?.()
      },
    })
    return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" } })
  }

  function announce(p, deskName = null) {
    const file = join(storageDir, "server.json")
    writeFileSync(file, JSON.stringify({ port: p, pid: process.pid, root: desk.workspace, ...(deskName ? { desk: deskName } : {}) }))
    process.on("exit", () => {
      try {
        if (JSON.parse(readFileSync(file, "utf8")).pid === process.pid) rmSync(file)
      } catch {}
    })
  }

  // What the team runs now, and the runs it accepted that have not started yet (step "waiting to start").
  function work() {
    const preview = (text) => String(text ?? "").split("\n")[0].slice(0, HOST_LIMITS.team.runPreviewChars)
    const running = team.list.flatMap((a) => {
      const s = states[a.name]
      if (s?.status !== "running") return []
      const request = s.messages.find((m) => m.id === s.working?.request)
      return [{ agent: a.name, lead: a === lead, run: preview(request?.content), step: describeActivity(s.activity) || null, since: s.working?.at ?? null }]
    })
    const waiting = [...accepted].filter((r) => !r.started).map((r) => ({ agent: r.agent, lead: r.agent === lead.name, run: preview(r.text), step: "waiting to start", since: r.at }))
    return [...running, ...waiting]
  }

  log(`desk: ${team.list.length} agents ready (lead ${lead.name})`)
  // onLeadAnswer(fn): fn({request, answer, flags, artifacts, deskTeam, at}) after each lead run; returns an unsubscribe.
  const onLeadAnswer = (fn) => (leadAnswers.add(fn), () => leadAnswers.delete(fn))
  return {
    storageDir,
    stream,
    call,
    send,
    announce,
    work,
    onLeadAnswer,
    log, // host code beside the desk (the Telegram bridge) writes to the same trail
    get agents() {
      return team.list.map((a) => a.name) // now: spawned agents count while they are here
    },
    terminate: () => (clearInterval(scheduleTimer), stopWakes(), stopBackground?.(), controllers.forEach((set) => set.forEach((c) => c.abort()))),
    // Every open stream ends: EventSource reconnects on its own, to the desk hosted then (companion/server/desks.js,
    // after a reload), and its snapshot replaces what the tab showed.
    endStreams: () => [...closers].forEach((close) => close()),
  }
}
