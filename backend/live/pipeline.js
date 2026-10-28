// The pipeline view's model (components/views/pipeline.jsx), pure: a desk's staged workflow artifact (view "pipeline":
// custom/<desk>/lib/workflow.js) → rows the view draws, and the owner's calls on it (team call target artifact).
//   state: {status, run: {id, by, from, note, started, ended}, stages: [{id, n, title, status, started, ms, tools,
//           sources: [{name, query?, url?}], head, error}], result | card: {decision, text, problems, levels},
//           note: {label, mirrored}, learnings: {pending: [{id, text, evidence, source}], accepted}, events?, watch?,
//           runs, prompts, config: {folder, settings, steps: [{file, id, n, kind, title, after, inputs, schema, derive,
//           code, check, model, max_turns, seconds}], error}}; a stage row's flow: {in: [{kind, from, chars}],
//           prompt_chars, out: {text_chars, data: [keys], code: [keys]}}. The owner's `stage` call reads one whole.

import { teamCall } from "./stream"

export const pipelineCall = (id, method, extra = {}) => teamCall("artifact", method, [{ id, ...extra }])

// One stage of the last run, whole: {text, data, code, problems, prompt, flow} (a code step: {state}).
export const stageDetail = (id, stage) => pipelineCall(id, "stage", { stage })

// One stage's output before this run (its row's `last`): the same shape, from that run's files.
export const lastOutput = (id, stage) => pipelineCall(id, "stage", { stage, last: true })

// One step of the workflow folder as written: {file, kind, title, after, inputs, tools, code, agent, schema, derive, check,
// model, max_turns, seconds, from, body (its prompt), vars ({{names}} it uses), example (the ```data it must end with),
// source: {name, text, revision, shared} | null (the file itself, when the desk lets the owner edit it)}.
export const stepFile = (id, step) => pipelineCall(id, "step", { step })

// The owner rewrites a step's file (kernel Workflow.editStep: refused when it changed since `revision`, rolled back when
// the workflow would not load) → {saved, revision, changed, next_run}.
export const editStep = (id, step, text, revision) => pipelineCall(id, "edit", { step, text, revision })

// The owner's Run: the flow with what it is for (request), its run variables (the workflow's `vars:`), from a phase.
export const runWorkflow = (id, { request = "", vars = null, from = null, note = null } = {}) => pipelineCall(id, "run", { request, ...(vars ? { vars } : {}), ...(from ? { from } : {}), ...(note ? { note } : {}) })

// The workflow's file as written (read even when it does not load): {name, text, revision, files, versions}.
export const workflowSource = (id, name = null) => pipelineCall(id, "source", name ? { name } : {})

// A draft checked, never written: {ok: true, config} (the workflow it would be) | {ok: false, error}.
export const checkWorkflow = (id, name, text) => pipelineCall(id, "check", { name, text })

// The owner saves a file of the workflow (refused when it changed since `revision`, or when it would not load; the old
// text kept as a version) → {saved, revision, changed, next_run}.
export const saveWorkflow = (id, name, text, revision) => pipelineCall(id, "edit", { name, text, revision })

// An earlier text of a file (a version a save replaced) → {name, text, at, revision}.
export const workflowVersion = (id, file) => pipelineCall(id, "version", { file })

// One price level of a result (a desk's card, e.g. custom/trade-card: {symbol, kind, side, price, path, active_from?}) in a
// line: "SPY tp1 512.4 above — path · from 10:00".
export function levelLine(l) {
  if (!l || typeof l !== "object") return String(l ?? "")
  const head = [l.symbol, l.kind, l.price, l.side].filter((x) => x != null && x !== "").join(" ")
  return `${head}${l.path ? ` — ${l.path}` : ""}${l.active_from ? ` · from ${l.active_from}` : ""}`
}

// The stage the viewer shows while it follows the run (2026-10-22 owner: "the UI should follow live the workflow
// progress"): the one running (the newest started of several), else — a run going — the next one waiting, else the
// last that settled, else the first.
export function followStage(stages, running = false) {
  const list = stages ?? []
  const live = list.filter((s) => s.status === "running")
  if (live.length) return live.reduce((a, b) => (Date.parse(b.startedAt ?? 0) > Date.parse(a.startedAt ?? 0) ? b : a)).id
  if (running) {
    const next = list.find((s) => s.status === "waiting")
    if (next) return next.id
  }
  const settled = list.filter((s) => ["done", "failed", "stopped", "reused", "interrupted"].includes(s.status))
  return settled.at(-1)?.id ?? list[0]?.id ?? null
}

