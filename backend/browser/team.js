// A desk run in this tab, served to the live UI the way the desk server serves its team (2026-10-20: the hosted
// version — no desk server — runs a single long-running agent in the browser). The same protocol as
// companion/team/kernel-team.js (backend/live/stream.js reads it): a snapshot {registry, states, kernel, log}, then
// state {id, patch}, kernel {artifact | tree}, registry (an agent spawned or dismissed) and log events; calls
// {target, method, args} → {ok, value | error}. The thread rows come from the same builders (backend/live/team-rows.js).
//
// What it keeps in the browser store (backend/browser/storage.js), so the agent picks up where it left off: each
// agent's finished runs (runs:<agent>, ≤ 20 — its EARLIER RUNS) and thread (thread:<agent>, ≤ 200 rows), every artifact
// by its keep (artifact:<id>: "always"; "day" the same day only; "run" and "file" never — practice keeps its own file),
// and the kept helpers (kept: [{by, at, input}], spawned again at the next start, kernel respawn).
//
//   createBrowserTeam({desk, store, title?, log?}) → Promise<{subscribe(onEvent) → off, call(body) → result, send(body),
//                                                   work(), terminate()}>

import { ownerHelperCall, respawn } from "../kernel/index.js"
import { activityOf, cut, freshState, IDLE, nextStats, rows } from "../live/team-rows.js"

const MAX_MESSAGES = 200
const MAX_RUNS = 20
const LOG_KEEP = 200
const dayOf = (d = new Date()) => new Intl.DateTimeFormat("en-CA").format(d)

