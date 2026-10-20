// Agents made at run time (2026-10-17): Desk.spawn / dismiss and the tools agent.spawn / agent.dismiss
// (backend/kernel/builtin/spawn.js). A helper answers its caller's quest, shows in the tree and its twin, is heard by
// taps added before it existed, never gets more than its caller, and is not dismissed while it runs.

import { describe, expect, test } from "bun:test"
import { Artifact, buildDesk, catalogTool, Checklist, dismissTool, Plan, Practice, respawn, SPAWN_NAME, spawnTool, Tool, updateTool } from "../index.js"

const quest = (ask) => ({ requirement: "the corpus is data/tiny.txt", ask, outcome: "the number" })

// Per agent, a list of replies (a function: called with the prompt); records every prompt.
function scripted(script) {
  const prompts = {}
  const infer = async (prompt, agent) => {
    ;(prompts[agent.name] ??= []).push(prompt)
    let next = script[agent.name]?.shift()
    if (typeof next === "function") next = await next(prompt)
    return JSON.stringify(next ?? { thought: "done", calls: [], answer: `${agent.name} ok` })
  }
  return { infer, prompts }
}

const count = new Tool({ name: "corpus.count", description: "count tokens", input: { path: "file" }, run: ({ path }) => `${path}: 1200 tokens` })
const secret = new Tool({ name: "lab.reset", description: "wipe the lab", run: () => "wiped" })

const deskOf = (infer, more = {}) =>
  buildDesk(
    {
      name: "lead",
      team: "lab",
      report: false,
      soul: "You work on the lab desk.",
      model: "opus",
      maxSteps: 9,
      writes: ["projects/**"],
      artifacts: [new Plan(), (agent) => Object.assign(new Checklist({ id: `${agent.name}.checklist`, items: [] }), { owner: "lab" })],
      tools: [spawnTool(), dismissTool(), count, { type: "agent", name: "coder", report: false, tools: [spawnTool(), count] }],
      ...more,
    },
    { infer, tools: { "lab.reset": secret }, artifacts: { notes: () => Object.assign(new Artifact({ name: "notes" }), { state: { n: 1 } }) } },
  )