// When a stage's whole detail must be read again (the viewer re-reads on a change, never polls): its status, document,
// time, turns, reads, gate or refusals moved.
export const stageKey = (x) => [x.id, x.status, x.file ?? "", x.ms ?? "", x.turns ?? "", x.tools ?? 0, x.gate ? (x.gate.ok ? "ok" : x.gate.problems?.length ?? 1) : "", x.refused ?? 0, x.shadow ? `${x.shadow.status}:${x.shadow.ms ?? ""}:${x.shadow.differs?.length ?? ""}` : ""].join("|")

// A stage's shadow (kernel workflow.js runShadow, 2026-10-25 the A/B): the same stage run beside it as the other kind.
// → {label ("B · research" | "B · step agent"), status, elapsed, gate: ok | n problems | null, problems, agent, compare
// ("3 of 9 data fields differ: side, top, …" | "data agrees" | null), error, cost, file} | null
export function shadowView(sh, now = Date.now()) {
  if (!sh) return null
  const live = sh.status === "running" && sh.started
  const compare = sh.differs ? (sh.differs.length ? `${sh.differs.length} of ${sh.differs.length + (sh.same ?? 0)} data fields differ: ${sh.differs.slice(0, 6).join(", ")}${sh.differs.length > 6 ? ", …" : ""}` : "data agrees") : null
  return {
    label: `B · ${sh.kind === "agent" ? "step agent" : "research"}`,
    status: sh.status ?? "running",
    elapsed: live ? took(now - Date.parse(sh.started)) : sh.ms ? took(sh.ms) : "",
    gate: sh.gate ? (sh.gate.ok ? "ok" : `${sh.gate.problems?.length ?? 1} problems`) : null,
    problems: sh.gate?.problems ?? [],
    agent: sh.agent ?? null,
    turns: sh.turns || null,
    tools: sh.tools ?? 0,
    compare,
    error: sh.error ?? null,
    cost: sh.cost_usd ? `$${sh.cost_usd.toFixed(2)}` : null,
    file: sh.file ?? null,
  }
}

const VAR_KIND = { var: "template", rules: "rules", lessons: "learnings", owner_note: "owner note", note: "memory note", carry: "carry", market: "live market", news: "news", state: "state", input: "code step", data: "data", code: "code results", document: "whole document", gate: "gate failed", failed: "failed", expect: "expected", card_rows: "card rows" }

// A stage's variables (kernel stepVariables / a desk's own) as the viewer draws them: each with what it is, where it came
// from, its size, a one-line preview and its whole text (JSON indented; markdown kept for a document).
export function varsView(vars) {
  return (vars ?? []).map((v) => {
    const isText = typeof v.value === "string"
    const text = v.value == null ? "" : isText ? v.value : JSON.stringify(v.value, null, 1)
    const flat = v.value == null ? "" : isText ? v.value : JSON.stringify(v.value)
    return { name: v.name, kind: v.kind, label: VAR_KIND[v.kind] ?? v.kind, from: v.from ?? "", size: size(v.chars ?? flat.length), preview: v.missing ? "not filled by this run" : flat.replace(/\s+/g, " ").slice(0, 140), text, markdown: isText && (v.kind === "document" || v.kind === "rules" || v.kind === "note"), missing: !!v.missing, clipped: !!v.clipped, empty: v.value == null && !v.missing }
  })
}

// 12.3k, 840
export const size = (n) => (!(n > 0) ? "0" : n < 1000 ? String(n) : `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`)

const FLOW_ORDER = ["carry", "market", "state", "note", "data", "code", "document", "gate", "failed", "card_rows", "rules", "lessons", "owner_note"]
const FLOW_LABEL = { carry: "carry", market: "live market", state: "state", note: "memory note", data: "data", code: "code results", document: "whole document", gate: "gate failed", failed: "failed", card_rows: "card rows", rules: "rules.md", lessons: "accepted learnings", owner_note: "owner note" }

// What flowed into a stage, grouped by kind: [{kind, label, from: [ids], chars}], in FLOW_ORDER (rules last: every stage
// reads them); the prompt's size; what came out (data and code result keys).
export function flowOf(flow) {
  if (!flow) return null
  const groups = new Map()
  for (const r of flow.in ?? []) {
    const g = groups.get(r.kind) ?? { kind: r.kind, label: FLOW_LABEL[r.kind] ?? r.kind, from: [], chars: 0 }
    if (!g.from.includes(r.from)) g.from.push(r.from)
    g.chars += r.chars ?? 0
    groups.set(r.kind, g)
  }
  const ins = [...groups.values()].sort((a, b) => FLOW_ORDER.indexOf(a.kind) - FLOW_ORDER.indexOf(b.kind))
  return { in: ins, prompt: flow.prompt_chars ? size(flow.prompt_chars) : null, out: flow.out ? { text: size(flow.out.text_chars), data: flow.out.data ?? [], code: flow.out.code ?? [] } : null }
}