export async function createBrowserTeam({ desk: team, store, title = "This browser", log: hostLog = () => {} }) {
  const listeners = new Set()
  let listenerErrors = 0
  const broadcast = (event) => {
    for (const fn of listeners) {
      try {
        fn(event)
      } catch (error) {
        // a view that throws is counted and said (1st, 10th, 100th …) — as the kernel's listener guard (2026-10-23)
        listenerErrors++
        if (Number.isInteger(Math.log10(listenerErrors))) console.warn(`desk: a view threw on a ${event?.type} event (${listenerErrors} so far): ${error?.message ?? error}`)
      }
    }
  }
  // the desk log kept in the store, as the desk server keeps state/desk-log.json (2026-10-23 audit)
  const saved = store.get("log", [])
  const logs = Array.isArray(saved) ? saved.slice(-LOG_KEEP) : []
  let logRefused = false
  const log = (line) => {
    const text = String(line)
    hostLog(text)
    const row = { at: new Date().toISOString(), source: text.match(/^([\w.-]+):\s/)?.[1] ?? "desk", text }
    logs.push(row)
    if (logs.length > LOG_KEEP) logs.shift()
    if (!store.set("log", logs) && !logRefused) (logRefused = true), console.warn("desk log not saved: this browser's storage is full or blocked")
    broadcast({ type: "log", ...row })
  }
  // A store write this browser refused (full, or site data blocked): said once per key, never silent (2026-10-23 audit)
  const refused = new Set()
  const keep = (key, value) => {
    const done = store.set(key, value)
    if (!done && !refused.has(key)) (refused.add(key), log(`desk: ${key} not saved (this browser's storage is full or blocked) — it is lost when the tab closes`))
    if (done) refused.delete(key)
    return done
  }
  const lead = team.lead

  // ---- registry ---------------------------------------------------------------------------------
  const definition = (a) => {
    const { element, id, tools, folder, status, ...twin } = a.twin()
    return { ...twin, folder: null, tools: tools.map(({ element, id, ...spec }) => spec), kernel: true, browser: true }
  }
  const registry = { agents: [], edited: [], status: "ready", error: null, requiredId: lead.name, engines: [] }
  const describeAll = () => {
    registry.engines = team.list.map((a) => ({ id: a.name, name: a.name, agent: definition(a) }))
    registry.agents = registry.engines.map((e) => e.agent)
  }
  describeAll()

  // ---- states and threads -----------------------------------------------------------------------
  let seq = 0
  const msg = (row) => ({ id: `b${Date.now().toString(36)}${++seq}`, ...row })
  const at = (ms) => new Date(ms ?? Date.now()).toISOString()
  const states = {}
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
  const restartNote = (id, kind, content, agent) => {
    if (!states[id]) return
    states[id].messages = [...states[id].messages, msg(rows.lifecycle(kind, content, at(), { agent }))]
  }
  for (const r of Array.isArray(leftQueued) ? leftQueued : []) restartNote(r.agent, "queued", `Handed over before this tab closed, never started (from ${r.from}): ${String(r.text).split("\n")[0].slice(0, 300)} — send it again to run it`, r.agent)
  for (const [id, st] of Object.entries(states)) {
    const thread = st.messages
    for (const [i, m] of thread.entries()) {
      if (m.action !== "lifecycle" || m.kind !== "proposal" || !String(m.content).startsWith("Proposed") || !m.agent) continue
      if (thread.slice(i + 1).some((x) => x.action === "lifecycle" && x.agent === m.agent)) continue
      if (team.agents().get(m.agent)?.config.spawned?.proposed) continue
      restartNote(id, "proposal", `The proposal for ${m.agent} was dropped when this tab closed (proposals are not saved) — propose it again to keep it`, m.agent)
    }
  }
  const keepStats = (id, stats) => (keep(`stats:${id}`, stats), stats)
  const saveTimers = new Map()
  const saveThread = (id) => {
    clearTimeout(saveTimers.get(id))
    saveTimers.set(
      id,
      setTimeout(() => keep(`thread:${id}`, (states[id]?.messages ?? []).slice(-MAX_MESSAGES)), 400),
    )
  }
  function update(id, patch, newMessages = []) {
    const s = (states[id] ??= freshState())
    const from = s.messages.length
    let messages = s.messages
    if (newMessages.length) {
      messages = [...messages, ...newMessages]
      if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES)
      saveThread(id)
    }
    const next = { ...s, ...patch, messages, revision: s.revision + 1 }
    states[id] = next
    const out = { ...patch, revision: next.revision }
    if (newMessages.length) out.messages = messages.length < from + newMessages.length ? { from: 0, items: messages } : { from, items: newMessages }
    broadcast({ type: "state", id, patch: out })
  }

  // ---- artifacts --------------------------------------------------------------------------------
  let artifacts = team.artifacts()
  const view = (id) => {
    const { artifact: x, holders } = artifacts.get(id)
    return { ...x.twin(), holders }
  }
  const keepOf = (x) => x.keep ?? "day"
  const restored = new WeakSet()
  const restore = (id, x) => {
    restored.add(x)
    if (["run", "file"].includes(keepOf(x))) return
    const saved = store.get(`artifact:${id}`, null)
    if (!saved || (keepOf(x) === "day" && saved.day !== dayOf())) return
    try {
      x.restore(saved.state)
    } catch (error) {
      log(`desk: ${id} not restored (${error.message})`)
    }
  }
  const timers = new Map()
  const save = (id, x) => {
    if (["run", "file"].includes(keepOf(x))) return
    clearTimeout(timers.get(id))
    timers.set(
      id,
      setTimeout(() => {
        keep(`artifact:${id}`, { day: dayOf(), state: x.snapshot?.() ?? x.state }) // a refusal said once per key (audit 18)
      }, 300),
    )
  }
  for (const [id, { artifact: x }] of artifacts) restore(id, x)
  const kernel = { title, tree: team.tree(), artifacts: Object.fromEntries([...artifacts.keys()].map((id) => [id, view(id)])) }
  const watched = new Map()
  const watch = (id, x) =>
    watched.set(
      id,
      x.onChange(() => {
        if (artifacts.get(id)?.artifact !== x) return
        kernel.artifacts[id] = view(id)
        const patch = { type: "kernel", artifact: kernel.artifacts[id] }
        broadcast(patch)
        save(id, x)
      }),
    )
  for (const [id, { artifact: x }] of artifacts) watch(id, x)
  const rescan = () => {
    const next = team.artifacts()
    const sent = []
    for (const [id, { artifact: x, holders }] of next) {
      const old = artifacts.get(id)
      if (old?.artifact !== x) {
        watched.get(id)?.()
        if (!restored.has(x)) restore(id, x)
        watch(id, x)
        sent.push(id)
      } else if (old.holders.join("\n") !== holders.join("\n")) sent.push(id)
    }
    const removed = [...artifacts.keys()].filter((id) => !next.has(id))
    artifacts = next
    for (const id of removed) {
      watched.get(id)?.()
      watched.delete(id)
      delete kernel.artifacts[id]
    }
    for (const id of sent) broadcast({ type: "kernel", artifact: (kernel.artifacts[id] = view(id)) })
    return removed
  }

  // ---- kept helpers -----------------------------------------------------------------------------
  const keptRecords = () => {
    const r = store.get("kept", [])
    return Array.isArray(r) ? r : []
  }
  const saveKept = (records) => keep("kept", records)

  // ---- kernel events → states -------------------------------------------------------------------
  const pendingCalls = new Map()
  const starts = new Map()
  // 2026-10-23: a desk event as a row in the thread of the agent that caused it (kernel-team.js lifecycle, the same row)
  const lifecycle = (by, kind, content, e) => {
    if (by && states[by]) update(by, {}, [msg(rows.lifecycle(kind, content, at(e.at), { agent: e.agent, goal: e.goal ?? null, keep: e.keep ?? null, team: e.team ?? null }))])
  }
  team.on((e) => {
    const id = e.agent
    const a = team.agents().get(id)
    switch (e.event) {
      case "spawn": {
        if (!a) break
        const fresh = team.list.filter((x) => !states[x.name])
        if (!fresh.includes(a)) break
        for (const x of fresh) restoreAgent(x)
        const s = a.config.spawned
        if (s?.keep === "desk" && s.input) saveKept([...keptRecords().filter((r) => r.input?.name !== a.name), { by: s.by, at: s.at, input: s.input }])
        else if (s?.input) saveKept(keptRecords().filter((r) => r.input?.name !== a.name)) // updated to keep: run
        describeAll()
        broadcast({ type: "registry", registry, states: Object.fromEntries(fresh.map((x) => [x.name, states[x.name]])) })
        rescan()
        kernel.tree = team.tree()
        broadcast({ type: "kernel", tree: kernel.tree })
        const waits = e.proposed ? ` (for this run; keep: desk waits for the owner — from a run that read the web: ${e.proposed.from})` : ""
        log(`desk: ${e.by} spawned ${a.name}${e.keep === "desk" ? " (kept)" : waits}: ${String(e.goal ?? "").split("\n")[0].slice(0, 160)}`)
        // a run's spawn, not a kept helper respawned at start (its spawner idle then)
        if (team.agents().get(e.by)?.current) lifecycle(e.by, "spawn", `Spawned ${a.name}${waits}: ${String(e.goal ?? "").split("\n")[0]}`, e)
        break
      }
      // 2026-10-20 (kernel builtin/spawn.js): kept by the owner's accept (Desk.keep) — its record saved, as a kept spawn's;
      // a proposal set or dropped (Desk.propose) — its twin.
      case "keep":
      case "proposal": {
        const s = a?.config.spawned
        if (e.event === "keep" && s?.keep === "desk" && s.input) saveKept([...keptRecords().filter((r) => r.input?.name !== a.name), { by: s.by, at: s.at, input: s.input }])
        describeAll()
        broadcast({ type: "registry", registry, states: {} })
        kernel.tree = team.tree()
        broadcast({ type: "kernel", tree: kernel.tree })
        const p = e.proposed
        if (e.event === "keep") log(`desk: ${e.by ?? "owner"} kept ${id}`)
        else if (p) log(`desk: ${e.by ?? "?"} proposes ${p.update ? `an update of kept ${id}` : `to keep ${id}`} — not in force, waits for the owner (from a run that read the web: ${p.from})`)
        else if (e.dropped) log(`desk: ${e.by ?? "owner"} dropped the ${e.dropped} proposed for ${id}${e.reason ? `: ${e.reason}` : ""}`)
        if (e.event === "keep") lifecycle(s?.by, "keep", `${e.by ?? "owner"} kept ${id}: it stays on the desk`, e)
        else if (p) lifecycle(e.by, "proposal", `Proposed ${p.update ? `an update of ${id}` : `to keep ${id}`} — waits for the owner`, e)
        else if (e.dropped) lifecycle(s?.by, "proposal", `${e.by ?? "owner"} dropped the ${e.dropped} proposed for ${id}${e.reason ? `: ${e.reason}` : ""}`, e)
        break
      }
      case "dismiss": {
        delete states[id]
        pendingCalls.delete(id)
        if (e.reason !== "update" && (!e.team || e.team === id)) saveKept(keptRecords().filter((r) => r.input?.name !== id))
        // Gone for good: its thread and runs too, so a later helper of the same name starts clean (an update keeps them).
        if (e.reason !== "update") for (const key of [`thread:${id}`, `runs:${id}`, `stats:${id}`]) store.remove(key)
        describeAll()
        broadcast({ type: "registry", registry, states: {} })
        const removed = rescan()
        kernel.tree = team.tree()
        broadcast({ type: "kernel", tree: kernel.tree, ...(removed.length ? { removed } : {}) })
        log(`desk: ${e.by ?? "owner"} dismissed ${id}${e.reason ? ` (${e.reason})` : ""}`)
        lifecycle(e.by, "dismiss", `Dismissed ${id}${e.reason ? ` (${e.reason})` : ""}`, e)
        break
      }
      case "start": {
        starts.set(id, e.request)
        {
          const i = queued.findIndex((q) => q.agent === id && q.text === e.request?.text)
          if (i >= 0) (queued.splice(i, 1), saveQueued())
        }
        const first = msg(rows.request(e.request, at(e.at)))
        update(id, { status: "running", error: null, activity: { phase: "llm", stage: "waiting" }, working: { request: first.id, at: at(e.at) } }, [first])
        break
      }
      case "think":
        update(id, { activity: { phase: "llm", stage: "waiting", n: e.n } }) // n: the step whose model call is in flight
        break
      case "step": {
        if (e.ms != null) update(id, { stats: keepStats(id, nextStats(states[id]?.stats, a, e)) })
        // a step that only looked at its screenshots, then answered: the row that shows what it saw (as kernel-team.js)
        if (!e.calls?.length && e.images?.length && a) update(id, {}, [msg(rows.saw(e.images, at(e.at)))])
        if (!e.calls?.length || !a) break
        const row = msg(rows.step(e.thought, e.calls, at(e.at), e.images, e.ms, { n: e.n, answer: e.answer }))
        const step = { stage: e.n, since: at(e.at), row: row.id, calls: e.calls.map((c, index) => ({ index, tool: a.resolveTool(c.tool), input: c.input ?? {} })) }
        pendingCalls.set(id, step)
        update(id, { activity: activityOf(a, step) }, [row])
        break
      }
      case "call": {
        const step = pendingCalls.get(id)
        const call = step?.calls.find((c) => c.index === e.index)
        if (call && a && call.tool !== e.tool) {
          call.tool = e.tool
          update(id, { activity: activityOf(a, step) })
        }
        break
      }
      case "result": {
        if (!a) break
        const step = pendingCalls.get(id)
        const i = step ? step.calls.findIndex((c) => c.index === e.index) : -1
        const call = i >= 0 ? step.calls.splice(i, 1)[0] : null
        update(id, step ? { activity: activityOf(a, step) } : {}, [msg(rows.result(a, e, call?.input ?? e.input, e.index, step?.row, at(e.at)))])
        break
      }
      case "gate":
      case "format": {
        const content = e.event === "gate" ? `Answer ${e.held ? "held" : "refused"}${e.hard ? " (hard: retries never let it through)" : ""}: ${(e.reasons ?? []).join("; ")}` : `Reply not taken: ${e.note ?? "no calls and no answer"}`
        update(id, { activity: { phase: "llm", stage: "waiting" } }, [msg(rows.gate(e.event, content, at(e.at)))])
        break
      }
      case "refresh":
        update(id, {}, [msg(rows.refresh(e, at(e.at)))])
        break
      case "compact":
        // 2026-10-22: the prompt reached 90% of its budget and the older work was folded (kernel #compact): a row in
        // the thread and the Live feed; its summary's model call in the stats.
        update(id, e.mode === "model" && e.ms != null ? { stats: keepStats(id, nextStats(states[id]?.stats, a, e)) } : {}, [msg(rows.compact(e, at(e.at)))])
        break
      case "guide":
        update(id, {}, [msg(rows.guidance(e.from, e.text, at(e.at)))])
        break
      case "chat":
        update(id, e.ms != null ? { stats: keepStats(id, nextStats(states[id]?.stats, a, e)) } : {}, [msg(rows.chatAsked(e.from, e.text, at(e.at - (e.ms ?? 0)))), msg(rows.chatAnswer(e, at(e.at)))])
        break
      case "answer": {
        pendingCalls.delete(id)
        const request = e.request ?? starts.get(id)
        starts.delete(id)
        const runs = [...store.get(`runs:${id}`, []), { at: at(e.at), from: request?.from ?? "owner", request: cut(request?.text ?? "").slice(0, 4000), answer: cut(e.answer).slice(0, 6000) }].slice(-MAX_RUNS)
        keep(`runs:${id}`, runs)
        update(id, { status: "idle", activity: IDLE, working: null }, [msg(rows.answer(e.answer, at(e.at), e.flags))])
        break
      }
      case "error":
        pendingCalls.delete(id)
        starts.delete(id)
        update(id, { status: "error", activity: IDLE, working: null, error: e.error }, [msg({ ...rows.answer(`Error: ${e.error}`, at(e.at)), error: e.error })])
        break
    }
  })

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

  // ---- calls -------------------------------------------------------------------------------------
  const ok = (value = null) => ({ ok: true, value })
  const fail = (message) => ({ ok: false, error: { message } })
  const running = new Map() // agent name → AbortControllers of its runs
  // What waits on a debounce, written now (2026-10-23 audit): at terminate, and when the tab is hidden or closed
  // (start.js: pagehide) — the newest rows and artifact states.
  function flush() {
    for (const { artifact: x } of artifacts.values()) x.flush?.()
    for (const t of [...timers.values(), ...saveTimers.values()]) clearTimeout(t)
    for (const id of saveTimers.keys()) keep(`thread:${id}`, (states[id]?.messages ?? []).slice(-MAX_MESSAGES))
    saveTimers.clear()
    for (const id of timers.keys()) {
      const x = artifacts.get(id)?.artifact
      if (x && !["run", "file"].includes(keepOf(x))) keep(`artifact:${id}`, { day: dayOf(), state: x.snapshot?.() ?? x.state })
    }
    timers.clear()
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
    if (target === "artifact") {
      const id = String(args[0]?.id ?? "")
      const x = artifacts.get(id)?.artifact
      if (typeof x?.ownerCall !== "function") return fail(`no artifact "${id}" takes the owner's calls`)
      try {
        const { deliver, keeper: name, ...rest } = (await x.ownerCall(method, args, "owner")) ?? {}
        if (!deliver) return ok(rest)
        const keeper = team.agents().get(name ?? "") ?? lead
        const guided = keeper.guide(deliver, "owner")
        if (guided) log(`desk: owner asks on ${id} → ${keeper.name} (guidance): ${String(deliver).split("\n")[0].slice(0, 160)}`)
        if (!guided) run(keeper, deliver, "owner").catch((error) => log(`desk: owner's ask on ${id} → ${keeper.name} failed: ${error.message}`))
        return ok({ ...rest, keeper: keeper.name, delivered: guided ? "guided" : "run" })
      } catch (error) {
        return fail(error.message)
      }
    }
    const agent = target ? team.agents().get(target) : lead
    if (!agent) return fail(`No agent "${target}" in this desk.`)
    try {
      switch (method) {
        case "ask":
          return ok(await run(agent, args[0], args[1]?.from ?? "owner"))
        case "send":
          run(agent, args[0], args[1]?.from ?? "owner").catch(() => {})
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
          // the same lines the desk server writes (2026-10-23 audit)
          const from = args[1]?.from ?? "owner"
          log(`desk: ${from} asks ${agent.name}: ${said.split("\n")[0].slice(0, 160)}`)
          let out
          try {
            out = await agent.chat(said, { from })
          } catch (error) {
            log(`desk: ${agent.name} did not answer ${from}'s chat (${String(error.message).slice(0, 160)})`)
            throw error
          }
          const proposed = typeof out.proposed === "string" && out.proposed.trim() ? out.proposed.trim() : null
          return ok({ answer: out.answer, guided: !!out.guided, proposed, ...(out.visual ? { visual: out.visual } : {}), ...(out.visualError ? { visualError: out.visualError } : {}) }) // 2026-10-23 audit: the inline answer draws its visual too
        }
        case "guide": {
          const delivered = agent.guide(args[0], args[1]?.from ?? "owner")
          log(`desk: ${args[1]?.from ?? "owner"} guides ${agent.name}${delivered ? "" : " (nothing running: not delivered)"}: ${String(args[0] ?? "").split("\n")[0].slice(0, 160)}`)
          return ok({ delivered })
        }
        case "preview":
          await agent.refreshArtifacts?.()
          return ok(agent.render({ text: String(args[0] ?? ""), from: "owner" }, []))
        case "clearMemory":
          // 2026-10-23 audit 19: never under a run (it set the agent idle while the run went on): stop it first
          if (agent.busy) return fail(`${agent.name} is working: stop it first, then clear its memory`)
          agent.history.length = 0
          store.remove(`runs:${agent.name}`)
          store.remove(`thread:${agent.name}`)
          update(agent.name, { status: "idle", activity: IDLE, working: null, error: null })
          states[agent.name] = { ...states[agent.name], messages: [] }
          broadcast({ type: "state", id: agent.name, patch: { messages: { from: 0, items: [] }, revision: states[agent.name].revision } })
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
      onEvent({ type: "snapshot", registry, states, kernel, log: logs })
      listeners.add(onEvent)
      return () => listeners.delete(onEvent)
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
      listeners.clear()
    },
  }
}
