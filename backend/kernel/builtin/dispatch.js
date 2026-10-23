import { Artifact } from "../artifact/artifact.js"
import { QUEST_INPUT, questText, Tool } from "../tool/tool.js"

// Dispatch: work that runs while its dispatcher keeps working (2026-10-17 owner: "let more teams work in parallel and
// in various levels and stages of the building"). A quest blocks the caller's step until its report comes back;
// dispatch.start hands the same brief to an agent the holder can quest and returns at once — the target's run goes on
// beside the holder's steps (one run at a time per agent: a busy target queues it), and its report waits in the
// holder's prompt until dispatch.wait or dispatch.read delivers it. One instance per desk (id "dispatch"); each
// holder sees and drives its own jobs, the twin shows every job.
//
//   dispatch.start {to, requirement, ask, outcome}  to: one of the holder's agents (its quest tool; a team prefix is
//                                     fine); the brief as a quest's (refused without the three); ≤ 6 running per holder
//   dispatch.wait  {ids?, seconds?}   until one of them ends (default: every running job of the holder), seconds pass
//                                     (default 300, 5..1800), owner guidance arrives for the holder, or its run stops
//   dispatch.read  {id}               the whole report (≤ 20000 chars) or the error
//   dispatch.stop  {id}               aborts the job: the target's run stops at its next step boundary, its own quests
//                                     get the signal (only the holder that started it; the owner through stop(id))
//   dispatch.list                     the holder's jobs, one line each
//
// A holder's run that is stopped (its signal aborts) stops the jobs it started. gate(agent) refuses the holder's answer
// while any of its jobs runs — a hard reason ({reason, hard: true}: Agent never lets it through after gateRetries).
// 2026-10-17 (critic: a lead answered past two refusals, or ran out of steps, and its stations kept working beyond its
// stop): no job outlives the holder's run — when that run ends for any reason (an answer, flagged or at maxSteps, an
// error, a stop) the jobs it left running stop with "<holder>'s run ended while it ran" (attach listens to the holder's
// answer and error; detach drops the listeners). The owner stops one job: ownerCall("stop", [{id, job}]) (the host's
// team/call target artifact). A report shown in a wait or read result is delivered: the prompt drops it, a later wait
// does not show it again. Commands are type dev (never answered from the run's data cache).
// Twin state: {jobs: [{id, to, by, ask ≤ 300, status: running | done | failed | stopped, startedAt, endedAt,
//   report ≤ 4000, error}] ≤ 40, newest first}; changed() on each transition only (a job starts, a job ends).
// Prompt (the holder's own jobs only): the running ones with their target's state, the finished reports not yet
// delivered (head 600 chars), at most 12 lines of finished ones.

const RUNNING_MAX = 6 // running jobs per holder
const JOBS_MAX = 40 // in the twin
const KEPT_MAX = 200 // jobs kept in memory (the oldest finished go first)
const WAIT_DEFAULT = 300
const WAIT_MIN = 5
const WAIT_MAX = 1800
const REPORT_WAIT = 3000 // a report in a wait result
const REPORT_READ = 20000 // in a read result
const REPORT_TWIN = 4000
const REPORT_PROMPT = 600
const ASK_TWIN = 300
const ASK_PROMPT = 120
const FINISHED_LINES = 12 // finished jobs in the prompt

