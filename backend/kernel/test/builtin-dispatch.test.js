// The dispatch artifact (backend/kernel/builtin/dispatch.js, 2026-10-17): a brief handed to one of the holder's agents
// that runs while the holder keeps working — start returns at once, wait wakes on a report, owner guidance, a timeout
// or the holder's stop; the gate holds the holder's answer while a job runs; stop reaches the target's run; the twin.

import { describe, expect, test } from "bun:test"
import { Agent, Dispatch, questText, Tool } from "../index.js"

const quest = (ask) => ({ requirement: "a dispatch test", ask, outcome: "one line" })
const json = (o) => JSON.stringify(o)
const answer = (text) => json({ thought: "done", calls: [], answer: text })
const until = async (ok, ms = 2000) => {
  const end = Date.now() + ms
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out waiting")
    await Bun.sleep(1)
  }
}

// An agent whose model waits until the test answers for it: release(text) answers, step(reply) makes a call step,
// fail(error) throws; waiting = model calls not answered yet.
function blocked(name) {
  const pending = []
  const agent = new Agent({ name, report: false }, { infer: () => new Promise((ok, no) => pending.push({ ok, no })) })
  const next = async () => {
    await until(() => pending.length)
    return pending.shift()
  }
  return {
    agent,
    release: async (text = `${name} report`) => (await next()).ok(answer(text)),
    step: async (reply) => (await next()).ok(json(reply)),
    fail: async (message) => (await next()).no(new Error(message)),
    get waiting() {
      return pending.length
    },
  }
}

// A holder (lead) of the dispatch with the targets as its agents; run(cmd, input, signal) calls its dispatch command.
function team(targets, { dispatch = new Dispatch(), infer = async () => answer("lead done"), name = "lead" } = {}) {
  const lead = new Agent({ name, report: false }, { infer, tools: targets.map((t) => t.agent) }).addArtifact(dispatch)
  const run = (cmd, input = {}, signal) => lead.tools.get(`${dispatch.id}.${cmd}`).run(input, { ...lead.context, agent: lead, ...(signal ? { signal } : {}) })
  return { lead, run, dispatch }
}

// A clock the test moves: now.t += ms.
const clockAt = (iso = "2026-10-17T14:00:00Z") => {
  const now = { t: Date.parse(iso) }
  return { now, clock: () => new Date(now.t) }
}

