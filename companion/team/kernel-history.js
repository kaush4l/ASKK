// Each kernel agent's history lives beside its definition (2026-10-21 owner: "In order to survive restarts, the memory was
// to store in md file the history of that agent. In the folder where the agent.md lives will have a history.md"):
// <config.folder>/history.md, one section per finished run a person can read — who asked, the request, the answer, a
// short list of its steps — and, last in the section, the run as recorded (every step: thought, calls with their
// inputs, results) in a fenced json block that restore parses. At start the newest runs come back as the agent's EARLIER
// RUNS and as its thread (kernel-team.js), so a restart keeps every call on the agent page and the Live feed.
// Rotation: past `maxBytes` the file moves to history/history-<time>.md and a fresh one starts; the newest `keep` archives
// stay, and restore reads on into them when the fresh file holds fewer answered runs than it needs.
//
//   ## 2026-10-21 09:42 ET · owner · answered
//
//   **Request:**
//   > the request (clipped)
//
//   **Answer:**
//   > the answer (clipped)
//
//   - 1. the step's thought → tool, tool
//
//   ```json
//   {at, from, request, steps: [{thought, calls: [{tool, input}], results: [{tool, ok, output}], order?, gate?}],
//    answer, flags, guidance?, times?, error?}                                                     (one line)
//   ```
//
// The readable lines are blockquotes and list items, so the only line of a section that is exactly ```json is the run's.
// What the thread showed that the kernel's steps do not hold (the run's trail, from kernel-team.js) rides along:
// order — the step's results in the order they arrived (calls in one step run together), as call indices (results[k]
// answers calls[k]), only when it is not the call order; gate — the step's refused-answer row {kind: gate | format,
// content}; guidance — the owner's notes to the run {pos, from, text}, pos = the run's thread rows before it (after the
// request); times — every thread row's time before the answer (epoch ms, the request first). A row written before these
// existed restores without them.
//
// Migration: an agent folder's transcript.jsonl (one JSON row per run, before 2026-10-21) and its history/transcript-
// <time>.jsonl archives are read too, older than every history file; new runs go to history.md only.
//
//   createHistory({enabled, maxBytes, keep, outputChars, textChars}) → {restore(agent, n), record(agent, e, request, trail)}
//   parseHistory(text)   the run rows of one history.md, oldest first
//   historyMarkdown(rows, name)   a history.md holding these rows (what record appends, row by row)
//   HISTORY_FILE         "history.md"

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"

export const HISTORY_FILE = "history.md"
const LEGACY_FILE = "transcript.jsonl"
const FENCE = "```json"

const clip = (v, n) => {
  const s = typeof v === "string" ? v : JSON.stringify(v ?? null)
  return s.length > n ? `${s.slice(0, n)}…` : s
}

// The order a step's `count` results arrived in, from the call index each result event carried; null when it is the
// call order. 2026-10-17: arrivals were matched to results by tool, ok and output, so two calls that answered alike
// restored in call order and each row took the other's inputs.
function arrivalOrder(count, arrived = []) {
  const order = [...new Set(arrived.filter((k) => Number.isInteger(k) && k >= 0 && k < count))]
  for (let k = 0; k < count; k++) if (!order.includes(k)) order.push(k)
  return order.every((k, i) => k === i) ? null : order
}

// Every run row of a history.md, oldest first: the line after each line that is exactly ```json (a row that does not
// parse is skipped).
export function parseHistory(text) {
  const lines = String(text ?? "").split("\n")
  const rows = []
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].trimEnd() !== FENCE) continue // a file saved with \r\n line endings too
    try {
      const row = JSON.parse(lines[i + 1].trim())
      if (row && typeof row === "object") rows.push(row)
    } catch {}
  }
  return rows
}

