// Runners (2026-10-22 owner: "the tool that can run periodically and have its own run state … the local agent [can]
// understand the live status, running, paused and current state"): periodic checks a desk plugs in — each runner a
// record the desk's tool writes (a watcher, a formula), run every `every` minutes by `tick()` (the desk's own run loop
// calls it: no timer here), with its run state kept by the kernel: status running | paused | fired | expired | error |
// stopped, every check counted and timed, the last reading, how far it is from firing and how fast it closes in. The
// desk supplies what a check means:
//   check(r, shared, now) → null (nothing read: outside its hours, no data — not counted) | {value, against, holds,
//     gap?, waiting?, off?, fire?, price?, note?}   (the desk may keep its own fields on r: e.g. the previous `holds`)
//   prepare(due, now) → shared   (once per tick: one quote read for every due runner)
//   onFire(r, result, now) → text   (what firing does: wake an agent, book a run; its text is the tick's event)
// Agent commands `<id>.pause {id, reason}`, `<id>.resume {id}`, `<id>.check {id}` (one check now); the owner's
// ownerCall pause | resume | now | stop | remove [{id, runner}] (team call target artifact). View `runners`
// (components/views/runners.jsx): status word, last reading, gap / pace / eta, fires, the owner's controls.
//   state {runners: [{id, …the desk's fields, when, then, why, set_by, at, every (min), until ("HH:MM" ET, shown),
//          ends_at (ISO), status, paused_why, stop_why, checks, checked_at, next_at, errors, error, last: {at, value,
//          against, price, cond, waiting, note, prox: {gap, pace, eta}}, fires: [{at, kind: fire, price, value}] ≤ 10,
//          fired_at}] ≤ max, revision}

import { Artifact } from "../artifact/artifact.js"
import { clip } from "../util/text.js"

const hm = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : "—")
const round = (x) => (typeof x === "number" && Number.isFinite(x) ? Math.round(x * 1000) / 1000 : x ?? null)
const ACTIVE = new Set(["running", "paused", "error"])

export class Runners extends Artifact {
  static about = "periodic checks a desk plugs in, each with its own run state (running, paused, fired …)"
  static commands = {
    pause: { description: "pause a runner: it keeps its state and is not checked until resumed", input: { id: "the runner's id", reason: "why" }, run({ id, reason }) { return this.pause(id, reason) } },
    resume: { description: "resume a paused, errored, stopped or fired runner: checked again from now", input: { id: "the runner's id" }, run({ id }) { return this.resume(id) } },
    check: { description: "check one running runner now (its reading, gap and whether it fires)", input: { id: "the runner's id" }, run({ id }) { return this.checkNow(id) } },
  }
  static owner = {
    pause({ runner, reason }) { return { said: this.pause(runner, reason ?? "the owner") } },
    resume({ runner }) { return { said: this.resume(runner) } },
    now({ runner }) { return this.checkNow(runner).then((said) => ({ said })) },
    stop({ runner, reason }) { return { said: this.stop(runner, reason ?? "the owner") } },
    remove({ runner }) { return { said: this.remove(runner) } },
  }
  static ownerCan = "pause, resume, now, stop or remove"

  constructor({ id = "runners", title, check, prepare, onFire, clock = () => new Date(), every = 1, haltAfter = 3, max = 16, describe } = {}) {
    super({ name: id, title: title ?? `${id} — periodic checks and their run state` })
    Object.assign(this, { kind: "runners", view: "runners", keep: "always" })
    this.check = check ?? (async () => null)
    this.prepare = prepare ?? (async () => null)
    this.onFire = onFire ?? (async (r) => `${r.id} fired`)
    this.describe = describe ?? ((r) => r.when ?? r.id)
    Object.assign(this, { clock, every, haltAfter, max })
    this.state = { runners: [], revision: 0 }
  }

