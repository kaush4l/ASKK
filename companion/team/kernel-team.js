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

import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { dirname, join, relative } from "node:path"

import { limitWait, ownerHelperCall, respawn, SPAWN_NAME, usageLimit } from "../../backend/kernel/index.js"
import { describeActivity } from "../../backend/live/activity.js"
import { createChannel, createTeamCore, fail, ok } from "../../backend/live/team-core.js"
import { cut, freshState, nextStats, rows } from "../../backend/live/team-rows.js"
import { OWNER_CHAT_STEP } from "./kernel-status.js"
import { boardMarkdown, readBoardFile } from "./board-file.js"
import { MODELS, SELECTOR_MODELS, setAgentModel } from "./compose.js"
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
export async function createKernelTeam({ desk, port, log: hostLog = () => {}, live = process.env.ASKK_KERNEL_FIXTURE ? false : undefined, pollMinMs = POLL_MIN_MS, goalTickMs = 30000 }) {
  const storageDir = desk.state
  mkdirSync(storageDir, { recursive: true })
  const eventsFile = join(storageDir, "kernel-team.jsonl")
  // 2026-10-23 audit: what must outlive a hard kill — the run each agent has in progress (state/running/<agent>.json,
  // removed when it ends: one left at start was cut off) and each agent's model-call stats (state/agent-stats.json)
  const runningDir = join(storageDir, "running")
  const marker = (name) => join(runningDir, `${encodeURIComponent(name)}.json`)
  const statsFile = join(storageDir, "agent-stats.json")
  // A file that does not read is set aside, never deleted or written over (2026-10-23 audit) → its new name.
  const quarantine = (path) => {
    const to = `${path}.unreadable-${Date.now()}`
    try {
      renameSync(path, to)
      return to
    } catch {
      return path
    }
  }
  let journalFailed = false
  let logSaveWarned = false
  const logSaveFailed = (error) => {
    if (!logSaveWarned) log(`desk: the desk log was not saved (${error.message}) — a restart starts it empty`)
    logSaveWarned = true
  }
  // the runs the last process accepted and never started (saveAccepted below), read before this one accepts any
  const acceptedFile = join(storageDir, "accepted.json")
  let leftQueued = []
  let leftQueuedError = null // said once the log exists (below): the file kept aside, never dropped (2026-10-23 audit)
  try {
    leftQueued = existsSync(acceptedFile) ? JSON.parse(readFileSync(acceptedFile, "utf8")) : []
    rmSync(acceptedFile, { force: true })
  } catch (error) {
    leftQueuedError = `${error.message} — kept as ${quarantine(acceptedFile)}`
  }

  // Tabs on team/stream, and the desk's background log: every line the desk, its watchers, the schedule, the
  // wake book or the Telegram bridge writes goes to the server log and to every tab ({type: "log"}); the newest
  // LOG_KEEP ride in the snapshot. `source` is the line's "<word>:" prefix (watch, desk, radar, telegram, wake…).
  const closers = new Set() // each open stream's close (endStreams)
  // the desk log's newest lines outlive a restart (2026-10-23 audit: the Desk log started empty), saved a second after a line
  const logFile = join(storageDir, "desk-log.json")
  const logs = []
  let logReadError = null // said once the log runs (below)
  try {
    if (existsSync(logFile)) logs.push(...JSON.parse(readFileSync(logFile, "utf8")).slice(-LOG_KEEP))
  } catch (error) {
    logReadError = `${error.message} — kept as ${quarantine(logFile)}`
  }
  let logSave = null
  const writeLog = () => {
    try {
      writeFileSync(logFile, JSON.stringify(logs))
    } catch (error) {
      logSaveFailed(error)
    }
  }
  const saveLog = () => {
    logSave ??= setTimeout(() => ((logSave = null), writeLog()), 1000)
    logSave.unref?.()
  }
  const channel = createChannel({ logKeep: LOG_KEEP, logs, hostLog, saveLog })
  const { clients, broadcast, log } = channel
  // The desks' memory folder at ASKK's root (memory/, 2026-10-17 owner), one folder per desk by its name: the desk's and
  // its teams' memory and reports; every desk's in the same place (desk.js loadDesk sets it; ASKK_MEMORY moves it).
  if (logReadError) log(`desk: the desk log of before the restart did not read (${logReadError})`)
  const memory = desk.memory ?? (desk.folder ? memoryFolder(desk.name) : null)
  const built = await desk.start({ port, live: live ?? true, log, memory })
  const { desk: team, ready = async () => {}, run: background = null } = built
  const lead = team.lead // team.list: every agent now (spawned ones come and go), never a copy taken at start
  const modelFile = join(storageDir, "model.json")
  const catalogue = team.models ?? MODELS
  try {
    if (live !== false && existsSync(modelFile)) {
      const savedModel = JSON.parse(readFileSync(modelFile, "utf8"))?.defaultModel
      if (savedModel && Object.hasOwn(catalogue, savedModel)) team.defaultModel = savedModel
    }
  } catch (error) {
    log(`desk: the saved default model did not read (${error.message})`)
  }

  // ---- the desk's shape and its artifacts ------------------------------------------------------
  // Streamed as {type: "kernel", artifact, boards?}; the snapshot carries them all. Every artifact
  // (boards, memories, checklists, quality matrices, the desk's own) by its id "<owner>.<kind>": its twin
  // (kernel Artifact.twin(): kind, view, owner, title, brief — its state in one line —, state, items for a list)
  // with the agents that hold it (Desk.artifacts()).
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
        const x = core.artifacts.get(id)?.artifact
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
  // ---- the team: registry, threads, artifacts, run events (backend/live/team-core.js, shared with the tab's host) ------
  const boot = Date.now().toString(36) // ids unique across processes (2026-10-23 audit: k1, k2 … again after a restart)
  const core = createTeamCore({
    team,
    channel,
    title: desk.title ?? desk.name ?? null,
    kernel: { defaultModel: team.defaultModel ?? "default", models: SELECTOR_MODELS.map(({ key, label, provider, id }) => ({ key, label, provider, id })) },
    maxMessages: MAX_MESSAGES,
    logChars: HOST_LIMITS.team.logPreviewChars,
    idOf: (n) => `k${boot}-${n}`,
    // the folder shown relative to the desk's
    definition: (twin, folder) => ({ ...twin, folder: folder ? (desk.folder ? relative(desk.folder, folder) : folder) : null }),
    // every model call counted is saved once its update is in (a chat's or a compaction's too — 2026-10-23 audit)
    stats: (id, a, e) => (queueMicrotask(saveStats), nextStats(core.states[id]?.stats, a, e)),
    persist: {
      restore,
      save: (id) => save(id),
      flush: (id, x) => flush(id, x),
      // the run's rows, in order (an owner chat beside the run is not one of them: its history never holds it)
      rows: (id, newRows) => trails.get(id)?.times.push(...newRows.filter((m) => m.kind !== "chat").map((m) => Date.parse(m.at))),
    },
    hooks: {
      note,
      dropped: (text) => log(`desk: ${text}`),
      rescanned: () => syncPolls(),
      started(id, e) {
        try {
          mkdirSync(runningDir, { recursive: true })
          writeFileSync(marker(id), JSON.stringify({ at: e.at, request: e.request }))
        } catch (error) {
          if (!markFailed) log(`desk: the run marker was not written (${error.message}) — a kill would lose the run in progress`)
          markFailed = true
        }
        started(id, e.request)
        trails.set(id, { times: [e.at], step: -1, steps: [], guidance: [], notes: [] })
      },
      // every step before this one is in the run's record now: the marker a kill would leave holds them (2026-10-23)
      think: (id, a) => markRunning(id, a),
      step(id, e, a) {
        // Step n is the run's steps[n - 1] (every reply but the answer that ends the run is one step there).
        if (trails.has(id)) trails.get(id).step = e.n - 1
        const ts = trailStep(id)
        if (e.images?.length && e.calls?.length && ts) ts.images = e.images
        // the step in flight, as the thread draws it (2026-10-23 audit: a kill mid-step lost the step it showed)
        if (e.calls?.length && ts) Object.assign(ts, { thought: e.thought, calls: e.calls, n: e.n, ms: e.ms, results: {} })
        if (e.calls?.length) markRunning(id, a)
      },
      result(id, e, a, row) {
        const ts = trailStep(id)
        ts?.arrived.push(e.index)
        // how it drew live, kept for the record: a helper gone or a tool lent for one phase restores the same (2026-10-23)
        if (ts) (ts.looks ??= {})[e.index] = { kind: row.kind, view: row.view }
        if (ts?.results) ts.results[e.index] = { tool: e.tool, ok: e.ok, output: String(e.output ?? "").slice(0, 1500), ...(e.ms != null ? { ms: e.ms } : {}) }
        markRunning(id, a) // the marker holds the results in so far
      },
      gate(id, gate) {
        const step = trailStep(id)
        if (step) step.gate = gate
      },
      guide(id, e) {
        const trail = trails.get(id)
        trail?.guidance.push({ pos: trail.times.length - 1, from: e.from, text: e.text }) // the run's rows before it, after its request
      },
      answer: (id, e, a) => ended(id, () => history.record(a, e, null, trails.get(id))),
      // its steps and trail too: a failed run restores as it showed
      error: (id, e, a, request) => ended(id, () => history.record(a, e, request, trails.get(id))),
    },
  })
  const { states, update, msg, at, kernel } = core
  for (const a of team.list) states[a.name] = freshState()
  const deskTeam = lead.board?.team ?? null
  // a run's end: its marker gone, its stats saved, its run (with the trail) in history.md
  const ended = (id, record) => {
    rmSync(marker(id), { force: true })
    saveStats()
    record()
    trails.delete(id)
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
    const held = core.artifacts.get(id)
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
      for (const [id, { artifact: x }] of core.artifacts) {
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
  // The run in progress per agent, beside the kernel's steps (its answer event carries them): what its thread showed
  // that the steps do not hold — each step's results in the order they arrived, its refused-answer row, the owner's
  // guidance and where it fell, each row's time (the Live feed merges agents by time). Recorded with the run
  // (kernel-history.js), so a restored thread reads as it streamed.
  const trails = new Map() // agent name -> {times: [ms, request first], step, steps: [{arrived: [call index], gate}], guidance: [{pos, from, text}], notes: [{pos, row}]}
  const trailStep = (id) => {
    const t = trails.get(id)
    return t && t.step >= 0 ? (t.steps[t.step] ??= { arrived: [], gate: null }) : null
  }

  // A row the kernel's run record does not hold (a compaction, a desk event, a refresh that failed): kept on the run's
  // trail where it fell, so history.md keeps it and a restored thread shows it where it was (2026-10-23).
  // What waits on a debounce, written now (2026-10-23 audit: a stop lost the last second of log lines and artifact saves).
  function flushSaves() {
    for (const { artifact: x } of core.artifacts.values()) x.flush?.() // an artifact's own debounce first (a workflow's touch)
    for (const [id, t] of timers) {
      clearTimeout(t)
      timers.delete(id)
      const x = core.artifacts.get(id)?.artifact
      if (x) write(id, x)
    }
    if (logSave) {
      clearTimeout(logSave)
      logSave = null
      writeLog()
    }
  }
  let markFailed = false
  let statsFailed = false
  function saveStats() {
    try {
      // kept current in memory too: a kept helper respawned by an update restores the stats it had now, not at start
      savedStats = { ...savedStats, ...Object.fromEntries(Object.entries(states).filter(([, st]) => st?.stats).map(([n, st]) => [n, st.stats])) }
      writeFileSync(statsFile, JSON.stringify(savedStats))
    } catch (error) {
      if (!statsFailed) log(`desk: model-call stats not saved (${error.message})`)
      statsFailed = true
    }
  }
  function note(id, row, patch = {}) {
    const trail = trails.get(id)
    if (trail) trail.notes.push({ pos: trail.times.length - 1, row })
    else history.recordNote(team.agents().get(id), row) // no run: its own note in history.md (2026-10-23 audit)
    update(id, patch, [msg(row)])
  }

  // history.md beside each agent's .md: the newest runs come back as its EARLIER RUNS and as its thread's
  // first rows — every step as it streamed: its calls (tool, view, inputs, ok, the clipped output) in the order their
  // results arrived, refused answers, the owner's guidance where it fell. 2026-10-17: a restored run was only its
  // request and answer, so research-lead's thread and the Live feed lost every call when its desk reloaded.
  const history = createHistory({ enabled: live !== false, log })
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
    // a note outside any run: its rows alone
    if (r.note) return (r.notes ?? []).filter((n) => n?.row).map((n) => ({ ...n.row, at: n.row.at ?? r.at }))
    const request = rows.request({ from: r.from, text: r.request, ...(r.original ? { original: r.original, rewrite: r.rewrite } : {}) }, r.at)
    // a failed or stopped run ends on its error row, as live
    const answer = r.error ? { ...rows.answer(`Error: ${r.error}`, r.at), error: r.error } : rows.answer(r.answer, r.at, r.flags)
    try {
      const out = []
      for (const s of r.steps) {
        const calls = Array.isArray(s.calls) ? s.calls : []
        const results = s.results.slice(0, calls.length) // past the calls: the kernel's note on a refused answer
        if (results.length) {
          out.push(rows.step(s.thought, calls, r.at, s.images ?? null, s.ms, { n: s.n ?? null, answer: s.answer ?? null }))
          // results[k] answers calls[k] (the kernel keeps a step's results in call order); `order` is how they arrived.
          for (const k of s.order ?? results.keys()) if (!results[k]?.cut) out.push(rows.result(a, results[k], calls[k]?.input, k, null, r.at)) // row: withIds; cut: never answered
        }
        const gate = s.gate ?? noteGate(s.results[calls.length])
        if (gate) out.push(rows.gate(gate.kind, gate.content, r.at))
      }
      // guidance and the trail's notes (compactions, desk events, refreshes), each where it fell
      const fell = [...(r.guidance ?? []).map((g) => ({ pos: g.pos, row: rows.guidance(g.from, g.text, r.at) })), ...(r.notes ?? []).filter((n) => n?.row).map((n) => ({ pos: n.pos, row: { ...n.row, at: r.at } }))]
      for (const f of fell.sort((x, y) => x.pos - y.pos)) out.splice(f.pos, 0, f.row)
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
  let savedStats = {}
  try {
    if (existsSync(statsFile)) savedStats = JSON.parse(readFileSync(statsFile, "utf8"))
  } catch (error) {
    log(`desk: the model-call stats did not read (${error.message}) — they start again; the file kept as ${quarantine(statsFile)}`)
  }
  // One agent's state back at start — a desk agent now, a kept helper when it is respawned (2026-10-23 audit: helpers
  // missed this): a run the server was killed in (its marker left) recorded as interrupted with the steps it had taken
  // (the browser host does the same for a tab closed mid-run); its model-call stats; its runs as its thread and EARLIER
  // RUNS; an agent whose last run failed shows so.
  function restoreAgent(a) {
    if (existsSync(marker(a.name))) {
      try {
        const m = JSON.parse(readFileSync(marker(a.name), "utf8"))
        history.record(a, { at: m.at ?? Date.now(), error: "interrupted: the server stopped while this ran — send it again to go on", request: m.request, steps: m.steps ?? [] }, m.request, m.trail ?? null)
        log(`desk: ${a.name}'s run of ${new Date(m.at ?? Date.now()).toISOString()} was cut off when the server stopped — recorded as interrupted`)
        rmSync(marker(a.name), { force: true })
      } catch (error) {
        log(`desk: ${a.name} was running when the server stopped, but its run marker did not read (${error.message}) — kept as ${quarantine(marker(a.name))}`)
      }
    }
    if (savedStats[a.name] && states[a.name]) states[a.name].stats = savedStats[a.name]
    const runs = history.restore(a, undefined, { all: true })
    if (!runs.length) return
    const lastRun = runs.filter((r) => !r.note).at(-1)
    if (lastRun?.error && states[a.name]) Object.assign(states[a.name], { status: "error", error: lastRun.error })
    a.history = runs.filter((r) => r.answer != null && !r.error && !r.note).map((r) => ({ from: r.from, request: r.request, answer: r.answer }))
    states[a.name].messages = keepRuns(runs.map((r) => withIds(restoredRun(a, r))))
  }
  for (const a of team.list) restoreAgent(a)
  // The marker rewritten at each step boundary: the request, the steps so far (outputs clipped), the trail.
  function markRunning(id, a) {
    const trail = trails.get(id)
    if (!trail || !a) return
    try {
      const steps = a.runRecord.map((s) => ({ ...s, results: (s.results ?? []).map((r) => ({ ...r, output: String(r.output ?? "").slice(0, 1500) })) }))
      // the step whose calls are still out: its arrived results, the rest marked cut (never drawn, never restored)
      const live = trail.steps[trail.step]
      if (trail.step === steps.length && live?.calls) steps.push({ thought: live.thought, calls: live.calls, n: live.n, ms: live.ms, results: live.calls.map((c, k) => live.results?.[k] ?? { tool: c.tool, ok: false, output: "(cut off: the server stopped before it answered)", cut: true }) })
      writeFileSync(marker(id), JSON.stringify({ at: trail.times[0], request: core.starts.get(id), steps, trail }))
    } catch (error) {
      if (!markFailed) log(`desk: the run marker was not written (${error.message}) — a kill would lose the run in progress`)
      markFailed = true
    }
  }

  team.on((e) => {
    const a = team.agents().get(e.agent)
    const id = e.agent
    try {
      appendFileSync(eventsFile, JSON.stringify({ ...e, steps: undefined, request: e.request ? { from: e.request.from, text: cut(e.request.text).slice(0, 2000) } : undefined }) + "\n")
    } catch (error) {
      if (!journalFailed) log(`desk: the event journal (state/kernel-team.jsonl) did not take a line (${error.message})`)
      journalFailed = true
    }
    const deskEvent = { spawn: spawned, dismiss: dismissed, keep: keptNow, proposal }[e.event]
    if (deskEvent) deskEvent(e)
    else core.onEvent(e)
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
      if (keptFolders.has(x.name)) restoreAgent(x)
    }
    core.reshaped({ fresh, scan: true })
    core.deskSaid.spawn(e, a, fresh.filter((x) => x !== a).map((x) => x.name))
  }
  // 2026-10-20 (kernel builtin/spawn.js: a keep: desk or a kept helper's update from a run that read outside waits for the
  // owner). Kept by the owner's accept (kernel Desk.keep): its agent.md written under its spawner's folder now, members
  // inside, as a kept spawn's is. A proposal set or dropped (Desk.propose): its twin — the definition and the tree.
  function keptNow(e) {
    const a = team.agents().get(e.agent)
    if (!a) return
    for (const x of team.list.filter((x) => x === a || (e.team && x.config.spawned?.team === e.team))) recordSpawn(x, e)
    core.reshaped()
    core.deskSaid.keep(e, a, keptFolders.has(e.agent) ? " — its agent.md is written; it is back at every start" : "")
  }
  function proposal(e) {
    core.reshaped()
    core.deskSaid.proposal(e)
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
    core.pending.delete(e.agent)
    trails.delete(e.agent)
    core.starts.delete(e.agent)
    core.reshaped({ scan: true })
    // its stats go with it: a later helper of the same name starts with none (2026-10-23 audit)
    if (savedStats[e.agent] && e.reason !== "update") {
      delete savedStats[e.agent]
      saveStats()
    }
    core.deskSaid.dismiss(e)
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
  // The owner's words → a clear request before a run starts (2026-10-24 owner: "The first user input can always go through
  // sanitize … the input and the voice transcribe"): the host API hands its on-device sanitizer here (useSanitizer, from
  // companion/capabilities/sanitize.js; null: none on this machine or main.js sanitize: false). Only work the owner gives
  // (a `via`: typed, voice, telegram) — never a schedule, a wake, a quest. The run's request carries the owner's own words
  // beside the rewrite (kernel Agent.ask {original, rewrite}); its thread row shows both.
  let sanitizer = null
  const rewrite = async (text, via, signal) => {
    if (!sanitizer || !via) return { text }
    const r = await sanitizer.sanitize(text, { via, signal }).catch(() => null)
    return r?.changed ? { text: r.text, original: r.original, rewrite: { via, model: r.model, ms: r.ms } } : { text }
  }
  // given: a rewrite made already (the Telegram bridge's: {original, rewrite}) — passed on as it is.
  function run(agent, text, from = "owner", { via = null, given = null, suffix = "" } = {}) {
    const controller = new AbortController()
    if (!controllers.has(agent.name)) controllers.set(agent.name, new Set())
    controllers.get(agent.name).add(controller)
    const entry = { agent: agent.name, text: String(text), from, at: new Date().toISOString(), started: false }
    accepted.add(entry)
    saveAccepted()
    log(`desk: ${from} → ${agent.name}: ${String(text).slice(0, HOST_LIMITS.team.logPreviewChars)}`)
    // The desk's tools prime before a run (e.g. the broker's live tool listing, once the server listens).
    return Promise.resolve()
      .then(() => ready())
      .then(() => {
        // Stopped while it waited: it never starts (a line in the desk log, as its acceptance was).
        if (!controller.signal.aborted)
          return (given?.original ? Promise.resolve({ text: String(text), ...given }) : rewrite(String(text), via, controller.signal)).then((r) => {
            if (controller.signal.aborted) throw new Error("stopped")
            const request = `${r.text}${suffix}`
            if (request !== entry.text) (entry.text = request), saveAccepted() // started() finds it by the request it runs
            handed.add(controller)
            return agent.ask(request, { from, signal: controller.signal, ...(r.original ? { original: r.original, rewrite: r.rewrite } : {}) })
          })
        log(`desk: ${from} → ${agent.name} stopped before it started: ${String(text).slice(0, HOST_LIMITS.team.logPreviewChars)}`)
        throw new Error("stopped")
      })
      .finally(() => (accepted.delete(entry), saveAccepted(), controllers.get(agent.name)?.delete(controller)))
  }
  // The runs accepted and not started, on disk (state/accepted.json): a kill would drop them without a word (2026-10-23
  // audit — the schedule had taken its due run, the wake book marked its wake delivered); at the next start each is a row
  // in its agent's thread and a log line, to send again.
  function saveAccepted() {
    try {
      writeFileSync(acceptedFile, JSON.stringify([...accepted].filter((r) => !r.started).map((r) => ({ agent: r.agent, text: String(r.text).slice(0, 4000), from: r.from, at: r.at }))))
    } catch (error) {
      log(`desk: the queued runs were not saved (${error.message})`)
    }
  }
  // A run starts: the oldest accepted one of that agent with its request (a quest from a lead is not one of them).
  const started = (agent, request) => {
    const entry = [...accepted].find((r) => !r.started && r.agent === agent && r.text === request?.text && r.from === request?.from)
    if (entry) (entry.started = true), saveAccepted()
  }

  const viaOf = (o) => (["typed", "voice", "telegram"].includes(o?.via) ? o.via : null)

  // The desk's schedule: due runs go to the lead with their goal (checked every 30 s).
  const schedule = [...core.artifacts.values()].find((x) => x.artifact.kind === "schedule")?.artifact ?? null
  const scheduleTimer = schedule
    ? setInterval(() => {
        const due = schedule.takeDue(new Date())
        if (due) run(lead, due.goal, `schedule (booked by ${due.by})`).catch((error) => log(`desk: scheduled run failed: ${error.message}`))
      }, 30000)
    : null
  scheduleTimer?.unref?.()

  // The desk's standing goal (kernel builtin/goal.js; 2026-10-24 owner: "the desk will set a goal and will keep working
  // towards the goal"): while one is active and its keeper (else the lead) is idle with nothing queued, its due run starts
  // from "goal" with the goal, the last progress and the owner's feedback (checked every 30 s, as the schedule).
  const idle = (agent) => agent && agent.status !== "running" && ![...accepted].some((r) => r.agent === agent.name)
  const goalTimer = setInterval(() => {
    if (terminated) return
    for (const { artifact } of core.artifacts.values()) {
      if (artifact.kind !== "goal" || typeof artifact.takeDue !== "function") continue
      const keeperOf = (name) => team.agents().get(name ?? "") ?? lead
      const due = artifact.takeDue(new Date(), (name) => !idle(keeperOf(name)))
      if (!due) continue
      const keeper = keeperOf(due.keeper)
      // 2026-10-24 owner ("I want to create configurable workflows"): a goal with a workflow resumes through it — the
      // flow's file says how the desk works toward the goal (default desks/agent/phases/goal-cycle.md: plan → work → judge);
      // its last step's report is the progress when no step recorded one (Goal.flowEnded).
      const flow = due.workflow ? core.artifacts.get(due.workflow)?.artifact : null
      if (due.workflow && flow?.kind === "workflow" && typeof flow.run === "function" && !flow.active) {
        log(`desk: goal → the workflow ${due.workflow} (${keeper.name}): resumes the standing goal`)
        artifact.flowStarted(due.workflow)
        flow
          .run({ note: "the standing goal's resume" }, { agent: flow.holders?.[0] ?? keeper, owner: true, request: due.text, vars: due.vars, host: keeper.context?.host ?? null })
          .then(() => {
            const last = flow.state?.stages?.at(-1)?.id
            let report = null
            try {
              report = last ? (flow.stageDetail?.(last)?.report ?? null) : null
            } catch {}
            // the failed stage's own error (a model's usage limit is then told apart from a failure)
            const failed = flow.state?.stages?.find((s) => s.status === "failed")?.error
            artifact.flowEnded({ ok: flow.state?.status === "done", report, error: failed ? `${flow.state?.status}: ${failed}` : flow.state?.status })
          })
          .catch((error) => (artifact.flowEnded({ ok: false, error: error.message }), log(`desk: the goal's workflow failed: ${error.message}`)))
        continue
      }
      if (due.workflow) log(`desk: goal: the workflow ${due.workflow} ${flow ? "is busy or not a workflow" : "is not held on this desk"} — ${keeper.name} resumes it itself`)
      log(`desk: goal → ${keeper.name}: resumes the standing goal`)
      run(keeper, due.text, "goal").catch((error) => log(`desk: the goal's run failed: ${error.message}`))
    }
  }, goalTickMs)
  goalTimer.unref?.()

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
      // a model's usage limit: the retry waits until it resets (a retry inside the limit fails the same way)
      const limit = usageLimit(error.message)
      const retry = retryWake(wakeBook, { id, error: error.message, ...(limit ? { minutes: limitWait(limit) } : {}) })
      log(`wake: ${id} failed: ${error.message}${retry ? ` — retry ${retry.id} at ${retry.at}` : ""}`)
    })
    return ok({ agent: target.name })
  }
  const stopWakes = wakeBook && live !== false ? startWakes({ root: desk.workspace, deliver: deliverWake, log: (line) => log(`wake: ${line}`) }) : () => {}

  // Owner-level actions on the desk itself (the UI's next-run box; 2026-10-20 the owner's accept or drop of what waits on a
  // helper, kernel ownerHelperCall: [{helper, reason?}]; the footer's model selector: desk default model and per-agent override).
  async function deskCall(method, args) {
    if (method === "accept" || method === "drop") return ok(await ownerHelperCall(team, method, args[0] ?? {}))
    if (method === "model") {
      const raw = typeof args[0] === "string" ? args[0] : args[0]?.model
      const next = String(raw ?? "").trim()
      if (!next || !Object.hasOwn(catalogue, next)) return fail(`model: one of ${Object.keys(catalogue).join(", ")}`)
      team.defaultModel = next
      kernel.defaultModel = next
      if (live !== false) {
        try {
          writeFileSync(modelFile, JSON.stringify({ defaultModel: next }))
        } catch (error) {
          log(`desk: default model not saved (${error.message})`)
        }
      }
      broadcast({ type: "kernel", defaultModel: next })
      log(`desk: default model → ${next}`)
      return ok({ defaultModel: next })
    }
    if (method === "agentModel") {
      const { agent: name, model: raw } = args[0] ?? {}
      const target = name ? team.agents().get(String(name)) : lead
      if (!target) return fail(`No agent "${name}" in this desk.`)
      const next = raw == null || raw === "" || raw === "inherit" ? null : String(raw).trim()
      if (next && !Object.hasOwn(catalogue, next)) return fail(`model: one of ${Object.keys(catalogue).join(", ")}`)
      if (next) target.config.model = next
      else delete target.config.model
      if (target.config.spawned?.input) {
        if (next) target.config.spawned.input.model = next
        else delete target.config.spawned.input.model
        const kept = keptFolders.get(target.name)
        if (kept && live !== false) {
          try {
            writeKept(target, kept, team.agents())
          } catch (error) {
            log(`desk: ${target.name}'s agent.md not written (${error.message})`)
          }
        }
      } else if (target.config.folder && live !== false) {
        try {
          setAgentModel(target.config.folder, next)
        } catch (error) {
          log(`desk: ${target.name}'s model not written to its .md (${error.message})`)
        }
      }
      core.reshaped()
      log(`desk: ${target.name} model → ${next ?? `desk default (${kernel.defaultModel})`}`)
      return ok({ agent: target.name, model: next })
    }
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
    if (target === "artifact") return core.ownerArtifact(method, args, run)
    const agent = target ? team.agents().get(target) : lead // no target: the lead (scripts/send.js --wait)
    if (!agent) return fail(`No agent "${target}" in this desk.`)
    try {
      switch (method) {
        case "ask": // args: [text, { from, via }?] — resolves with the answer (via: the owner's words, rewritten first)
          return ok(await run(agent, args[0], args[1]?.from ?? "owner", { via: viaOf(args[1]) }))
        case "send": // args: [text, { via, suffix }?] — suffix: appended after the rewrite (the voice page's read-aloud note)
          run(agent, args[0], "owner", { via: viaOf(args[1]), suffix: typeof args[1]?.suffix === "string" ? args[1].suffix.slice(0, 400) : "" }).catch(() => {})
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
          // a spoken question is corrected, never expanded (sanitize via guidance)
          const said = (await rewrite(String(args[0] ?? "").trim(), args[1]?.via === "voice" ? "guidance" : null)).text
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
          const value = core.chatValue(out)
          if (value.proposed) log(`desk: ${agent.name} proposes to ${from} (not started): ${value.proposed.split("\n")[0].slice(0, HOST_LIMITS.team.logPreviewChars)}`)
          return ok(value)
        }
        case "guide": {
          // args: [text, { from }?] — a note for the run in progress, seen at the agent's next step (kernel
          // Agent.guide). Idle, there is no run to guide: {delivered: false}, and the caller sends it as new work.
          const from = args[1]?.from ?? "owner"
          // a spoken note is corrected only (sanitize via guidance): it keeps its size
          const note = args[1]?.via === "voice" ? (await rewrite(String(args[0] ?? ""), "guidance")).text : args[0]
          const delivered = agent.guide(note, from)
          if (delivered) log(`desk: ${from} guides ${agent.name}: ${String(args[0]).trim().slice(0, HOST_LIMITS.team.logPreviewChars)}`)
          return ok({ delivered })
        }
        case "preview":
          await agent.refreshArtifacts?.() // the prompt its next step would see, with its artifacts read fresh
          return ok(agent.render({ text: String(args[0] ?? ""), from: "owner" }, []))
        case "older": // args: [end, start?] — the thread rows before index end, which the snapshot left out or cut (snapshot-thread-tail, snapshot-steps-lean)
          return ok(core.older(agent.name, args[0], args[1]))
        case "artifact": // args: [id] — the full view of an artifact the snapshot sent compact (snapshot-artifact-views)
          return ok(core.artifact(String(args[0] ?? "")))
        case "clearMemory":
          // 2026-10-23 audit 19: never under a run (it set the agent idle while the run went on): stop it first
          if (agent.busy) return fail(`${agent.name} is working: stop it first, then clear its memory`)
          core.clearMemory(agent)
          return ok(null)
        default:
          return ok(null) // summarizeMemory, resolveApproval, reconfigure: nothing to do here
      }
    } catch (error) {
      return fail(error.message)
    }
  }

  // via: the owner's words, rewritten first; original + rewrite: rewritten by the caller already (the Telegram bridge)
  function send({ agent = null, text, from = null, via = null, original = null, rewrite: made = null } = {}) {
    if (typeof text !== "string" || !text.trim()) return fail("text: what the agent should do.")
    const target = agent ? team.agents().get(agent) : lead
    if (!target) return fail(`No agent "${agent}" in this desk.`)
    run(target, text.trim(), from ?? "owner", { via: viaOf({ via }), given: typeof original === "string" && original.trim() ? { original, rewrite: made } : null }).catch(() => {})
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
        sendEvent(core.snapshot())
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
    // a stop (launchd's SIGTERM, Ctrl-C) exits through "exit", so every desk writes what waits on a debounce
    if (!globalThis.__askkStopHook) {
      globalThis.__askkStopHook = true
      for (const sig of ["SIGTERM", "SIGINT"]) process.once(sig, () => process.exit(sig === "SIGINT" ? 130 : 143))
    }
    process.on("exit", () => flushSaves())
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
      const records = readKept(team.list.filter((a) => a.config.folder).map((a) => ({ name: a.name, folder: a.config.folder })), log)
      if (records.length) {
        const back = await respawn(team, records, { log: (line) => log(`desk: ${line}`) })
        if (back.length) log(`desk: kept helpers back: ${back.join(", ")}`)
      }
    } catch (error) {
      log(`desk: kept helpers not respawned (${error.message}): the desk starts without them; their folders stay`)
    }
  }

  // 2026-10-23 audit, after the kept helpers are back:
  // a run marker left by a helper that is not back (keep: run, gone with the process) — recorded as interrupted in its
  // own spawned/<name>/history.md, so its record says how it ended; and a proposal the thread shows waiting, whose
  // agent's proposal did not survive (nothing proposed is saved) — said in that thread and the log.
  try {
    for (const f of existsSync(runningDir) ? readdirSync(runningDir) : []) {
      const name = decodeURIComponent(f.replace(/\.json$/, ""))
      if (team.agents().get(name)) continue
      try {
        const m = JSON.parse(readFileSync(join(runningDir, f), "utf8"))
        if (SPAWN_NAME.test(name)) history.record({ name, config: { folder: join(spawnedDir, name) } }, { at: m.at ?? Date.now(), error: "interrupted: the server stopped while this ran (the helper did not come back)", request: m.request, steps: m.steps ?? [] }, m.request, m.trail ?? null)
        log(`desk: ${name}'s run was cut off when the server stopped; ${name} is not back — recorded in its history.md`)
        rmSync(join(runningDir, f), { force: true })
      } catch (error) {
        log(`desk: ${name} was running when the server stopped, but its run marker did not read (${error.message}) — kept as ${quarantine(join(runningDir, f))}`)
      }
    }
  } catch (error) {
    log(`desk: the run markers left by a stop could not be swept (${error.message})`)
  }
  core.droppedProposals("the server restarted")

  if (leftQueuedError) log(`desk: the runs queued before the stop did not read (${leftQueuedError}) — look there for what never ran`)
  if (!Array.isArray(leftQueued)) {
    log(`desk: the queued runs before the stop were not a list — left out`)
    leftQueued = []
  }
  try {
    for (const r of leftQueued) {
      const text = `Accepted before the server stopped, never started (from ${r.from}): ${String(r.text).split("\n")[0].slice(0, 300)} — send it again to run it`
      if (states[r.agent]) note(r.agent, rows.lifecycle("queued", text, at(), { agent: r.agent }))
      log(`desk: ${r.agent}: ${text}`)
    }
  } catch (error) {
    log(`desk: the runs queued before the stop could not be said (${error.message})`)
  }

  log(`desk: ${team.list.length} agents ready (lead ${lead.name})`)
  // onLeadAnswer(fn): fn({request, answer, flags, artifacts, deskTeam, at}) after each lead run; returns an unsubscribe.
  const onLeadAnswer = (fn) => (leadAnswers.add(fn), () => leadAnswers.delete(fn))
  // 2026-10-26: what a tab downloads and parses when it opens the stream — the snapshot's bytes, by part, and its
  // largest agent states and artifacts (the dev desk's speed measure, through projects/health)
  function snapshotSize() {
    const snap = core.snapshot()
    const len = (v) => JSON.stringify(v ?? null).length
    const top = (o, n = 4) => Object.entries(o ?? {}).map(([id, v]) => ({ id, bytes: len(v) })).sort((a, b) => b.bytes - a.bytes).slice(0, n)
    return { bytes: len(snap), parts: { registry: len(snap.registry), states: len(snap.states), kernel: len(snap.kernel), log: len(snap.log) }, states: top(snap.states), artifacts: top(snap.kernel?.artifacts) }
  }

  return {
    storageDir,
    stream,
    snapshotSize,
    call,
    // the view of an artifact held on this desk (null: none): the agent's-view gate's Ask 'what' (server/desks.js viewMayCall)
    viewOf: (id) => core.artifacts.get(id)?.artifact?.view ?? null,
    send,
    announce,
    work,
    onLeadAnswer,
    log, // host code beside the desk (the Telegram bridge) writes to the same trail
    // the host API's on-device sanitizer (null: none); the Telegram bridge rewrites the owner's own words with it
    useSanitizer: (s) => void (sanitizer = s ?? null),
    sanitize: (text, via) => rewrite(String(text ?? ""), via),
    get agents() {
      return team.list.map((a) => a.name) // now: spawned agents count while they are here
    },
    terminate: () => (flushSaves(), clearInterval(scheduleTimer), clearInterval(goalTimer), stopWakes(), stopBackground?.(), controllers.forEach((set) => set.forEach((c) => c.abort())), (terminated = true), syncPolls()),
    // Every open stream ends: EventSource reconnects on its own, to the desk hosted then (companion/server/desks.js,
    // after a reload), and its snapshot replaces what the tab showed.
    endStreams: () => [...closers].forEach((close) => close()),
  }
}
