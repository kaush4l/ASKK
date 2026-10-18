// Sub-teams at run time (2026-10-17 owner: "let the lead, when required, be able to create a sub team to focus on
// special critical observation and in control on a layer"): agent.spawn {members} / {template} builds a team under
// its caller (backend/kernel/builtin/spawn.js, Desk.spawn), every member bounded by the caller, its files lanes
// narrowed (globCovers, builtin/files.js), and the team goes whole.

import { describe, expect, test } from "bun:test"
import { AgentTool, Artifact, buildDesk, dismissTool, globCovers, inLane, Plan, spawnTool, Tool } from "../index.js"

const quest = (ask) => ({ requirement: "layer 3 of the tiny model", ask, outcome: "the number" })

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

// The desk's one terminal: the lead holds only list, read and wait of it.
class Term extends Artifact {
  constructor(id = "terminal") {
    super({ name: id })
    this.kind = "terminal"
  }
  commands() {
    return ["list", "read", "wait", "start", "stop"].map((c) => new Tool({ name: `${this.id}.${c}`, description: c, run: () => c }))
  }
}

const count = new Tool({ name: "corpus.count", description: "count tokens", input: { path: "file" }, run: ({ path }) => `${path}: 1200 tokens` })
const OBSERVATORY = {
  name: "observatory",
  role: "Watches every run.\nCharts first, then a finding with numbers.",
  goal: "chart every run's loss",
  tools: ["corpus.count"],
  artifacts: [{ type: "plan", gate: true }],
  writes: ["projects/*/obs/**"],
  model: "haiku",
  max_steps: 40,
  members: [
    { name: "grapher", role: "Plots the metrics.", writes: ["projects/*/obs/charts/**"] },
    { name: "analyst", role: "Probes grad norms.", tools: ["corpus.count"], artifacts: [{ id: "terminal", commands: ["read"] }] },
  ],
}

function deskOf(infer, { lead = {}, env = {} } = {}) {
  const term = new Term()
  const context = { tag: "the lab desk's context" }
  const desk = buildDesk(
    {
      name: "lead",
      team: "lab",
      report: false,
      soul: "You work on the lab desk.",
      model: "opus",
      maxSteps: 9,
      writes: ["projects/**", "shared/**", "!projects/*/secret/**"],
      artifacts: [new Plan(), { type: "terminal", commands: ["list", "read", "wait"] }],
      tools: [spawnTool(), dismissTool(), count, { type: "agent", name: "coder", report: false }],
      ...lead,
    },
    { infer, context, tools: { "lab.reset": new Tool({ name: "lab.reset", run: () => "wiped" }) }, artifacts: { terminal: () => term }, models: ["opus", "haiku"], templates: { observatory: OBSERVATORY }, ...env },
  )
  return { desk, term, context }
}

const spawnAs = (agent, input) =>
  spawnTool()
    .run({ role: "r", goal: "g", keep: "desk", ...input }, { agent })
    .catch((e) => `ERROR ${e.message}`)

describe("globCovers: is one lane glob inside another", () => {
  test("covers", () => {
    for (const [outer, inner] of [
      ["projects/**", "projects/*/eval/**"],
      ["**", "anything/at/all.md"],
      ["**", "**"],
      ["**", "x/*/y-*.tsv"],
      ["notes-*.md", "notes-a.md"],
      ["notes-*.md", "notes-*.md"],
      ["projects/**", "projects/tiny/runs/1/metrics.jsonl"],
      ["projects/", "projects/a.md"], // a trailing / is /**
      ["./projects/**", "projects/a/**"],
      ["projects/**", "projects"], // a last ** covers none too: the folder itself
      ["a/*", "a/b"],
      ["a/*", "a/*"],
      ["a*", "a?"],
      ["a/**/b", "a/b"],
      ["a/**/b", "a/x/*/b"],
      ["desks/**", "desks/*/.project.json"],
      ["a/b", "a/b"],
    ])
      expect([outer, inner, globCovers(outer, inner)]).toEqual([outer, inner, true])
  })

  test("does not cover (conservative)", () => {
    for (const [outer, inner] of [
      ["shared/*/notes.md", "shared/**"],
      ["a/*", "a/**"],
      ["a/*", "a/b/c"],
      ["a/b", "a/c"],
      ["notes-*.md", "notes-a.txt"],
      ["notes-*.md", "*"],
      ["a?", "a*"], // a ? never stands for an inner *
      ["projects/*/eval/**", "projects/**"],
      ["a/*/b", "a/**/b"],
      ["projects/**", "data/x"],
      ["!projects/**", "projects/a"],
      ["projects/**", "!projects/a"],
      ["", "a"],
      ["a", ""],
    ])
      expect([outer, inner, globCovers(outer, inner)]).toEqual([outer, inner, false])
  })

  test("what it says is covered is in the lane (inLane) for every sample path the inner glob takes", () => {
    const paths = ["projects/tiny/eval/x.json", "projects/tiny/train.py", "projects/a/b/eval/c", "shared/x/notes.md", "shared/notes.md", "a/b", "a/b/c", "a/x/y/b", "notes-a.md", "notes-.md", "desks/dev/.project.json"]
    const globs = ["projects/**", "projects/*/eval/**", "shared/*/notes.md", "shared/**", "a/*", "a/**", "a/**/b", "a/*/b", "notes-*.md", "notes-a.md", "**", "desks/**", "desks/*/.project.json"]
    for (const outer of globs)
      for (const inner of globs) {
        if (!globCovers(outer, inner)) continue
        for (const p of paths) if (inLane([inner], p)) expect([outer, inner, p, inLane([outer], p)]).toEqual([outer, inner, p, true])
      }
  })
})

