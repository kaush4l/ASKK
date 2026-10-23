// The workflow viewer's model (components/workflow/), pure. A workflow is a loop over phases (2026-10-22 owner: "a loop
// over phase elements … they carry data between them in the form variables and provide the output report format
// document"), so every phase is drawn as INPUT → WORK → OUTPUT: what it reads (its {{variables}} and where each comes
// from), how it runs (an agent, its own agent, one research call, the desk's code) and what it hands on (its report
// fields). The definition (the workflow twin's config) and the run (its stage rows, pipelineView) merge here.

const SETTLED = new Set(["done", "reused", "failed", "skipped", "stopped", "interrupted"])

// How a step runs, in a word and a detail.
export function howRuns(x) {
  if (!x) return { label: "", detail: "" }
  if (x.kind === "code") return { label: "code", detail: x.code ? `the desk's ${x.code}` : "the desk's code" }
  if (x.own) return { label: "own agent", detail: x.step_agent ?? "spawned for the run" }
  if (x.kind === "phase" || x.kind === "agent") return { label: "agent", detail: x.agent ?? "" }
  return { label: "research", detail: [x.model && x.model !== "default" ? x.model : "one research call", x.max_turns ? `${x.max_turns} turns` : null].filter(Boolean).join(" · ") }
}

// What a step reads: its {{variables}}, each from the run or from an upstream phase (a field, or its whole report); a
// research step's whole earlier documents (inputs); a phase on the shared board, the board.
export function readsOf(x, config) {
  if (!x) return { vars: [], inputs: [], board: false }
  const ids = new Set((config?.steps ?? []).map((s) => s.id))
  const vars = (x.uses ?? []).map((u) => {
    const p = u.split(".")[0]
    return ids.has(p) ? { name: u, from: p, kind: u.includes(".") ? "field" : "report" } : { name: u, from: "run", kind: "run" }
  })
  const inputs = (x.inputs ?? []).filter((i) => !vars.some((v) => v.from === i)).map((i) => ({ name: i, from: i, kind: i === "all" ? "all" : "document" }))
  const phased = x.kind === "phase" || (x.own && x.report?.length > 0)
  const first = (config?.steps ?? []).findIndex((s) => s.id === x.id) <= 0
  const board = phased && !first && (x.board ?? config?.settings?.board) !== false
  return { vars, inputs, board }
}

// What a step hands on: its report fields (each {{id.field}} for later phases), else its ```data, else its document.
export function handsOn(x) {
  if (!x) return []
  if (x.report?.length) return x.report.map((f) => ({ name: `${x.id}.${f}`, field: f }))
  if (x.kind === "code") return [{ name: x.id, field: "data" }]
  if (x.schema) return [{ name: x.id, field: `data (${x.schema})` }]
  return [{ name: x.id, field: "document" }]
}

// The flow's shape: each step's depth (one more than the deepest step it waits on — its `after`, what it reads, and a
// code step above it marked barrier: true, as the engine waits), the groups of steps at one depth (they may run together), and the edges — `after` (it
// waits) and `data` (it reads a phase it does not wait on directly).
export function flowLayout(steps) {
  const depth = new Map()
  for (const [i, s] of (steps ?? []).entries()) {
    // the engine's waitsOf (kernel builtin/workflow.js): after, the earlier steps it reads (its inputs — all: every one —
    // and the {{step}} its text names), and every code step above it marked barrier: true
    const named = (s.inputs ?? []).includes("all") ? steps.slice(0, i).map((x) => x.id) : (s.inputs ?? []).filter((x) => depth.has(x))
    const used = (s.uses ?? []).map((u) => u.split(".")[0]).filter((x) => depth.has(x))
    const waits = [...(s.after ?? []), ...named, ...used, ...steps.slice(0, i).filter((x) => x.kind === "code" && x.barrier === true).map((x) => x.id)]
    depth.set(s.id, Math.max(-1, ...waits.map((a) => depth.get(a) ?? -1)) + 1)
  }
  const groups = []
  for (const s of steps ?? []) (groups[depth.get(s.id)] ??= []).push(s.id)
  const edges = []
  for (const s of steps ?? []) {
    for (const a of s.after ?? []) edges.push({ from: a, to: s.id, kind: "after", vars: (s.uses ?? []).filter((u) => u.split(".")[0] === a) })
    const direct = new Set(s.after ?? [])
    for (const p of new Set((s.uses ?? []).map((u) => u.split(".")[0]))) if (!direct.has(p) && depth.has(p)) edges.push({ from: p, to: s.id, kind: "data", vars: (s.uses ?? []).filter((u) => u.split(".")[0] === p) })
  }
  return { groups: groups.filter(Boolean), edges, depth: Object.fromEntries(depth) }
}

