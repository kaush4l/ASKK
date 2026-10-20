// The live status message of a kernel desk's runs, server-side: when the lead starts a run (from any
// source: Telegram, the schedule, the UI), one message is sent and then edited in place as the agents
// work; when the run ends, a final edit marks it done and editing stops. The run's report or reply is
// sent separately, as before (kernel-telegram.js, scripts/dev.js).
//
//   const live = startLiveStatus({ team, desk, transport: { send(text) → message id, edit(id, text) }, log })
//   live.refresh()   /status: a fresh message now (the old one is edited to point at it), or, with no
//                    run, a one-off snapshot of the last run
//   live.stop()
//
// Why edits (editMessageText) and not sendMessageDraft: a draft is a 30-second preview that vanishes
// when the bot sends any other message (a "queued" note, a report) and is never kept in the chat, so a
// run lasting minutes would need a keep-alive and still leave nothing behind; an edited message is
// kept, survives app restarts and makes no sound. No pin: every pin adds a service line to the chat.
//
// State: the team's stream (team.stream, the surface every tab mirrors), mirrored here in a slim form
// (each message cut to what the status shows). Text: companion/team/kernel-status.js.
//
// Throttle: at most one Bot API call per MIN_INTERVAL_MS and PER_MINUTE per minute, only when the
// rendered text changed (elapsed time shows whole minutes, so an idle minute changes nothing); a 429
// waits its retry_after. A run shorter than GRACE_MS that hands no quest gets no status message (a
// quick question is answered at once anyway).
//
// Watch runs (request `from` "watch…": the desk's own watch reruns the lead every few minutes all day)
// get no status message at all, and /status skips them for the last run.

import { clip, isRunRequest, leadRun, parseReport, renderStatus, runOutcome } from "./kernel-status.js"

const MIN_INTERVAL_MS = 3000
const PER_MINUTE = 20
const HEARTBEAT_MS = 15_000
const GRACE_MS = 15_000
const MAX_FAILURES = 5
const HIDDEN = new Set(["board", "memory"]) // artifacts the mirror drops: big, and the status never shows them

const redact = (text) => String(text).replace(/-?\d{6,}/g, "<id>")
const isWatch = (from) => String(from ?? "").startsWith("watch")

// What the status needs of a message: the quest (role user), the report (VERDICT + CONFIDENCE). kind stays (2026-10-17
// critic: without it isRunRequest could not tell a run's request from guidance or an owner chat's question).
function slim(m) {
  const out = { id: m.id, role: m.role, kind: m.kind ?? null, action: m.action ?? null, at: m.at ?? null, from: m.from ?? null }
  if (m.error) out.error = clip(m.error, 300)
  if (m.role === "user") out.content = clip(m.content, 400)
  else if (m.action === "answer") {
    const { verdict, confidence } = parseReport(m.content)
    out.content = `VERDICT: ${clip(verdict, 300)}${confidence != null ? `\nCONFIDENCE: ${confidence}` : ""}`
  }
  return out
}
const slimState = (s = {}) => ({ status: s.status, activity: s.activity, error: s.error ?? null, working: s.working ?? null, messages: (s.messages ?? []).map(slim) })

// The team's stream as one view { lead, registry, states, kernel }, updated in place; onEvent(e) after each.
export function mirrorTeam(team, signal, onEvent) {
  const view = { lead: null, registry: null, states: {}, kernel: { tree: null, artifacts: {} } }
  const kept = (a) => a?.id && !HIDDEN.has(a.kind)
  const keep = (artifacts = {}) => Object.fromEntries(Object.entries(artifacts).filter(([, a]) => kept(a)))
  function apply(e) {
    if (e.type === "snapshot") {
      view.lead = e.registry?.requiredId ?? null
      view.registry = { agents: (e.registry?.agents ?? []).map((a) => ({ name: a.name, agents: a.agents ?? [] })) }
      view.states = Object.fromEntries(Object.entries(e.states ?? {}).map(([id, s]) => [id, slimState(s)]))
      view.kernel = { tree: e.kernel?.tree ?? null, artifacts: keep(e.kernel?.artifacts) }
    } else if (e.type === "registry") {
      // 2026-10-17: an agent spawned or dismissed (kernel Desk.spawn / dismiss): the new list, the new agents' states.
      view.registry = { agents: (e.registry?.agents ?? []).map((a) => ({ name: a.name, agents: a.agents ?? [] })) }
      const names = new Set(view.registry.agents.map((a) => a.name))
      for (const id of Object.keys(view.states)) if (!names.has(id)) delete view.states[id]
      for (const [id, s] of Object.entries(e.states ?? {})) view.states[id] = slimState(s)
    } else if (e.type === "state" && e.id) {
      const s = view.states[e.id] ?? slimState()
      const { messages, revision, ...rest } = e.patch ?? {}
      const next = { ...s, ...rest }
      if (messages) next.messages = [...s.messages.slice(0, messages.from ?? 0), ...(messages.items ?? []).map(slim)]
      view.states[e.id] = next
    } else if (e.type === "kernel") {
      if (kept(e.artifact)) view.kernel.artifacts[e.artifact.id] = e.artifact
      if (e.tree) view.kernel.tree = e.tree
      for (const id of e.removed ?? []) delete view.kernel.artifacts[id]
    }
  }
  const done = (async () => {
    const reader = team.stream({ signal }).body.getReader()
    signal.addEventListener("abort", () => reader.cancel().catch(() => {}))
    const decoder = new TextDecoder()
    let buffer = ""
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      for (let cut; (cut = buffer.indexOf("\n\n")) >= 0; ) {
        const block = buffer.slice(0, cut)
        buffer = buffer.slice(cut + 2)
        for (const line of block.split("\n")) {
          if (!line.startsWith("data: ")) continue
          let e
          try {
            e = JSON.parse(line.slice(6))
          } catch {
            continue
          }
          apply(e)
          onEvent(e, view)
        }
      }
    }
  })().catch(() => {})
  return { view, done }
}