describe("agent.spawn {members}: a sub-team under its caller", () => {
  test("the team: its own board under the caller's, members as its quest tools, every agent wired, taps hear members, one spawn event each", async () => {
    const { infer, prompts } = scripted({
      lead: [
        {
          thought: "a team watches layer 3",
          calls: [
            {
              tool: "agent.spawn",
              input: {
                name: "probe",
                role: "Watches layer 3.\nQuests grads and acts.",
                goal: "watch layer 3",
                keep: "desk",
                members: [
                  { name: "grads", role: "Reads grad norms.", tools: ["corpus.count"] },
                  { name: "acts", role: "Reads activations.", model: "haiku", artifacts: [{ id: "terminal", commands: ["read"] }] },
                ],
              },
            },
          ],
        },
        { thought: "ask the team", calls: [{ tool: "probe", input: quest("grad norm of layer 3?") }] },
        { thought: "done", calls: [], answer: "0.42" },
      ],
      probe: [{ thought: "grads", calls: [{ tool: "grads", input: quest("grad norm?") }] }, { thought: "done", calls: [], answer: "0.42" }],
      grads: [{ thought: "count", calls: [{ tool: "corpus.count", input: { path: "runs/1" } }] }, { thought: "done", calls: [], answer: "0.42" }],
    })
    const { desk, context } = deskOf(infer)
    const lead = desk.lead
    const heard = []
    desk.on((e) => heard.push(e))
    expect(await desk.ask("watch layer 3")).toBe("0.42")
    expect(prompts.lead[1]).toContain("agent.spawn → spawned team probe (lead probe; members grads, acts; board probe.board) — quest or dispatch probe {requirement, ask, outcome} (stays until agent.dismiss)")
    const [probe, grads, acts] = ["probe", "grads", "acts"].map((n) => desk.agents().get(n))
    // Its own board, whose parent is the caller's team board.
    expect(probe.board.name).toBe("probe.board")
    expect(probe.board.parent).toBe(lead.board)
    expect(lead.board.children).toContain(probe.board)
    expect(lead.board.snapshot().children.map((c) => c.id)).toEqual(["probe.board"])
    expect(probe.board.state.goal).toBe("watch layer 3")
    // Members are its quest tools; it is the caller's.
    expect(probe.tools.get("grads")).toBeInstanceOf(AgentTool)
    expect(probe.tools.get("grads").agent).toBe(grads)
    expect(probe.tools.get("acts").agent).toBe(acts)
    expect(lead.tools.get("probe").agent).toBe(probe)
    expect(probe.children).toEqual([grads, acts])
    expect(prompts.probe[0]).toContain("- grads {requirement, ask, outcome} — Reads grad norms.")
    expect(prompts.probe[0]).toContain("# probe.board — probe board")
    // Every new agent: the desk, the caller's context, the caller's soul and model unless set, its spawn record.
    for (const a of [probe, grads, acts]) {
      expect(a.home).toBe(desk)
      expect(a.context).toBe(context)
      expect(a.context).toBe(lead.context)
      expect(a.config.soul).toBe("You work on the lab desk.")
      expect(a.config.maxSteps).toBe(9)
      expect(a.config.writes).toEqual(lead.config.writes)
      expect(a.config.spawned).toEqual({ by: a === probe ? "lead" : "probe", goal: "watch layer 3", at: expect.any(String), keep: "desk", team: "probe" })
    }
    expect([probe.config.model, grads.config.model, acts.config.model]).toEqual(["opus", "opus", "haiku"])
    expect(grads.depth).toBe(2)
    expect(grads.parentBoard).toBe(probe.board)
    expect(grads.artifacts.map((x) => x.id)).toEqual(["probe.board"]) // its team's board, not the caller's
    expect([...acts.tools.keys()]).toEqual(["terminal.read", "probe.board.write"])
    // Taps added before the team existed heard a member's run; one spawn event per agent, the team's lead first.
    expect(heard.filter((e) => e.agent === "grads").map((e) => e.event)).toEqual(expect.arrayContaining(["spawn", "start", "step", "call", "result", "answer"]))
    expect(heard.filter((e) => e.event === "spawn").map((e) => [e.agent, e.by, e.goal, e.keep, e.team])).toEqual([
      ["probe", "lead", "watch layer 3", "desk", "probe"],
      ["grads", "probe", "watch layer 3", "desk", "probe"],
      ["acts", "probe", "watch layer 3", "desk", "probe"],
    ])
    // The tree and the twin: the team under the lead, its members under it.
    expect(desk.tree().agents.map((n) => n.name)).toEqual(["coder", "probe"])
    expect(desk.tree().agents[1]).toMatchObject({ name: "probe", team: "probe", agents: [{ name: "grads" }, { name: "acts" }] })
    expect(desk.artifacts().get("probe.board").holders).toEqual(["probe", "grads", "acts"])
    expect(desk.artifacts().get("terminal").holders).toEqual(["lead", "acts"])
  })

  test("a plain helper (no members) is as before: no team field, today's text", async () => {
    const { desk } = deskOf(async () => "")
    expect(await spawnAs(desk.lead, { name: "solo" })).toBe("spawned solo — quest it with solo {requirement, ask, outcome} (stays until agent.dismiss)")
    const solo = desk.agents().get("solo")
    expect(solo.config.spawned).toEqual({ by: "lead", goal: "g", at: expect.any(String), keep: "desk" })
    expect(solo.board).toBeNull()
  })
})

