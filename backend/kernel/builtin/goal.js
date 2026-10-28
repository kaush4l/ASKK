import { Artifact } from "../artifact/artifact.js"
import { limitWait, usageLimit } from "../model/limits.js"
import { clip, oneLine } from "../util/text.js"

// Goal (2026-10-24 owner: "to target a long running goal, the desk will set a goal and will keep working towards the
// goal. For example for trade desk, the [model] can be on the goal and all actions with feedback is to gain towards the
// goal"): the desk's standing goal — what it works toward across runs, how progress is measured, and every run's
// feedback against it. Id `goal`, view and kind `goal`, keep `always`.
//
//   goal.set      {text, measure, target?, cadence_minutes?, why}  the standing goal (replaces the one before)
//   goal.progress {did, result, value?, toward, next, next_in_minutes?}
//                 every run of a holder while the goal is active ends with one: what this run did toward it, what came
//                 of it (the measure's value when there is one), closer | same | further | unrelated, and what the next
//                 run should do (and when, else the cadence)
//   goal.met      {evidence}   the target reached: the desk stops resuming
//   goal.pause    {reason}     no more runs on its own until the owner (or a holder) resumes it
//   goal.frame    {intent, done, route, why}  (2026-10-25 owner: "the lead should be able to translate every user request
//                 into a goal using sub agent and workflows based on the task complexity") every request a holder runs —
//                 but a resume of the standing goal, which is its own frame — is first framed as a goal: the outcome, what
//                 shows it done, and the route its complexity takes (ROUTES); a soft gate holds the answer until it is.
//                 The frame is rendered in every step (never compacted) and drawn on the dashboard's Goal card
//
// Keep working (the host, companion/team/kernel-team.js): while the goal is active, its keeper idle and `next_at` due,
// the host starts the keeper's run with resumeText() — the goal, the newest progress, what the last run said is next,
// the owner's feedback not yet acted on. takeDue(now) hands that run over once (next_at cleared until the run's
// progress, or its end, books the next). A run that ends without progress books the cadence; 3 runs in a row that end
// in an error pause it (the desk log and the view say why) — but never a model's usage limit (model/limits.js: a
// session limit, a 429): that is the model's, not the run's, so it books the next run after the limit resets instead.
//
// The owner (team/call {target: "artifact", method, args: [{id: "goal", …}]}): set {text, measure, target?,
// cadence_minutes?}, pause {reason?}, resume, drop, now (the next run due now), cadence {minutes}, feedback {text} — the
// owner's feedback recorded on the goal and handed to the keeper ({deliver, keeper}: guidance while it runs, else a run),
// request {text} (2026-10-27: the owner's feature request as one more open milestone, its id from the text),
// workflow {workflow | none}, note {kind, text, evidence?}, forget {note, why}, release {milestone} (a stuck claim).
//
// The goal-oriented runner (2026-10-24 owner: "the goal artifact will contain the elements for a long running process.
// Since the auto compaction happens to the conversation history, the goal can be live artifact … configurable
// workflows"): the artifact is rendered into every step's prompt and a compaction never folds it, so what a long process
// must not forget lives here, not in the conversation. Its elements, each from an experiment in running agents for days
// (docs/goal.md has the sources):
//   charter      text, measure, target, constraints (what the work must never break) — Anthropic's long-running harness:
//                a fixed spec every fresh session reads first
//   ledger       goal.note {kind: fact | guess | decision | dead_end, text, evidence?}, goal.forget {id, why} — Magentic-One's
//                task ledger (facts and guesses) and the C-compiler agents' "running doc of failed approaches": what was
//                learnt, decided and ruled out, kept across runs and compactions (≤ LEDGER, the oldest retired first)
//   milestones   goal.plan {items: "id: text | how it is checked" lines}, goal.claim {id}, goal.done {id, evidence} — the
//                harness's feature list (each passing or not) and the C compiler's current_tasks/ lock files: a claim says
//                who works on what, so parallel agents never take the same item; it is released when its holder's run
//                ends (Cursor's lesson: agents held locks too long, or died holding them)
//   stall        progress that is not "closer" STALL times in a row → the next resume is a REPLAN: re-read the ledger,
//                write down the dead ends, plan again before more work (Magentic-One's stall counter and re-plan, Cursor's
//                periodic fresh start against drift and tunnel vision)
//   workflow     goal.set {workflow} / owner `workflow {id}`: each resume runs that workflow (a desk's phases/<flow>.md,
//                kernel builtin/workflow.js) with the goal's vars — the default flow is plan → work → judge (Cursor's
//                planners, workers and judge) — and its last step's report becomes the run's progress when no step
//                recorded one; the owner edits the flow's file to change how the desk works toward the goal
//
// State {goal: {text, measure, target, constraints, why, by, at} | null, status: none | active | paused | met | dropped,
// reason, keeper, cadence_minutes, next_at, next, failures, stall, workflow, flow_run: {flow, at} | null, entries: [{id:
// e<n>, kind: progress | owner | event, at, by, did, result, value, toward, next, text, acted}] ≤ ENTRIES, ledger: [{id:
// l<n>, kind, text, evidence, by, at}] ≤ LEDGER, milestones: [{id, text, check, status: open | done | dropped, claim: {by,
// at} | null, evidence, by, at}] ≤ MILESTONES, frames: [{id: f<n>, agent, request, intent, done, route, why, at, status:
// working | answered | failed}] ≤ FRAMES, revision}.