// The time of a run as the owner reads it: "2026-10-21 09:42 ET".
const etTime = (iso) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} ET`
}
const quote = (text, n) => {
  const s = clip(String(text ?? "").trim(), n)
  return s ? s.split("\n").map((l) => `> ${l}`.trimEnd()) : ["> (none)"]
}
const oneLine = (v, n) => clip(String(v ?? "").replace(/\s+/g, " ").trim(), n)

// One run as a section of history.md.
function section(row) {
  const answered = row.answer != null && !row.error
  const head = `## ${etTime(row.at)} · ${oneLine(row.from ?? "?", 80)} · ${answered ? "answered" : "error"}`
  const steps = (Array.isArray(row.steps) ? row.steps : []).map((s, i) => {
    const tools = (Array.isArray(s?.calls) ? s.calls : []).map((c) => c?.tool).filter(Boolean).join(", ")
    const gate = s?.gate ? ` (${s.gate.kind}: ${oneLine(s.gate.content, 100)})` : ""
    return `- ${i + 1}. ${oneLine(s?.thought, 160) || "(no thought)"}${tools ? ` → ${oneLine(tools, 200)}` : ""}${gate}`
  })
  const body = [head, "", "**Request:**", ...quote(row.request, 1200), ""]
  if (answered || row.answer != null) body.push("**Answer:**", ...quote(row.answer, 2000), "")
  if (row.error) body.push("**Error:**", ...quote(row.error, 600), "")
  if (steps.length) body.push(...steps, "")
  body.push(FENCE, JSON.stringify(row), "```", "", "")
  return body.join("\n")
}

const headOf = (name) => `# ${name} — history\n\nEach run: who asked, the request, the answer, its steps; the json block is the run as recorded (read back at every start).\n\n`
export const historyMarkdown = (rows, name = "agent") => headOf(name) + rows.map(section).join("")