describe("agent.spawn {template}: a team from the desk's teams/", () => {
  test("role, goal, tools, artifacts, lanes, model, max_steps and members from the template; members named <team>-<member>", async () => {
    const { desk } = deskOf(async () => "")
    const lead = desk.lead
    expect(await spawnTool().run({ template: "observatory" }, { agent: lead })).toBe(
      "spawned team observatory (lead observatory; members observatory-grapher, observatory-analyst; board observatory.board) — quest or dispatch observatory {requirement, ask, outcome} (dismissed when this run ends)",
    )
    const obs = desk.agents().get("observatory")
    expect(obs.config).toMatchObject({ role: OBSERVATORY.role, goal: "chart every run's loss", model: "haiku", maxSteps: 40, writes: ["projects/*/obs/**", "!projects/*/secret/**"] })
    expect([...obs.tools.keys()]).toEqual(["corpus.count", "observatory-grapher", "observatory-analyst", "plan.write", "plan.tick", "plan.skip", "observatory.board.write"])
    expect(lead.artifacts.find((a) => a.id === "plan").gated.has("observatory")).toBe(true) // gate: true kept
    const grapher = desk.agents().get("observatory-grapher")
    const analyst = desk.agents().get("observatory-analyst")
    expect(grapher.config.writes).toEqual(["projects/*/obs/charts/**", "!projects/*/secret/**"])
    expect(grapher.config.model).toBe("opus") // the caller's, unless the member sets it
    expect(analyst.config.writes).toEqual(lead.config.writes) // not set: the caller's
    expect([...analyst.tools.keys()]).toEqual(["corpus.count", "terminal.read", "observatory.board.write"])
    expect(analyst.config.spawned).toMatchObject({ by: "observatory", team: "observatory", keep: "run" })
  })

  test("the input's own fields win; unknown template names the templates", async () => {
    const { desk } = deskOf(async () => "")
    const lead = desk.lead
    const said = await spawnTool().run({ template: "observatory", name: "obs-l3", goal: "watch layer 3 only", role: "Watches layer 3.", max_steps: 12, keep: "desk" }, { agent: lead })
    expect(said).toContain("spawned team obs-l3 (lead obs-l3; members obs-l3-grapher, obs-l3-analyst; board obs-l3.board)")
    expect(said).toContain("(stays until agent.dismiss)")
    expect(desk.agents().get("obs-l3").config).toMatchObject({ role: "Watches layer 3.", goal: "watch layer 3 only", maxSteps: 12, model: "haiku" })
    expect(desk.agents().get("obs-l3").board.state.goal).toBe("watch layer 3 only")
    // Inline members replace the template's and keep their names.
    expect(await spawnAs(lead, { template: "observatory", name: "obs-b", members: [{ name: "solo-m", role: "alone" }] })).toContain("members solo-m;")
    expect(await spawnAs(lead, { template: "nope" })).toBe("ERROR unknown template nope; templates: observatory")
    const bare = buildDesk({ name: "lead", report: false, tools: [spawnTool()] }, { infer: async () => "" })
    expect(await spawnAs(bare.lead, { template: "data" })).toBe("ERROR unknown template data; templates: none (the desk has no teams/)")
  })
})