describe("Desk.spawn through agent.spawn", () => {
  test("the helper answers its caller's quest, is in the tree and twin, and taps added before it hear it", async () => {
    const { infer, prompts } = scripted({
      lead: [
        { thought: "a helper counts", calls: [{ tool: "agent.spawn", input: { name: "counter", role: "Counts tokens.\nOnly counts.", goal: "count the corpus", tools: ["corpus.count"], artifacts: ["plan"], keep: "desk" } }] },
        { thought: "ask it", calls: [{ tool: "counter", input: quest("how many tokens?") }] },
        { thought: "done", calls: [], answer: "1200 tokens" },
      ],
      counter: [{ thought: "count", calls: [{ tool: "corpus.count", input: { path: "data/tiny.txt" } }] }, { thought: "done", calls: [], answer: "1200" }],
    })
    const desk = deskOf(infer)
    const heard = []
    desk.on((e) => heard.push(`${e.agent}:${e.event}`))
    expect(await desk.ask("count the corpus")).toBe("1200 tokens")
    const lead = desk.lead
    const counter = desk.agents().get("counter")
    // The spawn tool's answer, then the quest went to the helper and came back with its report.
    expect(prompts.lead[1]).toContain("agent.spawn → spawned counter — quest it with counter {requirement, ask, outcome} (stays until agent.dismiss)")
    expect(prompts.lead[1]).toContain("- counter {requirement, ask, outcome} — counter: count the corpus") // in # TOOLS at the next step
    expect(prompts.counter[0]).toContain("# REQUEST (from lead)\nREQUIREMENT: the corpus is data/tiny.txt")
    expect(prompts.counter[0].startsWith("You work on the lab desk.")).toBe(true) // the caller's soul
    expect(prompts.lead[2]).toContain("counter → 1200")
    // Taps added before it existed heard its run, and the desk's own spawn event.
    expect(heard).toContain("counter:spawn")
    expect(heard).toEqual(expect.arrayContaining(["counter:start", "counter:step", "counter:answer"]))
    // Inherited (never more than the caller), placed in the caller's team, its own tools only.
    expect(counter.config).toMatchObject({ model: "opus", maxSteps: 9, soul: "You work on the lab desk.", writes: ["projects/**"], report: false })
    expect(counter.home).toBe(desk)
    expect(counter.depth).toBe(1)
    expect(counter.parentBoard).toBe(lead.board)
    expect(counter.context).toBe(lead.context)
    expect(counter.teamPath).toBe("lab")
    expect([...counter.tools.keys()]).toEqual(["corpus.count", "plan.write", "plan.tick", "plan.skip", "lab.board.write"])
    expect(counter.tools.get("corpus.count")).toBe(count) // the caller's instance
    expect(lead.children.map((c) => c.name)).toEqual(["coder", "counter"])
    // The twin and the tree say who spawned it, for what, how long it stays.
    const spawned = { by: "lead", goal: "count the corpus", at: expect.any(String), keep: "desk" }
    expect(counter.twin().spawned).toEqual(spawned)
    expect(lead.twin().spawned).toBeNull()
    expect(lead.twin().agents).toEqual(["coder", "counter"])
    expect(desk.tree().agents.map((n) => n.name)).toEqual(["coder", "counter"])
    expect(desk.tree().agents[1]).toMatchObject({ name: "counter", spawned, tools: [{ name: "corpus.count", type: "function" }], agents: [] })
    expect(desk.tree().agents[0].spawned).toBeNull()
    expect(desk.artifacts().get("plan").holders).toEqual(["lead", "counter"])
    expect(desk.artifacts().get("lab.board").holders).toEqual(["lead", "coder", "counter"])
    expect(JSON.parse(JSON.stringify(desk.twin())).agents.map((a) => a.name)).toEqual(["lead", "coder", "counter"])
  })

  test("keep: run (the default) — dismissed when the caller's run ends; the dismiss reaches the taps", async () => {
    const { infer } = scripted({
      lead: [{ thought: "spawn", calls: [{ tool: "agent.spawn", input: { name: "helper", role: "helps", goal: "help once" } }] }, { thought: "ask", calls: [{ tool: "helper", input: quest("help?") }] }, { thought: "done", calls: [], answer: "helped" }],
    })
    const desk = deskOf(infer)
    const events = []
    desk.on((e) => ["spawn", "dismiss"].includes(e.event) && events.push(e))
    await desk.ask("go")
    expect(desk.agents().has("helper")).toBe(false)
    expect(desk.lead.tools.has("helper")).toBe(false)
    expect(desk.lead.children.map((c) => c.name)).toEqual(["coder"])
    expect(events.map((e) => [e.event, e.agent, e.by, e.goal])).toEqual([["spawn", "helper", "lead", "help once"], ["dismiss", "helper", "lead", "help once"]])
    expect(events[0].keep).toBe("run")
    // The name is free again: a later run spawns it anew.
    expect(desk.ctx.names.has("helper")).toBe(false)
  })

  test("dismiss: refused while it runs and for an agent that did not spawn it; a desk agent is never dismissed", async () => {
    let release
    const hold = new Promise((r) => (release = r))
    const { infer } = scripted({ slow: [async () => (await hold, { thought: "done", calls: [], answer: "slow done" })] })
    const desk = deskOf(infer)
    const slow = desk.spawn({ name: "slow", role: "waits", goal: "wait", keep: "desk" }, desk.lead)
    const running = slow.ask("wait")
    await Bun.sleep(5)
    expect(() => desk.dismiss("slow", "lead")).toThrow("slow is running: dismiss once it has answered")
    const coder = desk.agents().get("coder")
    expect(() => desk.dismiss("slow", "coder")).toThrow("slow was spawned by lead: only lead dismisses it")
    expect(() => desk.dismiss("coder")).toThrow("coder is part of the desk, not a spawned helper")
    expect(await dismissTool().run({ name: "coder" }, { agent: desk.lead }).catch((e) => e.message)).toBe("coder is part of the desk, not a spawned helper: it cannot be dismissed")
    release()
    expect(await running).toBe("slow done")
    expect(await dismissTool().run({ name: "slow" }, { agent: desk.lead })).toBe("dismissed slow")
    expect(desk.agents().has("slow")).toBe(false)
    expect(coder.home).toBe(desk)
  })

  test("a helper's helpers go with it; nested spawns count depth against maxDepth", async () => {
    const desk = deskOf(async () => "")
    const a = desk.spawn({ name: "aa", role: "r", goal: "g", keep: "desk", tools: [spawnTool()] }, desk.lead)
    const b = desk.spawn({ name: "bb", role: "r", goal: "g", keep: "desk" }, a)
    expect(b.depth).toBe(2)
    expect(desk.tree().agents[1].agents[0]).toMatchObject({ name: "bb", spawned: { by: "aa" } })
    expect(desk.dismiss("aa", "lead")).toEqual(["bb", "aa"])
    expect([...desk.agents().keys()]).toEqual(["lead", "coder"])
    const shallow = buildDesk({ name: "lead", report: false, tools: [spawnTool()] }, { infer: async () => "", maxDepth: 1 })
    const one = shallow.spawn({ name: "one", role: "r", goal: "g", keep: "desk" }, shallow.lead)
    expect(() => shallow.spawn({ name: "two", role: "r", goal: "g" }, one)).toThrow("two: nested too deep")
    expect([...shallow.agents().keys()]).toEqual(["lead", "one"]) // nothing left of the failed build
  })

  test("agent.spawn refuses what the caller does not have, bad names, shared run checklists; a failed spawn leaves nothing", async () => {
    const desk = deskOf(async () => "")
    const lead = desk.lead
    const spawn = (input, agent = lead) => spawnTool().run({ role: "r", goal: "g", ...input }, { agent }).catch((e) => e.message)
    expect(await spawn({ name: "X" })).toBe('name "X": lowercase letters, digits and -, 2–31 chars, starting with a letter')
    expect(await spawn({ name: "ok", role: "" })).toBe("role is required: what the helper is for and how it works")
    expect(await spawn({ name: "ok", goal: " " })).toBe("goal is required: the stated goal it works toward")
    expect(await spawn({ name: "ok", keep: "forever" })).toBe('keep "forever": run (dismissed when your run ends) or desk (until agent.dismiss)')
    expect(await spawn({ name: "ok", tools: ["coder"] })).toBe("coder is an agent: a helper does not quest your agents — give it tools, and quest coder yourself")
    expect(await spawn({ name: "ok", tools: ["plan.write"] })).toBe("plan.write is an artifact's command: list the artifact under artifacts instead")
    expect(await spawn({ name: "ok", tools: ["web.fetch"] })).toBe("unknown tool web.fetch; yours: agent.spawn, agent.dismiss, corpus.count; the desk's: lab.reset")
    expect(await spawn({ name: "ok", artifacts: ["lead.checklist"] })).toBe("lead.checklist is lab's run checklist: it is not shared (a helper's run would reset it)")
    expect(await spawn({ name: "ok", artifacts: ["nope"] })).toBe("unknown artifact nope; yours: plan, lead.checklist, lab.board; the desk's types: notes")
    expect(await spawn({ name: "coder" })).toBe("lead already has a tool named coder")
    expect(await spawn({ name: "lead" })).toBe("agent name lead used twice")
    expect([...desk.agents().keys()]).toEqual(["lead", "coder"])
    expect(lead.children.map((c) => c.name)).toEqual(["coder"])
    // A catalogue tool and type by name, the board listed anyway (it comes once), a commands subset of a held artifact.
    expect(await spawn({ name: "ok", tools: "lab.reset", artifacts: ["notes", "lab.board", { id: "plan", commands: ["tick"] }], keep: "desk" })).toBe("spawned ok — quest it with ok {requirement, ask, outcome} (stays until agent.dismiss)")
    const ok = desk.agents().get("ok")
    expect([...ok.tools.keys()]).toEqual(["lab.reset", "plan.tick", "lab.board.write"])
    expect(ok.artifacts.map((a) => a.id)).toEqual(["notes", "plan", "lab.board"])
    // A member (no board of its own) spawns into its own team: the board above it.
    const coder = desk.agents().get("coder")
    expect(await spawn({ name: "sub", tools: ["corpus.count"], keep: "desk" }, coder)).toContain("spawned sub")
    expect(desk.agents().get("sub").parentBoard).toBe(lead.board)
    // An agent outside any desk cannot spawn.
    expect(await spawnTool().run({ name: "zz", role: "r", goal: "g" }, { agent: { name: "lone" } }).catch((e) => e.message)).toBe("agent.spawn: lone is not part of a desk")
  })

  test("a failed build is undone: an unknown catalogue artifact type leaves no agent, name or holder", () => {
    const desk = deskOf(async () => "")
    const plan = desk.lead.artifacts.find((a) => a.id === "plan")
    expect(() => desk.spawn({ name: "half", role: "r", goal: "g", artifacts: [{ artifact: plan, gate: true }, { type: "nope" }] }, desk.lead)).toThrow("half: unknown artifact nope")
    expect(desk.agents().has("half")).toBe(false)
    expect(desk.ctx.names.has("half")).toBe(false)
    expect(plan.gated.has("half")).toBe(false)
    expect(desk.spawn({ name: "half", role: "r", goal: "g" }, desk.lead).name).toBe("half")
  })

  // 2026-10-17 (critic): a caller holding terminal [read, wait] gave its helper start and stop — by the type's name, or
  // by asking {id: "terminal", commands: ["start"]}. The caller's subset is now the helper's default and its bound.
  test("a helper never holds more of an artifact than its caller: the caller's subset by default, a command outside it refused", async () => {
    class Term extends Artifact {
      constructor(id = "terminal") {
        super({ name: id })
        this.kind = "terminal"
      }
      commands() {
        return ["read", "wait", "start", "stop"].map((c) => new Tool({ name: `${this.id}.${c}`, description: c, run: () => c }))
      }
    }
    const term = new Term() // the desk's one terminal; {type, id} makes a separate one
    const desk = buildDesk(
      { name: "lead", report: false, artifacts: [{ type: "terminal", commands: ["read", "wait"] }, new Plan()], tools: [spawnTool()] },
      { infer: async () => "", artifacts: { terminal: (_, spec) => (spec?.id && spec.id !== "terminal" ? new Term(spec.id) : term) } },
    )
    const lead = desk.lead
    const spawn = (input) => spawnTool().run({ role: "r", goal: "g", keep: "desk", ...input }, { agent: lead }).catch((e) => e.message)
    const tools = (name) => [...desk.agents().get(name).tools.keys()]
    // By the type's name (it is the caller's instance): the caller's subset.
    expect(await spawn({ name: "reader", artifacts: ["terminal"] })).toContain("spawned reader")
    expect(tools("reader")).toEqual(["terminal.read", "terminal.wait"])
    expect(desk.agents().get("reader").artifacts).toEqual([term])
    expect(desk.agents().get("reader").holding.get("terminal").commands).toEqual(["read", "wait"])
    // A command outside it, by id or by type, short or "<id>.<cmd>": refused, nothing built.
    expect(await spawn({ name: "starter", artifacts: [{ id: "terminal", commands: ["start"] }] })).toBe("start is not yours on terminal (yours: read, wait)")
    expect(await spawn({ name: "starter", artifacts: [{ type: "terminal", commands: "read, terminal.stop" }] })).toBe("stop is not yours on terminal (yours: read, wait)")
    expect(desk.agents().has("starter")).toBe(false)
    // Narrower is fine.
    expect(await spawn({ name: "narrow", artifacts: [{ type: "terminal", commands: ["read"] }] })).toContain("spawned narrow")
    expect(tools("narrow")).toEqual(["terminal.read"])
    // A fresh one of a type the caller holds only in part is bounded the same way.
    expect(await spawn({ name: "scratch", artifacts: [{ type: "terminal", id: "scratch" }] })).toContain("spawned scratch")
    expect(tools("scratch")).toEqual(["scratch.read", "scratch.wait"])
    expect(await spawn({ name: "wider", artifacts: [{ type: "terminal", id: "wide", commands: ["stop"] }] })).toBe("stop is not yours on wide (yours: read, wait)")
    // A caller that holds it whole (plan) shares any subset of it.
    expect(await spawn({ name: "ticker", artifacts: [{ id: "plan", commands: ["tick"] }] })).toContain("spawned ticker")
    expect(tools("ticker")).toEqual(["plan.tick"])
    // Desk.spawn itself: the caller's instance comes with the caller's subset; a catalogue type that resolves to it whole
    // is refused and the build undone.
    expect(desk.spawn({ name: "direct", role: "r", goal: "g", keep: "desk", artifacts: [term] }, lead).holding.get("terminal").commands).toEqual(["read", "wait"])
    expect(() => desk.spawn({ name: "sneak", role: "r", goal: "g", artifacts: ["terminal"] }, lead)).toThrow("start, stop are not yours on terminal (yours: read, wait)")
    expect(() => desk.spawn({ name: "sneak", role: "r", goal: "g", artifacts: [{ artifact: term, commands: ["stop"] }] }, lead)).toThrow("stop is not yours on terminal")
    expect(desk.agents().has("sneak")).toBe(false)
    expect(desk.ctx.names.has("sneak")).toBe(false)
  })

  test("Desk.spawn checks the name itself: '..', a path, an empty or upper-case name are refused, nothing left behind", () => {
    const desk = deskOf(async () => "")
    for (const bad of ["..", "a/b", "", "X", "-a", "../state"]) expect(() => desk.spawn({ name: bad, role: "r", goal: "g" }, desk.lead)).toThrow(`name "${bad}": lowercase letters, digits and -, 2–31 chars, starting with a letter`)
    expect([...desk.agents().keys()]).toEqual(["lead", "coder"])
    expect(SPAWN_NAME.test("ok-2")).toBe(true)
    expect(desk.spawn({ name: "ok-2", role: "r", goal: "g" }, desk.lead).name).toBe("ok-2")
  })

  test("a hand-built Desk spawns too; Desk.on's unsubscribe stops every agent's events, later ones too", async () => {
    const desk = buildDesk({ name: "lead", report: false }, { infer: async () => JSON.stringify({ thought: "d", calls: [], answer: "ok" }) })
    const seen = []
    const off = desk.on((e) => seen.push(e.event))
    const h = desk.spawn({ name: "hh", role: "r", goal: "g" }, desk.lead)
    off()
    await h.ask("go")
    await desk.lead.ask("go")
    expect(seen).toEqual(["spawn"])
  })
})

