// Goal (2026-10-24 owner: "to target a long running goal, the desk will set a goal and will keep working towards the
// goal … all actions with feedback is to gain towards the goal"): the standing goal, each run's progress against it
// (gated), the run the host starts when it is due (takeDue), the owner's feedback and controls. The host's loop:
// companion/team/kernel-goal.test.js.

import { describe, expect, test } from "bun:test"
import { Agent, BUILTIN, Goal } from "../index.js"

let now = new Date("2026-10-24T14:00:00Z")
const clock = () => now
const at = (iso) => (now = new Date(iso))
const run = (goal, cmd, input, name = "lead") => goal.commands().find((t) => t.name === `goal.${cmd}`).run(input, { agent: { name } })
const json = (o) => JSON.stringify(o)

describe("goal: the desk's standing goal", () => {
  test("every request is framed as a goal first: gated until framed, kept in each step, answered or failed with its run; a resume needs none", async () => {
    at("2026-10-25T09:00:00Z")
    const goal = new Goal({ clock })
    const frame = { intent: "a two-page brief on solid-state batteries", done: "work/brief.md with a source per claim", route: "helpers", why: "three independent angles" }
    const replies = [json({ thought: "done", calls: [], answer: "early" }), json({ thought: "frame", calls: [{ tool: "goal.frame", input: frame }] }), json({ thought: "done", calls: [], answer: "brief written" })]
    const prompts = []
    let k = 0
    const lead = new Agent({ name: "lead", report: false }, { infer: async (p) => (prompts.push(p), replies[k++]) }).addArtifact(goal)
    const gates = []
    lead.on("gate", (e) => gates.push(...e.reasons))
    expect(await lead.ask("brief me on solid-state batteries")).toBe("brief written")
    expect(gates[0]).toStartWith("frame this request as a goal first: goal.frame {intent, done, route: direct | helpers | workflow | goal | desk")
    expect(prompts[0]).toContain("THIS REQUEST AS A GOAL: not framed yet")
    expect(prompts[2]).toContain("THIS REQUEST AS A GOAL (f1, route helpers): a two-page brief on solid-state batteries\ndone when: work/brief.md with a source per claim")
    expect(goal.state.frames).toEqual([{ id: "f1", agent: "lead", request: "brief me on solid-state batteries", ...frame, at: "2026-10-25T09:00:00.000Z", status: "answered" }])
    expect(goal.brief()).toBe("helpers · a two-page brief on solid-state batteries · answered")
    expect(() => run(goal, "frame", { ...frame, route: "maybe" })).toThrow("frame the request of a run in progress")
    // the standing goal's own resume is framed by the goal
    k = 2
    gates.length = 0
    await lead.ask("Keep working toward the desk's standing goal", { from: "goal" })
    expect(gates).toEqual([])
    // restored: a frame still working is no run any more
    const back = new Goal({ clock })
    back.restore({ ...goal.snapshot(), frames: [{ ...goal.state.frames[0], status: "working" }] })
    expect(back.state.frames[0].status).toBe("interrupted")
    expect(back.fn).toBe(1)
  })

  test("set, progress, the prompt with its trend and next step, takeDue once", async () => {
    at("2026-10-24T14:00:00Z")
    const goal = new Goal({ clock })
    expect(goal.render({ name: "lead", tools: new Set(["goal.set"]) })).toBe("the desk's standing goal: none set — goal.set one only when the owner asks for a goal to pursue over time")
    expect(await run(goal, "set", { text: "Grow the paper account to $1,300", measure: "account value in $", target: "1300", cadence_minutes: 30, why: "owner: aim for 30%" })).toBe("standing goal set: Grow the paper account to $1,300 — its first run starts 10-24 14:30, then the desk resumes it every 30 min; end every run with goal.progress")
    expect(goal.state).toMatchObject({ status: "active", keeper: "lead", cadence_minutes: 30, next_at: "2026-10-24T14:30:00.000Z" })
    await expect(run(goal, "progress", { did: "x", result: "y", toward: "up" })).rejects.toThrow("toward: closer | same | further | unrelated")
    await expect(run(goal, "progress", { did: "x", result: "y", toward: "same" })).rejects.toThrow("next: what the next run")
    expect(await run(goal, "progress", { did: "read the account", result: "value $1,000", value: "$1,000", toward: "same", next: "scan SPY momentum at the open", next_in_minutes: 15 })).toBe("progress e2 recorded (same) — the next run starts 10-24 14:15")
    at("2026-10-24T14:16:00Z")
    await run(goal, "progress", { did: "SPY call, sold half at +20%", result: "value $1,060", value: 1060, toward: "closer", next: "trail the runner" })
    const prompt = goal.render({ name: "lead", tools: new Set(["goal.progress"]) })
    expect(prompt).toContain("STANDING GOAL (active; set by lead 10-24 14:00): Grow the paper account to $1,300")
    expect(prompt).toContain("measure: account value in $ · target: 1300 · from 1000 to 1060 over 2 runs")
    expect(prompt).toContain("10-24 14:16 lead [closer 1060] SPY call, sold half at +20% → value $1,060")
    expect(prompt).toContain("next: trail the runner")
    expect(goal.brief()).toBe("active · Grow the paper account to $1,300 · last closer 1060")
    // due: once, never while its keeper works
    expect(goal.takeDue(new Date("2026-10-24T14:20:00Z"))).toBeNull()
    expect(goal.takeDue(new Date("2026-10-24T14:47:00Z"), () => true)).toBeNull()
    const due = goal.takeDue(new Date("2026-10-24T14:47:00Z"))
    expect(due.keeper).toBe("lead")
    expect(due.text).toContain("Keep working toward the desk's standing goal: Grow the paper account to $1,300")
    expect(due.text).toContain("Next, as the last run said: trail the runner")
    expect(goal.takeDue(new Date("2026-10-24T15:47:00Z"))).toBeNull()
  })

  test("a holder's run answers only after its progress (soft gate); a run without one books the cadence", async () => {
    at("2026-10-24T14:00:00Z")
    const goal = new Goal({ clock })
    goal.set({ text: "Ship the parser", measure: "tests passing" }, "owner")
    let k = 0
    const replies = [json({ thought: "done", calls: [], answer: "done" }), json({ thought: "progress", calls: [{ tool: "goal.frame", input: { intent: "a lexer", done: "its tests pass", route: "direct" } }, { tool: "goal.progress", input: { did: "wrote the lexer", result: "12/40 tests", value: 12, toward: "closer", next: "the parser" } }] }), json({ thought: "done", calls: [], answer: "lexer written" })]
    const lead = new Agent({ name: "lead", report: false }, { infer: async () => replies[k++] }).addArtifact(goal)
    const gates = []
    lead.on("gate", (e) => gates.push(...e.reasons))
    expect(await lead.ask("write the lexer")).toBe("lexer written")
    expect(gates.join(" ")).toContain("the standing goal is active: before you answer, goal.progress")
    expect(goal.state.entries.at(-1)).toMatchObject({ kind: "progress", by: "lead", value: 12, toward: "closer" })
    // a run that ends without progress (the gate let through after its retries) still books the next run
    goal.state.next_at = null
    const quiet = new Agent({ name: "lead2", report: false, gateRetries: 0 }, { infer: async () => json({ thought: "done", calls: [], answer: "hi" }) }).addArtifact(goal)
    await quiet.ask("say hi")
    expect(goal.state.next_at).toBe("2026-10-24T15:00:00.000Z")
  })

  test("three runs in a row that fail pause it", async () => {
    at("2026-10-24T14:00:00Z")
    const goal = new Goal({ clock })
    goal.set({ text: "Keep the build green", measure: "CI status" }, "owner")
    const lead = new Agent({ name: "lead", report: false }, { infer: async () => { throw new Error("model down") } }).addArtifact(goal)
    for (let i = 0; i < 3; i++) await lead.ask("go").catch(() => {})
    expect(goal.state).toMatchObject({ status: "paused", reason: "3 runs in a row ended in an error", next_at: null })
    expect(goal.takeDue(new Date("2026-10-25T00:00:00Z"))).toBeNull()
  })

  test("a model's usage limit never pauses it: no failure counted, the next run after the limit resets (2026-10-26)", async () => {
    at("2026-10-26T13:40:00Z") // 09:40 ET
    const goal = new Goal({ clock })
    goal.set({ text: "Keep the build green", measure: "CI status" }, "owner")
    const limited = "default: POST llm/claude-cli/v1/chat/completions: HTTP 502 {\"error\":\"claude exited 1: You've hit your session limit · resets 10:10am (America/New_York)\"}"
    const lead = new Agent({ name: "lead", report: false }, { infer: async () => { throw new Error(limited) } }).addArtifact(goal)
    for (let i = 0; i < 5; i++) await lead.ask("go").catch(() => {})
    expect(goal.state).toMatchObject({ status: "active", failures: 0, next_at: "2026-10-26T14:40:00.000Z" }) // its booked run, already after the reset
    expect(goal.state.entries.filter((e) => e.text?.startsWith("model limit")).length).toBe(1)
    goal.state.next_at = "2026-10-26T13:45:00.000Z" // due before the reset: moved after it
    await lead.ask("go").catch(() => {})
    expect(goal.state.next_at).toBe("2026-10-26T14:12:00.000Z") // 10:10 ET + 2 min
    // a failed flow on the limit: the same
    goal.flowStarted("goal-cycle")
    goal.flowEnded({ ok: false, error: `failed: ${limited}` })
    expect(goal.state).toMatchObject({ status: "active", failures: 0 })
    // a real error still counts
    goal.flowStarted("goal-cycle")
    goal.flowEnded({ ok: false, error: "failed: the card check failed" })
    expect(goal.state.failures).toBe(1)
  })

  test("the owner: feedback for the keeper, pause, resume, now, cadence, drop; acted on by the next progress", async () => {
    at("2026-10-24T14:00:00Z")
    const goal = new Goal({ clock })
    expect(() => goal.ownerCall("feedback", [{ id: "goal", text: "x" }])).toThrow("no goal set yet")
    goal.ownerCall("set", [{ id: "goal", text: "Write the saga", measure: "chapters made and heard ≥ 90%" }])
    expect(goal.state.keeper).toBeNull() // the host's lead
    const fb = goal.ownerCall("feedback", [{ id: "goal", text: "the spirit voice is too fast" }])
    expect(fb).toMatchObject({ entry: "e2", keeper: null })
    expect(fb.deliver).toContain('The owner\'s feedback on the standing goal ("Write the saga"): "the spirit voice is too fast"')
    expect(goal.render()).toContain("OWNER FEEDBACK 10-24 14:00: the spirit voice is too fast")
    expect(goal.resumeText()).toContain('The owner\'s feedback to act on: "the spirit voice is too fast"')
    await run(goal, "progress", { did: "set spirit speed 0.9", result: "re-sampled", toward: "closer", next: "chapter 2" })
    expect(goal.state.entries.find((e) => e.kind === "owner").acted).toBe("lead")
    expect(goal.render()).not.toContain("OWNER FEEDBACK")
    expect(goal.ownerCall("pause", [{ id: "goal", reason: "away" }])).toEqual({ status: "paused" })
    expect(() => goal.ownerCall("now", [{ id: "goal" }])).toThrow("the goal is paused")
    expect(goal.ownerCall("resume", [{ id: "goal" }])).toEqual({ status: "active" })
    expect(goal.takeDue(new Date("2026-10-24T14:00:01Z"))).not.toBeNull() // resumed: due at once
    expect(goal.ownerCall("cadence", [{ id: "goal", minutes: 5 }])).toEqual({ cadence_minutes: 10 }) // clamped to 10
    expect(goal.ownerCall("drop", [{ id: "goal" }])).toEqual({ status: "dropped" })
    expect(() => goal.ownerCall("explode", [{ id: "goal" }])).toThrow("the owner can set, pause")
  })

  test("met stops it; snapshot and restore keep it; the kit shares one per desk", async () => {
    at("2026-10-24T14:00:00Z")
    const goal = new Goal({ clock })
    goal.set({ text: "Reach 1300", measure: "$" }, "lead")
    expect(await run(goal, "met", { evidence: "value 1312 at 15:40" })).toBe("goal met: the desk stops resuming it")
    expect(goal.state.status).toBe("met")
    const copy = new Goal({ clock })
    copy.restore(goal.snapshot())
    expect(copy.state).toMatchObject({ status: "met", goal: { text: "Reach 1300" }, keeper: "lead" })
    expect(copy.state.entries.length).toBe(2)
    copy.ownerCall("feedback", [{ text: "next: 1500" }])
    expect(copy.state.entries.at(-1).id).toBe("e3") // ids go on after a restore
    const make = BUILTIN.artifacts.goal({ clock })
    expect(make({ name: "a" }, {})).toBe(make({ name: "b" }, {}))
  })

  // 2026-10-24 owner ("the goal artifact will contain the elements for a long running process … the goal can be live
  // artifact"): the ledger, milestones with claims, the stall counter and the workflow resume.
  test("ledger: facts need evidence, ordered decisions first, forget with why; kept in the prompt and the vars", async () => {
    at("2026-10-24T14:00:00Z")
    const goal = new Goal({ clock })
    await expect(run(goal, "note", { kind: "fact", text: "x" })).rejects.toThrow("no goal set")
    goal.set({ text: "Ship the parser", measure: "tests passing", constraints: "never change the public API" }, "owner")
    await expect(run(goal, "note", { kind: "hunch", text: "x" })).rejects.toThrow("kind: fact | guess | decision | dead_end")
    await expect(run(goal, "note", { kind: "fact", text: "40 tests" })).rejects.toThrow("evidence: where the fact shows")
    expect(await run(goal, "note", { kind: "fact", text: "the suite has 40 tests", evidence: "bun test: 40" })).toBe("noted l1 (fact)")
    expect(await run(goal, "note", { kind: "dead end", text: "a regex lexer: unicode broke it" })).toBe("noted l2 (dead_end)")
    expect(await run(goal, "note", { kind: "decision", text: "hand-written lexer: unicode-safe" })).toBe("noted l3 (decision)")
    await expect(run(goal, "note", { kind: "guess", text: "hand-written lexer: unicode-safe" })).rejects.toThrow("already in the ledger")
    const prompt = goal.render({ name: "lead", tools: new Set(["goal.progress", "goal.note"]) })
    expect(prompt).toContain("never break: never change the public API")
    expect(prompt).toContain("ledger (kept across runs and compactions):\n  l3 DECISION: hand-written lexer: unicode-safe\n  l1 FACT: the suite has 40 tests (bun test: 40)\n  l2 DEAD END: a regex lexer: unicode broke it")
    expect(prompt).toContain("this block is live and never compacted")
    expect(goal.vars()).toMatchObject({ goal: "Ship the parser", constraints: "never change the public API", mode: "continue" })
    expect(goal.vars().ledger.split("\n")[0]).toBe("l3 DECISION: hand-written lexer: unicode-safe")
    await expect(run(goal, "forget", { id: "l1" })).rejects.toThrow("why:")
    expect(await run(goal, "forget", { id: "l1", why: "the suite grew to 52" })).toBe("forgot l1")
    expect(goal.ownerCall("note", [{ id: "goal", kind: "fact", text: "CI runs on push" }]).note).toMatchObject({ kind: "fact", evidence: "the owner's word", by: "owner" })
    expect(goal.ownerCall("forget", [{ id: "goal", note: "l4", why: "moved to nightly" }])).toEqual({ forgot: "l4" })
    expect(goal.state.ledger.map((l) => l.id)).toEqual(["l2", "l3"])
    goal.set({ text: "Ship the parser", measure: "tests passing", target: "40" }, "owner")
    expect(goal.state.ledger.length).toBe(2) // the same goal re-set keeps its ledger
    const copy = new Goal({ clock })
    copy.restore(goal.snapshot())
    copy.note({ kind: "guess", text: "maybe 60 tests" }, "lead")
    expect(copy.state.ledger.at(-1).id).toBe("l5") // ids go on after a restore (l4 retired, never reused)
  })

  test("milestones: plan, claim keeps another agent off, released when the run ends, done needs evidence", async () => {
    at("2026-10-24T14:00:00Z")
    const goal = new Goal({ clock })
    goal.set({ text: "Ship the parser", measure: "tests passing" }, "owner")
    await expect(run(goal, "claim", { id: "lexer" })).rejects.toThrow("no plan yet: goal.plan first")
    await expect(run(goal, "plan", { items: "Lexer!: x" })).rejects.toThrow("id lowercase")
    expect(await run(goal, "plan", { items: "lexer: tokens for every construct | tests/lexer pass\nparser: an AST | tests/parser pass\n- docs: the README" })).toBe("plan: 3 open, 0 done")
    expect(goal.state.milestones[0]).toMatchObject({ id: "lexer", text: "tokens for every construct", check: "tests/lexer pass", status: "open", claim: null })
    // as the reply format hands them: "id: text" lines read as maps, or a literal \n (live 2026-10-24: one item stored)
    const other = new Goal({ clock })
    other.set({ text: "x", measure: "y" }, "owner")
    other.plan({ items: [{ a: "first | check a" }, { b: "second" }] }, "lead")
    other.plan({ items: "a: first | check a\\nb: second\\nc: third" }, "lead")
    expect(other.state.milestones.map((m) => `${m.id}:${m.text}:${m.check}`)).toEqual(["a:first:check a", "b:second:null", "c:third:null"])
    // two agents on the desk: a claim keeps the second one off the item
    let k = 0
    const a = new Agent({ name: "a", report: false }, { infer: async () => [json({ thought: "", calls: [{ tool: "goal.claim", input: { id: "lexer" } }] }), json({ thought: "", calls: [], answer: "working" })][k++] }).addArtifact(goal)
    const b = new Agent({ name: "b", report: false }, { infer: async () => json({ thought: "", calls: [], answer: "x" }) }).addArtifact(goal)
    const out = []
    a.on("result", (e) => out.push(e.output))
    goal.state.status = "paused" // no progress gate for this check
    await a.ask("take the lexer")
    expect(out[0]).toBe("claimed lexer — goal.done it with evidence before your run ends")
    expect(goal.state.milestones[0].claim).toBeNull() // a's run ended: released
    goal.claim({ id: "lexer" }, "a")
    expect(() => goal.claim({ id: "lexer" }, "b")).toThrow("lexer is claimed by a since 10-24 14:00 — take another open item (parser, docs)")
    expect(() => goal.done({ id: "lexer", evidence: "x" }, "b")).toThrow("only it marks it done")
    expect(() => goal.done({ id: "lexer" }, "a")).toThrow("evidence: its check (tests/lexer pass)")
    goal.done({ id: "lexer", evidence: "tests/lexer: 12/12" }, "a")
    expect(goal.render()).toContain("  [x] lexer: tokens for every construct | check: tests/lexer pass — tests/lexer: 12/12")
    // a new plan keeps the done item, drops the open one it leaves out, keeps a claim
    goal.claim({ id: "parser" }, "b")
    goal.plan({ items: "parser: an AST | tests/parser pass\nerrors: messages with line numbers" }, "a")
    expect(goal.state.milestones.map((m) => `${m.id}:${m.status}`)).toEqual(["lexer:done", "parser:open", "errors:open", "docs:dropped"])
    expect(goal.state.milestones.find((m) => m.id === "parser").claim.by).toBe("b")
    expect(goal.brief()).toContain("1/3 milestones")
    expect(goal.ownerCall("release", [{ id: "goal", milestone: "parser" }])).toEqual({ released: "parser" })
    const fresh = new Goal({ clock })
    fresh.restore(goal.snapshot())
    fresh.set({ text: "Ship the formatter", measure: "tests passing" }, "owner")
    expect(fresh.state.milestones).toEqual([]) // a new goal: a fresh plan and ledger
    // a restore never keeps a claim (its run is gone)
    goal.claim({ id: "parser" }, "b")
    const copy = new Goal({ clock })
    copy.restore(goal.snapshot())
    expect(copy.state.milestones.find((m) => m.id === "parser").claim).toBeNull()
    void b
  })

  test("stall: three runs not closer make the next resume a replan; closer or a new plan clears it", async () => {
    at("2026-10-24T14:00:00Z")
    const goal = new Goal({ clock })
    goal.set({ text: "Ship the parser", measure: "tests passing" }, "owner")
    for (const t of ["same", "further", "same"]) goal.progress({ did: "tried", result: "no change", toward: t, next: "try again" }, "lead")
    expect(goal.stalled).toBe(true)
    expect(goal.state.entries.some((e) => e.text?.startsWith("stalled: 3 runs in a row not closer"))).toBe(true)
    expect(goal.resumeText()).toContain("REPLAN FIRST: the last 3 runs did not move the measure closer")
    expect(goal.vars().mode).toContain("replan")
    expect(goal.render()).toContain("STALLED: 3 runs in a row not closer")
    expect(goal.brief()).toContain("active (stalled)")
    goal.plan({ items: "fresh: a new approach" }, "lead")
    expect(goal.stalled).toBe(false)
    goal.progress({ did: "a", result: "b", toward: "same", next: "c" }, "lead")
    goal.progress({ did: "a", result: "b", toward: "closer", next: "c" }, "lead")
    expect(goal.state.stall).toBe(0)
  })

  test("workflow: takeDue hands its id and the vars; the flow's report is the progress when no step recorded one", async () => {
    at("2026-10-24T14:00:00Z")
    const goal = new Goal({ clock })
    expect(() => goal.set({ text: "x", measure: "y", workflow: "bad id!" }, "owner")).toThrow("workflow: a workflow's id")
    goal.set({ text: "Ship the parser", measure: "tests passing", workflow: "goal-cycle" }, "owner")
    goal.ownerCall("now", [{}])
    const due = goal.takeDue(new Date("2026-10-24T14:00:01Z"))
    expect(due).toMatchObject({ workflow: "goal-cycle", vars: { goal: "Ship the parser", measure: "tests passing", milestones: "no plan yet", mode: "continue" } })
    goal.flowStarted("goal-cycle")
    goal.state.next_at = new Date(0).toISOString()
    expect(goal.takeDue(new Date("2026-10-24T15:00:00Z"))).toBeNull() // never twice while its flow runs
    goal.flowEnded({ ok: true, report: { toward: "closer", value: "12", did: "wrote the lexer", result: "12/40", next: "the parser" } })
    expect(goal.state.entries.at(-1)).toMatchObject({ kind: "progress", by: "goal-cycle", value: 12, toward: "closer", next: "the parser" })
    expect(goal.state.flow_run).toBeNull()
    // a step that recorded progress itself: the report is not recorded again
    goal.flowStarted("goal-cycle")
    goal.progress({ did: "judge", result: "13/40", value: 13, toward: "closer", next: "go on" }, "goal-cycle-judge")
    const n = goal.state.entries.filter((e) => e.kind === "progress").length
    goal.flowEnded({ ok: true, report: { toward: "closer", did: "x", result: "y", next: "z" } })
    expect(goal.state.entries.filter((e) => e.kind === "progress").length).toBe(n)
    // three failed flows pause it
    for (let i = 0; i < 3; i++) (goal.flowStarted("goal-cycle"), goal.flowEnded({ ok: false, error: "failed" }))
    expect(goal.state).toMatchObject({ status: "paused", reason: "3 runs in a row ended in an error" })
    expect(goal.ownerCall("workflow", [{ id: "goal", workflow: "none" }])).toEqual({ workflow: null })
  })

  test("the gate: only a holder with goal.progress, never a workflow's step agent", () => {
    at("2026-10-24T14:00:00Z")
    const goal = new Goal({ clock })
    goal.set({ text: "x", measure: "y" }, "owner")
    for (const name of ["lead", "step", "helper"]) goal.onRunStart({ name })
    expect(goal.gate({ name: "lead", tools: new Set(["goal.progress"]) })).toContain("the standing goal is active")
    expect(goal.gate({ name: "step", config: { managed: true }, tools: new Set(["goal.progress"]) })).toBeNull()
    expect(goal.gate({ name: "helper", tools: new Set(["goal.claim"]) })).toBeNull()
  })
})