describe("dispatch", () => {
  test("start returns while the target still runs; the holder's next command runs meanwhile; the job is target.ask(questText(brief), {from, signal})", async () => {
    const data = blocked("data")
    const asks = []
    const ask = data.agent.ask.bind(data.agent)
    data.agent.ask = (text, opts) => (asks.push({ text, opts }), ask(text, opts))
    const { run } = team([data])
    expect(await run("start", { to: "data", ...quest("which shard is clean?") })).toBe("j1 → data started; your steps go on — dispatch.wait for its report")
    expect(asks).toHaveLength(1)
    expect(asks[0].text).toBe(questText(quest("which shard is clean?")))
    expect(asks[0].opts.from).toBe("lead")
    expect(asks[0].opts.signal).toBeInstanceOf(AbortSignal)
    await until(() => data.waiting) // the target is in its model call
    expect(data.agent.status).toBe("running")
    expect(await run("list")).toBe("j1 → data · 0s · which shard is clean? · data: thinking")
    // a second job to the same agent queues behind its run
    expect(await run("start", { to: "data", ...quest("and the next shard?") })).toBe("j2 → data started (queued behind its current run); your steps go on — dispatch.wait for its report")
    expect((await run("list")).split("\n")[0]).toBe("j2 → data · 0s · and the next shard? · queued behind data's current run")
    await data.release("shard 3 is clean")
    await data.release("shard 4 too")
    expect(await run("wait", { ids: ["j2"] })).toContain("j2 → data done in")
  })

  test("in a run: the holder's steps go on while the job runs, its answer waits on the gate, wait delivers the report", async () => {
    const data = blocked("data")
    let during = null
    const note = new Tool({
      name: "note",
      description: "a note",
      run: () => {
        during = data.agent.status
        return "noted"
      },
    })
    const script = [
      { thought: "hand it off", calls: [{ tool: "dispatch.start", input: { to: "data", ...quest("which shard is clean?") } }] },
      { thought: "my own work meanwhile", calls: [{ tool: "note", input: {} }] },
      { thought: "answer", calls: [], answer: "too early" },
      { thought: "wait for it", calls: [{ tool: "dispatch.wait", input: {} }] },
      { thought: "done", calls: [], answer: "shard 3" },
    ]
    const prompts = []
    const dispatch = new Dispatch()
    const lead = new Agent({ name: "lead", report: false }, { infer: async (p) => (prompts.push(p), json(script.shift())), tools: [data.agent, note] }).addArtifact(dispatch)
    const gates = []
    lead.on("gate", (e) => gates.push(e.reasons))
    lead.on("call", (e) => e.tool === "dispatch.wait" && setTimeout(() => data.release("shard 3 is clean"), 5))
    expect(await lead.ask("find a clean shard")).toBe("shard 3")
    expect(during).toBe("running") // the note ran while the target's run went on
    expect(gates).toEqual([["1 job still running: j1 → data (0s): dispatch.wait for its report or dispatch.stop it"]])
    expect(prompts[2]).toContain("RUNNING\n  j1 → data · 0s · which shard is clean? · data: thinking")
    expect(prompts[4]).toMatch(/dispatch\.wait → j1 → data done in \d+s:\nshard 3 is clean/)
    expect(prompts[4]).toContain("(1 report delivered earlier: dispatch.list)")
    expect(prompts[4]).not.toContain("REPORTS NOT YET READ")
    expect(lead.gates("x")).toEqual([])
  })

  test("refused: a brief without requirement, ask or outcome; an agent that is not the holder's; a 7th running job", async () => {
    const data = blocked("data")
    const evals = blocked("eval")
    const { run, dispatch } = team([data, evals])
    await expect(run("start", { to: "data", ask: "x", outcome: "y" })).rejects.toThrow("a quest needs requirement")
    await expect(run("start", { to: "ghost", ...quest("x") })).rejects.toThrow("to: ghost is not one of your agents (yours: data, eval)")
    await expect(run("start", quest("x"))).rejects.toThrow("to: which of your agents (yours: data, eval)")
    await expect(team([]).run("start", { to: "data", ...quest("x") })).rejects.toThrow("to: data is not one of your agents (you have none — agent.spawn makes one)")
    // a member written with the holder's team prefix is that member
    expect(await run("start", { to: "lead.eval", ...quest("bpb?") })).toStartWith("j1 → eval started")
    for (let i = 0; i < 5; i++) await run("start", { to: "data", ...quest(`shard ${i}?`) })
    await expect(run("start", { to: "data", ...quest("one more?") })).rejects.toThrow(/^6 jobs already running \(at most 6\): j1 → eval · 0s · eval: thinking; j2 → data · 0s · data: thinking; j3 → data · 0s · queued behind data's current run; .*j6 → data · 0s · queued behind data's current run — dispatch\.wait for one or dispatch\.stop one first$/)
    for (let i = 0; i < 5; i++) await data.release()
    await evals.release()
    await until(() => dispatch.state.jobs.every((j) => j.status === "done"))
    const reports = await run("wait", {})
    expect(reports.split("\n\n")).toHaveLength(6)
    expect(reports).toContain("j6 → data done")
  })

  test("wait: a report clipped to 3000 chars with the read hint, delivered once; read gives all of it", async () => {
    const data = blocked("data")
    const { run, lead } = team([data])
    await run("start", { to: "data", ...quest("the whole table?") })
    const report = `${"a".repeat(2990)}0123456789${"b".repeat(2000)}`
    await data.release(report)
    const out = await run("wait", {})
    expect(out).toMatch(/^j1 → data done in \d+s:\n/)
    expect(out).toContain(`${"a".repeat(2990)}0123456789\n… dispatch.read {id: j1} for all of it (5000 chars)`)
    expect(out).not.toContain("b")
    // delivered: not again, and not in the prompt
    expect(await run("wait", {})).toBe("nothing to wait for: no job of yours runs (dispatch.start starts one)")
    expect(await run("wait", { ids: "j1" })).toBe("nothing to wait for: j1 delivered already (dispatch.read {id} shows one again)")
    expect(lead.render({ text: "x", from: "owner" }, [])).not.toContain("REPORTS NOT YET READ")
    expect(await run("read", { id: "j1" })).toEndWith(report)
    await expect(run("wait", { ids: ["j9"] })).rejects.toThrow("j9: not a job of yours (yours: j1)")
  })

  test("wait: wakes on a timeout listing what still runs, on the holder's stop, and returns at once with a report waiting", async () => {
    const data = blocked("data")
    const evals = blocked("eval")
    const { run, dispatch } = team([data, evals], { dispatch: new Dispatch({ secondMs: 1 }) })
    await run("start", { to: "data", ...quest("which shard?") })
    await run("start", { to: "eval", ...quest("bpb?") })
    const out = await run("wait", { seconds: 5 })
    expect(out).toBe("still running:\n  j1 → data · 0s · data: thinking\n  j2 → eval · 0s · eval: thinking\n\nwaited 5 s: no job ended — dispatch.wait again, or go on and wait later")
    // a report already waiting: the wait returns it at once (no timer)
    await evals.release("bpb 1.21")
    await until(() => dispatch.state.jobs.find((j) => j.id === "j2").status === "done")
    const slow = new Dispatch({ secondMs: 1000 })
    expect((await run("wait", { seconds: 1800 })).split("\n\n")).toEqual(["j2 → eval done in 0s:\nbpb 1.21", "still running:\n  j1 → data · 0s · data: thinking"])
    // the holder's run stopped: its wait wakes and its jobs stop with it
    const stopper = new AbortController()
    const { run: run2 } = team([blocked("probe")], { dispatch: slow })
    await run2("start", { to: "probe", ...quest("rms?") }, stopper.signal)
    const waiting = run2("wait", { seconds: 1800 }, stopper.signal)
    await Bun.sleep(5)
    stopper.abort()
    expect(await waiting).toBe("j1 → probe stopped after 0s: lead's run was stopped\n\nyour run was stopped: its jobs stop with it")
    expect(slow.state.jobs[0]).toMatchObject({ id: "j1", status: "stopped", error: "lead's run was stopped" })
  })

  test("wait: owner guidance for the holder wakes it (and a note already waiting returns it at once)", async () => {
    const data = blocked("data")
    const script = [
      { thought: "hand it off", calls: [{ tool: "dispatch.start", input: { to: "data", ...quest("which shard?") } }] },
      { thought: "wait", calls: [{ tool: "dispatch.wait", input: { seconds: 1800 } }] },
      { thought: "the owner says stop it", calls: [{ tool: "dispatch.stop", input: { id: "j1" } }] },
      { thought: "done", calls: [], answer: "stopped as asked" },
    ]
    const prompts = []
    const lead = new Agent({ name: "lead", report: false }, { infer: async (p) => (prompts.push(p), json(script.shift())), tools: [data.agent] }).addArtifact(new Dispatch())
    lead.on("call", (e) => e.tool === "dispatch.wait" && setTimeout(() => lead.guide("drop the shard search"), 5))
    expect(await lead.ask("find a shard")).toBe("stopped as asked")
    expect(prompts[2]).toContain("# OWNER GUIDANCE")
    expect(prompts[2]).toContain("> owner: drop the shard search")
    expect(prompts[2]).toMatch(/dispatch\.wait → still running:\n {2}j1 → data · 0s · data: thinking\n\nowner guidance arrived — read # OWNER GUIDANCE in your next step/)
    expect(prompts[3]).toContain("dispatch.stop → j1 → data stopped: its run ends at its next step")
    // a note that arrived before the wait: it returns at once
    const { run, lead: other } = team([blocked("eval")], { dispatch: new Dispatch() })
    await run("start", { to: "eval", ...quest("bpb?") })
    other.guidance.push({ from: "owner", text: "faster", at: 0 })
    expect(await run("wait", { seconds: 1800 })).toEndWith("owner guidance arrived — read # OWNER GUIDANCE in your next step")
  })

  test("stop: the target's run ends stopped; only the starter (or the owner) stops it; read gives the error", async () => {
    const data = blocked("data")
    const evals = blocked("eval")
    const dispatch = new Dispatch()
    const { run } = team([data, evals], { dispatch })
    const { run: other } = team([], { dispatch, name: "planner" })
    const ended = new Promise((ok) => data.agent.on("error", (e) => ok(e.error)))
    await run("start", { to: "data", ...quest("which shard?") })
    await until(() => data.waiting) // its model call is under way
    await expect(other("stop", { id: "j1" })).rejects.toThrow("j1 was started by lead: only lead (or the owner) stops it")
    expect(await run("stop", { id: "j1" })).toBe("j1 → data stopped: its run ends at its next step")
    expect(dispatch.state.jobs[0]).toMatchObject({ id: "j1", status: "stopped", error: "stopped by lead" })
    await data.step({ thought: "look", calls: [{ tool: "nothing", input: {} }] }) // its step ends; the next one sees the stop
    expect(await ended).toBe("stopped")
    expect(data.agent.status).toBe("error")
    expect(await run("read", { id: "j1" })).toBe("j1 → data stopped after 0s: stopped by lead")
    expect(await run("stop", { id: "j1" })).toBe("j1 → data stopped after 0s — it is not running")
    // the owner, through the host
    await run("start", { to: "eval", ...quest("bpb?") })
    expect(dispatch.stop("j2")).toBe(true)
    expect(dispatch.state.jobs[0]).toMatchObject({ id: "j2", status: "stopped", error: "stopped by the owner" })
    // a target that fails: the job fails, read gives the error
    const evals2 = blocked("probe")
    const { run: run3 } = team([evals2], { dispatch })
    await run3("start", { to: "probe", ...quest("rms?") })
    await evals2.fail("model down")
    await until(() => dispatch.state.jobs[0].status !== "running")
    expect(dispatch.state.jobs[0]).toMatchObject({ id: "j3", status: "failed", error: "model down", report: null })
    expect(await run3("read", { id: "j3" })).toBe("j3 → probe failed after 0s: model down")
    // a dismissed holder's jobs stop with it
    const probe = blocked("probe2")
    const { run: run4, lead: helper } = team([probe], { dispatch, name: "helper" })
    await run4("start", { to: "probe2", ...quest("grad norm?") })
    dispatch.detach(helper)
    expect(dispatch.state.jobs[0]).toMatchObject({ id: "j4", status: "stopped", error: "helper was dismissed" })
  })

  test("the gate names the running jobs with their age; the prompt shows only the holder's own running jobs and undelivered reports", async () => {
    const { now, clock } = clockAt()
    const data = blocked("data")
    const evals = blocked("eval")
    const dispatch = new Dispatch({ clock })
    const { run, lead } = team([data, evals], { dispatch })
    const { run: other, lead: planner } = team([blocked("probe")], { dispatch, name: "planner" })
    const longAsk = `which shard is clean, ${"and why ".repeat(30)}`
    await run("start", { to: "data", ...quest(longAsk) })
    now.t += 9 * 60_000
    await run("start", { to: "eval", ...quest("bpb?") })
    await other("start", { to: "probe", ...quest("rms?") })
    now.t += 3 * 60_000
    expect(lead.gates("x")).toEqual(["2 jobs still running: j1 → data (12m), j2 → eval (3m): dispatch.wait for their reports or dispatch.stop them"])
    const block = () => lead.render({ text: "x", from: "owner" }, []).split("# dispatch — dispatch — work that runs while you work\n")[1].split("\n\n# REQUEST")[0].split("\n")
    expect(block()[0]).toBe("the desk's dispatch: hand a brief to one of your agents and keep working while it runs: dispatch.start, dispatch.wait, dispatch.read, dispatch.stop, dispatch.list — your answer waits until none of your jobs runs")
    expect(block().slice(1)).toEqual(["RUNNING", `  j1 → data · 12m · ${longAsk.trim().replace(/\s+/g, " ").slice(0, 120)}… · data: thinking`, "  j2 → eval · 3m · bpb? · eval: thinking"])
    now.t += 4_000
    await evals.release("bpb 1.21 at 2k steps")
    await until(() => dispatch.state.jobs.find((j) => j.id === "j2").status === "done")
    expect(lead.gates("x")).toEqual(["1 job still running: j1 → data (12m): dispatch.wait for its report or dispatch.stop it"])
    expect(block().slice(1)).toEqual(["RUNNING", expect.stringMatching(/^ {2}j1 → data · 12m · /), "REPORTS NOT YET READ (dispatch.wait or dispatch.read delivers them)", "  j2 → eval done in 3m04s: bpb 1.21 at 2k steps"])
    expect(planner.render({ text: "x", from: "owner" }, [])).not.toContain("j1")
    expect(planner.gates("x")).toEqual(["1 job still running: j3 → probe (3m): dispatch.wait for its report or dispatch.stop it"])
    expect(await run("wait", { ids: ["j2"] })).toStartWith("j2 → eval done in 3m04s:\nbpb 1.21 at 2k steps")
    expect(block().slice(1)).toEqual(["RUNNING", expect.stringMatching(/^ {2}j1 → data · 12m · /), "(1 report delivered earlier: dispatch.list)"])
    expect(await run("list")).toEqual(expect.stringContaining("j2 → eval done in 3m04s · bpb? (delivered)"))
  })

  test("the twin: {jobs} ≤ 40 newest first with the spec's fields; brief; changed() only when a job starts or ends", async () => {
    const quick = new Agent({ name: "data", report: false }, { infer: async () => answer("ok") })
    const dispatch = new Dispatch()
    const { run } = team([{ agent: quick }], { dispatch })
    let changes = 0
    dispatch.onChange(() => changes++)
    expect(dispatch.brief()).toBe("no jobs yet")
    await run("start", { to: "data", ...quest("one?") })
    expect(changes).toBe(1)
    expect(dispatch.brief()).toBe("1 running · 0 done")
    await run("list")
    await run("wait", {})
    expect(changes).toBe(2)
    await run("read", { id: "j1" })
    expect(changes).toBe(2)
    const job = dispatch.twin().state.jobs[0]
    expect(Object.keys(dispatch.twin().state)).toEqual(["jobs"])
    expect(Object.keys(job)).toEqual(["id", "to", "by", "ask", "status", "startedAt", "endedAt", "report", "error"])
    expect(job).toMatchObject({ id: "j1", to: "data", by: "lead", ask: "one?", status: "done", report: "ok", error: null })
    expect(dispatch.twin()).toMatchObject({ kind: "dispatch", view: "dispatch", keep: "file", brief: "0 running · 1 done" })
    for (let i = 2; i <= 41; i++) {
      await run("start", { to: "data", ...quest(`${"x".repeat(400)} ${i}`) })
      await run("wait", {})
    }
    const jobs = dispatch.twin().state.jobs
    expect(jobs).toHaveLength(40)
    expect(jobs[0].id).toBe("j41")
    expect(jobs.at(-1).id).toBe("j2")
    expect(jobs[0].ask).toHaveLength(301) // 300 and the …
    expect(changes).toBe(2 + 40 * 2)
    const big = "r".repeat(5000)
    quick.infer = async () => answer(big)
    await run("start", { to: "data", ...quest("big?") })
    await run("wait", {})
    expect(dispatch.twin().state.jobs[0].report).toHaveLength(4001)
    expect(dispatch.brief()).toBe("0 running · 42 done")
  })
})
