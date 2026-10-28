// A desk run in this tab, served to the live UI the way the desk server serves its team (2026-10-20: the hosted
// version — no desk server — runs a single long-running agent in the browser). The protocol is backend/live/team-core.js,
// shared with companion/team/kernel-team.js; this host adds where it keeps things.
//
// What it keeps in the browser store (backend/browser/storage.js), so the agent picks up where it left off: each
// agent's finished runs (runs:<agent>, ≤ 20 — its EARLIER RUNS) and thread (thread:<agent>, ≤ 200 rows), every artifact
// by its keep (artifact:<id>: "always"; "day" the same day only; "run" and "file" never — practice keeps its own file),
// and the kept helpers (kept: [{by, at, input}], spawned again at the next start, kernel respawn).
//
//   createBrowserTeam({desk, store, title?, log?}) → Promise<{subscribe(onEvent) → off, call(body) → result, send(body),
//                                                   work(), terminate()}>

import { ownerHelperCall, respawn } from "../kernel/index.js"
import { createChannel, createTeamCore, fail, ok } from "../live/team-core.js"
import { cut, freshState, nextStats, rows } from "../live/team-rows.js"

const MAX_MESSAGES = 200
const MAX_RUNS = 20
const LOG_KEEP = 200
const dayOf = (d = new Date()) => new Intl.DateTimeFormat("en-CA").format(d)
const stored = (keep) => !["run", "file"].includes(keep ?? "day")
const debounce = (timers, id, ms, fn) => (clearTimeout(timers.get(id)), timers.set(id, setTimeout(fn, ms)))