describe("bounds: every member within the caller", () => {
  test("a member asking a command the caller lacks, or an agent tool, is refused and nothing is built", async () => {
    const { desk, term } = deskOf(async () => "")
    const lead = desk.lead
    const size = desk.list.length
    const names = [...desk.ctx.names]
    const kids = [...lead.board.children]
    const tried = [
      [{ name: "ok-one", role: "fine" }, { name: "starter", role: "starts runs", artifacts: [{ id: "terminal", commands: ["start"] }] }],
      [{ name: "ok-one", role: "fine" }, { name: "starter", role: "starts runs", artifacts: [{ type: "terminal", commands: ["read", "terminal.stop"] }] }],
      [{ name: "quester", role: "quests", tools: ["coder"] }],
      [{ name: "commander", role: "ticks", tools: ["plan.tick"] }],
      [{ name: "", role: "nameless" }],
      [{ name: "roleless" }],
      [{ name: "lead", role: "a name used twice" }],
    ]
    const said = []
    for (const members of tried) said.push(await spawnAs(lead, { name: "crew", members }))
    expect(said).toEqual([
      "ERROR member starter: start is not yours on terminal (yours: list, read, wait)",
      "ERROR member starter: stop is not yours on terminal (yours: list, read, wait)",
      "ERROR member quester: coder is an agent: a helper does not quest your agents — give it tools, and quest coder yourself",
      "ERROR member commander: plan.tick is an artifact's command: list the artifact under artifacts instead",
      "ERROR members: each member needs a name",
      "ERROR member roleless: role is required: what it is for and how it works",
      "ERROR agent name lead used twice",
    ])
    expect(desk.list.length).toBe(size)
    expect([...desk.ctx.names]).toEqual(names)
    expect(lead.board.children).toEqual(kids)
    expect(lead.tools.has("crew")).toBe(false)
    // By the type's name, a member gets the caller's subset — never more.
    expect(await spawnAs(lead, { name: "crew", members: [{ name: "reader", role: "reads", artifacts: ["terminal"] }] })).toContain("spawned team crew")
    expect([...desk.agents().get("reader").tools.keys()]).toEqual(["terminal.list", "terminal.read", "terminal.wait", "crew.board.write"])
    // Desk.spawn itself bounds every member it builds (an instance with a command the caller lacks) and undoes it all.
    const before = desk.list.length
    expect(() => desk.spawn({ name: "sneak", role: "r", goal: "g", tools: [{ type: "agent", name: "sneaker", role: "r", artifacts: [{ artifact: term, commands: ["stop"] }] }] }, lead)).toThrow("stop is not yours on terminal")
    expect(() => desk.spawn({ name: "sneak", role: "r", goal: "g", tools: [{ type: "agent", name: "sneaker", role: "r", artifacts: ["terminal"] }] }, lead)).toThrow("start, stop are not yours on terminal (yours: list, read, wait)")
    expect(() => desk.spawn({ name: "sneak", role: "r", goal: "g", tools: [{ type: "agent", name: "Bad_Name", role: "r" }] }, lead)).toThrow('name "Bad_Name"')
    expect(desk.list.length).toBe(before)
    expect(desk.ctx.names.has("sneak") || desk.ctx.names.has("sneaker")).toBe(false)
    expect(lead.board.children.map((b) => b.id)).toEqual(["crew.board"]) // the half-built team's board left too
  })
})