  list() {
    return this.state.runners
  }
  get(id) {
    return this.state.runners.find((r) => r.id === id) ?? null
  }
  #find(id) {
    const r = this.get(String(id ?? "").trim())
    if (!r) throw new Error(`no runner ${id} — ${this.state.runners.map((x) => x.id).join(", ") || "none set"}`)
    return r
  }

  // A runner set (or replaced, same id): the desk's fields plus its run state, running from now.
  add(spec, by = null) {
    const now = this.clock()
    const r = {
      ...spec,
      when: spec.when ?? this.describe(spec),
      every: spec.every ?? this.every,
      set_by: by ?? spec.set_by ?? null,
      at: now.toISOString(),
      status: "running",
      paused_why: null,
      stop_why: null,
      checks: 0,
      checked_at: null,
      next_at: now.toISOString(),
      errors: 0,
      error: null,
      last: null,
      fires: [],
      fired_at: null,
    }
    const rest = this.state.runners.filter((x) => x.id !== r.id)
    const drop = rest.length >= this.max ? rest.findLastIndex((x) => !ACTIVE.has(x.status)) : -1
    if (rest.length >= this.max && drop < 0) throw new Error(`at most ${this.max} runners — stop or remove one first`)
    if (drop >= 0) rest.splice(drop, 1)
    this.state.runners = [r, ...rest]
    this.bump()
    return r
  }

  pause(id, reason = null) {
    const r = this.#find(id)
    if (r.status !== "running" && r.status !== "error") throw new Error(`${r.id} is ${r.status}: only a running one pauses`)
    Object.assign(r, { status: "paused", paused_why: clip(reason, 200) || null })
    this.bump()
    return `paused ${r.id}${r.paused_why ? `: ${r.paused_why}` : ""}`
  }

  resume(id) {
    const r = this.#find(id)
    if (r.status === "running") return `${r.id} is already running`
    if (r.ends_at && new Date(r.ends_at) <= this.clock()) throw new Error(`${r.id} ended at ${hm(r.ends_at)} ET — set it again`)
    Object.assign(r, { status: "running", paused_why: null, stop_why: null, errors: 0, error: null, next_at: this.clock().toISOString() })
    this.bump()
    return `resumed ${r.id}`
  }

  stop(id, reason = null) {
    const r = this.#find(id)
    Object.assign(r, { status: "stopped", stop_why: clip(reason, 200) || null })
    this.bump()
    return `stopped ${r.id}`
  }

  remove(id) {
    const r = this.#find(id)
    this.state.runners = this.state.runners.filter((x) => x !== r)
    this.bump()
    return `removed ${r.id}`
  }

  // One check of one runner now, whatever its schedule (a running one; a paused one stays paused).
  async checkNow(id) {
    const r = this.#find(id)
    if (r.status !== "running") throw new Error(`${r.id} is ${r.status}: resume it first`)
    const events = await this.#run([r], this.clock())
    this.bump()
    return events[0] ?? this.lineOf(r)
  }

  // Every due runner checked once (and past ones expired) → the events' texts.
  async tick(now = this.clock()) {
    const events = []
    for (const r of this.state.runners)
      if (ACTIVE.has(r.status) && r.ends_at && new Date(r.ends_at) <= now) {
        r.status = "expired"
        events.push(`${r.id} expired`)
      }
    const due = this.state.runners.filter((r) => r.status === "running" && (!r.next_at || new Date(r.next_at) <= now))
    events.push(...(await this.#run(due, now)))
    if (events.length || due.length) this.bump()
    return events
  }

  async #run(due, now) {
    if (!due.length) return []
    const events = []
    let shared = null
    try {
      shared = await this.prepare(due, now)
    } catch (e) {
      for (const r of due) this.#failed(r, `prepare: ${e.message}`, now)
      return events
    }
    // every due runner checked at once over the shared data (2026-10-23 architecture map: one slow check held the rest);
    // the results applied, and the fires acted on, one at a time in order — onFire wakes agents and books runs
    const settled = await Promise.allSettled(due.map((r) => this.check(r, shared, now)))
    for (const [i, r] of due.entries()) {
      if (settled[i].status === "rejected") {
        this.#failed(r, settled[i].reason?.message ?? String(settled[i].reason), now)
        continue
      }
      const res = settled[i].value
      r.next_at = new Date(now.getTime() + Math.max(1, Number(r.every) || this.every) * 60000).toISOString()
      if (!res) continue
      const prev = r.last
      const gap = res.gap != null ? round(Math.abs(res.gap)) : null
      const pace = gap != null && prev?.prox?.gap != null ? round(prev.prox.gap - gap) : null
      const eta = gap != null && pace > 0 ? Math.ceil(gap / pace) : null
      Object.assign(r, { checks: r.checks + 1, checked_at: now.toISOString(), errors: 0, error: null })
      r.last = { at: now.toISOString(), value: round(res.value), against: round(res.against), price: round(res.price ?? null), cond: res.holds ?? null, waiting: res.waiting ?? null, note: res.note ?? null, prox: gap != null ? { gap, pace, eta } : null }
      if (res.off) {
        Object.assign(r, { status: "stopped", stop_why: clip(res.off, 200) })
        events.push(`${r.id} off: ${r.stop_why}`)
        continue
      }
      if (!res.fire) continue
      r.fires = [...r.fires, { at: now.toISOString(), kind: "fire", price: round(res.price ?? null), value: round(res.value) }].slice(-10)
      r.fired_at = now.toISOString()
      if (!r.repeat) r.status = "fired"
      try {
        const text = await this.onFire(r, res, now)
        if (text) events.push(text)
      } catch (e) {
        events.push(`${r.id} fired; its action failed: ${e.message}`)
        r.error = clip(e.message, 300)
      }
    }
    return events
  }

  #failed(r, message, now) {
    r.errors = (r.errors ?? 0) + 1
    r.error = clip(message, 300)
    r.next_at = new Date(now.getTime() + Math.max(1, Number(r.every) || this.every) * 60000).toISOString()
    if (r.errors >= this.haltAfter) r.status = "error"
  }

  // One runner in one line: "spy-entry running · SPY price above 772.5 · now 771.4 · gap 1.1 ≈2 checks · check #14 10:41, next 10:42 → …"
  lineOf(r) {
    const l = r.last
    const p = l?.prox
    const state = r.status === "paused" ? `paused${r.paused_why ? ` (${r.paused_why})` : ""}` : r.status === "stopped" ? `stopped${r.stop_why ? ` (${r.stop_why})` : ""}` : r.status === "fired" ? `fired ${hm(r.fired_at)}` : r.status === "error" ? `error (${r.error})` : r.status
    const reading = l ? ` · now ${l.value ?? "—"}${l.against != null && l.against !== r.value ? ` vs ${l.against}` : ""}${p ? ` · gap ${p.gap}${p.eta != null ? ` ≈${p.eta} checks` : p.pace < 0 ? " moving away" : ""}` : ""}${l.waiting ? ` · waiting: ${l.waiting}` : ""}` : " · not read yet"
    const when = r.status === "running" ? ` · check #${r.checks}${r.checked_at ? ` ${hm(r.checked_at)}` : ""}, next ${hm(r.next_at)}` : r.checks ? ` · ${r.checks} checks` : ""
    return `${r.id} ${state} · ${this.describe(r)}${reading}${when}${r.fires.length ? ` · fired ×${r.fires.length}` : ""}${r.then ? ` → ${clip(r.then, 120)}` : ""}`
  }

  render() {
    const active = this.state.runners.filter((r) => ACTIVE.has(r.status))
    const done = this.state.runners.filter((r) => !ACTIVE.has(r.status)).slice(0, 4)
    if (!active.length && !done.length) return `# ${this.name} — none set (periodic checks, each with its own run state: ${this.name}.pause / .resume / .check)`
    return [
      `# ${this.name} — ${active.filter((r) => r.status === "running").length} running · ${active.filter((r) => r.status === "paused").length} paused (each checked on its own clock; ${this.name}.pause {id, reason} · .resume {id} · .check {id})`,
      ...active.slice(0, 12).map((r) => `- ${this.lineOf(r)}`),
      ...(done.length ? [`ended: ${done.map((r) => `${r.id} ${r.status}${r.fired_at ? ` ${hm(r.fired_at)}` : ""}`).join(" · ")}`] : []),
    ].join("\n")
  }

  brief() {
    const n = (s) => this.state.runners.filter((r) => r.status === s).length
    return `${n("running")} running · ${n("paused")} paused · ${n("fired")} fired${n("error") ? ` · ${n("error")} error` : ""}`
  }

  restore(data) {
    if (data && Array.isArray(data.runners)) this.state = { runners: data.runners.map((r) => (r.when ? r : { ...r, when: this.describe(r) })), revision: data.revision ?? 0 }
  }
}
