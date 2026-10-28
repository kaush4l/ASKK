// The team protocol both hosts serve (2026-10-25: one copy, it was two): the desk server's companion/team/kernel-team.js
// and the tab's backend/browser/team.js. A snapshot {registry, states, kernel, log}, then state {id, patch}, kernel
// {artifact | tree | removed}, registry and log events (backend/live/stream.js reads them); the thread rows from
// team-rows.js. Plain JS, no fs: each host plugs in where it keeps things (persist) and what it adds per event (hooks).
//
//   createChannel({logKeep, logs?, hostLog?, saveLog?}) → {clients, broadcast, log, logs}
//   createTeamCore({team, channel, title, kernel?, maxMessages, logChars, idOf, definition?, stats, persist, hooks})
//     persist  {restore(id, x), save(id, x), flush?(id, x), rows?(id, rows)}   rows: the new thread rows
//     hooks    {note, started, think, step, result, gate, guide, answer, error, rescanned, dropped}: a host's own
//              record of a run beside the rows (the desk server's trail, markers, history.md; the tab's store)
//     → {broadcast, clients, log, registry, states, update, msg, note, at, kernel, artifacts, rescan, reshaped, deskSaid,
//        droppedProposals, onEvent, ownerArtifact, chatValue, clearMemory, snapshot, …}

import { kernelClasses } from "../kernel/index.js"
import { tailArtifacts } from "./artifact-tail.js"
import { activityOf, freshState, IDLE, rows } from "./team-rows.js"

export const ok = (value = null) => ({ ok: true, value })
export const fail = (message) => ({ ok: false, error: { message } })
const first = (text, n) => String(text ?? "").split("\n")[0].slice(0, n)

// The tabs on the stream and the desk's background log, before the desk is built (desk.start takes the log): every line
// the desk, its watchers, the schedule, the wake book or the Telegram bridge writes goes to the host's log and every tab.
export function createChannel({ logKeep, logs = [], hostLog = () => {}, saveLog = () => {} }) {
  // A view that throws is counted and said (1st, 10th, 100th …) — as the kernel's listener guard (2026-10-23).
  const clients = new Set()
  let listenerErrors = 0
  const broadcast = (event) => {
    for (const fn of clients) {
      try {
        fn(event)
      } catch (error) {
        listenerErrors++
        if (Number.isInteger(Math.log10(listenerErrors))) console.warn(`desk: a view threw on a ${event?.type} event (${listenerErrors} so far): ${error?.message ?? error}`)
      }
    }
  }
  // `source` is the line's "<word>:" prefix (watch, desk, radar, telegram, wake…); the newest logKeep ride the snapshot.
  const log = (line) => {
    const text = String(line)
    hostLog(text)
    const row = { at: new Date().toISOString(), source: text.match(/^([\w.-]+):\s/)?.[1] ?? "desk", text }
    logs.push(row)
    if (logs.length > logKeep) logs.shift()
    saveLog(logs)
    broadcast({ type: "log", ...row })
  }
  return { clients, broadcast, log, logs }
}