const ENTRIES = 60
const LEDGER = 60
const MILESTONES = 30
const STALL = 3
const KINDS = ["fact", "guess", "decision", "dead_end"]
const ITEM_ID = /^[a-z0-9][a-z0-9-]{0,23}$/
const LINES = 6 // progress lines in the prompt
const CADENCE = { default: 60, min: 10, max: 7 * 24 * 60 }
// 2026-10-25 owner ("the critique … proposes updates. And this will go to the planner again"): a run's progress may book
// the next turn sooner than the cadence — a loop that goes straight on — but never sooner than a minute
const NEXT_MIN = 1
const TOWARD = ["closer", "same", "further", "unrelated"]
const FAILURES = 3
const TEXT = 1200
const FRAMES = 12
// The routes a request's complexity takes, least first (the lead's role says when each fits).
export const ROUTES = {
  direct: "yourself: a few reads answer it",
  helpers: "helpers in parallel: independent angles or many reads (agent.spawn + dispatch)",
  workflow: "a workflow you hold: a known multi-step flow (<flow>.run)",
  goal: "a standing goal: work over time toward a measure (goal.set, a workflow may resume it)",
  desk: "a desk: a standing job with its own memory or schedule (desk.ask one, or desk.create)",
}

const minutes = (v, fallback, min = CADENCE.min) => {
  if (v == null || v === "") return fallback
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`minutes: a number (${min}–${CADENCE.max})`)
  return Math.min(CADENCE.max, Math.max(min, Math.round(n)))
}
// A value as a number when it reads as one ("+4.2%", "1,250"), else its text.
const valueOf = (v) => {
  if (v == null || v === "") return null
  if (typeof v === "number") return v
  const n = Number(String(v).replace(/[,%$+\s]/g, ""))
  return Number.isFinite(n) && /\d/.test(String(v)) ? n : clip(oneLine(v), 80)
}
const hm = (iso) => String(iso ?? "").slice(5, 16).replace("T", " ")
const who = (ctx) => ctx?.agent?.name ?? "agent"
// A workflow's id (the artifact id the desk holds it under), or null for none.
const flowId = (v) => {
  const s = String(v ?? "").trim()
  if (!s || s === "none" || s === "null") return null
  if (!/^[a-z][a-z0-9._-]{0,39}$/i.test(s)) throw new Error("workflow: a workflow's id (the desk's phases/<flow>.md), or none")
  return s
}

