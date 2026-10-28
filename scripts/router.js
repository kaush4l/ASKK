// Train and score the JEPA-style step router (docs/jepa-router.md §4–5) on steps.jsonl from scripts/steps.js.
// bun scripts/router.js <steps.jsonl> [--save router.json]
// E: frozen hashed bag of the state (request head, previous two tools, last result head) → R^D, L2-normed.
// T: frozen random projection of the next call's template tokens → R^K (the latent target; frozen, so no collapse).
// P: linear R^D → R^K trained on ‖P·E(x) − T(next)‖². Decision: nearest template prototype (mean predicted latent
// of its train rows) by cosine; confidence = the best cosine and its margin over the best of another tool.
// Route: SCRIPT when the template has no masked slot (args replayed exactly), LOCAL when it has slots (a small
// model fills them), BIG when unsure. Scored per agent, chronological 70/30.
import { readFileSync, writeFileSync } from "node:fs"

const [file, ...rest] = process.argv.slice(2)
if (!file) throw new Error("usage: bun scripts/router.js <steps.jsonl> [--save router.json]")
const saveAt = rest.indexOf("--save")
const save = saveAt >= 0 ? rest[saveAt + 1] : null
const rows = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l))

const D = 2048, K = 64
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0 }
const words = (s) => String(s ?? "").toLowerCase().match(/[a-z_][a-z0-9_.]{1,30}/g) ?? []

function encode(r) {
  const v = new Map()
  const add = (tok, w) => { const i = hash(tok) % D; v.set(i, (v.get(i) ?? 0) + w) }
  for (const w of words(r.request)) add(`q:${w}`, 1)
  r.prev.forEach((t, i) => add(`p${i}:${t}`, 3))
  add(`pp:${r.prev.join(">")}`, 3)
  for (const w of words(r.last)) add(`r:${w}`, 0.5)
  add(`a:${r.agent}`, 1)
  let n = 0; for (const x of v.values()) n += x * x
  n = Math.sqrt(n) || 1
  return [...v].map(([i, x]) => [i, x / n])
}

function unit(t) { let n = 0; for (const x of t) n += x * x; n = Math.sqrt(n) || 1; return t.map((x) => x / n) }
// target encoder: each template token a fixed random ±1 vector seeded by its hash
function target(template) {
  const t = new Float64Array(K)
  for (const tok of [template.split(" ")[0], ...words(template)]) {
    let s = hash(tok)
    for (let k = 0; k < K; k++) { s = Math.imul(s ^ (s >>> 15), 2246822507) >>> 0; t[k] += s & 1 ? 1 : -1 }
  }
  return unit(t)
}
const cos = (a, b) => { let s = 0; for (let k = 0; k < K; k++) s += a[k] * b[k]; return s }
const slotted = (template) => /<TEXT>|<N>|<DATE>/.test(template)

const byAgent = Object.groupBy(rows, (r) => `${r.desk}/${r.agent}`)
const train = [], test = []
for (const list of Object.values(byAgent)) {
  const cut = Math.floor(list.length * 0.7)
  train.push(...list.slice(0, cut)); test.push(...list.slice(cut))
}
const good = train.filter((r) => r.ok)

const W = Array.from({ length: K }, () => new Float64Array(D))
const predict = (x) => { const z = new Float64Array(K); for (const [i, v] of x) for (let k = 0; k < K; k++) z[k] += W[k][i] * v; return z }
const X = good.map(encode), Y = good.map((r) => target(r.template))
for (let epoch = 0, lr = 0.5; epoch < 30; epoch++, lr *= 0.92) {
  let loss = 0
  for (let n = 0; n < X.length; n++) {
    const z = predict(X[n])
    for (let k = 0; k < K; k++) {
      const g = z[k] - Y[n][k]; loss += g * g
      for (const [i, v] of X[n]) W[k][i] -= lr * g * v
    }
  }
  if (epoch % 10 === 9) console.log(`epoch ${epoch + 1} latent loss ${(loss / X.length).toFixed(4)}`)
}