// The thesis record (a desk's theses.json, scored by code): each one in a line — what it claims, the level that proves
// it, the levels that break it, and code's last verdict.
const lvl = (x) => `${x.op === "ABOVE" ? ">" : "<"} ${x.level}`
export function thesesView(theses) {
  if (!theses) return null
  const row = (t) => ({
    id: t.id,
    head: `${t.symbol} ${t.side} · target ${lvl(t.target)} · ${t.horizon_days} session${t.horizon_days === 1 ? "" : "s"} from ${t.opened}`,
    falsify: (t.falsify ?? []).map((f) => `${f.symbol} ${lvl(f)}`).join(", "),
    claim: t.claim,
    status: t.status,
    last: t.last ? `${t.last.date} ${t.last.result}${Object.keys(t.last.px ?? {}).length ? ` (${Object.entries(t.last.px).map(([s, p]) => `${s} ${p}`).join(", ")})` : ""}` : "not scored yet",
    touches: (t.touches ?? []).map((x) => `${x.hm} ${x.role} ${x.level} at ${x.px}`),
  })
  const k = theses.track ?? {}
  return { open: (theses.open ?? []).map(row), closed: (theses.closed ?? []).map(row), track: `${k.confirmed ?? 0} confirmed · ${k.falsified ?? 0} falsified · ${k.expired ?? 0} expired · ${k.closed ?? 0} closed` }
}

