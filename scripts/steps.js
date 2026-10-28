// Split agents' history.md runs into steps and measure how routable they are (docs/jepa-router.md §9 step 1).
// bun scripts/steps.js [folder…] [--out steps.jsonl]
// Per step: context (request head, previous tools), action (tool or "answer"), args template (literals masked).
// Report: share of steps whose template repeats ≥ 5 times (SCRIPT/LOCAL candidates) and a baseline router —
// predict the next action from the previous two — with its accuracy at each confidence level (coverage).
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const argv = process.argv.slice(2)
const outAt = argv.indexOf("--out")
const out = outAt >= 0 ? argv.splice(outAt, 2)[1] : null
const roots = argv.length ? argv : ["custom", "desks"]

function histories(dir, found = []) {
  let names = []
  try { names = readdirSync(dir) } catch { return found }
  for (const name of names) {
    if (name === "vendor" || name === "node_modules" || name.startsWith(".")) continue
    const path = join(dir, name)
    const st = statSync(path, { throwIfNoEntry: false })
    if (st?.isDirectory()) histories(path, found)
    else if (name === "history.md") found.push(path)
  }
  return found
}

function runs(text) {
  const list = []
  for (const m of text.matchAll(/```json\n([\s\S]*?)\n```/g)) {
    try { const o = JSON.parse(m[1]); if (Array.isArray(o.steps)) list.push(o) } catch {}
  }
  return list
}

// literals masked so calls of one shape share a template: numbers, dates, long text
const mask = (v) => {
  if (typeof v === "number") return "<N>"
  if (typeof v === "boolean") return v
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return "<DATE>"
    if (v.length > 40 || /\s/.test(v)) return "<TEXT>"
    return v.replace(/\d+/g, "<N>")
  }
  if (Array.isArray(v)) return v.length ? [mask(v[0])] : []
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, mask(v[k])]))
  return v
}

const rows = []
for (const file of roots.flatMap((r) => histories(r))) {
  const agent = file.split("/").slice(-2, -1)[0]
  const desk = file.split("/")[1]
  for (const run of runs(readFileSync(file, "utf8"))) {
    const prev = ["<start>", "<start>"]
    let last = ""
    for (const step of run.steps) {
      const calls = step.calls?.length ? step.calls : [{ tool: "answer", input: {} }]
      const ok = (step.results ?? []).every((r) => r.ok !== false)
      for (const c of calls) {
        const template = `${c.tool} ${JSON.stringify(mask(c.input ?? {}))}`
        rows.push({ desk, agent, request: String(run.request ?? "").slice(0, 200), prev: [...prev], last, thought: String(step.thought ?? "").slice(0, 400), action: c.tool, template, input: c.input ?? {}, ok })
      }
      prev.shift(); prev.push(calls.map((c) => c.tool).join("+"))
      last = (step.results ?? []).map((r) => String(r.output ?? r.error ?? "").slice(0, 300)).join("\n")
    }
  }
}
if (out) writeFileSync(out, rows.map((r) => JSON.stringify(r)).join("\n") + "\n")

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : "-")
const byAgent = Object.groupBy(rows, (r) => `${r.desk}/${r.agent}`)
console.log(`steps ${rows.length} from ${Object.keys(byAgent).length} agents${out ? ` → ${out}` : ""}\n`)
console.log("agent".padEnd(26), "steps".padStart(6), "ok".padStart(7), "tmpl≥5".padStart(8), "answer".padStart(8))
for (const [key, list] of Object.entries(byAgent).sort((a, b) => b[1].length - a[1].length)) {
  const counts = Object.groupBy(list, (r) => r.template)
  const repeat = list.filter((r) => counts[r.template].length >= 5).length
  console.log(key.padEnd(26), String(list.length).padStart(6), pct(list.filter((r) => r.ok).length, list.length).padStart(7),
    pct(repeat, list.length).padStart(8), pct(list.filter((r) => r.action === "answer").length, list.length).padStart(8))
}

// baseline router: per agent, P(action | previous two actions), learned on the first 70% of its steps in order,
// scored on the rest. A JEPA predictor (§4) must beat this to earn its place.
console.log("\nbaseline router (prev-2 actions → next action), held-out last 30% per agent")
const scored = []
for (const list of Object.values(byAgent)) {
  const cut = Math.floor(list.length * 0.7)
  const table = {}
  for (const r of list.slice(0, cut)) {
    const k = r.prev.join(">")
    ;(table[k] ??= {})[r.action] = (table[k][r.action] ?? 0) + 1
  }
  for (const r of list.slice(cut)) {
    const seen = table[r.prev.join(">")]
    if (!seen) { scored.push({ p: 0, hit: false }); continue }
    const total = Object.values(seen).reduce((a, b) => a + b, 0)
    const [best, n] = Object.entries(seen).sort((a, b) => b[1] - a[1])[0]
    scored.push({ p: total >= 3 ? n / total : 0, hit: best === r.action })
  }
}
for (const tau of [0.5, 0.7, 0.9, 0.97]) {
  const routed = scored.filter((s) => s.p >= tau)
  console.log(`  τ ${tau}: routes ${pct(routed.length, scored.length)} of steps, agrees ${pct(routed.filter((s) => s.hit).length, routed.length)}`)
}