describe("lanes: writes and reads narrow, never widen", () => {
  test("covered globs pass with the caller's exclusions appended; an uncovered one is outside your lane; defaults unchanged", async () => {
    const { desk } = deskOf(async () => "")
    const lead = desk.lead
    const cfg = (name) => desk.agents().get(name).config
    expect(await spawnAs(lead, { name: "narrow", writes: ["projects/tiny/**", "shared/*/notes.md"] })).toContain("spawned narrow")
    expect(cfg("narrow").writes).toEqual(["projects/tiny/**", "shared/*/notes.md", "!projects/*/secret/**"])
    expect(await spawnAs(lead, { name: "evals", writes: "projects/*/eval/**" })).toContain("spawned evals") // as text too
    expect(cfg("evals").writes).toEqual(["projects/*/eval/**", "!projects/*/secret/**"])
    expect(await spawnAs(lead, { name: "wide", writes: ["projects/tiny/**", "data/**"] })).toBe("ERROR writes: data/** is outside your lane (yours: projects/**, shared/**, !projects/*/secret/**)")
    expect(await spawnAs(lead, { name: "wide", writes: ["**"] })).toBe("ERROR writes: ** is outside your lane (yours: projects/**, shared/**, !projects/*/secret/**)")
    expect(desk.agents().has("wide")).toBe(false)
    // Not given: the caller's, as before; reads stays unset (the caller reads everywhere).
    expect(await spawnAs(lead, { name: "same" })).toContain("spawned same")
    expect(cfg("same").writes).toEqual(lead.config.writes)
    expect(cfg("same").reads).toBeUndefined()
    // A caller without reads reads everywhere: any reads lane is narrower.
    expect(await spawnAs(lead, { name: "reader", reads: ["anything/**", "projects/*/out/**"] })).toContain("spawned reader")
    expect(cfg("reader").reads).toEqual(["anything/**", "projects/*/out/**"])
    // A caller with a reads lane bounds the helper's (and its exclusions come along).
    const critic = desk.spawn({ name: "critic", role: "r", goal: "g", keep: "desk", tools: [spawnTool()], reads: ["projects/*/out/**", "!projects/*/out/raw/**"] }, lead)
    expect(await spawnAs(critic, { name: "sub-ok", reads: ["projects/tiny/out/**"] })).toContain("spawned sub-ok")
    expect(cfg("sub-ok").reads).toEqual(["projects/tiny/out/**", "!projects/*/out/raw/**"])
    expect(await spawnAs(critic, { name: "sub-bad", reads: ["projects/**"] })).toBe("ERROR reads: projects/** is outside your lane (yours: projects/*/out/**, !projects/*/out/raw/**)")
    expect(await spawnAs(critic, { name: "sub-def" })).toContain("spawned sub-def")
    expect(cfg("sub-def").reads).toEqual(critic.config.reads)
    // A caller that writes nothing gives no write lane.
    const reader = desk.agents().get("reader")
    reader.config.writes = undefined
    reader.addTool(spawnTool())
    expect(await spawnAs(reader, { name: "w2", writes: ["projects/a/**"] })).toBe("ERROR writes: projects/a/** is outside your lane (yours: none)")
    // Members: the same rule, against the caller.
    expect(await spawnAs(lead, { name: "crew", members: [{ name: "m-ok", role: "r", writes: ["shared/x/**"] }, { name: "m-bad", role: "r", writes: ["data/**"] }] })).toBe(
      "ERROR member m-bad: writes: data/** is outside your lane (yours: projects/**, shared/**, !projects/*/secret/**)",
    )
    expect(desk.agents().has("m-ok")).toBe(false)
  })

  test("model: one the desk knows; max_steps: 1–300; defaults the caller's", async () => {
    const { desk } = deskOf(async () => "")
    const lead = desk.lead
    expect(await spawnAs(lead, { name: "m1", model: "gpt-9" })).toBe("ERROR unknown model gpt-9; models: opus, haiku")
    expect(await spawnAs(lead, { name: "m1", members: [{ name: "m1-a", role: "r", model: "gpt-9" }] })).toBe("ERROR member m1-a: unknown model gpt-9; models: opus, haiku")
    expect(await spawnAs(lead, { name: "m1", model: "haiku" })).toContain("spawned m1")
    expect(desk.agents().get("m1").config.model).toBe("haiku")
    for (const bad of [0, 301, 2.5, "lots", -1]) expect(await spawnAs(lead, { name: "s1", max_steps: bad })).toBe(`ERROR max_steps ${JSON.stringify(bad)}: a whole number from 1 to 300`)
    expect(await spawnAs(lead, { name: "s1", max_steps: 300 })).toContain("spawned s1")
    expect(desk.agents().get("s1").config.maxSteps).toBe(300)
    expect(await spawnAs(lead, { name: "s2", max_steps: "1" })).toContain("spawned s2")
    expect(desk.agents().get("s2").config.maxSteps).toBe(1)
    expect(await spawnAs(lead, { name: "s3" })).toContain("spawned s3")
    expect(desk.agents().get("s3").config).toMatchObject({ maxSteps: 9, model: "opus" })
    // Without a model list on the desk any name passes.
    const open = buildDesk({ name: "lead", report: false, tools: [spawnTool()] }, { infer: async () => "" })
    expect(await spawnAs(open.lead, { name: "any", model: "local-7b" })).toContain("spawned any")
  })
})