// Calibration (a desk's calibration.json, recomputed by code from its records): per book (paper, real) the overall line
// and the rows by regime, playbook, mode and stated p; the theses' line. rate and gap as percentages.
const pct = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`)
const signed = (x) => (x == null ? "—" : `${x > 0 ? "+" : ""}${Math.round(x * 100)}`)
const calRow = (label, c) => ({ label, n: c.n, hits: c.hits, rate: pct(c.rate), mean_p: pct(c.mean_p), gap: signed(c.gap), tp1: c.tp1, invalidated: c.invalidated })
export function calibrationView(cal, { rows = 6 } = {}) {
  if (!cal?.predictions) return null
  const book = (b, name) => {
    if (!b?.all?.n) return { name, empty: true, all: calRow("all", b?.all ?? { n: 0, hits: 0 }), groups: [] }
    const group = (title, m) => ({ title, rows: Object.entries(m ?? {}).slice(0, rows).map(([k, c]) => calRow(k, c)) })
    return { name, empty: false, all: calRow("all", b.all), groups: [group("regime", b.by_regime), group("playbook", b.by_playbook), group("mode", b.by_mode), group("stated p", b.by_p)].filter((g) => g.rows.length) }
  }
  const t = cal.theses?.all ?? { n: 0 }
  return {
    books: [book(cal.predictions.paper, "paper"), book(cal.predictions.real, "real")],
    theses: t.n ? `${t.n} resolved · ${pct(t.rate)} confirmed (${t.confirmed} confirmed · ${t.falsified} falsified · ${t.expired} expired)${["UP", "DOWN"].filter((s) => cal.theses.by_side?.[s]?.n).map((s) => ` · ${s} ${pct(cal.theses.by_side[s].rate)} of ${cal.theses.by_side[s].n}`).join("")}` : "no thesis resolved yet",
    at: cal.at ?? null,
  }
}

// The workflow's live log (its twin's ring, today): {time (ET HH:MM:SS), text, kind}, oldest first.
export function logView(log) {
  const lines = log?.lines ?? []
  return lines.map((l) => ({ time: l.at ? new Date(l.at).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "", text: l.text, kind: l.kind ?? "run" }))
}

// The calibration gate's setting in one phrase.
export const gateLine = (g) => (g.enabled ? `calibration gate: ${g.by.join(" + ")} with ≥ ${g.min_n} ${g.book} calls, hit < ${Math.round(g.min_rate * 100)}% or said p ${Math.round(g.max_gap * 100)} over → ${g.cap}` : "calibration gate off")

// The workflow folder as rows: the settings in short phrases and every step with how it runs.
export function configView(config) {
  if (!config) return null
  const s = config.settings
  const settings = s
    ? [
        `deadline ${s.deadline_minutes} min`,
        `retries ${s.retries}`,
        ...(s.concurrency > 0 ? [`≤ ${s.concurrency} steps at once`] : []), // 2026-10-23
        ...(s.note_stage ? [`note ${s.note_stage}`] : []),
        ...("mirror" in s ? [s.mirror ? `mirror Notes › ${s.mirror}` : "no mirror"] : []),
        ...(s.critical?.length ? [`critical ${s.critical.join(", ")}`] : []),
        ...(s.slots ? [`never skipped ${(s.past_deadline ?? []).join(", ") || "none"}`] : []),
        ...(s.slots ?? []).map((x) => `${x.at} ET ${x.from ? `from ${x.from}` : "full run"}${x.full_day ? " (not half days)" : ""}`),
        ...(s.market ? [`market: ${s.market.symbols.join(" ")} · snapshots ${s.market.look.join(" ")} on ${s.market.interval}`] : []),
        ...(s.watch ? [`watch: card levels${s.watch.theses ? " + thesis levels" : ""} · falsify → ${s.watch.on_falsify === "rerun" ? `re-run from ${s.watch.rerun_from} (≤ ${s.watch.max_reruns}/day)` : "notify"}`] : []),
        ...(s.calibration_gate ? [gateLine(s.calibration_gate)] : []),
      ]
    : []
  const steps = (config.steps ?? []).map((x) => ({
    ...x,
    runs: x.kind === "code" ? `code: ${x.code}` : x.own ? ["step agent", x.tools?.length ? `tools ${x.tools.join(", ")}` : null, x.artifacts?.length ? `+ ${x.artifacts.join(", ")}` : null, x.max_steps ? `≤ ${x.max_steps} steps` : null].filter(Boolean).join(" · ") : x.kind === "phase" ? [`agent ${x.agent}`, x.tools?.length ? `grants ${x.tools.join(", ")}` : null, x.artifacts?.length ? `+ ${x.artifacts.join(", ")}` : null, x.max_steps ? `≤ ${x.max_steps} steps` : null].filter(Boolean).join(" · ") : [x.model && x.model !== "default" ? x.model : null, `${x.max_turns} turns`, `${x.seconds}s`].filter(Boolean).join(" · "),
    waits: x.after?.length ? x.after.join(", ") : null,
    reads: x.inputs?.length ? x.inputs.join(", ") : null,
    contract: x.kind === "code" ? null : x.kind === "phase" ? (x.report?.length ? `report ${x.report.join(", ")}` : "") : [x.check ? `check ${x.check}` : null, x.schema ? `schema ${x.schema}` : null, x.derive && x.derive !== x.schema ? `derive ${x.derive}` : x.derive ? "derive" : null].filter(Boolean).join(" · "),
  }))
  return { folder: config.folder, settings, steps, error: config.error ?? null }
}

// 4m07s, 38s
export const took = (ms) => {
  if (!(ms >= 0)) return ""
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`
}

export const clockOf = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }) : "")

const host = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return String(url).slice(0, 40)
  }
}