const list = (v) => (v == null || v === "" ? [] : Array.isArray(v) ? v : String(v).split(/[,\s]+/)).map((x) => String(x).trim()).filter(Boolean)
const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n)}…` : String(s))
const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim()
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
// 12m04s (a job that ended), 12m (one that runs)
const took = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`
}
const since = (ms) => {
  const m = Math.floor(Math.max(0, ms) / 60_000)
  return m < 1 ? `${Math.max(0, Math.round(ms / 1000))}s` : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`
}
// The ASK part of a quest's text (questText: "REQUIREMENT: …\nASK: …\nOUTCOME: …").
const askOf = (text) => {
  const a = text.indexOf("\nASK: ")
  const o = text.lastIndexOf("\nOUTCOME: ")
  return a < 0 ? text : text.slice(a + 6, o > a ? o : undefined)
}

export class Dispatch extends Artifact {
  // secondMs: how long a wait's second lasts (tests shorten it); clock: the timestamps and the elapsed times.
  constructor({ id = "dispatch", title, clock = () => new Date(), secondMs = 1000 } = {}) {
    super({ name: id, title: title ?? (id === "dispatch" ? "dispatch — work that runs while you work" : `${id} — dispatch`) })
    this.kind = "dispatch"
    this.view = "dispatch"
    this.keep = "file" // a job is a run in this process: never restored
    this.clock = clock
    this.secondMs = secondMs
    this.state = { jobs: [] }
    this.jobs = new Map() // id -> job (oldest first)
    this.n = 0
    this.holders = new Map() // holder name -> drops its run-end listeners (attach / detach)
  }

  // ---- jobs ----

  #now() {
    return this.clock().getTime()
  }

  #own(name) {
    return [...this.jobs.values()].filter((j) => j.by === name)
  }

  // The twin's jobs, newest first; changed() when they differ (a job started or ended).
  #publish() {
    // began: the target took it (else it waits behind the target's current run); delivered: its report was read by its
    // starter (2026-10-23 audit: the prompt knew both, the twin did not)
    const twin = (j) => ({ id: j.id, to: j.to, by: j.by, ask: clip(j.ask, ASK_TWIN), status: j.status, startedAt: j.startedAt, endedAt: j.endedAt, report: j.report == null ? null : clip(j.report, REPORT_TWIN), error: j.error, began: !!j.began, delivered: !!j.delivered })
    const next = { jobs: [...this.jobs.values()].reverse().slice(0, JOBS_MAX).map(twin) }
    if (JSON.stringify(next) === JSON.stringify(this.state)) return
    this.state = next
    this.changed()
  }

  // A job ends once (the first of: its report, its error, a stop). Everything that tied it to the holder and the
  // target is released; whoever waits on it wakes.
  #end(job, status, { report = null, error = null } = {}) {
    if (job.status !== "running") return false
    Object.assign(job, { status, report: report == null ? null : String(report), error: error == null ? null : String(error), endedAt: this.clock().toISOString(), t1: this.#now() })
    for (const off of job.offs.splice(0)) off()
    job.settle()
    const finished = [...this.jobs.values()].filter((j) => j.status !== "running")
    for (const old of finished.slice(0, Math.max(0, this.jobs.size - KEPT_MAX))) this.jobs.delete(old.id)
    this.#publish()
    return true
  }

  #halt(job, why) {
    if (job.status !== "running") return false
    job.controller.abort(new Error("stopped"))
    return this.#end(job, "stopped", { error: why })
  }

  // The owner (through the host: by null) or the holder that started it stops a running job. → true when it stopped.
  stop(id, by = null) {
    const job = this.jobs.get(String(id ?? "").trim())
    if (!job) throw new Error(`no job ${id}`)
    if (by != null && job.by !== by) throw new Error(`${job.id} was started by ${job.by}: only ${job.by} (or the owner) stops it`)
    return this.#halt(job, by == null ? "stopped by the owner" : `stopped by ${by}`)
  }

  // The owner acts on the twin (the host's team/call {target: "artifact", method, args: [{id, job}]}): "stop" stops that
  // one job (its error names the owner) → {stopped: job}. 2026-10-17 (critic): stopping the target agent was the only
  // way, and it ended every other run queued on it. An unknown method, job, or one not running → throws.
  ownerCall(method, args = [], _from = "owner") {
    if (method !== "stop") throw new Error(`${this.name}: the owner can stop a job (not ${method})`)
    const id = String(args[0]?.job ?? "").trim()
    if (!id) throw new Error("job: the job to stop (j3)")
    const job = this.jobs.get(id)
    if (!job) throw new Error(`no job ${id}`)
    if (job.status !== "running") throw new Error(`${id} is not running (${job.status})`)
    this.stop(id, null)
    return { stopped: id }
  }

  // A holder's run ends (an answer — flagged or at maxSteps — or an error, a stop): the jobs it left running stop.
  attach(agent) {
    if (!agent?.name || typeof agent.on !== "function") return
    this.holders.get(agent.name)?.()
    const ended = () => {
      for (const j of this.#own(agent.name)) this.#halt(j, `${agent.name}'s run ended while it ran`)
    }
    const offs = [agent.on("answer", ended), agent.on("error", ended)]
    this.holders.set(agent.name, () => offs.forEach((off) => off()))
  }

  // A spawned holder dismissed: the jobs it left running go with it, and its run-end listeners.
  detach(agent) {
    for (const j of this.#own(agent?.name)) this.#halt(j, `${agent.name} was dismissed`)
    this.holders.get(agent?.name)?.()
    this.holders.delete(agent?.name)
  }

  // The agent `to` names: one of the holder's quest tools (a member written with its team's prefix is that member).
  #target(holder, to) {
    const name = String(to ?? "").trim()
    const agents = [...(holder.tools?.values() ?? [])].filter((t) => t.type === "agent" && t.agent).map((t) => t.name)
    const yours = agents.length ? `yours: ${agents.join(", ")}` : "you have none — agent.spawn makes one"
    if (!name) throw new Error(`to: which of your agents (${yours})`)
    const tool = holder.tools.get(holder.resolveTool ? holder.resolveTool(name) : name)
    if (tool?.type !== "agent" || !tool.agent) throw new Error(`to: ${name} is not one of your agents (${yours})`)
    return tool
  }

  // One job in one line, as the holder reads it: "j2 → data · 12m · <ask>" (running), "j3 → eval done in 3m10s".
  #line(j, { ask = true } = {}) {
    const head = `${j.id} → ${j.to}`
    if (j.status === "running") return `${head} · ${since(this.#now() - j.t0)}${ask ? ` · ${clip(oneLine(j.ask), ASK_PROMPT)}` : ""} · ${this.#where(j)}`
    const end = j.status === "done" ? `done in ${took(j.t1 - j.t0)}` : `${j.status} after ${took(j.t1 - j.t0)}`
    return `${head} ${end}${ask ? ` · ${clip(oneLine(j.ask), ASK_PROMPT)}` : ""}`
  }

  // Where the target is with a running job: queued behind another run, starting, or at a step.
  #where(j) {
    if (j.began) return `${j.to}: ${j.step ? `step ${j.step}` : "thinking"}`
    return j.target.status === "running" ? `queued behind ${j.to}'s current run` : "starting"
  }

  // A finished job as a wait (or read) result shows it, delivered from then on: the report clipped to `max`, then how
  // to read all of it (a read's own cut says only how much was left out).
  #delivered(j, max = REPORT_WAIT) {
    if (!j.delivered) queueMicrotask(() => this.#publish())
    j.delivered = true
    if (j.status === "done") j.holder.reported?.add(j.to) // a sibling that works from its report may be called now
    if (j.status !== "done") return `${this.#line(j, { ask: false })}: ${j.error ?? "(no reason given)"}`
    const report = j.report ?? ""
    const more = max < REPORT_READ ? `${this.name}.read {id: ${j.id}} for all of it` : `its first ${max} shown`
    const cut = report.length > max ? `\n… ${more} (${report.length} chars)` : ""
    return `${this.#line(j, { ask: false })}:\n${report.slice(0, max)}${cut}`
  }

  // ---- commands ----

  #start(input = {}, ctx = {}) {
    const holder = ctx.agent
    if (!holder?.name) throw new Error(`${this.name}.start: no agent`)
    if (ctx.signal?.aborted) throw new Error("stopped")
    const tool = this.#target(holder, input.to)
    const text = questText(input) // refused without requirement, ask and outcome
    const waiting = (tool.after ?? []).filter((n) => holder.reported && !holder.reported.has(n))
    if (waiting.length) throw new Error(`${tool.name} works from ${waiting.join(" and ")}'s report: get ${waiting.join(", ")}'s report first (a quest, or ${this.name}.wait for its job), then ${tool.name} with that report in the requirement`)
    const running = this.#own(holder.name).filter((j) => j.status === "running")
    if (running.length >= RUNNING_MAX) throw new Error(`${running.length} jobs already running (at most ${RUNNING_MAX}): ${running.map((j) => this.#line(j, { ask: false })).join("; ")} — ${this.name}.wait for one or ${this.name}.stop one first`)
    const target = tool.agent
    const queued = target.status === "running"
    let settle
    const job = {
      id: `j${++this.n}`,
      to: tool.name,
      by: holder.name,
      ask: askOf(text),
      status: "running",
      startedAt: this.clock().toISOString(),
      endedAt: null,
      report: null,
      error: null,
      t0: this.#now(),
      t1: null,
      text,
      holder,
      target,
      controller: new AbortController(),
      ended: new Promise((ok) => (settle = ok)),
      settle: () => settle(),
      delivered: false,
      began: false,
      step: 0,
      offs: [],
    }
    // Where its run is (the prompt's line): its start event, then its steps.
    job.offs.push(
      target.on("start", (e) => {
        if (!job.began && e.request?.text === text && e.request?.from === holder.name) (job.began = true), this.#publish()
      }),
      target.on("step", (e) => {
        if (job.began) job.step = e.n
      }),
    )
    // The holder's run stopped → the jobs it started stop with it.
    if (ctx.signal) {
      const abort = () => this.#halt(job, `${holder.name}'s run was stopped`)
      ctx.signal.addEventListener("abort", abort, { once: true })
      job.offs.push(() => ctx.signal.removeEventListener("abort", abort))
    }
    this.jobs.set(job.id, job)
    this.#publish()
    target.ask(text, { from: holder.name, signal: job.controller.signal, outside: ctx.outside }).then(
      (answer) => this.#end(job, "done", { report: answer }),
      (error) => {
        const message = String(error?.message ?? error)
        this.#end(job, job.controller.signal.aborted || /^stopped/.test(message) ? "stopped" : "failed", { error: message })
      },
    )
    return `${job.id} → ${job.to} started${queued ? " (queued behind its current run)" : ""}; your steps go on — ${this.name}.wait for its report`
  }

  async #wait(input = {}, ctx = {}) {
    const holder = ctx.agent
    if (!holder?.name) throw new Error(`${this.name}.wait: no agent`)
    const mine = this.#own(holder.name)
    const ids = list(input.ids ?? input.id)
    const unknown = ids.filter((id) => !mine.some((j) => j.id === id))
    if (unknown.length) throw new Error(`${unknown.join(", ")}: not ${unknown.length > 1 ? "jobs" : "a job"} of yours (yours: ${mine.map((j) => j.id).join(", ") || "none"})`)
    const watched = ids.length ? mine.filter((j) => ids.includes(j.id)) : mine
    const s = Math.min(WAIT_MAX, Math.max(WAIT_MIN, Math.round(Number(input.seconds) || WAIT_DEFAULT)))
    const ready = watched.some((j) => j.status !== "running" && !j.delivered)
    const running = watched.filter((j) => j.status === "running")
    let woke = ready ? "ended" : !running.length ? "none" : holder.guidance?.length ? "guide" : ctx.signal?.aborted ? "stopped" : null
    if (!woke) {
      woke = await new Promise((resolve) => {
        const offs = []
        let done = false
        const wake = (why) => {
          if (done) return
          done = true
          for (const off of offs) off()
          resolve(why)
        }
        const timer = setTimeout(() => wake("timeout"), s * this.secondMs)
        offs.push(() => clearTimeout(timer))
        for (const j of running) j.ended.then(() => wake("ended"))
        if (typeof holder.on === "function") offs.push(holder.on("guide", () => wake("guide")))
        if (ctx.signal) {
          const abort = () => wake("stopped")
          ctx.signal.addEventListener("abort", abort, { once: true })
          offs.push(() => ctx.signal.removeEventListener("abort", abort))
        }
      })
    }
    // Every finished report of the holder not yet delivered, then what still runs, then why it woke.
    const out = this.#own(holder.name)
      .filter((j) => j.status !== "running" && !j.delivered)
      .map((j) => this.#delivered(j))
    const still = this.#own(holder.name).filter((j) => j.status === "running")
    if (still.length) out.push(["still running:", ...still.map((j) => `  ${this.#line(j, { ask: false })}`)].join("\n"))
    if (woke === "guide") out.push("owner guidance arrived — read # OWNER GUIDANCE in your next step")
    else if (woke === "timeout") out.push(`waited ${s} s: no job ended — ${this.name}.wait again, or go on and wait later`)
    else if (woke === "stopped") out.push("your run was stopped: its jobs stop with it")
    else if (woke === "none" && !out.length) out.push(`nothing to wait for: ${ids.length ? `${ids.join(", ")} delivered already (${this.name}.read {id} shows one again)` : `no job of yours runs (${this.name}.start starts one)`}`)
    return out.join("\n\n")
  }

  #read(input = {}, ctx = {}) {
    const id = String(input.id ?? "").trim()
    const job = this.jobs.get(id)
    const mine = this.#own(ctx.agent?.name).map((j) => j.id)
    if (!job) throw new Error(`id: no job ${id || "given"} (yours: ${mine.join(", ") || "none"})`)
    if (job.status === "running") return `${this.#line(job)} — still running: ${this.name}.wait {ids: [${job.id}]} for its report`
    if (job.by !== ctx.agent?.name) return this.#text(job)
    return this.#delivered(job, REPORT_READ)
  }

  // Another holder's finished job, read without delivering it.
  #text(j) {
    if (j.status !== "done") return `${this.#line(j, { ask: false })}: ${j.error ?? "(no reason given)"}`
    return `${this.#line(j, { ask: false })} (by ${j.by}):\n${clip(j.report ?? "", REPORT_READ)}`
  }

  #stop(input = {}, ctx = {}) {
    const id = String(input.id ?? "").trim()
    const job = this.jobs.get(id)
    const mine = this.#own(ctx.agent?.name).map((j) => j.id)
    if (!job) throw new Error(`id: no job ${id || "given"} (yours: ${mine.join(", ") || "none"})`)
    if (job.status !== "running") return `${this.#line(job, { ask: false })} — it is not running`
    this.stop(id, ctx.agent?.name ?? null)
    return `${job.id} → ${job.to} stopped: its run ends at its next step`
  }

  #list(_input = {}, ctx = {}) {
    const mine = this.#own(ctx.agent?.name).reverse()
    if (!mine.length) return `no jobs yet (${this.name}.start starts one)`
    return mine.map((j) => `${this.#line(j)}${j.status !== "running" ? (j.delivered ? " (delivered)" : " (report waiting)") : ""}`).join("\n")
  }

  commands() {
    const tool = (name, description, input, run, describe = null) => {
      const t = new Tool({ name: `${this.name}.${name}`, type: "dev", view: "dispatch", description, input, run })
      if (describe) t.describe = () => `- ${t.name} ${describe} — ${t.description}`
      return t
    }
    const id = "a job id (j3)"
    return [
      // The brief's fields are explained once above the TOOLS list (Agent.render), as for a quest.
      tool("start", `hand one of your agents a brief and keep working while it runs (a quest waits for its report; this does not): the job's id — at most ${RUNNING_MAX} running`, { to: "the agent (one of your quest tools)", ...QUEST_INPUT }, (i, c) => this.#start(i, c), "{to, requirement, ask, outcome}"),
      tool("wait", `wait until a job ends, owner guidance arrives or seconds pass: the reports that came back, what still runs`, { ids: "job ids (default: every running job of yours)", seconds: `at most ${WAIT_MAX} (default ${WAIT_DEFAULT}, at least ${WAIT_MIN})` }, (i, c) => this.#wait(i, c)),
      tool("read", "a job's whole report, or its error", { id }, (i, c) => this.#read(i, c)),
      tool("stop", "stop a job you started (its run ends at its next step)", { id }, (i, c) => this.#stop(i, c)),
      tool("list", "your jobs, one line each", {}, (i, c) => this.#list(i, c)),
    ]
  }

  // ---- gate ----

  // The holder answers only when none of its jobs runs (their reports are the work it answers from). Hard: never let
  // through after gateRetries (Agent), so a run that ends with jobs running ends only at maxSteps, an error or a stop.
  gate(agent) {
    const running = this.#own(agent?.name).filter((j) => j.status === "running")
    if (!running.length) return null
    const one = running.length === 1
    return { reason: `${plural(running.length, "job")} still running: ${running.map((j) => `${j.id} → ${j.to} (${since(this.#now() - j.t0)})`).join(", ")}: ${this.name}.wait for ${one ? "its report" : "their reports"} or ${this.name}.stop ${one ? "it" : "them"}`, hard: true }
  }

  // ---- views ----

  brief() {
    const jobs = [...this.jobs.values()]
    if (!jobs.length) return "no jobs yet"
    const count = (s) => jobs.filter((j) => j.status === s).length
    const extra = ["failed", "stopped"].filter(count).map((s) => ` · ${count(s)} ${s}`).join("")
    return `${count("running")} running · ${count("done")} done${extra}`
  }

  // The holder's own jobs: what runs (and where its target is), the reports not yet delivered, the rest counted.
  render(agent) {
    const own = (c) => !agent || agent.tools?.has(`${this.name}.${c}`)
    const can = ["start", "wait", "read", "stop", "list"].filter(own).map((c) => `${this.name}.${c}`)
    const head = `the desk's dispatch: hand a brief to one of your agents and keep working while it runs${can.length ? `: ${can.join(", ")}` : ""} — your answer waits until none of your jobs runs`
    const mine = agent ? this.#own(agent.name) : [...this.jobs.values()]
    if (!mine.length) return `${head}\n(no jobs yet)`
    const out = [head]
    const running = mine.filter((j) => j.status === "running")
    if (running.length) out.push("RUNNING", ...running.map((j) => `  ${this.#line(j)}`))
    const waiting = mine.filter((j) => j.status !== "running" && !j.delivered).reverse()
    if (waiting.length) {
      out.push(`REPORTS NOT YET READ (${this.name}.wait or ${this.name}.read delivers them)`)
      const shown = waiting.slice(0, FINISHED_LINES)
      for (const j of shown) out.push(`  ${this.#line(j, { ask: false })}: ${j.status === "done" ? clip(oneLine(j.report), REPORT_PROMPT) : (j.error ?? "")}`)
      if (waiting.length > shown.length) out.push(`  … ${waiting.length - shown.length} more: ${this.name}.list`)
    }
    const delivered = mine.filter((j) => j.status !== "running" && j.delivered).length
    if (delivered) out.push(`(${plural(delivered, "report")} delivered earlier: ${this.name}.list)`)
    return out.join("\n")
  }
}