// The snapshot's threads (2026-10-26, snapshot-thread-tail): each state with its newest `n` rows only and
// messagesSkipped, the count left out (a tab asks for them with the agent call `older`); live patches still index
// the whole thread, so the tab keeps messagesSkipped as their offset (backend/live/agent.js apply).
// snapshot-states-lean (2026-10-26): a result row carries its text twice (content and output, team-rows.js result);
// the snapshot sends it once, as content — every reader falls back to it (follow.js toolEvents and runSteps).
// snapshot-inputs-lean (2026-10-26): a result row's long input strings (a files.write content, a long ask) ride the
// snapshot as their first INPUT_CHARS chars plus "…", with inputsCut: true; short ones (path, url, q) stay whole, and
// live patches and the `older` call still carry the whole row.
// snapshot-tail-40 (2026-10-26): 40 rows, from 60, so the snapshot stays under 500 KB as threads grow ("Show n older rows" loads the rest).
export const SNAPSHOT_ROWS = 40
export const INPUT_CHARS = 300
const cutInputs = (inputs) => {
  if (!inputs || typeof inputs !== "object") return null
  let cut = false
  const out = Object.fromEntries(
    Object.entries(inputs).map(([k, v]) => {
      if (typeof v !== "string" || v.length <= INPUT_CHARS) return [k, v]
      cut = true
      return [k, `${v.slice(0, INPUT_CHARS)}…`]
    }),
  )
  return cut ? out : null
}
// snapshot-steps-lean (2026-10-26): a step row (role assistant, action tool: its thought, then one `name({...})` line per
// call, team-rows.js step) keeps its first line whole; each later line over INPUT_CHARS rides as its first INPUT_CHARS
// chars plus "…", with contentCut: true (the tab's "Show full step" fetches the whole row through `older`).
const cutCalls = (content) => {
  const [thought, ...calls] = content.split("\n")
  let cut = false
  const lines = calls.map((line) => {
    if (line.length <= INPUT_CHARS) return line
    cut = true
    return `${line.slice(0, INPUT_CHARS)}…`
  })
  return cut ? [thought, ...lines].join("\n") : null
}
const leanRow = (m) => {
  if (m?.role === "assistant" && m.action === "tool" && typeof m.content === "string") {
    const content = cutCalls(m.content)
    return content == null ? m : { ...m, content, contentCut: true }
  }
  if (m?.role !== "tool") return m
  const { output, ...rest } = m
  const lean = output === m.content ? rest : m
  const inputs = cutInputs(m.inputs)
  return inputs ? { ...lean, inputs, inputsCut: true } : lean
}
export function tailStates(states, n = SNAPSHOT_ROWS) {
  return Object.fromEntries(
    Object.entries(states).map(([id, s]) => {
      const all = s?.messages ?? []
      const skipped = Math.max(0, all.length - n)
      return [id, { ...s, messages: (skipped ? all.slice(skipped) : all).map(leanRow), messagesSkipped: skipped }]
    }),
  )
}

// registry-once (2026-10-26): the stream's registry carries each agent definition once, in engines[].agent; the host's
// registry.agents is the same objects again, so the wire copy leaves it out (registry.js and kernel-live.js derive it).
export const wireRegistry = ({ agents, ...rest }) => rest