export async function createBrowserTeam({ desk: team, store, title = "This browser", log: hostLog = () => {} }) {
  // the desk log kept in the store, as the desk server keeps state/desk-log.json (2026-10-23 audit)
  const saved = store.get("log", [])
  let logRefused = false
  const saveLog = (logs) => !store.set("log", logs) && !logRefused && ((logRefused = true), console.warn("desk log not saved: this browser's storage is full or blocked"))
  const channel = createChannel({ logKeep: LOG_KEEP, logs: Array.isArray(saved) ? saved.slice(-LOG_KEEP) : [], hostLog, saveLog })
  const { log } = channel
  // A store write this browser refused (full, or site data blocked): said once per key, never silent (2026-10-23 audit)
  const refused = new Set()
  const keep = (key, value) => {
    const done = store.set(key, value)
    if (!done && !refused.has(key)) (refused.add(key), log(`desk: ${key} not saved (this browser's storage is full or blocked) — it is lost when the tab closes`))
    if (done) refused.delete(key)
    return done
  }
  const lead = team.lead
  const threadTimers = new Map()
  const saveThread = (id) => keep(`thread:${id}`, (core.states[id]?.messages ?? []).slice(-MAX_MESSAGES))
  const artifactTimers = new Map()
  const saveArtifact = (id, x) => keep(`artifact:${id}`, { day: dayOf(), state: x.snapshot?.() ?? x.state }) // a refusal said once per key (audit 18)

  const core = createTeamCore({
    team,
    channel,
    title,
    maxMessages: MAX_MESSAGES,
    idOf: (n) => `b${Date.now().toString(36)}${n}`,
    definition: (twin) => ({ ...twin, folder: null, browser: true }),
    stats: (id, a, e) => {
      const next = nextStats(core.states[id]?.stats, a, e)
      keep(`stats:${id}`, next)
      return next
    },
    persist: {
      restore(id, x) {
        if (!stored(x.keep)) return
        const saved = store.get(`artifact:${id}`, null)
        if (!saved || ((x.keep ?? "day") === "day" && saved.day !== dayOf())) return
        try {
          x.restore(saved.state)
        } catch (error) {
          log(`desk: ${id} not restored (${error.message})`)
        }
      },
      save: (id, x) => stored(x.keep) && debounce(artifactTimers, id, 300, () => saveArtifact(id, x)),
      rows: (id) => debounce(threadTimers, id, 400, () => saveThread(id)),
    },
    hooks: {
      started(id, e) {
        const i = queued.findIndex((q) => q.agent === id && q.text === e.request?.text)
        if (i >= 0) (queued.splice(i, 1), saveQueued())
      },
      answer(id, e, a, request) {
        const runs = [...store.get(`runs:${id}`, []), { at: core.at(e.at), from: request?.from ?? "owner", request: cut(request?.text ?? "").slice(0, 4000), answer: cut(e.answer).slice(0, 6000) }].slice(-MAX_RUNS)
        keep(`runs:${id}`, runs)
      },
    },
  })
  const { states, msg, at } = core

  // ---- states and threads ---------------------------------------------------------------------------------------------
  const restoreAgent = (a) => {
    const s = freshState()
    const thread = store.get(`thread:${a.name}`, [])
    if (Array.isArray(thread)) s.messages = thread.slice(-MAX_MESSAGES)
    // A run the tab closed on (its request after the last answer): said so, so the thread does not hang on it.
    const lastRun = s.messages.findLastIndex((m) => m.role === "user" && m.kind !== "chat" && m.kind !== "guidance")
    const lastEnd = s.messages.findLastIndex((m) => m.role === "assistant" && m.action === "answer")
    if (lastRun > lastEnd) s.messages = [...s.messages, msg({ ...rows.answer("Interrupted: this tab closed while the run was in progress. Send it again to go on — the steps above are kept.", at()), error: "interrupted" })]
    const runs = store.get(`runs:${a.name}`, [])
    if (Array.isArray(runs) && runs.length) a.history = runs.map((r) => ({ from: r.from, request: r.request, answer: r.answer }))
    // its model-call stats, and an error status when its last run ended on one (2026-10-23 audit, as the desk server)
    const stats = store.get(`stats:${a.name}`, null)
    if (stats) s.stats = stats
    const last = s.messages.findLast((m) => m.role === "assistant" && m.action === "answer")
    if (last?.error) Object.assign(s, { status: "error", error: last.error })
    states[a.name] = s
  }
  for (const a of team.list) restoreAgent(a)
  // 2026-10-23 audit, as the desk server says them at start: runs handed over and never started before the tab closed,
  // and a proposal a thread shows waiting that did not survive (nothing proposed is saved)
  const leftQueued = store.get("queued", [])
  store.set("queued", [])
  for (const r of Array.isArray(leftQueued) ? leftQueued : []) if (states[r.agent]) core.note(r.agent, rows.lifecycle("queued", `Handed over before this tab closed, never started (from ${r.from}): ${String(r.text).split("\n")[0].slice(0, 300)} — send it again to run it`, at(), { agent: r.agent }))
  core.droppedProposals("this tab closed")

  // ---- kept helpers and the desk's shape ------------------------------------------------------------------------------
  const keptRecords = () => {
    const r = store.get("kept", [])
    return Array.isArray(r) ? r : []
  }
  const keepRecord = (a, s = a.config.spawned) => keep("kept", [...keptRecords().filter((r) => r.input?.name !== a.name), { by: s.by, at: s.at, input: s.input }])
  const forgetRecord = (name) => keep("kept", keptRecords().filter((r) => r.input?.name !== name))
  const desk = {
    spawn(e, a) {
      const fresh = team.list.filter((x) => !states[x.name])
      if (!a || !fresh.includes(a)) return // a member, set up at its lead's event
      for (const x of fresh) restoreAgent(x)
      const s = a.config.spawned
      if (s?.keep === "desk" && s.input) keepRecord(a)
      else if (s?.input) forgetRecord(a.name) // updated to keep: run
      core.reshaped({ fresh, scan: true })
      core.deskSaid.spawn(e, a, fresh.filter((x) => x !== a).map((x) => x.name))
    },
    // 2026-10-20 (kernel builtin/spawn.js): kept by the owner's accept (Desk.keep) — its record saved, as a kept spawn's
    keep(e, a) {
      if (a?.config.spawned?.keep === "desk" && a.config.spawned.input) keepRecord(a)
      core.reshaped()
      core.deskSaid.keep(e, a)
    },
    proposal(e) {
      core.reshaped()
      core.deskSaid.proposal(e)
    },
    dismiss(e) {
      const id = e.agent
      delete states[id]
      core.pending.delete(id)
      if (e.reason !== "update" && (!e.team || e.team === id)) forgetRecord(id)
      // Gone for good: its thread and runs too, so a later helper of the same name starts clean (an update keeps them).
      if (e.reason !== "update") for (const key of [`thread:${id}`, `runs:${id}`, `stats:${id}`]) store.remove(key)
      core.reshaped({ scan: true })
      core.deskSaid.dismiss(e)
    },
  }
  team.on((e) => (desk[e.event] ? desk[e.event](e, team.agents().get(e.agent)) : core.onEvent(e)))

  // Kept helpers from the last visit, spawned again by their spawners.
  const kept = keptRecords()
  if (kept.length) {
    const back = await respawn(team, kept, { log: (line) => log(`desk: ${line}`) })
    if (back.length) log(`desk: kept helpers back: ${back.join(", ")}`)
  }
  // 2026-10-23 audit, what the tab's storage says at start: no storage at all (a private window: nothing outlives the tab),
  // values that no longer read, and a run helper (keep run) that did not come back — its thread, runs and stats cleared so
  // a later helper of that name starts clean, as the desk server does
  if (String(store.where ?? "").startsWith("memory")) log("desk: this browser keeps nothing (no storage here): threads, runs and helpers go when the tab closes")
  for (const key of store.unreadable?.() ?? []) log(`desk: ${key} did not read from this browser's storage — it starts empty`)
  for (const key of store.keys?.("thread:") ?? []) {
    const name = key.slice("thread:".length)
    if (team.agents().get(name)) continue
    for (const k of [`thread:${name}`, `runs:${name}`, `stats:${name}`]) store.remove(k)
    log(`desk: ${name} (a helper of a run) did not come back when the tab opened again — its thread is cleared`)
  }

  // ---- calls ----------------------------------------------------------------------------------------------------------
  const running = new Map() // agent name → AbortControllers of its runs
  // What waits on a debounce, written now (2026-10-23 audit): at terminate, and when the tab is hidden or closed
  // (start.js: pagehide) — the newest rows and artifact states.
  function flush() {
    for (const { artifact: x } of core.artifacts.values()) x.flush?.()
    for (const t of [...artifactTimers.values(), ...threadTimers.values()]) clearTimeout(t)
    for (const id of threadTimers.keys()) saveThread(id)
    threadTimers.clear()
    for (const id of artifactTimers.keys()) {
      const x = core.artifacts.get(id)?.artifact
      if (x && stored(x.keep)) saveArtifact(id, x)
    }
    artifactTimers.clear()
  }
  // Runs handed over and not started (queued behind a run), kept in the store: a tab closed on them says so at the next
  // start, as the desk server does (2026-10-23 audit).
  const queued = []
  const saveQueued = () => keep("queued", queued.map(({ agent, text, from, at }) => ({ agent, text: String(text).slice(0, 4000), from, at })))
  function run(agent, text, from = "owner") {
    const entry = { agent: agent.name, text: String(text), from, at: new Date().toISOString() }
    queued.push(entry)
    saveQueued()
    const controller = new AbortController()
    if (!running.has(agent.name)) running.set(agent.name, new Set())
    running.get(agent.name).add(controller)
    log(`desk: ${from} → ${agent.name}: ${String(text).split("\n")[0].slice(0, 160)}`)
    return agent.ask(String(text), { from, signal: controller.signal }).finally(() => {
      running.get(agent.name)?.delete(controller)
      const i = queued.indexOf(entry)
      if (i >= 0) (queued.splice(i, 1), saveQueued())
    })
  }

  async function call({ target, method, args = [] } = {}) {
    if (target === "registry") return ok(null)
    if (target === "desk") {
      // the owner on what waits on a helper (kernel ownerHelperCall, 2026-10-20); no schedule in a tab
      if (method !== "accept" && method !== "drop") return fail("this desk runs in the browser: no schedule here (the desk server has one)")
      try {
        return ok(await ownerHelperCall(team, method, args[0] ?? {}))
      } catch (error) {
        return fail(error.message)
      }
    }
    if (target === "artifact") return core.ownerArtifact(method, args, run)
    const agent = target ? team.agents().get(target) : lead
    if (!agent) return fail(`No agent "${target}" in this desk.`)
    const from = args[1]?.from ?? "owner"
    try {
      switch (method) {
        case "ask":
          return ok(await run(agent, args[0], from))
        case "send":
          run(agent, args[0], from).catch(() => {})
          return ok(null)
        case "stop": {
          const own = agent.stop?.() ?? 0
          for (const c of running.get(agent.name) ?? []) c.abort()
          log(`desk: owner stops ${agent.name}: ${own ? `${own} stopped` : "nothing was running"}`)
          return ok({ stopped: own })
        }
        case "chat": {
          const said = String(args[0] ?? "").trim()
          if (!said) return fail("a chat needs text: what to ask the agent.")
          log(`desk: ${from} asks ${agent.name}: ${said.split("\n")[0].slice(0, 160)}`)
          try {
            return ok(core.chatValue(await agent.chat(said, { from })))
          } catch (error) {
            log(`desk: ${agent.name} did not answer ${from}'s chat (${String(error.message).slice(0, 160)})`)
            throw error
          }
        }
        case "guide": {
          const delivered = agent.guide(args[0], from)
          log(`desk: ${from} guides ${agent.name}${delivered ? "" : " (nothing running: not delivered)"}: ${String(args[0] ?? "").split("\n")[0].slice(0, 160)}`)
          return ok({ delivered })
        }
        case "preview":
          await agent.refreshArtifacts?.()
          return ok(agent.render({ text: String(args[0] ?? ""), from: "owner" }, []))
        case "older":
          return ok(core.older(agent.name, args[0], args[1]))
        case "artifact":
          return ok(core.artifact(String(args[0] ?? "")))
        case "clearMemory":
          if (agent.busy) return fail(`${agent.name} is working: stop it first, then clear its memory`)
          store.remove(`runs:${agent.name}`)
          store.remove(`thread:${agent.name}`)
          core.clearMemory(agent)
          return ok(null)
        default:
          return ok(null)
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

  const work = () => team.list.flatMap((a) => (states[a.name]?.status === "running" ? [{ agent: a.name, lead: a === lead, since: states[a.name].working?.at ?? null }] : []))

  log(`desk: ${team.list.length} agent${team.list.length === 1 ? "" : "s"} ready in this browser (lead ${lead.name})`)
  return {
    // A subscriber gets the snapshot first, then every event (backend/live/stream.js connectTeam).
    subscribe(onEvent) {
      onEvent(core.snapshot())
      core.clients.add(onEvent)
      return () => core.clients.delete(onEvent)
    },
    call,
    send,
    work,
    log,
    team,
    flush,
    terminate() {
      for (const set of running.values()) for (const c of set) c.abort()
      flush()
      core.clients.clear()
    },
  }
}