const protos = {}
good.forEach((r, n) => {
  const key = `${r.desk}/${r.agent}`
  const p = ((protos[key] ??= {})[r.template] ??= { tool: r.action, sum: new Float64Array(K), n: 0, inputs: {} })
  const z = predict(X[n]); for (let k = 0; k < K; k++) p.sum[k] += z[k]
  p.n++; const s = JSON.stringify(r.input); p.inputs[s] = (p.inputs[s] ?? 0) + 1
})
for (const agent of Object.values(protos)) for (const p of Object.values(agent)) p.mean = unit(p.sum)

// two levels: the tool by its prototype (mean of its templates' rows), then the template within that tool
const toolProtos = {}
for (const [agent, ts] of Object.entries(protos)) {
  const by = (toolProtos[agent] = {})
  for (const [template, p] of Object.entries(ts)) {
    const t = (by[p.tool] ??= { tool: p.tool, sum: new Float64Array(K), n: 0, templates: [] })
    for (let k = 0; k < K; k++) t.sum[k] += p.sum[k]
    t.n += p.n; t.templates.push([template, p])
  }
  for (const t of Object.values(by)) t.mean = unit(t.sum)
}

function decide(r) {
  const z = unit(predict(encode(r)))
  const tools = Object.values(toolProtos[`${r.desk}/${r.agent}`] ?? {}).filter((t) => t.n >= 3)
  if (!tools.length) return {}
  const ranked = tools.map((t) => ({ t, c: cos(z, t.mean) })).sort((a, b) => b.c - a.c)
  const top = ranked[0]
  const [template, p] = top.t.templates.map(([tm, p]) => [tm, p, cos(z, p.mean)]).sort((a, b) => b[2] - a[2])[0]
  return { best: { template, p }, c: top.c, margin: top.c - (ranked[1]?.c ?? -1) }
}

const scored = test.map((r) => ({ r, d: decide(r) })).filter((s) => s.d.best)
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : "-")
console.log(`\ntest rows ${test.length}, decidable ${scored.length}`)
console.log("margin  routes   tool-agree  script  script-exact  local")
let chosen = null
for (const m of [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5]) {
  const routed = scored.filter((s) => s.d.margin >= m && s.d.c >= 0.5)
  const agree = routed.filter((s) => s.d.best.p.tool === s.r.action)
  const script = routed.filter((s) => !slotted(s.d.best.template))
  const exact = script.filter((s) => {
    const top = Object.entries(s.d.best.p.inputs).sort((a, b) => b[1] - a[1])[0][0]
    return s.d.best.p.tool === s.r.action && top === JSON.stringify(s.r.input)
  })
  const rate = routed.length ? agree.length / routed.length : 0
  if (!chosen && rate >= 0.97 && routed.length) chosen = { margin: m, coverage: routed.length / test.length, agree: rate }
  console.log(String(m).padEnd(7), pct(routed.length, test.length).padStart(6), pct(agree.length, routed.length).padStart(12),
    pct(script.length, test.length).padStart(7), pct(exact.length, script.length).padStart(13), pct(routed.length - script.length, test.length).padStart(6))
}
console.log(chosen
  ? `\n≥97% tool agreement at margin ${chosen.margin}: routes ${(100 * chosen.coverage).toFixed(1)}% of steps (baseline 4.5%)`
  : "\nno margin reaches 97% tool agreement")

if (save) {
  const model = { D, K, margin: chosen?.margin ?? null, W: W.map((row) => Array.from(row, (x) => +x.toFixed(5))),
    protos: Object.fromEntries(Object.entries(protos).map(([a, ts]) => [a, Object.fromEntries(Object.entries(ts).map(([t, p]) =>
      [t, { tool: p.tool, n: p.n, mean: Array.from(p.mean, (x) => +x.toFixed(5)), input: Object.entries(p.inputs).sort((x, y) => y[1] - x[1])[0][0] }]))])) }
  writeFileSync(save, JSON.stringify(model))
  console.log(`saved ${save}`)
}