// 2026-10-20: the capability around spawn — agent.catalog (what a helper can be given), agent.update (a helper rebuilt
// with changed fields, or kept), respawn (kept helpers made again after a restart from their records).
describe("agent.catalog, agent.update, respawn", () => {
  const run = (tool, input, agent) => tool.run(input, { agent })
  const kit = () => deskOf(async () => JSON.stringify({ thought: "d", calls: [], answer: "ok" }))

  test("catalog: the caller's tools and the desk's with what each does, held artifacts with commands, models, lanes, helpers", async () => {
    const desk = kit()
    const lead = desk.lead
    await run(spawnTool(), { name: "counter", role: "Counts.", goal: "count the corpus", tools: ["corpus.count"], keep: "desk" }, lead)
    const out = await run(catalogTool(), {}, lead)
    expect(out).toContain("YOUR TOOLS (give by name): 3")
    expect(out).toContain("- corpus.count — count tokens")
    expect(out).toContain("THE DESK'S TOOLS you do not hold (give by name): 1\n- lab.reset — wipe the lab")
    expect(out).toContain("- plan (plan) — no plan yet · commands: write, tick, skip")
    expect(out).not.toContain("lead.checklist") // a run checklist is never given
    expect(out).toContain("ARTIFACT TYPES (a fresh one, or the desk's shared one by type): notes")
    expect(out).toContain("MODELS: any (yours: opus)")
    expect(out).toContain("LANES: writes projects/** · reads everywhere")
    expect(out).toContain("YOUR HELPERS NOW: 1\n- counter (keep desk) — idle · goal: count the corpus")
    const narrowed = await run(catalogTool(), { find: "wipe" }, lead)
    expect(narrowed).toContain("YOUR TOOLS (give by name) matching wipe: 0")
    expect(narrowed).toContain("- lab.reset — wipe the lab")
  })

  test("update: changed fields rebuild the helper (its record the base); keep switches; only its spawner; a bad change restores the old one", async () => {
    const desk = kit()
    const lead = desk.lead
    const events = []
    desk.on((e) => (e.event === "spawn" || e.event === "dismiss" ? events.push(`${e.event}:${e.agent}${e.reason ? `:${e.reason}` : ""}`) : null))
    await run(spawnTool(), { name: "counter", role: "Counts.", goal: "count the corpus", tools: ["corpus.count"] }, lead)
    const first = desk.agents().get("counter")
    expect(first.config.spawned.keep).toBe("run")
    expect(await run(updateTool(), { name: "counter", role: "Counts, then checks the sum.", keep: "desk" }, lead)).toBe("updated counter: role, keep desk")
    const next = desk.agents().get("counter")
    expect(next).not.toBe(first)
    expect(next.config.role).toBe("Counts, then checks the sum.")
    expect(next.config.description).toBe("Counts, then checks the sum.") // from the new role
    expect(next.config.spawned).toMatchObject({ keep: "desk", at: first.config.spawned.at, input: { role: "Counts, then checks the sum.", tools: ["corpus.count"], goal: "count the corpus" } })
    expect(lead.tools.get("counter").agent).toBe(next)
    expect(events).toEqual(["spawn:counter", "dismiss:counter:update", "spawn:counter"])
    await expect(run(updateTool(), { name: "counter" }, lead)).rejects.toThrow("nothing to change")
    await expect(run(updateTool(), { name: "counter", tools: ["no.such"] }, lead)).rejects.toThrow("counter not updated (unknown tool no.such")
    expect(desk.agents().get("counter").config.spawned.input.tools).toEqual(["corpus.count"]) // the old one is back
    await expect(run(updateTool(), { name: "coder", role: "x" }, lead)).rejects.toThrow("coder is part of the desk")
    const coder = desk.agents().get("coder")
    await run(spawnTool(), { name: "mine", role: "r", goal: "g" }, coder)
    await expect(run(updateTool(), { name: "mine", role: "x" }, lead)).rejects.toThrow("mine was spawned by coder: only coder updates it")
  })

  test("respawn: kept helpers made again by their spawners from their records; a missing spawner or tool is skipped with a line", async () => {
    const desk = kit()
    const lines = []
    const done = await respawn(
      desk,
      [
        { by: "lead", at: "2026-10-19T12:00:00.000Z", input: { name: "scout", role: "Scouts.", goal: "scout", tools: ["corpus.count"], members: [{ name: "eye", role: "Looks.", tools: ["corpus.count"] }] } },
        { by: "ghost", input: { name: "lost", role: "r", goal: "g" } },
        { by: "lead", input: { name: "bad", role: "r", goal: "g", tools: ["no.such"] } },
        { by: "lead", input: { name: "coder", role: "r", goal: "g" } },
      ],
      { log: (l) => lines.push(l) },
    )
    expect(done).toEqual(["scout"])
    const scout = desk.agents().get("scout")
    expect(scout.config.spawned).toMatchObject({ by: "lead", keep: "desk", at: "2026-10-19T12:00:00.000Z", team: "scout" })
    expect(desk.agents().get("eye").config.spawned).toMatchObject({ by: "scout", team: "scout" })
    expect(lines).toEqual(["kept lost: its spawner ghost is not in the desk — not restored", expect.stringContaining("kept bad: not restored (unknown tool no.such"), "kept coder: an agent of that name is in the desk already — not restored"])
  })

  test("a caller's practice is never a helper's: its run would reset the caller's checklist and its edits rewrite the caller's orders", async () => {
    const desk = deskOf(async () => "", { artifacts: [(agent) => new Practice({ id: `${agent.name}.practice`, owner: agent.name, seed: { checklist: ["!x: y"] } })] })
    const spawn = (input) => spawnTool().run({ role: "r", goal: "g", ...input }, { agent: desk.lead }).catch((e) => e.message)
    expect(await spawn({ name: "ok", artifacts: ["lead.practice"] })).toBe("lead.practice is lead's practice: it is not shared (give the helper its own: artifacts [practice])")
    expect([...desk.agents().keys()]).toEqual(["lead", "coder"])
  })
})