describe("a team goes whole", () => {
  test("keep run: the whole team is dismissed after the caller answers, once the team's runs have ended", async () => {
    let release
    const hold = new Promise((r) => (release = r))
    const { infer } = scripted({
      lead: [
        { thought: "a crew", calls: [{ tool: "agent.spawn", input: { name: "crew", role: "Leads a1 and a2.", goal: "check the loss", members: [{ name: "a1", role: "checks" }, { name: "a2", role: "checks too" }] } }] },
        { thought: "ask", calls: [{ tool: "crew", input: quest("loss?") }] },
        { thought: "done", calls: [], answer: "loss 2.1" },
      ],
      crew: [{ thought: "a1", calls: [{ tool: "a1", input: quest("loss?") }] }, { thought: "done", calls: [], answer: "2.1" }],
      // a1's second run (started outside the lead's quests — a dispatch, say) is still going when the lead answers
      a1: [{ thought: "done", calls: [], answer: "2.1" }, async () => (await hold, { thought: "done", calls: [], answer: "late" })],
    })
    const { desk } = deskOf(infer)
    const lead = desk.lead
    const events = []
    desk.on((e) => ["spawn", "dismiss"].includes(e.event) && events.push(`${e.event} ${e.agent}`))
    let late
    lead.on("answer", () => (late = desk.agents().get("a1").ask("one more look")))
    await desk.ask("go")
    // The lead answered, a1 still runs: the team waits.
    expect(desk.agents().get("a1").status).toBe("running")
    expect(["crew", "a1", "a2"].every((n) => desk.agents().has(n))).toBe(true)
    release()
    expect(await late).toBe("late")
    await Bun.sleep(5)
    expect(["crew", "a1", "a2"].some((n) => desk.agents().has(n))).toBe(false)
    expect(lead.tools.has("crew")).toBe(false)
    expect(lead.board.children).toEqual([])
    expect(lead.board.snapshot().children).toEqual([])
    expect(events).toEqual(["spawn crew", "spawn a1", "spawn a2", "dismiss a1", "dismiss a2", "dismiss crew"])
    expect(["crew", "a1", "a2"].some((n) => desk.ctx.names.has(n))).toBe(false)
  })

  test("dismissing the team's lead takes its members and unlinks its board; a member alone is refused", async () => {
    const { desk } = deskOf(async () => "")
    const lead = desk.lead
    expect(await spawnAs(lead, { template: "observatory", keep: "desk" })).toContain("spawned team observatory")
    const board = desk.agents().get("observatory").board
    expect(lead.board.snapshot().children.map((c) => c.id)).toEqual(["observatory.board"])
    const dismiss = (name, agent = lead) => dismissTool().run({ name }, { agent }).catch((e) => `ERROR ${e.message}`)
    expect(await dismiss("observatory-grapher")).toBe("ERROR observatory-grapher is a member of team observatory: dismiss the team (observatory), its members go with it")
    expect(() => desk.dismiss("observatory-grapher")).toThrow("is a member of team observatory") // the owner too
    expect(await dismiss("observatory-grapher", desk.agents().get("observatory"))).toContain("ERROR observatory-grapher is a member of team observatory")
    expect(desk.agents().has("observatory-grapher")).toBe(true)
    expect(await dismiss("observatory")).toBe("dismissed observatory-grapher, observatory-analyst, observatory")
    expect([...desk.agents().keys()]).toEqual(["lead", "coder"])
    expect(lead.board.children).not.toContain(board)
    expect(lead.board.snapshot().children).toEqual([])
    // A member that leaves alone never unlinks its team's board (the hook's agent check).
    board.parent.children.push(board)
    board.detach({ board: null })
    expect(lead.board.children).toContain(board)
    board.detach()
    expect(lead.board.children).not.toContain(board)
  })
})