export class Goal extends Artifact {
  static about = "the desk's standing goal: its measure, every run's progress, the ledger and milestones; the host resumes it on cadence"
  static commands = {
    frame: { description: "frame the request you run now as a goal, first: the outcome, what shows it done, and the route its complexity takes — the least that does it", input: { intent: "the request as an outcome, one line", done: "what shows it done, observable (a file, an answer with sources, a desk that answered)", route: Object.keys(ROUTES).join(" | "), why: "why that route is the least that does it" }, run(i, c) {
      const f = this.frame(i, who(c))
      return `framed ${f.id}: ${f.route} — ${clip(f.intent, 120)}`
    } },
    set: { description: "set the desk's standing goal — an outcome it keeps working toward across runs, with how progress is measured; only when the owner asks for a goal to pursue", input: { text: "the goal as an outcome", measure: "how progress is told: the number to move, or an observable sign", target: "the value or state that means it is met (optional)", cadence_minutes: `how often the desk resumes on its own (${CADENCE.min}–${CADENCE.max}, default ${CADENCE.default})`, constraints: "what the work must never break (optional)", workflow: "a workflow you hold that each resume runs (e.g. goal-cycle: plan → work → judge), or none (optional)", start_in_minutes: `when its first run starts (${NEXT_MIN}–${CADENCE.max}; optional, else the cadence)`, why: "the owner's words that set it" }, run(i, c) {
      const g = this.set(i, who(c))
      return `standing goal set: ${clip(g.text, 120)} — its first run starts ${hm(this.state.next_at)}, then the desk resumes it every ${this.state.cadence_minutes} min${this.state.workflow ? ` through the workflow ${this.state.workflow}` : ""}; end every run with ${this.name}.progress`
    } },
    note: { description: "keep one line in the goal's ledger — it outlives the conversation and every compaction: a fact (checked, with evidence), a guess (to check), a decision (taken, and why) or a dead_end (tried, failed, and why — so no later run tries it again)", input: { kind: KINDS.join(" | "), text: "the note, one line a fresh run can act on", evidence: "where it shows (required for a fact)" }, run(i, c) {
      const l = this.note(i, who(c))
      return `noted ${l.id} (${l.kind})`
    } },
    forget: { description: "retire a ledger note that turned out wrong or no longer holds", input: { id: "the note's id (l<n>)", why: "what showed it" }, run(i, c) { return `forgot ${this.forget(i, who(c)).id}` } },
    plan: { description: "write the goal's milestones — replaces the open ones (done ones stay): each a checkable item; parallel agents claim them", input: { items: '"id: what is true when it is done | how it is checked" — one per line' }, run(i, c) {
      const all = this.plan(i, who(c))
      return `plan: ${all.filter((m) => m.status === "open").length} open, ${all.filter((m) => m.status === "done").length} done`
    } },
    claim: { description: "take an open milestone before working on it — no other agent takes it while your run lasts (released when it ends)", input: { id: "the milestone's id" }, run(i, c) { return `claimed ${this.claim(i, who(c)).id} — ${this.name}.done it with evidence before your run ends` } },
    done: { description: "mark a milestone done, with what its check showed", input: { id: "the milestone's id", evidence: "its check and what it showed" }, run(i, c) { return `done ${this.done(i, who(c)).id}` } },
    progress: { description: "record what this run did toward the standing goal and what came of it — every run while the goal is active", input: { did: "what this run did toward it", result: "what came of it, with the measure's value when there is one", value: "the measure now (a number when it is one)", toward: TOWARD.join(" | "), next: "what the next run should do", next_in_minutes: `when the next run should start (${NEXT_MIN}–${CADENCE.max}; else the goal's cadence)` }, run(i, c) {
      const e = this.progress(i, who(c))
      return `progress ${e.id} recorded (${e.toward})${this.active ? ` — the next run starts ${hm(this.state.next_at)}` : ""}`
    } },
    met: { description: "the target is reached: the desk stops resuming the goal", input: { evidence: "the measure's value and where it shows" }, run(i, c) { return this.met(i, who(c)), "goal met: the desk stops resuming it" } },
    pause: { description: "stop resuming the goal on its own (a blocker only the owner can clear, a market closed)", input: { reason: "why" }, run(i, c) { return this.pause(clip(oneLine(i.reason), 300), who(c)), "goal paused" } },
  }
  static owner = {
    set(a, from) { return { goal: this.set(a, from) } },
    pause(a, from) { return this.pause(clip(oneLine(a.reason), 300), from), { status: this.state.status } },
    resume(a, from) { return this.resume(from), { status: this.state.status } },
    drop(a, from) {
      if (!this.state.goal) throw new Error("no goal to drop")
      this.#entry({ kind: "event", by: from, text: "dropped" })
      this.bump({ status: "dropped", reason: clip(oneLine(a.reason), 300) || null, next_at: null })
      return { status: "dropped" }
    },
    now() {
      if (!this.active) throw new Error(`the goal is ${this.state.status}`)
      this.bump({ next_at: this.clock().toISOString() })
      return { next_at: this.state.next_at }
    },
    cadence(a) {
      const cadence = minutes(a.minutes, null)
      if (cadence == null) throw new Error("minutes: how often the desk resumes")
      this.bump({ cadence_minutes: cadence, ...(this.active && this.state.next_at ? { next_at: this.#later(cadence) } : {}) })
      return { cadence_minutes: cadence }
    },
    feedback(a, from) {
      if (!this.state.goal) throw new Error("no goal set yet")
      const text = clip(String(a.text ?? "").trim(), TEXT)
      if (!text) throw new Error("text: your feedback")
      const e = this.#entry({ kind: "owner", by: from, text, acted: null })
      const deliver = `The owner's feedback on the standing goal ("${clip(this.state.goal.text, 200)}"): "${text}"\nAct on it toward the goal, then ${this.name}.progress.`
      return { entry: e.id, deliver, keeper: this.state.keeper }
    },
    // 2026-10-27 request-to-loop: the owner's feature request becomes one open milestone beside the others (never a
    // plan: no open item is replaced), its id from the text, -2, -3 … on a clash. 2026-10-27 request-mark: marked
    // requested, its check still null (to plan), so the planner and the owner tell it from a planned item
    request(a, from) {
      if (!this.state.goal) throw new Error("no goal set yet")
      const text = clip(oneLine(String(a.text ?? "")), 300)
      if (!text) throw new Error("text: the feature you want")
      const base = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "") || "request"
      const taken = new Set(this.state.milestones.map((x) => x.id))
      let id = base.slice(0, 24).replace(/-+$/, "")
      for (let n = 2; taken.has(id); n += 1) id = `${base.slice(0, 24 - `-${n}`.length).replace(/-+$/, "")}-${n}`
      const m = { id, text, check: null, requested: true, status: "open", claim: null, evidence: null, by: from, at: this.clock().toISOString() }
      this.#entry({ kind: "event", by: from, text: `requested ${id}: ${clip(text, 120)}` })
      this.bump({ milestones: [...this.state.milestones, m].slice(-MILESTONES) })
      return { milestone: id }
    },
    workflow(a, from) {
      const workflow = flowId(a.workflow)
      this.#entry({ kind: "event", by: from, text: workflow ? `resumes through the workflow ${workflow}` : "resumes as one run of its keeper" })
      this.bump({ workflow })
      return { workflow }
    },
    note(a, from) { return { note: this.note({ ...a, evidence: a.evidence || (a.kind === "fact" ? "the owner's word" : null) }, from) } },
    forget(a, from) { return { forgot: this.forget({ id: a.note, why: a.why }, from).id } },
    release(a, from) {
      const m = this.#item(a.milestone)
      if (!m.claim) throw new Error(`${m.id} is not claimed`)
      this.#entry({ kind: "event", by: from, text: `released ${m.id} (claimed by ${m.claim.by})` })
      this.bump({ milestones: this.state.milestones.map((x) => (x.id === m.id ? { ...x, claim: null } : x)) })
      return { released: m.id }
    },
  }
  static ownerCan = "set, pause, resume, drop, now, cadence, feedback, request, workflow, note, forget or release"

  constructor({ id = "goal", title, clock = () => new Date() } = {}) {
    super({ name: id, title: title ?? (id === "goal" ? "goal — what the desk works toward" : `${id} — goal`) })
    this.kind = "goal"
    this.view = "goal"
    this.keep = "always"
    this.clock = clock
    this.n = 0
    this.runs = new Map() // holder name -> {at, progressed} of its run in progress
    this.offs = new Map()
    this.ln = 0
    this.fn = 0
    this.state = { goal: null, status: "none", reason: null, keeper: null, cadence_minutes: CADENCE.default, next_at: null, next: null, failures: 0, stall: 0, workflow: null, flow_run: null, entries: [], ledger: [], milestones: [], frames: [], revision: 0 }
  }

  // ---- state ----


  #entry(e) {
    this.n += 1
    const entry = { id: `e${this.n}`, at: this.clock().toISOString(), ...e }
    this.bump({ entries: [...this.state.entries, entry].slice(-ENTRIES) })
    return entry
  }

  // A run that ended on a model's usage limit: no failure counted, the next run after the limit resets.
  #limited(error, by) {
    const now = this.clock()
    const limit = usageLimit(error, now)
    if (!limit) return false
    const wait = limitWait(limit, now)
    const next_at = this.#later(wait)
    const last = this.state.entries.at(-1)
    if (!(last?.kind === "event" && last.text?.startsWith("model limit"))) this.#entry({ kind: "event", by, text: `model limit (not counted as a failure): ${clip(limit.text, 140)} — the next run at ${next_at}` })
    this.bump({ next_at: this.state.next_at && this.state.next_at > next_at ? this.state.next_at : next_at })
    return true
  }

  #later(min) {
    return new Date(this.clock().getTime() + min * 60000).toISOString()
  }