// The phases as the viewer draws them: the definition (config steps) merged with this run's rows (pipelineView stages):
// how each runs, what it reads and hands on, its status and time, and whether its wording changed since its output
// (edited: the definition's revision is not the one it ran with).
export function phaseCards(config, stages) {
  const steps = config?.steps ?? []
  const rows = new Map((stages ?? []).map((r) => [r.id, r]))
  const ids = steps.length ? steps.map((s) => s.id) : (stages ?? []).map((r) => r.id)
  return ids.map((id) => {
    const x = steps.find((s) => s.id === id) ?? null
    const r = rows.get(id) ?? null
    const status = r?.status ?? "waiting"
    const ran = r && status !== "waiting" && status !== "skipped"
    return {
      id,
      n: x?.n ?? r?.n ?? 0,
      title: x?.title ?? r?.title ?? id,
      kind: x?.kind ?? r?.kind ?? "research",
      how: howRuns(x ?? r),
      reads: readsOf(x, config),
      hands: handsOn(x ?? r),
      status,
      elapsed: r?.elapsed ?? "",
      at: r?.at ?? "",
      agent: r?.agent ?? null,
      turns: r?.turns ?? null,
      tools: r?.tools ?? 0,
      cost: r?.cost ?? null,
      gate: r?.gate ?? null,
      error: r?.error ?? null,
      last: r?.last ?? null,
      run: r?.run ?? null,
      flow: r?.flow ?? null, // 2026-10-23: what flowed in (by source, sizes), the prompt's size, what came out (pipeline.js flowOf)
      key: r?.key ?? `${id}|config`,
      edited: !!(x?.rev && r?.rev && ran && x.rev !== r.rev),
      lastEdited: !!(x?.rev && r?.last?.rev && x.rev !== r.last.rev),
      row: r,
      step: x,
    }
  })
}

// The run's progress: one segment per phase (its status), how many settled, the share done.
export function progressOf(cards) {
  const total = cards.length
  const settled = cards.filter((c) => SETTLED.has(c.status)).length
  return { total, settled, share: total ? settled / total : 0, segments: cards.map((c) => ({ id: c.id, status: c.status })) }
}

// The live line (what the run does right now): the phases running, each with its time, turns and calls.
export function nowLine(cards, { status } = {}) {
  const running = cards.filter((c) => c.status === "running")
  if (running.length) return running.map((c) => ({ id: c.id, title: c.title, text: [c.elapsed, c.turns ? `${c.turns} turn${c.turns === 1 ? "" : "s"}` : null, c.tools ? `${c.tools} call${c.tools === 1 ? "" : "s"}` : null].filter(Boolean).join(" · "), agent: c.agent }))
  if (status === "running") {
    const next = cards.find((c) => c.status === "waiting")
    return next ? [{ id: next.id, title: next.title, text: "starting", agent: null }] : []
  }
  return []
}

// Where a load error points in the file: the `## <id>` heading it names ("x.md ## outline: …"), as a line (1-based).
export function errorLine(error, text) {
  const id = String(error ?? "").match(/## ([a-z][a-z0-9-]*)/)?.[1]
  if (!id) return null
  const i = String(text ?? "").split("\n").findIndex((l) => new RegExp(`^## +${id}(\\s|$)`).test(l))
  return i < 0 ? null : i + 1
}

// The character offset of a phase's heading in a workflow file (the editor opens there), else 0.
export function phaseOffset(text, id) {
  const m = String(text ?? "").match(new RegExp(`^## +${String(id).replace(/[^a-z0-9-]/g, "")}(\\s|$)`, "m"))
  return m ? m.index : 0
}

// A report's fields side by side, this run's and the one before: [{field, now, before, same}].
export function compareFields(fields, now, before) {
  const names = fields?.length ? fields : [...new Set([...Object.keys(now ?? {}), ...Object.keys(before ?? {})])]
  return names.map((f) => ({ field: f, now: now?.[f] ?? null, before: before?.[f] ?? null, same: (now?.[f] ?? null) === (before?.[f] ?? null) }))
}