// A stage's web reads as chips: searches by their words, pages by their site — newest first, `max` shown.
export function sourceChips(sources = [], max = 6) {
  const chips = [...(sources ?? [])].reverse().map((s) => (s.url ? { kind: "page", label: host(s.url), title: s.url, href: /^https?:\/\//i.test(s.url) ? s.url : null } : { kind: "search", label: String(s.query ?? s.name ?? "").slice(0, 48), title: s.query ?? s.name }))
  return { chips: chips.slice(0, max), more: Math.max(0, chips.length - max) }
}

export function pipelineView(state, { now = Date.now(), chips = 6 } = {}) {
  const s = state ?? {}
  const running = s.status === "running"
  const stages = (s.stages ?? []).map((x) => {
    const live = x.status === "running" && x.started
    return {
      id: x.id,
      n: x.n,
      title: x.title ?? x.id,
      status: x.status ?? "waiting",
      elapsed: live ? took(now - Date.parse(x.started)) : x.ms ? took(x.ms) : "",
      tools: x.tools ?? 0,
      ...sourceChips(x.sources, chips),
      head: x.head ?? "",
      error: x.error ?? null,
      kind: x.kind ?? "research",
      gate: x.gate ?? null,
      agent: x.agent ?? null, // a step agent's name (kind agent, the workflow spawned it): its page and live status
      refused: x.refused ?? 0,
      shadow: shadowView(x.shadow, now),
      flow: flowOf(x.flow),
      turns: x.turns ?? null,
      cost: x.cost_usd ? `$${x.cost_usd.toFixed(2)}` : null,
      startedAt: x.started ?? null,
      at: clockOf(x.started),
      run: x.run ?? null,
      // its output before this run (kept while it waits or runs again): the viewer's "last output"
      last: x.last?.file ? { run: x.last.run ?? null, status: x.last.status ?? "done", at: clockOf(x.last.at), took: x.last.ms ? took(x.last.ms) : "", head: x.last.head ?? "", rev: x.last.rev ?? null } : null,
      rev: x.rev ?? null,
      report: x.report ?? [],
      after: x.after ?? [],
      key: stageKey(x),
    }
  })
  // a desk that keeps its card beside the result (trade-card: levels, calibration, the card's own fields) — both, the
  // result's words first (2026-10-23 audit: the card's fields never drew)
  const result = s.result || s.card ? { ...(s.card ?? {}), ...(s.result ?? {}) } : null
  const CARD_SHOWN = new Set(["decision", "stage", "at", "expect", "file", "text", "problems", "levels", "calibration", "card_rows"])
  const cardRest = result ? Object.entries(result).filter(([k, v]) => !CARD_SHOWN.has(k) && v != null && v !== "" && !(Array.isArray(v) && !v.length)) : []
  const events = (s.watch?.hits ?? []).map((h) => `${h.symbol} ${h.kind} ${h.price} crossed (${h.side}) at ${h.px} · ${h.hm}`)
  return {
    status: s.status ?? "idle",
    running,
    run: s.run
      ? {
          id: s.run.id,
          by: s.run.by,
          from: s.run.from,
          note: s.run.note,
          started: clockOf(s.run.started),
          deadline: clockOf(s.run.deadline), // 2026-10-23: drawn beside the run (steps past it are skipped)
          request: s.run.request ?? "",
          vars: s.run.vars ?? null,
          revision: s.run.revision ?? null,
          elapsed: running ? took(now - Date.parse(s.run.started)) : s.run.ended ? took(Date.parse(s.run.ended) - Date.parse(s.run.started)) : "",
        }
      : null,
    stages,
    result: result ? { decision: result.decision ?? null, stage: result.stage ?? null, at: clockOf(result.at), expect: result.expect ?? null, file: result.file ?? null, text: result.text ?? "", problems: result.problems ?? [], levels: result.levels ?? [], gate: result.calibration ? (result.calibration.state === "cap" ? result.calibration.reason : result.calibration.state === "idle" ? result.calibration.reason : `calibration gate ${result.calibration.state}`) : null } : null,
    cardRest: cardRest.map(([k, v]) => ({ name: k, value: typeof v === "object" ? JSON.stringify(v).slice(0, 400) : String(v) })),
    // a desk's own counters (trade-card: memory numbers, learnings found and demoted, watch notifications)
    memory: s.memory && typeof s.memory === "object" ? Object.entries(s.memory).filter(([, v]) => v != null && typeof v !== "object").map(([k, v]) => `${k} ${v}`).join(" · ") : null,
    learned: s.learnings ? [s.learnings.candidates?.length ? `${s.learnings.candidates.length} candidates` : null, s.learnings.demoted ? `${s.learnings.demoted} demoted` : null].filter(Boolean).join(" · ") : null,
    // each candidate: what it says, how often seen and countered, and whether it may be proposed yet
    candidates: (s.learnings?.candidates ?? []).slice(0, 20).map((c) => ({ text: String(c.text ?? "").slice(0, 300), line: [c.seen != null ? `seen ${c.seen}` : null, c.counter != null ? `against ${c.counter}` : null, c.of != null ? `of ${c.of}` : null, c.eligible ? "eligible" : null].filter(Boolean).join(" · ") })),
    notified: s.watch?.notified ?? null,
    pending: s.learnings?.pending ?? [],
    accepted: s.learnings?.accepted ?? 0,
    events,
    note: s.note ?? null,
    prompts: s.prompts ?? null,
    runs: (s.runs ?? []).slice().reverse().map((r) => ({ ...r, startedAt: clockOf(r.started), endedAt: clockOf(r.ended) })),
    config: configView(s.config),
    theses: thesesView(s.theses),
    calibration: calibrationView(s.calibration),
    log: logView(s.log),
    report: s.report?.text ? { text: s.report.text, file: s.report.file ?? null, run: s.report.run ?? null, at: clockOf(s.report.at) } : null,
  }
}