export function startLiveStatus({
  team,
  desk = "desk",
  transport,
  log = () => {},
  now = Date.now,
  minIntervalMs = MIN_INTERVAL_MS,
  perMinute = PER_MINUTE,
  heartbeatMs = HEARTBEAT_MS,
  graceMs = GRACE_MS,
}) {
  const controller = new AbortController()
  let current = null // the live run: { startedAt, goal, from, touched, id, text, failures, replaced }
  const jobs = [] // one-shot texts before the live run's next edit: final edits, "moved", /status snapshots
  let leadStatus = null
  let pumping = false
  let stopped = false
  let retryUntil = 0
  let backoffUntil = 0
  const stamps = [] // Bot API calls in the last minute
  let wake = null
  const logged = new Set()
  const logOnce = (key, line) => logged.has(key) || (logged.add(key), log(line))

  const { view, done } = mirrorTeam(team, controller.signal, onEvent)
  let seen
  const ready = new Promise((resolve) => (seen = resolve))
  done.finally(() => seen())

  const snapshotFor = (run) => ({ desk, lead: view.lead, states: view.states, kernel: view.kernel, registry: view.registry, run, now: now() })
  const render = (run) => renderStatus(snapshotFor(run))
  const liveRun = (r) => ({ phase: "live", startedAt: r.startedAt, goal: r.goal, from: r.from, touched: [...r.touched] })

  function begin() {
    if (current) end()
    const r = leadRun(view) ?? {}
    if (isWatch(r.from)) return // the desk's own watch: no message, no edits
    current = { startedAt: r.startedAt ?? now(), goal: r.goal ?? null, from: r.from ?? null, touched: new Set(), id: null, text: null, failures: 0, replaced: null }
  }
  function end() {
    const run = current
    current = null
    if (!run) return
    const outcome = runOutcome(view, run.startedAt)
    // Frozen now: a next run may start at once and change the same agents' states.
    const text = render({ phase: "done", startedAt: run.startedAt, endedAt: now(), goal: run.goal, from: run.from, touched: [...run.touched], outcome })
    // The final edit goes to the run's message (or, if /status's new one was never sent, the old one).
    const id = run.id ?? run.replaced
    if (id != null) jobs.push({ id, text, failures: 0 })
    else run.final = text // its first message may be on the way: the final edit follows it (pump)
  }
  // The lead's last run that is not a watch run, with its own outcome (its answer, before the next run).
  function lastRun() {
    const messages = view.states[view.lead]?.messages ?? []
    // A run starts at its request (isRunRequest: guidance joins the run in progress, an owner chat is beside the runs).
    const i = messages.findLastIndex((m) => isRunRequest(m) && !isWatch(m.from))
    if (i < 0) return null
    const m = messages[i]
    const next = messages.findIndex((x, j) => j > i && isRunRequest(x))
    const own = { lead: view.lead, states: { [view.lead]: { messages: next < 0 ? messages : messages.slice(0, next) } } }
    const startedAt = Date.parse(m.at)
    return { startedAt, goal: m.content, from: m.from ?? "owner", outcome: runOutcome(own, startedAt) }
  }
  // A run is worth a message once a team works on it or it lasts past the grace.
  const due = (run) => run.id != null || run.force || now() - run.startedAt >= graceMs || Object.keys(view.states).some((name) => name !== view.lead && (view.states[name].status === "running" || view.states[name].messages.some((m) => isRunRequest(m) && Date.parse(m.at) >= run.startedAt - 1000)))

  function onEvent(e) {
    if (e.type === "snapshot") {
      leadStatus = view.states[view.lead]?.status ?? null
      if (leadStatus === "running") begin()
      seen()
    } else if (e.type === "state" && e.id === view.lead) {
      const status = view.states[view.lead]?.status ?? null
      if (status !== leadStatus) {
        if (status === "running") begin()
        else if (leadStatus === "running") end()
        leadStatus = status
      }
    } else if (e.type === "kernel" && current && e.artifact?.id) {
      current.touched.add(e.artifact.id)
    }
    kick()
  }

  const sleep = (ms) => new Promise((resolve) => ((wake = resolve), setTimeout(resolve, ms)))
  function waitFor() {
    const t = now()
    while (stamps.length && stamps[0] <= t - 60_000) stamps.shift()
    const window = stamps.length >= perMinute ? stamps[0] + 60_000 - t : 0
    const spacing = stamps.length ? stamps[stamps.length - 1] + minIntervalMs - t : 0
    return Math.max(0, window, spacing, retryUntil - t, backoffUntil - t)
  }

  // The one loop that talks to Telegram: one-shot jobs first, then the live run's edit.
  async function pump() {
    if (pumping) return
    pumping = true
    try {
      while (!stopped) {
        let job = jobs[0] ?? null
        let text
        const live = !job // the live run's message, else a one-shot job (taken off the queue when done)
        if (job) text = job.text
        else if (current && !current.dead && due(current)) {
          job = current
          text = render(liveRun(current))
          if (job.id != null && text === job.text) break
        } else break
        const wait = waitFor()
        if (wait > 0) {
          await sleep(wait)
          continue // re-read: the run may have changed or ended while waiting
        }
        stamps.push(now())
        try {
          if (job.id == null) {
            job.id = await transport.send(text)
            if (live && job.replaced != null) {
              jobs.push({ id: job.replaced, text: MOVED, failures: 0 })
              job.replaced = null
            }
          } else await transport.edit(job.id, text)
          job.text = text
          job.failures = 0
          if (!live) jobs.shift()
          else if (job.final) {
            // The run ended while its first message was on the way: now its final edit.
            jobs.push({ id: job.id, text: job.final, failures: 0 })
            job.final = null
          }
        } catch (error) {
          const message = String(error?.message ?? error)
          if (error?.retryAfter) {
            retryUntil = now() + Number(error.retryAfter) * 1000 + 250
            logOnce(`429`, `telegram: live status slowed down by Telegram (retry after ${error.retryAfter}s)`)
          } else if (/not modified/i.test(message)) {
            job.text = text
            if (!live) jobs.shift()
          } else if (/message to edit not found|message_id_invalid|message can't be edited/i.test(message)) {
            // Deleted in the chat, or too old to edit: the live run starts a new message, a one-shot is dropped.
            if (live) job.id = null
            else jobs.shift()
          } else {
            job.failures = (job.failures ?? 0) + 1
            backoffUntil = now() + Math.min(60_000, 2000 * 2 ** job.failures)
            logOnce(`fail:${message.slice(0, 40)}`, `telegram: live status failed: ${redact(message)}`)
            if (job.failures >= MAX_FAILURES) {
              if (live) job.dead = true // this run's status gives up; the next run tries again
              else jobs.shift()
            }
          }
        }
      }
    } finally {
      pumping = false
    }
  }
  function kick() {
    if (stopped) return
    if (pumping) return wake?.()
    pump().catch((error) => log(`telegram: live status loop failed: ${redact(error.message)}`))
  }
  // wake() ends a sleep early only to re-check what to send; the spacing still holds (waitFor).
  const heartbeat = setInterval(kick, heartbeatMs)
  heartbeat.unref?.()

  return {
    ready,
    get current() {
      return current ? { startedAt: current.startedAt, id: current.id } : null
    },
    // /status: a fresh live message (the old one says where it went), or a one-off of the last run.
    async refresh() {
      await ready
      if (current) {
        if (current.id != null) current.replaced = current.id
        Object.assign(current, { id: null, text: null, dead: false, failures: 0, force: true })
        kick()
        return "live"
      }
      const last = lastRun()
      const text = last ? render({ phase: "idle", ...last }) : `<b>${desk}</b> · IDLE · no run yet`
      jobs.push({ id: null, text, failures: 0 })
      kick()
      return "idle"
    },
    stop() {
      stopped = true
      clearInterval(heartbeat)
      controller.abort()
      wake?.()
    },
  }
}

const MOVED = "<i>Live status moved to a newer message ↓</i>"