  // The next resume sooner (another artifact's word, e.g. dev after a restart: the loop starts again from what came of
  // it) — never later than it is booked, at least NEXT_MIN.
  soon(min = NEXT_MIN) {
    if (!this.active) return null
    const at = this.#later(Math.max(NEXT_MIN, Number(min) || NEXT_MIN))
    if (!this.state.next_at || at < this.state.next_at) this.bump({ next_at: at })
    return this.state.next_at
  }

  get active() {
    return this.state.status === "active" && !!this.state.goal
  }

  snapshot() {
    const { revision, ...rest } = this.state
    return { ...rest, n: this.n, ln: this.ln, fn: this.fn }
  }

  restore(data) {
    if (!data || typeof data !== "object") return
    const entries = Array.isArray(data.entries) ? data.entries.slice(-ENTRIES) : []
    const ledger = Array.isArray(data.ledger) ? data.ledger.slice(-LEDGER) : []
    // a claim never outlives the process that made it (its run is gone)
    const milestones = Array.isArray(data.milestones) ? data.milestones.slice(0, MILESTONES).map((m) => ({ ...m, claim: null })) : []
    // a frame still working when the process went is no run any more
    const frames = Array.isArray(data.frames) ? data.frames.slice(-FRAMES).map((f) => (f.status === "working" ? { ...f, status: "interrupted" } : f)) : []
    const { n, ln, fn, ...rest } = data
    const top = (saved, list) => Math.max(Number(saved) || 0, 0, ...list.map((e) => Number(String(e.id).slice(1)) || 0))
    this.n = top(n, entries)
    this.ln = top(ln, ledger)
    this.fn = top(fn, frames)
    this.state = { ...this.state, ...rest, entries, ledger, milestones, frames, flow_run: null, revision: 0 }
  }

  // ---- a holder's runs ----

  // a resume of the standing goal (from "goal") is framed by the goal itself
  onRunStart(agent, request) {
    if (agent?.name) this.runs.set(agent.name, { at: this.clock().toISOString(), progressed: false, request: request?.text ?? "", frame: request?.from === "goal" ? "goal" : null })
  }

