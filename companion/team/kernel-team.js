// A desk (backend/kernel, main.js `start`) served as the server's team: GET team/stream, POST team/call and
// team/send (companion/server/host-api.js), announce, work, terminate. Every view of the live UI (backend/live) —
// home, agent page, Live follow, status bar, /sts — mirrors it.
//
// Each kernel agent is streamed as one entry (id = its name; the UI calls these agents, the stream's registry
// still names the list `engines`): its definition, and its events (start, think, step, call, result, gate,
// format, guide, answer, error) as the state the UI reads (status, activity, messages, working, stats).
// The owner's message to the lead (or any agent) runs it, as do the desk's schedule and its own
// background work (start's run({wake, busy, log})). Messages live in memory and in
// state/kernel-team.jsonl (one row per event); each agent's runs also in its history.md beside its
// .md (kernel-history.js), restored at start with every step as it streamed. Each team's board is
// memory/<desk>/<team>/board.md (board-file.js), restored at every start.

//
// Every kernel element reaches the UI (the owner follows the trail): agents with their definition (role, folder,
// tool specs, artifacts held), each call drawn by its tool's view, refused answers (gate/format), model-call stats
// per agent, every artifact, and the desk's background log (watchers, schedule, wakes, Telegram) as `log` events.
//
// 2026-10-17: the agent set is not fixed at start. An agent spawned at run time (kernel Desk.spawn, tool agent.spawn)
// gets its state, a folder under <desk state>/spawned/<name>/ (an agent.md record, so its history.md records), and
// reaches every tab as {type: "registry", registry, states: {<name>: state}} then {type: "kernel", tree}; the
// artifacts are scanned again (new ones watched, holders re-sent). A dismissed one leaves the registry, its own
// artifacts leave as {type: "kernel", tree, removed: [ids]}. work() and the agent count read the live list. A spawned
// TEAM (one spawn event per agent, its lead first) arrives whole at its lead's event: every agent of it gets its state
// and folder (agent.md with team:) in one registry event; dismissed, it leaves one agent per event, members first.
//
// 2026-10-17 owner ("I want to be able to talk with the lead to understand what is currently already there and what I
// want to check"): team/call chat [text, {from}] is one model call beside the agent's runs (kernel Agent.chat): the
// answer comes back, the exchange is two thread rows of kind "chat" (never a run's request), a GUIDE: line reached the
// run in progress (guided), a QUEUE: line — or a GUIDE: line with no run to guide — is a proposal (proposed): the host
// never starts a run from a chat (2026-10-17 critic: a quoted QUEUE: line, or one that arrived after the owner's Stop,
// started a run attributed to the owner); the owner starts it with one click. A chat in flight is work (work(): "(owner
// chat) …", step "answering the owner") until it ends. stop reaches every run of the agent, however it was started (a
// lead's quest, a dispatch), and its chats in flight: kernel Agent.stop.
//
// 2026-10-17 (critic: a live view froze while every holder waited on a long run): an artifact with a numeric `poll`
// (ms; the preview's) is refreshed by the host — x.refresh(a holder) every poll ms — while at least one tab is on the stream.

