// The desk's composition, pure (2026-10-25 owner: "show me visually the construction of the object … design for
// composition principle … every architecture and workflow"): what each live object is made of, read from the twins the
// stream already carries — the build path from the desk folder to this tab, every agent as its slots (model, response
// and its gates, members, its tools by type), every artifact with its commands and holders, every workflow's steps.
// 2026-10-26 owner ("the composition can contain the abstract classes, the variables, the instances, and how to make
// changes such that it aligns to a standard"): a Classes region from the kernel's own description (kernel.classes,
// backend/kernel/classes.js) — each base with its variables, hooks and change recipe, each artifact class with what it is
// read to be (kind, view, keep, commands, owner calls, hooks, state) and whether it meets the standard; every live agent
// and artifact is joined to its class and says where a change to it goes.
// compositionBoard(agents, kernel) → {nodes, edges, frames, bounds}: fixed-size cards on a grid, so no DOM is measured
// (components/compose/ draws it; each card subscribes to its own agent or artifact for what changes live).

export const CARD = { w: 236, h: 112 }
const GAP = { x: 32, y: 40 }
const FRAME = { pad: 32, head: 84 }
const REGION_GAP = 110
const COLUMNS = 5 // artifacts per row

const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`
const list = (xs, n = 4) => (xs.length > n ? `${xs.slice(0, n).join(", ")} +${xs.length - n}` : xs.join(", "))

// The path every object takes, from the files the owner writes to the card on this page; each step's line read live.
const BUILD = [
  { id: "folder", layer: "config", title: "Desk folder", file: "custom/<desk>/ · desks/<desk>/", sub: (c) => `main.js · ${count(c.own, "agent file")} · ${count(c.flows, "workflow file")}`, what: "main.js, <lead>/<lead>.md (members as subfolders), tools.js, tools/, teams/, phases/, practice.md — the configuration is the object." },
  { id: "compose", layer: "build", title: "composeDesk", file: "companion/team/compose.js", sub: (c) => `${count(c.models.length, "model")} · default ${c.defaultModel ?? "—"}`, what: "Each agent file becomes a spec: tools, artifacts and models resolved by name; an unknown one is an Error naming the file." },
  { id: "desk", layer: "kernel", title: "Desk", file: "backend/kernel/desk/desk.js", sub: (c) => `${count(c.agents, "agent")} · ${count(c.teams, "team")} · ${count(c.artifacts, "artifact")}`, what: "buildDesk(spec, env): live Agents, a board per team; spawn and dismiss grow and shrink it at run time." },
  { id: "host", layer: "host", title: "Desk server", file: "companion/team/kernel-team.js", sub: () => "restored by keep · history.md per agent", what: "Serves the desk as the team: persistence, schedule, wakes, Telegram; the protocol itself is team-core.js." },
  { id: "stream", layer: "stream", title: "team/stream", file: "backend/live/team-core.js", sub: () => "snapshot → state · kernel · registry · log", what: "One protocol for both hosts (the desk server and the tab): every kernel event becomes a row or a patch." },
  { id: "tab", layer: "ui", title: "This tab", file: "backend/live/registry.js · signal.js", sub: () => "one signal per object → one card redraws", what: "The registry feeds every store; each card here subscribes to its own agent or artifact." },
]

// What a tool's type means for the loop (the kernel's types: tool.js, the kit, a desk's own).
export const TOOL_TYPES = {
  function: "a plain function: its result is data (the same call twice in 3 min answers from the first)",
  dev: "an artifact's command that changes the world — never answered from the cache",
  artifact: "an artifact's command that only changes the artifact",
  agent: "another agent: the call is a quest {requirement, ask, outcome}, the result its report",
  spawn: "helpers made at run time (agent.spawn / dismiss / catalog / update)",
  desk: "other desks: create, check, load, ask, read, propose",
  mcp: "a tool server's tool (always outside)",
}

// What a held artifact gates: the answer it may refuse (its gate(); hard ones never let through).
export const GATES = {
  practice: "the run's checklist and !reflect",
  checklist: "while a required item is open",
  report: "the report's missing fields",
  dispatch: "while a dispatched job runs (hard)",
  goal: "until this run's progress is recorded",
  preview: "while the owner's question is open",
  studio: "while its images are made",
  audio: "while its files are made",
  workflow: "a desk wake runs the workflow first",
}

const recipe = (steps = []) => steps.map((x, i) => `${i + 1}. ${x}`).join("\n")
const variables = (xs = []) => xs.map((x) => `${x.name} (${x.where}${x.key ? ` · ${x.key}` : ""}) — ${x.says}`).join("\n")
const hookLines = (xs = []) => xs.map((x) => `${x.name} — ${x.says}`).join("\n")
const CLASS_COLUMNS = 6

const STEP_KIND = { agent: "step agent", phase: "an agent's run", code: "code" }
const gateOf = (a) => GATES[a.kind] ?? null // by kind: a plan shows as a checklist but gates only when held with gate

// The tree's agents, lead first, depth-first (the order of their bands).
function treeOrder(tree, out = []) {
  if (!tree) return out
  out.push(tree.name)
  for (const t of tree.tools ?? []) if (t.type === "agent" && t.agent) treeOrder(t.agent, out)
  for (const a of tree.agents ?? []) treeOrder(a, out)
  return out
}

// How this agent's loop is configured: a desk agent, a team lead, a helper, a member, a workflow's step agent.
export function strategyOf(def, flows = []) {
  const s = def?.spawned
  const flow = s && flows.find((f) => def.name.startsWith(`${f}-`))
  if (flow) return `step agent of ${flow}`
  if (s) return s.team && s.team !== def.name ? `member of team ${s.team}` : `helper of ${s.by} · keep ${s.keep ?? "run"}`
  return def?.agents?.length ? "team lead" : def?.team ? `member of team ${def.team}` : "desk agent"
}

// What the board depends on: the tree, each artifact's place and each workflow's steps — never an artifact's state
// otherwise, so a patch redraws its card, not the board.
export function boardKey(kernel) {
  if (!kernel) return ""
  const arts = Object.values(kernel.artifacts ?? {}).map((a) => `${a.id}:${a.kind}:${a.view}:${a.keep}:${a.holders?.join("+")}:${a.state?.config?.revision ?? ""}`)
  return JSON.stringify([treeOrder(kernel.tree), kernel.defaultModel, kernel.models?.length, kernel.classes?.kinds?.length ?? 0, arts.sort()])
}
export const sameBoard = (a, b) => a === b || boardKey(a) === boardKey(b)

export function compositionBoard(agents = [], kernel = null) {
  const nodes = [], edges = [], frames = []
  const add = (n) => nodes.push({ w: CARD.w, h: CARD.h, details: [], ...n })
  const link = (from, to, label = null, kind = null) => edges.push({ from, to, label, kind })
  const defs = new Map(agents.filter(Boolean).map((a) => [a.name, a]))
  const order = [...new Set([...treeOrder(kernel?.tree), ...defs.keys()])].filter((n) => defs.has(n))
  const artifacts = Object.values(kernel?.artifacts ?? {}).sort((a, b) => a.id.localeCompare(b.id))
  const flows = artifacts.filter((a) => a.kind === "workflow")
  const flowIds = flows.map((f) => f.id)
  const classes = kernel?.classes ?? null
  const classOf = (kind) => classes?.kinds?.find((k) => k.kind === kind) ?? null
  const artifactBase = classes?.bases?.find((b) => b.name === "Artifact")
  const col = (i) => i * (CARD.w + GAP.x)
  const row = (i) => i * (CARD.h + GAP.y)
  let y = 0
  // A framed region: draw(top) adds its cards and returns their height.
  const region = (id, title, says, draw) => {
    const before = nodes.length
    const height = draw(y + FRAME.head)
    const w = Math.max(CARD.w, ...nodes.slice(before).map((n) => n.x + n.w))
    frames.push({ id, title, says, x: -FRAME.pad, y, w: w + FRAME.pad * 2, h: FRAME.head + height + FRAME.pad })
    y += FRAME.head + height + FRAME.pad + REGION_GAP
  }

  // 1 · the build path
  const ctx = {
    own: [...defs.values()].filter((d) => !d.spawned).length, flows: flows.length, models: kernel?.models ?? [], defaultModel: kernel?.defaultModel,
    agents: defs.size, teams: [...defs.values()].filter((d) => d.agents?.length).length, artifacts: artifacts.length,
  }
  region("build", "Build & stream", "From the files on disk to this card: each step's line is read from the desk now.", (top) => {
    BUILD.forEach((b, i) => {
      add({ id: `build:${b.id}`, layer: b.layer, tag: b.file, title: b.title, sub: b.sub(ctx), x: col(i), y: top, details: [["What", b.what], ["Where", b.file]] })
      if (i) link(`build:${BUILD[i - 1].id}`, `build:${b.id}`)
    })
    link("build:tab", "build:host", "team/call", "loop")
    return CARD.h
  })

  // 2 · the classes: what every object here is an instance of, its variables and where a change to it goes
  if (classes) region("classes", "Classes — the kernel's types and how to change them", "Read from the kernel itself (classes.js): each base, each artifact class, the standard they meet. A click lights its instances.", (top) => {
    const instances = {
      Desk: 1, Agent: defs.size, Tool: [...defs.values()].reduce((n, d) => n + (d.tools?.length ?? 0), 0),
      AgentTool: [...defs.values()].reduce((n, d) => n + (d.tools ?? []).filter((t) => t.type === "agent").length, 0),
      Artifact: artifacts.length, Checklist: artifacts.filter((a) => ["checklist", "plan"].includes(a.kind)).length,
    }
    const bases = classes.bases ?? []
    bases.forEach((b, i) => {
      add({
        id: `class:${b.name}`, layer: "kernel", tag: `${b.abstract ? "abstract class" : "class"}${b.extends ? ` · extends ${b.extends}` : ""}`, title: b.name,
        sub: `${count(instances[b.name] ?? 0, "instance")} here · ${b.says}`, x: col(i), y: top,
        details: [["What", b.says], ["File", b.file], ["Variables", variables(b.variables) || "—"], ["Hooks", hookLines(b.hooks) || "—"], ["How to change", recipe(b.change)], ["Tests", b.tests ?? "—"], ["Docs", b.docs ?? "—"]],
      })
      if (b.extends) link(`class:${b.name}`, `class:${b.extends}`, "extends")
    })
    const kinds = classes.kinds ?? [], aligned = kinds.filter((k) => !k.problems?.length).length
    add({
      id: "class:standard", layer: aligned === kinds.length ? "ui" : "stream", tag: "the standard", title: `${aligned} of ${kinds.length} aligned`, sub: "what every artifact class must declare", x: col(bases.length), y: top,
      details: [["Rules", (classes.standard ?? []).map((r) => `${r.rule} — ${r.says}`).join("\n")], ["Off the standard", kinds.filter((k) => k.problems?.length).map((k) => `${k.name}: ${k.problems.join("; ")}`).join("\n") || "none"], ["Check", "bun scripts/composition.js --check (also the dev desk's composition check)"]],
    })
    kinds.forEach((k, i) => {
      const live = artifacts.filter((a) => a.kind === k.kind)
      add({
        id: `class:${k.name}`, layer: k.problems?.length ? "stream" : k.type ? "host" : "kernel",
        tag: `${k.type ? `kit ${k.type}` : "kernel"} · extends ${k.extends ?? "—"}`, title: k.name,
        sub: `${count(live.length, "live")} · ${count(k.commands.length, "command")} · view ${k.view ?? "—"} · keep ${k.keep ?? "—"}${k.problems?.length ? ` · ${count(k.problems.length, "problem")}` : ""}`,
        x: col(i % CLASS_COLUMNS), y: top + row(1 + Math.floor(i / CLASS_COLUMNS)),
        details: [
          ["What", k.says || "— (no static about)"], ["File", k.file],
          ["Variables", [`kind ${k.kind ?? "—"} · view ${k.view ?? "—"} · keep ${k.keep ?? "—"}${k.poll ? ` · poll ${k.poll} ms` : ""} · commands type ${k.commandType ?? "dev"}`, k.options ? `options (main.js builtin.${k.type}): ${Object.entries(k.options).map(([o, says]) => `${o} — ${says}`).join("; ")}` : null, `state: ${k.state.join(", ") || "—"}`].filter(Boolean).join("\n")],
          ["Commands", k.commands.map((c) => `${k.type ?? k.kind}.${c.name}${c.usage ? ` ${c.usage}` : ""} — ${c.says}`).join("\n") || "none"],
          ["Owner calls", k.owner.join(", ") || "none"], ["Hooks it defines", k.hooks.join(", ") || "none"],
          ["Instances", live.map((a) => `${a.id} (held by ${(a.holders ?? []).join(", ") || "—"})`).join("\n") || "none on this desk"],
          ["Standard", k.problems?.length ? k.problems.join("\n") : "aligned"],
          ["How to change", `Edit ${k.file}: its statics (about, commands, owner) and constructor (kind, view, keep). ${k.type ? `Test: backend/kernel/test/builtin-${k.type}.test.js. ` : ""}Its view: components/views/artifact.jsx (view ${k.view ?? "—"}).\n${recipe(artifactBase?.change ?? [])}`],
        ],
      })
      link(`class:${k.name}`, `class:${k.extends ?? "Artifact"}`, null, "inst")
    })
    const tools = classes.tools ?? [], at = top + row(1 + Math.ceil(kinds.length / CLASS_COLUMNS))
    Object.entries(Object.groupBy(tools, (t) => t.type ?? "function")).forEach(([type, ts], i) => {
      add({
        id: `class:tools:${type}`, layer: "build", tag: `kit tools · ${type}`, title: count(ts.length, `${type} tool`), sub: list(ts.map((t) => t.name), 3), x: col(i), y: at,
        details: [["Type", TOOL_TYPES[type] ?? type], ["Tools", ts.map((t) => `${t.name}${t.outside ? " (outside)" : ""} — ${t.says}`).join("\n")], ["How to change", recipe(bases.find((b) => b.name === "Tool")?.change)]],
      })
      link(`class:tools:${type}`, "class:Tool", null, "inst")
    })
    return row(2 + Math.ceil(kinds.length / CLASS_COLUMNS)) - GAP.y
  })

  // 3 · every agent: the loop and its slots (model · response · artifacts · members, then its tools by type)
  region("agents", "Agents — a prompt and a tool loop", "Each agent is the same loop; what differs is what fills its slots.", (top) => {
    order.forEach((name, band) => {
      const def = defs.get(name), at = top + row(2 * band), id = `agent:${name}`
      const held = artifacts.filter((a) => a.holders?.includes(name))
      const gates = held.filter(gateOf).map((a) => `${a.id}: ${gateOf(a)}`)
      const strategy = strategyOf(def, flowIds)
      add({
        id, layer: "kernel", tag: strategy, title: name, sub: def.description ?? "", x: 0, y: at + row(1) / 2, ref: { agent: name },
        details: [
          ["Strategy", strategy], ["Folder", def.folder ?? "—"], ["Team", def.team || "—"], ...(def.spawned ? [["Spawned", `by ${def.spawned.by}: ${def.spawned.goal ?? ""}`]] : []),
          ["Class", "Agent (backend/kernel/agent/agent.js)"],
          ["How to change", def.spawned ? `A helper made at run time by ${def.spawned.by}: agent.update changes it (kept helpers wait for the owner). Its spawner's role decides what it gets.` : `This agent: its .md in ${def.folder ?? "its folder"} — frontmatter (model, max_steps, tools, artifacts, writes, reads …) and the body (its role). Every agent: backend/kernel/agent/agent.js.`],
        ],
      })
      if (classes) link(id, "class:Agent", null, "inst")
      const slots = [
        { slot: "model", title: def.model ?? kernel?.defaultModel ?? "default", tag: "model", sub: def.model ? "its own model" : "the desk's default", details: [["Swap", "any infer(prompt, agent, {images}); fallbacks per desk"], ["Desk models", list((kernel?.models ?? []).map((m) => m.label ?? m.key), 8) || "—"]] },
        { slot: "response", title: held.some((a) => a.kind === "report") ? "Reply + report" : "Reply", tag: "response contract", sub: gates.length ? `${count(gates.length, "gate")} on the answer` : "no gate on the answer", details: [["Format", "RESPONSE_FORMAT (+ REPORT_FORMAT with a report), or config.system"], ["Gates", gates.join("\n") || "none"]] },
        { slot: "artifacts", title: count(held.length, "artifact"), tag: "live state in the prompt", sub: list(held.map((a) => a.id)), details: held.map((a) => [a.id, `${a.kind} · view ${a.view} · keep ${a.keep}`]) },
        ...(def.agents?.length ? [{ slot: "members", title: count(def.agents.length, "member"), tag: "quests", sub: list(def.agents), details: [["Members", def.agents.join(", ")]] }] : []),
      ]
      slots.forEach((s, i) => {
        add({ id: `${id}:${s.slot}`, layer: "kernel", x: col(i + 1), y: at, ...s })
        link(`${id}:${s.slot}`, id)
      })
      Object.entries(Object.groupBy(def.tools ?? [], (t) => t.type ?? "function")).forEach(([type, tools], i) => {
        const outside = tools.filter((t) => t.outside).length
        add({
          id: `${id}:tools:${type}`, layer: type === "agent" ? "kernel" : "build", tag: TOOL_TYPES[type] ? `tools · ${type}` : "tools", title: count(tools.length, `${type} tool`), x: col(i + 1), y: at + row(1),
          sub: list(tools.map((t) => t.name), 3) + (outside ? ` · ${outside} outside` : ""),
          details: [["Type", TOOL_TYPES[type] ?? type], ["Views", [...new Set(tools.map((t) => t.view).filter(Boolean))].join(", ") || "—"], ["Tools", tools.map((t) => t.name).join(", ")]],
        })
        link(`${id}:tools:${type}`, id)
      })
      for (const a of held) link(`${id}:artifacts`, `artifact:${a.id}`, null, "x")
    })
    return Math.max(row(2 * order.length) - GAP.y, CARD.h)
  })

  // 4 · every artifact: its commands (the holders' tools under its id) and its view
  region("artifacts", "Artifacts — declared state, commands and a view", "Commands become tools, owner calls become buttons, the state flows out to its view.", (top) => {
    artifacts.forEach((a, i) => {
      const k = classOf(a.kind)
      const commands = [...new Set([...defs.values()].flatMap((d) => (d.tools ?? []).filter((t) => t.name.startsWith(`${a.id}.`)).map((t) => t.name.slice(a.id.length + 1))))]
      add({
        id: `artifact:${a.id}`, layer: a.kind === "workflow" ? "build" : "host", tag: `${a.kind} · view ${a.view}`, title: a.id, sub: `${count(commands.length, "command")} · keep ${a.keep} · ${list(a.holders ?? [], 2)}`,
        x: col(i % COLUMNS), y: top + row(Math.floor(i / COLUMNS)), ref: { artifact: a.id },
        details: [
          ["Title", a.title ?? a.id], ["Commands", commands.join(", ") || "none (owner calls only)"], ["Holders", (a.holders ?? []).join(", ") || "—"], ["Keep", a.keep ?? "—"], ["Gate", gateOf(a) ?? "none"],
          ...(k ? [["Class", `${k.name} (${k.file})`], ["How to change", `How it is held: the holders' .md (artifacts: [${k.type ?? a.kind}] — {type, id, commands, gate}${k.options ? `; main.js builtin.${k.type}` : ""}). What it is: ${k.file}. How it draws: components/views/artifact.jsx view ${a.view}.`]] : []),
        ],
      })
      if (k) link(`artifact:${a.id}`, `class:${k.name}`, null, "inst")
    })
    return Math.max(CARD.h, row(Math.ceil(artifacts.length / COLUMNS)) - GAP.y)
  })

  // 5 · every workflow: its steps in order, each waiting on its `after`
  if (flows.length) region("workflows", "Workflows — one file, its steps", "Each step is code, an agent's run, or a step agent spawned for the run; arrows are what it waits on.", (top) => {
    flows.forEach((f, r) => {
      const config = f.state?.config ?? {}, ry = top + row(r)
      add({ id: `flow:${f.id}`, layer: "build", tag: "workflow", title: config.title ?? f.id, sub: config.description ?? config.folder ?? "", x: 0, y: ry, ref: { artifact: f.id }, details: [["File", config.folder ?? "—"], ["Steps", String(config.steps?.length ?? 0)], ["Vars", Object.keys(config.vars ?? {}).join(", ") || "—"]] })
      ;(config.steps ?? []).forEach((s, i) => {
        const sid = `flow:${f.id}:${s.id}`, after = s.after ?? []
        add({ id: sid, layer: s.kind === "code" ? "host" : "kernel", tag: s.agent ? `agent ${s.agent}` : (STEP_KIND[s.kind] ?? s.kind), title: s.id, sub: s.title ?? "", x: col(i + 1), y: ry, details: [["Kind", STEP_KIND[s.kind] ?? s.kind ?? "—"], ["Waits on", after.join(", ") || "nothing"], ...(s.barrier ? [["Barrier", "yes"]] : [])] })
        if (!after.length) link(`flow:${f.id}`, sid)
        for (const p of after) link(`flow:${f.id}:${p}`, sid)
      })
    })
    return row(flows.length) - GAP.y
  })

  const ids = new Set(nodes.map((n) => n.id))
  const right = Math.max(...frames.map((f) => f.x + f.w))
  return { nodes, edges: edges.filter((e) => ids.has(e.from) && ids.has(e.to)), frames, bounds: { x: -FRAME.pad, y: 0, w: right + FRAME.pad, h: y - REGION_GAP } }
}

// Where an edge leaves and enters two cards: the sides that face each other, a cubic between them.
export function edgePath(a, b) {
  const side = (p, q) => {
    const dx = q.x + q.w / 2 - (p.x + p.w / 2), dy = q.y + q.h / 2 - (p.y + p.h / 2)
    return Math.abs(dx) * p.h > Math.abs(dy) * p.w
      ? { x: dx > 0 ? p.x + p.w : p.x, y: p.y + p.h / 2, dx: Math.sign(dx), dy: 0 }
      : { x: p.x + p.w / 2, y: dy > 0 ? p.y + p.h : p.y, dx: 0, dy: Math.sign(dy) }
  }
  const p = side(a, b), q = side(b, a)
  const k = Math.max(36, Math.min(150, Math.hypot(q.x - p.x, q.y - p.y) / 3))
  return { d: `M${p.x},${p.y} C${p.x + p.dx * k},${p.y + p.dy * k} ${q.x + q.dx * k},${q.y + q.dy * k} ${q.x},${q.y}`, mid: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 } }
}