export function createTeamCore({ team, channel, title = null, kernel: extra = {}, maxMessages, logChars = 160, idOf, definition = (twin) => twin, stats, persist, hooks = {} }) {
  const { broadcast, log } = channel
  const lead = team.lead

  // ---- registry: one engine per kernel agent -------------------------------------------------------------------------
  // The agent's twin (kernel Agent.twin()): its definition and every tool as a spec; the host shapes its folder.
  const registry = { agents: [], edited: [], status: "ready", error: null, requiredId: lead.name, engines: [] }
  const describeAll = () => {
    registry.engines = team.list.map((a) => {
      const { element, id, tools, folder, status, ...twin } = a.twin()
      return { id: a.name, name: a.name, agent: definition({ ...twin, tools: tools.map(({ element, id, ...spec }) => spec), kernel: true }, folder) }
    })
    registry.agents = registry.engines.map((e) => e.agent)
  }
  describeAll()

  // ---- threads -------------------------------------------------------------------------------------------------------
  const states = {}
  let seq = 0
  const msg = (row) => ({ id: idOf(++seq), ...row })
  const at = (ms) => new Date(ms ?? Date.now()).toISOString()
  function update(id, patch, newMessages = []) {
    const s = (states[id] ??= freshState())
    const from = s.messages.length
    let messages = s.messages
    if (newMessages.length) {
      persist.rows?.(id, newMessages)
      messages = [...messages, ...newMessages]
      if (messages.length > maxMessages) messages = messages.slice(-maxMessages)
    }
    const next = { ...s, ...patch, messages, revision: s.revision + 1 }
    states[id] = next
    const out = { ...patch, revision: next.revision }
    if (newMessages.length) out.messages = messages.length < from + newMessages.length ? { from: 0, items: messages } : { from, items: newMessages }
    broadcast({ type: "state", id, patch: out })
  }
  // A row the kernel's run record does not hold (a compaction, a desk event, a refresh): the host may keep it with the run.
  const note = (id, row, patch = {}) => (hooks.note ? hooks.note(id, row, patch) : update(id, patch, [msg(row)]))
  // 2026-10-23 audit 19: never under a run (it set the agent idle while the run went on) — the caller checks `busy`
  const clearMemory = (agent) => {
    agent.history.length = 0
    update(agent.name, { status: "idle", activity: IDLE, working: null, error: null })
    states[agent.name] = { ...states[agent.name], messages: [] }
    broadcast({ type: "state", id: agent.name, patch: { messages: { from: 0, items: [] }, revision: states[agent.name].revision } })
  }

  // ---- artifacts -----------------------------------------------------------------------------------------------------
  // Every artifact by its id: its twin with the agents that hold it (Desk.artifacts()), restored by the host's keep,
  // one {type: "kernel", artifact} event per change, saved by the host.
  let artifacts = team.artifacts()
  const view = (id) => {
    const { artifact: x, holders } = artifacts.get(id)
    return { ...x.twin(), holders }
  }
  // Each instance is read back once, when it first appears (2026-10-17 critic: a shared one held again was reset).
  const restored = new WeakSet()
  const restore = (id, x) => (restored.add(x), persist.restore(id, x))
  for (const [id, { artifact: x }] of artifacts) restore(id, x)
  // classes: the kernel's own description of its classes (kernel classes.js), drawn on /compose beside the instances
  const kernel = { title, classes: kernelClasses(), ...extra, tree: team.tree(), artifacts: Object.fromEntries([...artifacts.keys()].map((id) => [id, view(id)])) }
  const watched = new Map() // artifact id -> its onChange unsubscribe
  const watch = (id, x) =>
    watched.set(
      id,
      x.onChange(() => {
        if (artifacts.get(id)?.artifact !== x) return // no holder left (its helper was dismissed)
        broadcast({ type: "kernel", artifact: (kernel.artifacts[id] = view(id)) })
        persist.save(id, x)
      }),
    )
  for (const [id, { artifact: x }] of artifacts) watch(id, x)
  // After a spawn or dismiss: a new one restored and watched, one whose holders changed sent again, one no agent holds
  // any more leaves → its id, its waiting save written first.
  const rescan = () => {
    const next = team.artifacts()
    const sent = []
    for (const [id, { artifact: x, holders }] of next) {
      const old = artifacts.get(id)
      if (old?.artifact !== x) {
        watched.get(id)?.()
        if (old) persist.flush?.(id, old.artifact)
        if (!restored.has(x)) restore(id, x)
        watch(id, x)
        sent.push(id)
      } else if (old.holders.join("\n") !== holders.join("\n")) sent.push(id)
    }
    const removed = [...artifacts.keys()].filter((id) => !next.has(id))
    for (const id of removed) persist.flush?.(id, artifacts.get(id).artifact)
    artifacts = next
    for (const id of removed) {
      watched.get(id)?.()
      watched.delete(id)
      delete kernel.artifacts[id]
    }
    for (const id of sent) broadcast({ type: "kernel", artifact: (kernel.artifacts[id] = view(id)) })
    hooks.rescanned?.()
    return removed
  }
  // The desk changed shape (a spawn, keep, proposal, dismiss, a model): the registry (with the new agents' states), the
  // artifacts when asked, the tree.
  const reshaped = ({ fresh = [], scan = false } = {}) => {
    describeAll()
    broadcast({ type: "registry", registry: wireRegistry(registry), states: Object.fromEntries(fresh.map((x) => [x.name, states[x.name]])) })
    const removed = scan ? rescan() : []
    kernel.tree = team.tree()
    broadcast({ type: "kernel", tree: kernel.tree, ...(removed.length ? { removed } : {}) })
    return removed
  }

  // ---- desk events: the log line, and the row in the thread of the agent that caused it (2026-10-23) -----------------
  const lifecycle = (by, kind, content, e) => {
    if (by && states[by]) note(by, rows.lifecycle(kind, content, at(e.at), { agent: e.agent, goal: e.goal ?? null, keep: e.keep ?? null, team: e.team ?? null }))
  }
  const deskSaid = {
    spawn(e, a, members = []) {
      const name = members.length ? `team ${a.name} (${members.join(", ")})` : a.name
      const waits = e.proposed ? ` (for this run; keep: desk waits for the owner — from a run that read the web: ${e.proposed.from})` : ""
      log(`desk: ${e.by} spawned ${name}${waits}: ${first(e.goal, logChars)}`)
      // a run's spawn, not a kept helper respawned at start (its spawner idle then)
      if (team.agents().get(e.by)?.current) lifecycle(e.by, "spawn", `Spawned ${name}${waits}: ${String(e.goal ?? "").split("\n")[0]}`, e)
    },
    keep(e, a, more = "") {
      log(`desk: ${e.by ?? "owner"} kept ${e.agent}${more}`)
      lifecycle(a?.config.spawned?.by, "keep", `${e.by ?? "owner"} kept ${e.agent}: it stays on the desk`, e)
    },
    proposal(e) {
      const p = e.proposed
      const what = e.dropped === "update" ? "update" : "keep"
      if (p) log(`desk: ${e.by ?? "?"} proposes ${p.update ? `an update of kept ${e.agent} (${Object.keys(p.update).join(", ")})` : `to keep ${e.agent}`} — not in force, waits for the owner (from a run that read the web: ${p.from})`)
      else if (e.dropped) log(`desk: ${e.by ?? "owner"} dropped the ${what} proposed for ${e.agent}${e.reason ? `: ${e.reason}` : ""}`)
      if (p) lifecycle(e.by, "proposal", `Proposed ${p.update ? `an update of ${e.agent}` : `to keep ${e.agent}`} — waits for the owner`, e)
      else if (e.dropped) lifecycle(team.agents().get(e.agent)?.config.spawned?.by, "proposal", `${e.by ?? "owner"} dropped the ${what} proposed for ${e.agent}${e.reason ? `: ${e.reason}` : ""}`, e)
    },
    dismiss(e) {
      log(`desk: ${e.by ?? "owner"} dismissed ${e.agent}${e.reason ? ` (${e.reason})` : ""}`)
      lifecycle(e.by, "dismiss", `Dismissed ${e.agent}${e.reason ? ` (${e.reason})` : ""}`, e)
    },
  }
  // A proposal a restored thread shows waiting whose agent's proposal did not survive (nothing proposed is saved).
  const droppedProposals = (when) => {
    for (const [id, st] of Object.entries(states)) {
      const thread = st?.messages ?? []
      for (const [i, m] of thread.entries()) {
        if (m.action !== "lifecycle" || m.kind !== "proposal" || !String(m.content).startsWith("Proposed") || !m.agent) continue
        if (thread.slice(i + 1).some((x) => x.action === "lifecycle" && x.agent === m.agent)) continue // kept, dropped or dismissed since
        if (team.agents().get(m.agent)?.config.spawned?.proposed) continue // still waiting
        const text = `The proposal for ${m.agent} was dropped when ${when} (proposals are not saved) — propose it again to keep it`
        note(id, rows.lifecycle("proposal", text, at(), { agent: m.agent }))
        hooks.dropped?.(text)
      }
    }
  }

  // ---- run events → the thread and the activity ----------------------------------------------------------------------
  // The step running now per agent: {stage, since, row, calls: [{index, tool, input}] not answered yet}. A result is its
  // call's by the index the kernel's `call` and `result` carry, never by tool name (2026-10-17).
  const pending = new Map()
  const starts = new Map() // agent name -> the request of its run in progress
  const runEvents = {
    start(id, e) {
      starts.set(id, e.request)
      const row = msg(rows.request(e.request, at(e.at)))
      update(id, { status: "running", error: null, activity: { phase: "llm", stage: "waiting" }, working: { request: row.id, at: at(e.at) } }, [row])
      hooks.started?.(id, e)
    },
    think(id, e, a) {
      hooks.think?.(id, a)
      update(id, { activity: { phase: "llm", stage: "waiting", n: e.n } }) // n: the step whose model call is in flight
    },
    step(id, e, a) {
      // the model call behind the step (kernel Agent: ms, prompt_chars, reply_chars): the agent's stats
      if (e.ms != null) update(id, { stats: stats(id, a, e) })
      hooks.step?.(id, e, a)
      if (!e.calls?.length) {
        // a step that only looked at its screenshots, then answered: the row that shows what it saw
        if (e.images?.length && a) note(id, rows.saw(e.images, at(e.at)))
        return
      }
      if (!a) return
      // each name as the kernel will run it (Agent.resolveTool): the first activity already draws a quest as one
      const row = msg(rows.step(e.thought, e.calls, at(e.at), e.images, e.ms, { n: e.n, answer: e.answer, route: e.route }))
      const step = { stage: e.n, since: at(e.at), row: row.id, calls: e.calls.map((c, index) => ({ index, tool: a.resolveTool(c.tool), input: c.input ?? {} })) }
      pending.set(id, step)
      update(id, { activity: activityOf(a, step) }, [row])
    },
    call(id, e, a) {
      // should the kernel run another tool than the step drew, the activity follows the kernel
      const step = pending.get(id)
      const call = step?.calls.find((c) => c.index === e.index)
      if (call && a && call.tool !== e.tool) {
        call.tool = e.tool
        update(id, { activity: activityOf(a, step) })
      }
    },
    result(id, e, a) {
      if (!a) return
      const step = pending.get(id)
      const i = step ? step.calls.findIndex((c) => c.index === e.index) : -1
      const call = i >= 0 ? step.calls.splice(i, 1)[0] : null
      const row = rows.result(a, e, call?.input ?? e.input, e.index, step?.row, at(e.at))
      hooks.result?.(id, e, a, row)
      update(id, step ? { activity: activityOf(a, step) } : {}, [msg(row)])
    },
    // an answer refused (open checklist, report missing fields; held: guidance arrived while it answered), or a reply
    // with neither calls nor an answer: the agent goes on, the thread and the Live feed say why
    gate(id, e) {
      const content = e.event === "gate" ? `Answer ${e.held ? "held" : "refused"}${e.hard ? " (hard: retries never let it through)" : ""}: ${(e.reasons ?? []).join("; ")}` : `Reply not taken: ${e.note ?? "no calls and no answer"}`
      hooks.gate?.(id, { kind: e.event, content })
      update(id, { activity: { phase: "llm", stage: "waiting" } }, [msg(rows.gate(e.event, content, at(e.at)))])
    },
    // the prompt reached 90% of its budget and the older work was folded (kernel #compact); its summary's call counted
    compact: (id, e, a) => note(id, rows.compact(e, at(e.at)), e.mode === "model" && e.ms != null ? { stats: stats(id, a, e) } : {}),
    refresh: (id, e) => note(id, rows.refresh(e, at(e.at))),
    // what waits behind the run in progress (kernel Agent.inbox)
    inbox: (id, e) => update(id, { inbox: e.inbox }),
    guide(id, e) {
      hooks.guide?.(id, e)
      update(id, {}, [msg(rows.guidance(e.from, e.text, at(e.at)))])
    },
    // the owner's chat: its question and answer as two rows; the activity and `working` stay the run's
    chat: (id, e, a) => update(id, e.ms != null ? { stats: stats(id, a, e) } : {}, [msg(rows.chatAsked(e.from, e.text, at(e.at - (e.ms ?? 0)))), msg(rows.chatAnswer(e, at(e.at)))]),
    answer(id, e, a) {
      pending.delete(id)
      hooks.answer?.(id, e, a, e.request ?? starts.get(id))
      starts.delete(id)
      update(id, { status: "idle", activity: IDLE, working: null }, [msg(rows.answer(e.answer, at(e.at), e.flags))])
    },
    error(id, e, a) {
      pending.delete(id)
      hooks.error?.(id, e, a, starts.get(id))
      starts.delete(id)
      update(id, { status: "error", activity: IDLE, working: null, error: e.error }, [msg({ ...rows.answer(`Error: ${e.error}`, at(e.at)), error: e.error })])
    },
  }
  runEvents.format = runEvents.gate
  const onEvent = (e) => runEvents[e.event]?.(e.agent, e, team.agents().get(e.agent))

  // ---- the owner's calls both hosts take -----------------------------------------------------------------------------
  // On an artifact through its twin: args [{id, …}] → its ownerCall(method, args, "owner"); a {deliver} text goes to its
  // keeper (else the lead) — guidance while it runs, else a new run → the result without the text, + {keeper, delivered}.
  async function ownerArtifact(method, args, run) {
    const id = String(args[0]?.id ?? "")
    const x = artifacts.get(id)?.artifact
    if (typeof x?.ownerCall !== "function") return fail(`no artifact "${id}" takes the owner's calls`)
    try {
      // awaited (2026-10-17): the preview's open / back / rerun read files and run scripts first
      const out = await x.ownerCall(method, args, "owner")
      // 2026-10-27 ask-answer: a text result (Ask's 'what' answer) goes back whole, not spread into its characters
      if (out != null && typeof out !== "object") return ok(out)
      const { deliver, keeper: name, ...rest } = out ?? {}
      if (!deliver) return ok(rest)
      const keeper = team.agents().get(name ?? "") ?? lead
      const guided = keeper.guide(deliver, "owner")
      if (guided) log(`desk: owner asks on ${id} → ${keeper.name} (guidance): ${first(deliver, logChars)}`)
      else run(keeper, deliver, "owner").catch((error) => log(`desk: owner's ask on ${id} → ${keeper.name} failed: ${error.message}`))
      return ok({ ...rest, keeper: keeper.name, delivered: guided ? "guided" : "run" })
    } catch (error) {
      // 2026-10-27 ask-answer: a non-Error throw (a string, an object) keeps its text, never an undefined message
      return fail(error?.message ?? String(error))
    }
  }
  // A chat's answer as the call returns it (2026-10-23 audit: the inline answer draws its visual too).
  const chatValue = (out) => {
    const proposed = typeof out.proposed === "string" && out.proposed.trim() ? out.proposed.trim() : null
    return { answer: out.answer, guided: !!out.guided, proposed, ...(out.visual ? { visual: out.visual } : {}), ...(out.visualError ? { visualError: out.visualError } : {}) }
  }

  return {
    ...channel,
    registry,
    describeAll,
    states,
    update,
    msg,
    note,
    at,
    kernel,
    get artifacts() {
      return artifacts
    },
    rescan,
    reshaped,
    deskSaid,
    droppedProposals,
    onEvent,
    pending,
    starts,
    ownerArtifact,
    chatValue,
    clearMemory,
    // The snapshot's artifacts are compact (artifact-tail.js); kernel.artifacts and the live patches stay whole.
    snapshot: () => ({ type: "snapshot", registry: wireRegistry(registry), states: tailStates(states), kernel: { ...kernel, artifacts: tailArtifacts(kernel.artifacts) }, log: channel.logs }),
    // The full view of an artifact the snapshot sent compact (agent call `artifact` [id]); null when no agent holds it.
    artifact: (id) => (artifacts.has(id) ? view(id) : null),
    // The rows a snapshot's tail left out (agent call `older` [end, start?]): the thread from index start (default 0)
    // to before index end — one row for a step the snapshot sent cut (snapshot-steps-lean).
    older: (id, end, start = 0) => ({ items: (states[id]?.messages ?? []).slice(Math.max(0, Number(start) || 0), Math.max(0, Number(end) || 0)) }),
  }
}