test("a progress may book the next turn as soon as a minute (the critic hands back to the planner); the cadence keeps its 10", async () => {
  at("2026-10-25T10:00:00Z")
  const goal = new Goal({ clock })
  run(goal, "set", { text: "the goal card shows the live view", measure: "milestones done", why: "owner" })
  expect(await run(goal, "progress", { did: "judged", result: "1/3", toward: "closer", next: "plan the next feature", next_in_minutes: 1 })).toMatch(/the next run starts 10-25 10:01/)
  expect(await run(goal, "progress", { did: "judged", result: "1/3", toward: "same", next: "x", next_in_minutes: 0 })).toMatch(/10-25 10:01/)
  expect(() => run(goal, "set", { text: "the goal card shows the live view", measure: "milestones done", cadence_minutes: 1, why: "owner" })).not.toThrow()
  expect(goal.state.cadence_minutes).toBe(10)
})

test("goal.set start_in_minutes: the first run starts that soon (≥ 1 min), the cadence after", async () => {
  at("2026-10-25T11:00:00Z")
  const goal = new Goal({ clock })
  expect(await run(goal, "set", { text: "ship the live view", measure: "features done", cadence_minutes: 30, start_in_minutes: 1, why: "owner" })).toMatch(/its first run starts 10-25 11:01, then the desk resumes it every 30 min/)
  expect(goal.state.next_at).toBe("2026-10-25T11:01:00.000Z")
})
test("2026-10-27 request-to-loop: the owner's request adds one open milestone beside the others, its id from the text", async () => {
  at("2026-10-27T03:20:00Z")
  const goal = new Goal({ clock })
  expect(() => goal.ownerCall("request", [{ id: "goal", text: "x" }])).toThrow("no goal set yet")
  goal.set({ text: "Ship the parser", measure: "tests passing" }, "owner")
  goal.plan({ items: "lexer: tokens | tests/lexer pass\nparser: an AST" }, "lead")
  goal.claim({ id: "lexer" }, "lead")
  goal.done({ id: "lexer", evidence: "tests/lexer: 12/12" }, "lead")
  expect(() => goal.ownerCall("request", [{ id: "goal", text: "  " }])).toThrow("text: the feature you want")
  expect(await goal.ownerCall("request", [{ id: "goal", text: "Show a speaker on every answer card!" }])).toEqual({ milestone: "show-a-speaker-on-every" })
  expect(await goal.ownerCall("request", [{ id: "goal", text: "Lexer" }])).toEqual({ milestone: "lexer-2" })
  expect(await goal.ownerCall("request", [{ id: "goal", text: "Show a speaker on every answer card, again" }])).toEqual({ milestone: "show-a-speaker-on-ever-2" })
  expect(goal.state.milestones.map((m) => `${m.id}:${m.status}`)).toEqual(["lexer:done", "parser:open", "show-a-speaker-on-every:open", "lexer-2:open", "show-a-speaker-on-ever-2:open"])
  expect(goal.state.milestones.at(-2)).toMatchObject({ text: "Lexer", check: null, claim: null })
  // 2026-10-27 request-mark: a request is marked requested, its check to plan; a planned item is not
  expect(goal.state.milestones.at(-2)).toMatchObject({ requested: true, check: null })
  expect(goal.state.milestones.find((m) => m.id === "parser").requested).toBeUndefined()
  const lines = goal.milestoneLines()
  expect(lines.find((l) => l.includes("lexer-2:"))).toContain("| check: to plan · requested by owner")
  expect(lines.find((l) => l.includes("parser:"))).not.toContain("requested by owner")
})