  // A holder's run ends: one that recorded no progress books the cadence; an error counts toward the pause.
  attach(agent) {
    if (!agent?.name || typeof agent.on !== "function") return
    this.offs.get(agent.name)?.()
    const ended = (error) => (event) => {
      const run = this.runs.get(agent.name)
      this.runs.delete(agent.name)
      this.#release(agent.name)
      if (run?.frame && run.frame !== "goal") this.bump({ frames: this.state.frames.map((f) => (f.id === run.frame ? { ...f, status: error ? "failed" : "answered" } : f)) })
      if (!this.active || !run || agent.config?.managed) return // a workflow's step agent: the flow's end books the next run
      if (error && this.#limited(event?.error, agent.name)) return
      const failures = error ? this.state.failures + 1 : 0
      if (failures >= FAILURES) {
        this.#entry({ kind: "event", by: agent.name, text: `paused: ${failures} runs in a row ended in an error` })
        return this.bump({ status: "paused", reason: `${failures} runs in a row ended in an error`, failures, next_at: null })
      }
      if (!run.progressed || error) this.bump({ failures, next_at: this.state.next_at ?? this.#later(this.state.cadence_minutes) })
    }
    const offs = [agent.on("answer", ended(false)), agent.on("error", ended(true))]
    this.offs.set(agent.name, () => offs.forEach((off) => typeof off === "function" && off()))
  }

  detach(agent) {
    this.offs.get(agent?.name)?.()
    this.offs.delete(agent?.name)
    this.runs.delete(agent?.name)
    this.#release(agent?.name)
  }

  // Every claim an agent holds goes when its run ends (done or not): the item is open for the next one to take.
  #release(name) {
    if (!name || !this.state.milestones.some((m) => m.claim?.by === name)) return
    this.bump({ milestones: this.state.milestones.map((m) => (m.claim?.by === name ? { ...m, claim: null } : m)) })
  }

  set(input = {}, by = "owner") {
    const text = oneLine(input.text ?? input.goal)
    if (!text) throw new Error("text: the goal, as an outcome the desk works toward")
    if (text.length > TEXT) throw new Error(`text: at most ${TEXT} chars`)
    const measure = oneLine(input.measure)
    if (!measure) throw new Error("measure: how progress is told — a number to move (account value, pages written, tests passing) or an observable sign")
    const cadence = minutes(input.cadence_minutes, this.state.cadence_minutes)
    const start = minutes(input.start_in_minutes, cadence, NEXT_MIN)
    const goal = { text, measure: clip(measure, 300), target: clip(oneLine(input.target), 200) || null, constraints: clip(oneLine(input.constraints), 600) || null, why: clip(oneLine(input.why), 300) || null, by, at: this.clock().toISOString() }
    // the keeper: the agent that set it; the owner's goal keeps the one before (else the host's lead)
    const keeper = by === "owner" ? (input.keeper ?? this.state.keeper ?? null) : by
    const workflow = input.workflow === undefined ? this.state.workflow : flowId(input.workflow)
    this.#entry({ kind: "event", by, text: `goal set: ${clip(text, 200)}${workflow ? ` (resumed by the workflow ${workflow})` : ""}` })
    // a new goal starts a fresh ledger and plan; the same goal re-set (its measure, target, cadence changed) keeps them
    const fresh = this.state.goal?.text !== text ? { ledger: [], milestones: [] } : {}
    this.bump({ goal, status: "active", reason: null, keeper, cadence_minutes: cadence, next_at: this.#later(start), next: null, failures: 0, stall: 0, workflow, ...fresh })
    return goal
  }

  // ---- every request framed as a goal ----

  frame(input = {}, by) {
    const run = this.runs.get(by)
    if (!run) throw new Error("frame the request of a run in progress")
    const intent = clip(oneLine(input.intent), 400)
    const done = clip(oneLine(input.done), 400)
    if (!intent || !done) throw new Error("intent and done: the request as an outcome, and what shows it done")
    const route = String(input.route ?? "").trim().toLowerCase()
    if (!ROUTES[route]) throw new Error(`route: ${Object.entries(ROUTES).map(([k, v]) => `${k} (${v})`).join(" | ")}`)
    const why = clip(oneLine(input.why), 300) || null
    const id = run.frame && run.frame !== "goal" ? run.frame : `f${++this.fn}`
    const f = { id, agent: by, request: clip(oneLine(run.request), 300), intent, done, route, why, at: this.clock().toISOString(), status: "working" }
    run.frame = id
    this.bump({ frames: [...this.state.frames.filter((x) => x.id !== id), f].slice(-FRAMES) })
    return f
  }

  // ---- the ledger: what the work learnt, decided and ruled out ----

  note(input = {}, by) {
    if (!this.state.goal) throw new Error(`no goal set: ${this.name}.set it first`)
    const kind = String(input.kind ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_")
    if (!KINDS.includes(kind)) throw new Error(`kind: ${KINDS.join(" | ")} — fact (checked), guess (to check), decision (taken, with why), dead_end (tried, did not work, and why)`)
    const text = clip(oneLine(input.text), 400)
    if (!text) throw new Error("text: the note, one line that a fresh run can act on")
    if (this.state.ledger.some((l) => l.text === text)) throw new Error("that note is already in the ledger")
    if (kind === "fact" && !oneLine(input.evidence)) throw new Error("evidence: where the fact shows (a file, a URL, a number read) — else note it as a guess")
    this.ln += 1
    const l = { id: `l${this.ln}`, kind, text, evidence: clip(oneLine(input.evidence), 300) || null, by, at: this.clock().toISOString() }
    this.bump({ ledger: [...this.state.ledger, l].slice(-LEDGER) })
    return l
  }

  forget(input = {}, by) {
    const id = String(input.id ?? "").trim()
    const l = this.state.ledger.find((x) => x.id === id)
    if (!l) throw new Error(`no note ${id || "(id)"} — the ledger has ${this.state.ledger.map((x) => x.id).join(", ") || "none"}`)
    const why = clip(oneLine(input.why), 300)
    if (!why) throw new Error("why: what showed it wrong or no longer true")
    this.#entry({ kind: "event", by, text: `forgot ${l.kind} ${id} ("${clip(l.text, 120)}"): ${why}` })
    this.bump({ ledger: this.state.ledger.filter((x) => x.id !== id) })
    return l
  }

  // ---- milestones: the plan, who works on what ----

  // "id: text | how it is checked" lines: replaces the open items (a done or dropped one stays listed; an open one left out
  // is dropped); a claimed item keeps its claim.
  plan(input = {}, by) {
    if (!this.state.goal) throw new Error(`no goal set: ${this.name}.set it first`)
    // the reply format reads "id: text" lines as {id: text} maps, and a model may write "\n" literally: all are lines
    const flat = (v) => (v == null ? [] : Array.isArray(v) ? v.flatMap(flat) : typeof v === "object" ? Object.entries(v).map(([k, x]) => `${k}: ${x}`) : String(v).split(/\r?\n|\\n/))
    const lines = flat(input.items).map((x) => String(x).trim().replace(/^[-*]\s*/, "")).filter(Boolean)
    if (!lines.length) throw new Error('items: one per line, "id: what is done when it is done | how it is checked"')
    const items = []
    for (const line of lines) {
      const m = line.match(/^([^:]{1,24}):\s*(.+)$/)
      if (!m || !ITEM_ID.test(m[1].trim().toLowerCase())) throw new Error(`"${clip(line, 80)}": "id: text | how it is checked" (id lowercase, a-z 0-9 -)`)
      const [text, check] = m[2].split("|").map((x) => oneLine(x))
      items.push({ id: m[1].trim().toLowerCase(), text: clip(text, 300), check: clip(check, 200) || null })
    }
    const ids = items.map((x) => x.id)
    if (new Set(ids).size !== ids.length) throw new Error("items: each id once")
    const old = new Map(this.state.milestones.map((x) => [x.id, x]))
    const kept = this.state.milestones.filter((x) => x.status !== "open" && !ids.includes(x.id))
    const at = this.clock().toISOString()
    const next = items.map((x) => {
      const was = old.get(x.id)
      if (was && was.status !== "open") return was // a done item is not reopened by a plan
      return { ...x, status: "open", claim: was?.claim ?? null, evidence: null, by, at }
    })
    const dropped = this.state.milestones.filter((x) => x.status === "open" && !ids.includes(x.id))
    const all = [...kept, ...next, ...dropped.map((x) => ({ ...x, status: "dropped", claim: null }))].slice(-MILESTONES)
    this.#entry({ kind: "event", by, text: `plan: ${items.length} item(s)${dropped.length ? `, dropped ${dropped.map((x) => x.id).join(", ")}` : ""}` })
    this.bump({ milestones: all, stall: 0 })
    return all
  }

  claim(input = {}, by) {
    const m = this.#item(input.id)
    if (m.status !== "open") throw new Error(`${m.id} is ${m.status}`)
    if (m.claim && m.claim.by !== by) throw new Error(`${m.id} is claimed by ${m.claim.by} since ${hm(m.claim.at)} — take another open item (${this.#open(by) || "none open"})`)
    this.bump({ milestones: this.state.milestones.map((x) => (x.id === m.id ? { ...x, claim: { by, at: this.clock().toISOString() } } : x)) })
    return m
  }

  done(input = {}, by) {
    const m = this.#item(input.id)
    if (m.status !== "open") throw new Error(`${m.id} is ${m.status}`)
    if (m.claim && m.claim.by !== by) throw new Error(`${m.id} is claimed by ${m.claim.by}: only it marks it done`)
    const evidence = clip(oneLine(input.evidence), 400)
    if (!evidence) throw new Error(`evidence: ${m.check ? `its check (${m.check}) and what it showed` : "what shows it is done"}`)
    this.#entry({ kind: "event", by, text: `done ${m.id}: ${clip(evidence, 200)}` })
    this.bump({ milestones: this.state.milestones.map((x) => (x.id === m.id ? { ...x, status: "done", claim: null, evidence, by, at: this.clock().toISOString() } : x)) })
    return m
  }

  #item(id) {
    const key = String(id ?? "").trim().toLowerCase()
    const m = this.state.milestones.find((x) => x.id === key)
    if (!m) throw new Error(`no item ${key || "(id)"} — ${this.state.milestones.length ? `the plan has ${this.state.milestones.map((x) => x.id).join(", ")}` : `no plan yet: ${this.name}.plan first`}`)
    return m
  }

  #open(by) {
    return this.state.milestones.filter((x) => x.status === "open" && (!x.claim || x.claim.by === by)).map((x) => x.id).join(", ")
  }

  progress(input = {}, by) {
    if (!this.state.goal) throw new Error(`no goal set: ${this.name}.set it first (only when the owner asks for a standing goal)`)
    const did = clip(oneLine(input.did), 600)
    const result = clip(oneLine(input.result), 600)
    if (!did || !result) throw new Error("did and result: what this run did toward the goal, and what came of it (the measure's value when there is one)")
    const toward = String(input.toward ?? "").trim().toLowerCase()
    if (!TOWARD.includes(toward)) throw new Error(`toward: ${TOWARD.join(" | ")} — the measure against the last progress`)
    const next = clip(oneLine(input.next), 400)
    if (!next && this.active) throw new Error("next: what the next run should do toward the goal")
    const wait = minutes(input.next_in_minutes, this.state.cadence_minutes, NEXT_MIN)
    const value = valueOf(input.value)
    // the owner's feedback this run had in front of it is acted on now
    this.state = { ...this.state, entries: this.state.entries.map((e) => (e.kind === "owner" && !e.acted ? { ...e, acted: by } : e)) }
    const run = this.runs.get(by)
    if (run) run.progressed = true
    const e = this.#entry({ kind: "progress", by, did, result, toward, next: next || null, ...(value != null ? { value } : {}) })
    const stall = toward === "closer" ? 0 : this.state.stall + 1
    if (stall === STALL) this.#entry({ kind: "event", by, text: `stalled: ${stall} runs in a row not closer — the next run replans first` })
    if (this.state.flow_run) this.state.flow_run = { ...this.state.flow_run, progressed: true }
    this.bump({ next: next || null, next_at: this.active ? this.#later(wait) : null, failures: 0, stall })
    return e
  }

  get stalled() {
    return this.state.stall >= STALL
  }

  met(input = {}, by) {
    if (!this.active) throw new Error(`the goal is ${this.state.status}`)
    const evidence = clip(oneLine(input.evidence), 600)
    if (!evidence) throw new Error("evidence: the measure's value and where it shows")
    this.#entry({ kind: "event", by, text: `met: ${evidence}` })
    this.bump({ status: "met", reason: evidence, next_at: null })
  }

  pause(reason, by) {
    if (this.state.status !== "active") throw new Error(`the goal is ${this.state.status}`)
    this.#entry({ kind: "event", by, text: `paused${reason ? `: ${reason}` : ""}` })
    this.bump({ status: "paused", reason: reason || null, next_at: null })
  }

  resume(by) {
    if (!this.state.goal || !["paused", "met"].includes(this.state.status)) throw new Error(`nothing to resume (the goal is ${this.state.status})`)
    this.#entry({ kind: "event", by, text: "resumed" })
    this.bump({ status: "active", reason: null, failures: 0, next_at: this.clock().toISOString() })
  }

  // ---- the host ----

  // The run due now (once): {keeper, text}, else null. busy(name): that agent works now (then it waits for the next tick).
  takeDue(now = this.clock(), busy = () => false) {
    if (!this.active || !this.state.next_at || new Date(this.state.next_at).getTime() > now.getTime()) return null
    if (busy(this.state.keeper) || this.state.flow_run) return null
    this.bump({ next_at: null })
    return { keeper: this.state.keeper, text: this.resumeText(), workflow: this.state.workflow, vars: this.vars() }
  }

  resumeText() {
    const g = this.state.goal
    const last = this.state.entries.filter((e) => e.kind === "progress").at(-1)
    const owner = this.state.entries.filter((e) => e.kind === "owner" && !e.acted)
    return [
      `Keep working toward the desk's standing goal: ${g.text}`,
      `Measure: ${g.measure}${g.target ? ` · target: ${g.target}` : ""}.`,
      g.constraints ? `Never break: ${g.constraints}` : "",
      this.stalled ? `REPLAN FIRST: the last ${this.state.stall} runs did not move the measure closer. Re-read the ledger, ${this.name}.note each dead_end with why it failed, then ${this.name}.plan a different approach before any more work of the same kind.` : "",
      last ? `Last progress (${hm(last.at)}, ${last.toward}): ${last.did} → ${last.result}${last.value != null ? ` (value ${last.value})` : ""}.` : "No progress recorded yet: start with the step that tells where the measure stands now.",
      this.state.next ? `Next, as the last run said: ${this.state.next}` : "",
      owner.length ? `The owner's feedback to act on: ${owner.map((e) => `"${clip(e.text, 300)}"`).join("; ")}` : "",
      `Do the next step that moves the measure, then ${this.name}.progress {did, result, value, toward, next}; ${this.name}.met when the target is reached.`,
    ]
      .filter(Boolean)
      .join("\n")
  }

  // The goal as a workflow's run variables (a flow declares the ones it reads under vars:, kernel builtin/workflow.js).
  vars() {
    const g = this.state.goal
    if (!g) return {}
    const last = this.state.entries.filter((e) => e.kind === "progress").at(-1)
    const owner = this.state.entries.filter((e) => e.kind === "owner" && !e.acted)
    return {
      goal: g.text,
      measure: g.measure,
      target: g.target ?? "none set",
      constraints: g.constraints ?? "none set",
      ledger: this.ledgerLines().join("\n") || "empty: nothing learnt yet",
      milestones: this.milestoneLines().join("\n") || "no plan yet",
      last: last ? `${hm(last.at)} ${last.toward}${last.value != null ? ` (value ${last.value})` : ""}: ${last.did} → ${last.result}` : "no progress yet",
      next: this.state.next ?? "find where the measure stands now",
      feedback: owner.map((e) => clip(e.text, 300)).join("; ") || "none",
      mode: this.stalled ? `replan: ${this.state.stall} runs in a row did not move the measure closer — plan a different approach` : "continue",
    }
  }

  ledgerLines(limit = LEDGER) {
    const order = { decision: 0, fact: 1, dead_end: 2, guess: 3 }
    return [...this.state.ledger]
      .sort((a, b) => order[a.kind] - order[b.kind])
      .slice(0, limit)
      .map((l) => `${l.id} ${l.kind.replace("_", " ").toUpperCase()}: ${l.text}${l.evidence ? ` (${clip(l.evidence, 120)})` : ""}`)
  }

  // 2026-10-27 request-mark: an owner's request with no check yet reads "check: to plan · requested by owner", so the
  // planner writes its check and tells it from a planned item.
  milestoneLines() {
    return this.state.milestones.filter((m) => m.status !== "dropped").map((m) => `[${m.status === "done" ? "x" : m.claim ? "~" : " "}] ${m.id}: ${m.text}${m.check ? ` | check: ${m.check}` : m.requested ? " | check: to plan · requested by owner" : ""}${m.claim ? ` (claimed by ${m.claim.by})` : ""}${m.status === "done" ? ` — ${clip(m.evidence, 120)}` : ""}`)
  }

  // ---- a resume through the goal's workflow (the host runs it) ----

  flowStarted(flow) {
    this.#entry({ kind: "event", by: flow, text: `resumed through the workflow ${flow}` })
    this.bump({ flow_run: { flow, at: this.clock().toISOString(), progressed: false } })
  }

  // The flow ended: its last step's report ({toward, value, did, result, next}) is the progress when no step recorded one;
  // a failed flow counts toward the pause; either way the next run is booked.
  flowEnded({ ok = true, report = null, error = null } = {}) {
    const run = this.state.flow_run
    if (!run) return null
    this.state.flow_run = null
    if (!this.active) return this.bump({}), null
    if (ok && !run.progressed && report && TOWARD.includes(String(report.toward ?? "").trim().toLowerCase())) {
      try {
        return this.progress({ did: report.did || `the ${run.flow} workflow`, result: report.result || report.verdict || "see the workflow's report", value: report.value, toward: report.toward, next: report.next || "run the workflow again", next_in_minutes: report.next_in_minutes }, `${run.flow}`)
      } catch (e) {
        this.#entry({ kind: "event", by: run.flow, text: `its report was no progress: ${clip(e.message, 200)}` })
      }
    }
    if (!ok && this.#limited(error, run.flow)) return null
    const failures = ok ? 0 : this.state.failures + 1
    if (!ok) this.#entry({ kind: "event", by: run.flow, text: `the workflow failed: ${clip(error ?? "no reason", 200)}` })
    if (failures >= FAILURES) {
      this.#entry({ kind: "event", by: run.flow, text: `paused: ${failures} runs in a row ended in an error` })
      return this.bump({ status: "paused", reason: `${failures} runs in a row ended in an error`, failures, next_at: null }), null
    }
    this.bump({ failures, next_at: this.state.next_at ?? this.#later(this.state.cadence_minutes) })
    return null
  }

  // ---- the kernel ----

  // A holder's run answers once its request is framed and, while the goal is active, once it said what it did toward it
  // (soft: gateRetries let it go). Only a holder that holds the command, and never a workflow's step agent (the flow's end
  // records it from its report).
  gate(agent) {
    const run = this.runs.get(agent?.name)
    if (!run || agent?.config?.managed) return null
    const has = (command) => !agent?.tools || agent.tools.has(`${this.name}.${command}`)
    const reasons = [
      !run.frame && has("frame") ? `frame this request as a goal first: ${this.name}.frame {intent, done, route: ${Object.keys(ROUTES).join(" | ")}, why}` : "",
      this.active && has("progress") && !run.progressed ? `the standing goal is active: before you answer, ${this.name}.progress {did, result, value, toward, next} — what this run did toward "${clip(this.state.goal.text, 120)}" (toward: unrelated when it did nothing for it)` : "",
    ].filter(Boolean)
    return reasons.length ? reasons.join("; ") : null
  }

  brief() {
    const g = this.state.goal
    const f = this.state.frames.at(-1)
    if (!g) return f ? `${f.route} · ${clip(f.intent, 70)} · ${f.status}` : "no standing goal"
    const last = this.state.entries.filter((e) => e.kind === "progress").at(-1)
    const ms = this.state.milestones.filter((m) => m.status !== "dropped")
    return `${this.state.status}${this.stalled ? " (stalled)" : ""} · ${clip(g.text, 60)}${ms.length ? ` · ${ms.filter((m) => m.status === "done").length}/${ms.length} milestones` : ""}${last ? ` · last ${last.toward}${last.value != null ? ` ${last.value}` : ""}` : ""}`
  }

  render(agent) {
    return [this.#frameLines(agent), this.#standingLines(agent)].filter(Boolean).join("\n")
  }

  // This run's request as a goal: framed (its line, kept in every step), or the ask to frame it.
  #frameLines(agent) {
    const run = this.runs.get(agent?.name)
    if (!run || run.frame === "goal" || agent?.config?.managed) return ""
    const f = this.state.frames.find((x) => x.id === run.frame)
    if (f) return `THIS REQUEST AS A GOAL (${f.id}, route ${f.route}): ${f.intent}\ndone when: ${f.done}`
    if (!this.can(agent).includes(`${this.name}.frame`)) return ""
    return `THIS REQUEST AS A GOAL: not framed yet — first ${this.name}.frame {intent, done, route, why}; routes, least first:\n${Object.entries(ROUTES).map(([k, v]) => `  ${k}: ${v}`).join("\n")}`
  }

  #standingLines(agent) {
    const g = this.state.goal
    const can = this.can(agent)
    if (!g) return `the desk's standing goal: none set${can.includes(`${this.name}.set`) ? ` — ${this.name}.set one only when the owner asks for a goal to pursue over time` : ""}`
    const progress = this.state.entries.filter((e) => e.kind === "progress")
    const values = progress.filter((e) => typeof e.value === "number")
    const trend = values.length > 1 ? ` · from ${values[0].value} to ${values.at(-1).value} over ${values.length} runs` : values.length ? ` · now ${values[0].value}` : ""
    const owner = this.state.entries.filter((e) => e.kind === "owner" && !e.acted)
    const out = [
      `STANDING GOAL (${this.state.status}${this.state.reason ? `: ${this.state.reason}` : ""}; set by ${g.by} ${hm(g.at)}): ${g.text}`,
      `measure: ${g.measure}${g.target ? ` · target: ${g.target}` : ""}${trend}`,
      g.constraints ? `never break: ${g.constraints}` : "",
      this.stalled ? `STALLED: ${this.state.stall} runs in a row not closer — replan before more of the same: note the dead ends, ${this.name}.plan a different approach` : "",
      ...progress.slice(-LINES).map((e) => `  ${hm(e.at)} ${e.by} [${e.toward}${e.value != null ? ` ${e.value}` : ""}] ${clip(e.did, 160)} → ${clip(e.result, 200)}`),
      ...owner.map((e) => `  OWNER FEEDBACK ${hm(e.at)}: ${clip(e.text, 400)}`),
      ...(this.state.milestones.some((m) => m.status !== "dropped") ? ["milestones ([x] done, [~] claimed — claim an open one before you work on it):", ...this.milestoneLines().map((l) => `  ${l}`)] : []),
      ...(this.state.ledger.length ? ["ledger (kept across runs and compactions):", ...this.ledgerLines(24).map((l) => `  ${l}`), ...(this.state.ledger.length > 24 ? [`  … ${this.state.ledger.length - 24} more notes`] : [])] : []),
      this.state.next ? `next: ${this.state.next}` : "",
      this.state.workflow ? `resumed through the workflow ${this.state.workflow}${this.state.flow_run ? ` (running since ${hm(this.state.flow_run.at)})` : ""}` : "",
      this.active ? `every run: work toward it, then ${this.name}.progress {did, result, value, toward, next} (${this.name}.met when the target is reached) — the desk resumes it ${this.state.next_at ? `at ${hm(this.state.next_at)}` : `every ${this.state.cadence_minutes} min`}` : "",
      this.active && can.includes(`${this.name}.note`) ? `this block is live and never compacted: ${this.name}.note what a later run must not relearn (facts, decisions, dead ends)` : "",
    ]
    return out.filter(Boolean).join("\n")
  }
}