import { appendFileSync, existsSync, mkdirSync, renameSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { dirname, join, relative } from "node:path"

import { ownerHelperCall, respawn, SPAWN_NAME } from "../../backend/kernel/index.js"
import { describeActivity } from "../../backend/live/activity.js"
import { activityOf, cut, freshState, IDLE, nextStats, rows } from "../../backend/live/team-rows.js"
import { OWNER_CHAT_STEP } from "./kernel-status.js"
import { boardMarkdown, readBoardFile } from "./board-file.js"
import { createHistory } from "./kernel-history.js"
import { archiveKept, keptFolderOf, readKept, writeKept } from "./kept.js"
import { agentTreeRoot } from "./layout.js"
import { retryWake, startWakes, wakesPath } from "../shared/wakes.js"
import { SSE_PING_MS, HOST_LIMITS } from "../shared/config.js"
import { boardFile, memoryFolder } from "../shared/paths.js"

export const MAX_MESSAGES = 400 // an agent's thread rows kept: the newest (live), the newest whole runs (restored)
const LOG_KEEP = 300 // background log lines kept for a tab that connects later
const POLL_MIN_MS = 1000 // an artifact's `poll` shorter than this runs at this (the host's refresh of polled artifacts)

// pollMinMs: the shortest poll the host runs for an artifact's `poll` (tests shorten it).
export async function createKernelTeam({ desk, port, log: hostLog = () => {}, live = process.env.ASKK_KERNEL_FIXTURE ? false : undefined, pollMinMs = POLL_MIN_MS }) {
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
  // The desks' memory folder at ASKK's root (memory/, 2026-10-17 owner), one folder per desk by its name: the desk's and
  // its teams' memory and reports; every desk's in the same place (desk.js loadDesk sets it; ASKK_MEMORY moves it).
  const memory = desk.memory ?? (desk.folder ? memoryFolder(desk.name) : null)
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
  // 2026-10-21 owner ("For a shared history board for agents, a memory/<desk>/<sub desk>"): a team's board is
  // memory/<desk>/<team>/board.md instead (paths.js boardFile; the desk's memory is its lead's ctx.memory — a mounted
  // desk's own), written on every change and restored at every start whatever its keep; a board.md not written yet is
  // restored once from its state/artifacts/<id>.json (any day). A fixture run (live: false), or a desk without a memory
  // folder, keeps the state/ files.
  const etDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d)
  const artDir = join(storageDir, "artifacts")
  mkdirSync(artDir, { recursive: true })
  const fileOf = (id) => `${id.replace(/[^\w.-]/g, "_")}.json`
  const keepOf = (x) => x.keep ?? "day"
  // Each instance is read back from disk once, when it first appears (2026-10-17 critic: a live shared one re-held after
  // its last holder was dismissed was restored again by rescan, its in-memory state reset to the last save).
  const restored = new WeakSet()
  const boardPaths = new WeakMap() // a board → its board.md (null: state/ files), fixed when it first appears
  const boardPath = (x) => {
    if (!boardPaths.has(x)) {
      const mem = live === false ? null : (team.list.find((a) => a.board === x)?.context?.memory ?? memory)
      boardPaths.set(x, mem ? boardFile(mem, x.team) : null)
    }
    return boardPaths.get(x)
  }
  // A board.md is the team's history: restored at start when it belongs to today (a keep "day" board — the default) or
  // to any day (keep "always"); a day board from an earlier day is filed under <team>/boards/<day>.md and the board
  // starts fresh (2026-10-21 review: days-old entries flowed into every prompt). A spawned team that is not kept never
  // inherits a dismissed team's board of the same name: its old file is filed away too.
  const fileAway = (file, day) => {
    const to = join(dirname(file), "boards", `${day}.md`)
    mkdirSync(dirname(to), { recursive: true })
    renameSync(file, existsSync(to) ? to.replace(/\.md$/, `-${Date.now()}.md`) : to)
    return to
  }
  const restoreBoard = (id, x) => {
    const file = boardPath(x)
    if (!file) return false
    try {
      const saved = existsSync(file) ? readBoardFile(file) : null
      const owner = team.list.find((a) => a.board === x)
      const transient = !!owner?.config?.spawned && owner.config.spawned.keep !== "desk"
      if (saved) {
        const day = saved.at ? etDay(new Date(saved.at)) : null
        if (transient || (keepOf(x) === "day" && day !== etDay())) log(`desk: ${id} from ${day ?? "an unknown day"} filed to ${fileAway(file, day ?? "undated")}; the board starts fresh`)
        else x.restore({ entries: saved.entries })
      } else if (!transient && existsSync(join(artDir, fileOf(id)))) {
        const old = JSON.parse(readFileSync(join(artDir, fileOf(id)), "utf8")) // before board.md: only today's
        if (keepOf(x) !== "day" || old.day === etDay()) x.restore(old.state)
      }
    } catch (error) {
      log(`desk: ${id} not restored (${error.message})`)
    }
    return true
  }
  const restore = (id, x) => {
    restored.add(x)
    if (x.kind === "board" && restoreBoard(id, x)) return
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
    const board = x.kind === "board" ? boardPath(x) : null
    if (board) {
      try {
        mkdirSync(dirname(board), { recursive: true })
        const tmp = `${board}.${process.pid}.tmp`
        writeFileSync(tmp, boardMarkdown(x))
        renameSync(tmp, board)
      } catch (error) {
        log(`desk: ${id} not saved (${error.message})`)
      }
      return
    }
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
    syncPolls()
    return removed
  }

  // ---- artifacts the host refreshes -------------------------------------------------------------
  // 2026-10-17 (critic: a live view froze while every holder sat in dispatch.wait / terminal.wait — its refresh ran only
  // before a holder's step): an artifact with a numeric `poll` (ms, at least POLL_MIN_MS) is refreshed here —
  // x.refresh(a holder still in the desk) every poll ms — only while at least one tab is on the stream, one refresh at a
  // time. Its refresh calls changed() only on a diff, so a quiet poll sends nothing. A failure (or a refresh with no
  // answer in POLL_TIMEOUT_MS) is one desk-log line per minute at most. Timers end with the last tab, and on terminate.
  const POLL_TIMEOUT_MS = 15_000
  const polls = new Map() // artifact id -> {x, timer, busy}
  let pollLogged = 0
  let terminated = false // terminate(): no poll starts again, even for a tab still connected
  const pollEvery = (x) => (typeof x?.refresh === "function" && Number.isFinite(x.poll) && x.poll > 0 ? Math.max(pollMinMs, x.poll) : 0)
  async function pollOnce(id, entry) {
    if (entry.busy) return
    const held = artifacts.get(id)
    if (held?.artifact !== entry.x) return
    const holder = held.holders.map((name) => team.agents().get(name)).find(Boolean)
    if (!holder) return
    entry.busy = true
    let timer = null
    try {
      await Promise.race([entry.x.refresh(holder), new Promise((_, no) => (timer = setTimeout(() => no(new Error(`no answer in ${POLL_TIMEOUT_MS / 1000} s`)), POLL_TIMEOUT_MS)))])
    } catch (error) {
      if (Date.now() - pollLogged >= 60_000) {
        pollLogged = Date.now()
        log(`desk: ${id} refresh failed (${String(error?.message ?? error).split("\n")[0].slice(0, 200)}); more failures this minute are not logged`)
      }
    } finally {
      clearTimeout(timer)
      entry.busy = false
    }
  }
  // The polls the desk needs now: one per polled artifact while a tab is connected, none without one.
  function syncPolls() {
    const wanted = new Set()
    if (clients.size > 0 && !terminated) {
      for (const [id, { artifact: x }] of artifacts) {
        const every = pollEvery(x)
        if (!every) continue
        wanted.add(id)
        const old = polls.get(id)
        if (old?.x === x) continue
        if (old) clearInterval(old.timer)
        const entry = { x, timer: null, busy: false }
        entry.timer = setInterval(() => pollOnce(id, entry), every)
        entry.timer.unref?.()
        polls.set(id, entry)
      }
    }
    for (const [id, p] of polls)
      if (!wanted.has(id)) {
        clearInterval(p.timer)
        polls.delete(id)
      }
  }

  // ---- state per engine, from kernel events ----------------------------------------------------
  const states = Object.fromEntries(team.list.map((a) => [a.name, freshState()]))
  let seq = 0
  const at = (ms) => new Date(ms ?? Date.now()).toISOString()
  // The run in progress per agent, beside the kernel's steps (its answer event carries them): what its thread showed
  // that the steps do not hold — each step's results in the order they arrived, its refused-answer row, the owner's
  // guidance and where it fell, each row's time (the Live feed merges agents by time). Recorded with the run
  // (kernel-history.js), so a restored thread reads as it streamed.
  const trails = new Map() // agent name -> {times: [ms, request first], step, steps: [{arrived: [call index], gate}], guidance: [{pos, from, text}]}
  const trailStep = (id) => {
    const t = trails.get(id)
    return t && t.step >= 0 ? (t.steps[t.step] ??= { arrived: [], gate: null }) : null
  }

  function update(id, patch, newMessages = []) {
    const s = (states[id] ??= freshState())
    const from = s.messages.length
    const trail = trails.get(id)
    // The run's rows, in order (an owner chat beside the run is not one of them: its history never holds it).
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
  const counted = (id, a, e) => nextStats(states[id]?.stats, a, e)
  // The step running now per agent: {stage, since, row, calls: [{index, tool, input}] not answered yet}; row: the
  // step's thread row (its message id). A result is its call's by the index the kernel's `call` and `result` carry
  // (the call's place in the step), never by tool name (2026-10-17: two quote calls in one step showed each other's
  // inputs; "desk.scout", run as scout, kept its row without its brief and stayed in the activity after it reported).
  const pendingCalls = new Map()

  const msg = (row) => ({ id: `k${++seq}`, ...row })

  // history.md beside each agent's .md: the newest runs come back as its EARLIER RUNS and as its thread's
  // first rows — every step as it streamed: its calls (tool, view, inputs, ok, the clipped output) in the order their
  // results arrived, refused answers, the owner's guidance where it fell. 2026-10-17: a restored run was only its
  // request and answer, so research-lead's thread and the Live feed lost every call when its desk reloaded.
  const history = createHistory({ enabled: live !== false })
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
  // A run from its history row as thread rows (no ids), each at its recorded time (else the run's). A row from
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
    const runs = history.restore(a)
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
      case "keep":
        keptNow(e)
        break
      case "proposal":
        proposal(e)
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
        if (!e.calls?.length) {
          if (e.images?.length) update(id, {}, [msg(rows.saw(e.images, at(e.at)))])
          break
        }
        // The step's calls by their index; quests only: the thread now waits for its sub-agents' reports. Each name as
        // the kernel will run it (Agent.resolveTool), so the first activity already draws "desk.scout" as the quest to
        // scout (2026-10-17: it drew it as a data tool until the `call` event came). The step row keeps the names as
        // written.
        const row = msg(rows.step(e.thought, e.calls, at(e.at), e.images))
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
        history.record(a, e, null, trails.get(id))
        trails.delete(id)
        update(id, { status: "idle", activity: IDLE, working: null }, [msg(rows.answer(e.answer, at(e.at)))])
        break
      case "error":
        pendingCalls.delete(id)
        history.record(a, e, starts.get(id))
        starts.delete(id)
        trails.delete(id)
        update(id, { status: "error", activity: IDLE, working: null, error: e.error }, [msg({ ...rows.answer(`Error: ${e.error}`, at(e.at)), error: e.error })])
        break
    }
  })

  // ---- agents that come and go -----------------------------------------------------------------
  // A spawned agent (kernel Desk.spawn, from agent.spawn): its folder is <desk state>/spawned/<name>/ with an agent.md
  // record of what it was made for (the history.md beside it records its runs, as an agent's folder does); every
  // tab gets its definition and state, the caller's new definition, the artifacts' new holders and the new tree.
  // 2026-10-17: a spawned TEAM is one spawn event per agent (kernel Desk.spawn), its lead's first, every agent of it
  // already built then: the lead's event sets them all up — each its state and folder (agent.md with team:, the lead's
  // with its members) — in one registry event; a member's own event finds itself set up.
  const spawnedDir = join(storageDir, "spawned")
  // 2026-10-20 owner ("The agent might want to keep the sub-agents alive … written as .MD files in the same folder"): a
  // helper spawned with keep: desk is written as <its spawner's folder>/<name>/<name>.md (kept.js) — its history.md
  // beside it — spawned again at the next start (below), and archived to memory/<desk>/archive/agents/ when dismissed.
  // The desk's agent tree (layout.js): its lead's folder (<desk>/<lead>/), or agents/ in the legacy layout.
  const agentsRoot = desk.folder ? agentTreeRoot(desk.folder) : null
  const keptFolders = new Map() // name → its agent.md folder, for a kept helper here now
  const updating = new Map() // name → its kept folder, between agent.update's dismiss and its spawn
  const yamlList = (xs) => `[${xs.map((x) => JSON.stringify(x)).join(", ")}]`
  // An agent's folder and its agent.md record: what it was made for (config.spawned: by, goal, keep, at, team — else
  // the event's), what it holds.
  function recordSpawn(a, e) {
    const kept = live === false ? null : keptFolderOf(a, { agentsRoot, agents: team.agents() })
    const was = updating.get(a.name)
    updating.delete(a.name)
    if (was && was !== kept) {
      const to = archiveKept(was, memory, a.name)
      if (to) log(`desk: ${a.name} is no longer kept — its agent.md moved to ${memory && to.startsWith(memory) ? `memory/${relative(join(memory, ".."), to)}` : to}`)
    }
    if (kept) {
      a.config.folder = kept
      keptFolders.set(a.name, kept)
      try {
        writeKept(a, kept, team.agents())
      } catch (error) {
        log(`desk: ${a.name}'s agent.md not written (${error.message})`)
      }
      return
    }
    const s = a.config.spawned ?? e
    // Only a spawn name (kernel SPAWN_NAME, which Desk.spawn checks too) becomes a folder. 2026-10-17 (critic): the old
    // sanitiser (/[^\w.-]/) let ".." through, and the helper's agent.md and history went into state/.
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
      // A kept helper back (a restart, an update): its runs from the history.md beside its .md, as a desk agent's.
      if (keptFolders.has(x.name)) {
        const runs = history.restore(x)
        if (runs.length) {
          x.history = runs.map((r) => ({ from: r.from, request: r.request, answer: r.answer }))
          states[x.name].messages = keepRuns(runs.map((r) => withIds(restoredRun(x, r))))
        }
      }
    }
    describeAll()
    broadcast({ type: "registry", registry, states: Object.fromEntries(fresh.map((x) => [x.name, states[x.name]])) })
    rescan()
    kernel.tree = team.tree()
    broadcast({ type: "kernel", tree: kernel.tree })
    const members = fresh.filter((x) => x !== a).map((x) => x.name)
    const waits = e.proposed ? ` (for this run; keep: desk waits for the owner — from a run that read the web: ${e.proposed.from})` : ""
    log(`desk: ${e.by} spawned ${members.length ? `team ${a.name} (${members.join(", ")})` : a.name}${waits}: ${String(e.goal ?? "").split("\n")[0].slice(0, HOST_LIMITS.team.logPreviewChars)}`)
  }
  // 2026-10-20 (kernel builtin/spawn.js: a keep: desk or a kept helper's update from a run that read outside waits for the
  // owner). Kept by the owner's accept (kernel Desk.keep): its agent.md written under its spawner's folder now, members
  // inside, as a kept spawn's is. A proposal set or dropped (Desk.propose): its twin — the definition and the tree.
  function keptNow(e) {
    const a = team.agents().get(e.agent)
    if (!a) return
    for (const x of team.list.filter((x) => x === a || (e.team && x.config.spawned?.team === e.team))) recordSpawn(x, e)
    describeAll()
    broadcast({ type: "registry", registry, states: {} })
    kernel.tree = team.tree()
    broadcast({ type: "kernel", tree: kernel.tree })
    log(`desk: ${e.by ?? "owner"} kept ${e.agent}${keptFolders.has(e.agent) ? " — its agent.md is written; it is back at every start" : ""}`)
  }
  function proposal(e) {
    describeAll()
    broadcast({ type: "registry", registry, states: {} })
    kernel.tree = team.tree()
    broadcast({ type: "kernel", tree: kernel.tree })
    const p = e.proposed
    if (p) log(`desk: ${e.by ?? "?"} proposes ${p.update ? `an update of kept ${e.agent} (${Object.keys(p.update).join(", ")})` : `to keep ${e.agent}`} — not in force, waits for the owner (from a run that read the web: ${p.from})`)
    else if (e.dropped) log(`desk: ${e.by ?? "owner"} dropped the ${e.dropped === "update" ? "update" : "keep"} proposed for ${e.agent}${e.reason ? `: ${e.reason}` : ""}`)
  }
  // A dismissed agent leaves the registry (its folder and history.md stay); the artifacts only it held leave too. A
  // team leaves one agent per event, its members first (kernel Desk.dismiss), its board with the last of them.
  function dismissed(e) {
    const folder = keptFolders.get(e.agent)
    keptFolders.delete(e.agent)
    // A kept helper dismissed for good leaves the desk's agents/ (its folder, members inside, archived in memory); one
    // dismissed for an update keeps its folder for the spawn that follows. A team member goes inside its lead's folder.
    if (folder && e.reason === "update") updating.set(e.agent, folder)
    else if (folder && (!e.team || e.team === e.agent)) {
      const to = archiveKept(folder, memory, e.agent)
      if (to) log(`desk: kept ${e.agent} dismissed — its agent.md moved to ${memory && to.startsWith(memory) ? `memory/${relative(join(memory, ".."), to)}` : to}`)
    }
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
  // The owner's chats in flight (team call `chat`) until each ends: work() lists them, so the status bar, the canvas and
  // a desk reload (desks/load waits while work() is not empty) see them; kernel Agent.stop aborts them.
  const chatting = new Set() // {agent, text, at}
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

  // Owner-level actions on the desk itself (the UI's next-run box; 2026-10-20 the owner's accept or drop of what waits on a
  // helper, kernel ownerHelperCall: [{helper, reason?}]).
  async function deskCall(method, args) {
    if (method === "accept" || method === "drop") return ok(await ownerHelperCall(team, method, args[0] ?? {}))
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
        return await deskCall(method, args)
      } catch (error) {
        return fail(error.message)
      }
    }
    // The owner acts on an artifact through its twin (2026-10-17: the preview's ask, kernel builtin/preview.js): args [{id,
    // …}] → its ownerCall(method, args, "owner"); a {deliver} text goes to its keeper (else the lead) — guidance while it
    // runs, else a new run. → the call's result without the text, + {keeper, delivered: "guided" | "run"}.
    if (target === "artifact") {
      const id = String(args[0]?.id ?? "")
      const x = artifacts.get(id)?.artifact
      if (typeof x?.ownerCall !== "function") return fail(`no artifact "${id}" takes the owner's calls`)
      try {
        // awaited (2026-10-17): the preview's open / back / rerun read files and run scripts first
        const { deliver, keeper: name, ...rest } = (await x.ownerCall(method, args, "owner")) ?? {}
        if (!deliver) return ok(rest)
        const keeper = team.agents().get(name ?? "") ?? lead
        const guided = keeper.guide(deliver, "owner")
        if (guided) log(`desk: owner asks on ${id} → ${keeper.name} (guidance): ${deliver.split("\n")[0].slice(0, HOST_LIMITS.team.logPreviewChars)}`)
        else run(keeper, deliver, "owner").catch((error) => log(`desk: owner's ask on ${id} → ${keeper.name} failed: ${error.message}`))
        return ok({ ...rest, keeper: keeper.name, delivered: guided ? "guided" : "run" })
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
          // lead's quest, a dispatch) and its owner chats in flight (they reject "stopped": no answer, no guidance), then
          // the host's runs not handed to it yet (waiting on ready()). → {stopped: n} (chats counted, as the kernel does).
          const from = args[0]?.from ?? "owner"
          const chats = [...chatting].filter((c) => c.agent === agent.name).length
          const own = typeof agent.stop === "function" ? agent.stop() : null
          let waiting = 0
          for (const c of controllers.get(agent.name) ?? []) {
            if (c.signal.aborted) continue
            if (own === null || !handed.has(c)) waiting++
            c.abort()
          }
          const stopped = (own ?? 0) + waiting
          const runs = Math.max(0, stopped - chats)
          const said = [runs && `${runs} run${runs === 1 ? "" : "s"}`, stopped > runs && `${stopped - runs} owner chat${stopped - runs === 1 ? "" : "s"}`].filter(Boolean).join(" and ")
          log(`desk: ${from} stops ${agent.name}: ${stopped ? `${said} stopped` : "nothing was running"}`)
          return ok({ stopped })
        }
        case "chat": {
          // args: [text, { from }?] — one model call beside the agent's runs (kernel Agent.chat) → {answer, guided,
          // proposed}. A QUEUE: line (or a GUIDE: line with no run left to guide) is a proposal: never started here — the
          // owner starts it (the UI's "Queue it" sends it). In flight it is work (work()); stop aborts it ("stopped").
          const from = args[1]?.from ?? "owner"
          const said = String(args[0] ?? "").trim()
          if (!said) return fail("a chat needs text: what to ask the agent.")
          log(`desk: ${from} asks ${agent.name}: ${said.split("\n")[0].slice(0, HOST_LIMITS.team.logPreviewChars)}`)
          const entry = { agent: agent.name, text: said, at: new Date().toISOString() }
          chatting.add(entry)
          let out
          try {
            out = await agent.chat(said, { from })
          } catch (error) {
            log(`desk: ${agent.name} did not answer ${from}'s chat (${String(error.message).slice(0, HOST_LIMITS.team.logPreviewChars)})`)
            throw error
          } finally {
            chatting.delete(entry)
          }
          const proposed = typeof out.proposed === "string" && out.proposed.trim() ? out.proposed.trim() : null
          if (proposed) log(`desk: ${agent.name} proposes to ${from} (not started): ${proposed.split("\n")[0].slice(0, HOST_LIMITS.team.logPreviewChars)}`)
          return ok({ answer: out.answer, guided: !!out.guided, proposed })
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
            syncPolls()
          }
        }
        sendEvent({ type: "snapshot", registry, states, models: null, kernel, log: logs })
        clients.add(sendEvent)
        syncPolls() // the first tab starts the polled artifacts' refreshes
        ping = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": ping\n\n"))
          } catch {
            clearInterval(ping)
            clients.delete(sendEvent) // a tab gone without its abort: no longer counted (the polls stop with the last)
            syncPolls()
          }
        }, SSE_PING_MS)
        const close = () => {
          clients.delete(sendEvent)
          syncPolls() // the last tab gone: no polls
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

  // What the team runs now, the owner's chats in flight (step OWNER_CHAT_STEP: work to stop, never a run — the Telegram
  // bridge tells them apart with isRunWork), and the runs it accepted that have not started yet (step "waiting to start").
  function work() {
    const preview = (text) => String(text ?? "").split("\n")[0].slice(0, HOST_LIMITS.team.runPreviewChars)
    const running = team.list.flatMap((a) => {
      const s = states[a.name]
      if (s?.status !== "running") return []
      const request = s.messages.find((m) => m.id === s.working?.request)
      return [{ agent: a.name, lead: a === lead, run: preview(request?.content), step: describeActivity(s.activity) || null, since: s.working?.at ?? null }]
    })
    const chats = [...chatting].map((c) => ({ agent: c.agent, lead: c.agent === lead.name, run: preview(`(owner chat) ${c.text}`), step: OWNER_CHAT_STEP, since: c.at }))
    const waiting = [...accepted].filter((r) => !r.started).map((r) => ({ agent: r.agent, lead: r.agent === lead.name, run: preview(r.text), step: "waiting to start", since: r.at }))
    return [...running, ...chats, ...waiting]
  }

  // The kept helpers (<spawner folder>/<name>/<name>.md — or agent.md — with keep: desk), spawned again by their spawners, parents first: each
  // bounded by what its spawner holds now; one that cannot be is a log line and stays on disk.
  if (agentsRoot && live !== false) {
    try {
      const records = readKept(team.list.filter((a) => a.config.folder).map((a) => ({ name: a.name, folder: a.config.folder })))
      if (records.length) {
        const back = await respawn(team, records, { log: (line) => log(`desk: ${line}`) })
        if (back.length) log(`desk: kept helpers back: ${back.join(", ")}`)
      }
    } catch (error) {
      log(`desk: kept helpers not respawned (${error.message}): the desk starts without them; their folders stay`)
    }
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
    terminate: () => (clearInterval(scheduleTimer), stopWakes(), stopBackground?.(), controllers.forEach((set) => set.forEach((c) => c.abort())), (terminated = true), syncPolls()),
    // Every open stream ends: EventSource reconnects on its own, to the desk hosted then (companion/server/desks.js,
    // after a reload), and its snapshot replaces what the tab showed.
    endStreams: () => [...closers].forEach((close) => close()),
  }
}