export function createHistory({ enabled = true, maxBytes = 512 * 1024, keep = 6, outputChars = 1500, textChars = 6000 } = {}) {
  // A fixture run (tests, dry runs) reads no history and writes none.
  const fileOf = (agent) => (enabled && agent.config.folder ? join(agent.config.folder, HISTORY_FILE) : null)
  const dirOf = (agent) => join(agent.config.folder, "history")
  // An archive is a name rotation writes, <prefix>-<ISO time with ":" and "." as "-"><ext>, read back to the same time:
  // names sort by time, so the newest is the last (2026-10-17: any transcript-*.jsonl counted, and a name that is not a
  // time could sort after every name compaction can write). history-*.md now; transcript-*.jsonl before 2026-10-21.
  const kinds = { md: { prefix: "history", ext: ".md" }, jsonl: { prefix: "transcript", ext: ".jsonl" } }
  const nameOf = (ms, k = kinds.md) => `${k.prefix}-${new Date(ms).toISOString().replace(/[:.]/g, "-")}${k.ext}`
  const timeOf = (f, k = kinds.md) => {
    const m = f.match(new RegExp(`^${k.prefix}-(\\d{4}-\\d{2}-\\d{2}T\\d{2})-(\\d{2})-(\\d{2})-(\\d{3})Z${k.ext.replace(".", "\\.")}$`))
    return m ? Date.parse(`${m[1]}:${m[2]}:${m[3]}.${m[4]}Z`) : NaN
  }
  const archived = (k) => (f) => {
    const ms = timeOf(f, k)
    return Number.isFinite(ms) && nameOf(ms, k) === f
  }

  function rotate(agent) {
    const file = fileOf(agent)
    if (!file || !existsSync(file) || statSync(file).size < maxBytes) return
    const dir = dirOf(agent)
    mkdirSync(dir, { recursive: true })
    // Named by time, never before the newest archive: max(now, newest + 1 ms), so the new archive sorts last and the
    // prune below drops only older ones (2026-10-17: a reused name sorted oldest and was pruned at once).
    const old = readdirSync(dir).filter(archived(kinds.md)).sort()
    const ms = old.length ? Math.max(Date.now(), timeOf(old.at(-1)) + 1) : Date.now()
    renameSync(file, join(dir, nameOf(ms)))
    old.push(nameOf(ms))
    for (const f of old.slice(0, Math.max(0, old.length - keep))) rmSync(join(dir, f))
  }

  // The files that hold an agent's runs, newest first, each {path, rows}: history.md, the newest `keep` history/history-
  // *.md archives, then (migration) transcript.jsonl and its newest `keep` archives — (keep + 1) * 2 files at most.
  function filesOf(agent) {
    const file = fileOf(agent)
    if (!file) return []
    const dir = dirOf(agent)
    const listed = existsSync(dir) ? readdirSync(dir) : []
    const newest = (k) => listed.filter(archived(k)).sort().reverse().slice(0, keep).map((f) => join(dir, f))
    const md = [file, ...newest(kinds.md)].map((path) => ({ path, rows: (text) => parseHistory(text) }))
    const jsonl = [join(agent.config.folder, LEGACY_FILE), ...newest(kinds.jsonl)].map((path) => ({
      path,
      rows: (text) =>
        text.split("\n").flatMap((l) => {
          if (!l.trim()) return []
          try {
            return [JSON.parse(l)]
          } catch {
            return []
          }
        }),
    }))
    return [...md, ...jsonl].filter((f) => existsSync(f.path))
  }

  return {
    // The newest `n` answered runs, oldest first: every step's results an array with outputs clipped (a row from before
    // steps were kept has steps: []). Read newest row first until n answered runs are found, however many failed runs
    // follow them (2026-10-17: a streak of failed runs restored none); history.md first, then on into its archives and
    // the transcripts written before it while runs are missing. Bounded: the files filesOf names, each about maxBytes.
    restore(agent, n = agent.config.historyKeep ?? 3) {
      const runs = []
      for (const f of filesOf(agent)) {
        if (runs.length >= n) break
        let rows
        try {
          rows = f.rows(readFileSync(f.path, "utf8"))
        } catch {
          continue
        }
        for (let i = rows.length - 1; i >= 0 && runs.length < n; i--) if (rows[i] && rows[i].answer != null) runs.unshift(rows[i])
      }
      return runs.map((r) => ({
        ...r,
        steps: (Array.isArray(r.steps) ? r.steps : []).map((s) => ({
          ...s,
          results: (Array.isArray(s?.results) ? s.results : []).map((x) => ({ ...x, output: clip(x?.output ?? "", outputChars) })),
        })),
      }))
    },

    // One finished run (the kernel's answer event) or a failed one (its error event); trail: what the live thread
    // showed beside the steps (kernel-team.js: {steps: [{arrived: [call index], gate}], guidance: [{pos, from, text}]}).
    record(agent, e, request = null, trail = null) {
      const file = fileOf(agent)
      if (!file) return
      const steps = (e.steps ?? []).map((s, i) => {
        const calls = (s.calls ?? []).map((c) => ({ tool: c.tool, input: c.input ?? {} }))
        const results = s.results ?? []
        const live = trail?.steps?.[i]
        const order = live ? arrivalOrder(Math.min(results.length, calls.length), live.arrived) : null
        return {
          thought: s.thought,
          calls,
          results: results.map((r) => ({ tool: r.tool, ok: r.ok, output: clip(r.output, outputChars) })),
          ...(order ? { order } : {}),
          ...(live?.gate ? { gate: { kind: live.gate.kind, content: clip(live.gate.content, textChars) } } : {}),
        }
      })
      const guidance = (trail?.guidance ?? []).map((g) => ({ pos: g.pos, from: g.from, text: clip(g.text, textChars) }))
      const req = e.request ?? request
      const row = {
        at: new Date(e.at ?? Date.now()).toISOString(),
        from: req?.from ?? null,
        request: clip(req?.text ?? "", textChars),
        steps,
        answer: e.answer ?? null,
        flags: e.flags ?? [],
        ...(guidance.length ? { guidance } : {}),
        ...(Array.isArray(trail?.times) ? { times: trail.times } : {}),
        ...(e.error ? { error: e.error } : {}),
      }
      try {
        mkdirSync(agent.config.folder, { recursive: true })
        if (!existsSync(file)) appendFileSync(file, headOf(agent.name))
        appendFileSync(file, section(row))
        rotate(agent)
      } catch {}
    },
  }
}
