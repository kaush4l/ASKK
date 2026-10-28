// Typed-slot fill experiment (docs/jepa-router.md §16): each input field gets a type learned from history —
// enum (≤ 8 values cover 90%), number, ref (a path or URL), text — and is filled by its type: enum picked from its
// known values by word overlap with the thought, ref copied from the request / thought / last result, number copied
// from them, text written by the small on-device model one slot per prompt. Scored per slot against the big model.
// bun scripts/typed-fill.js <steps.jsonl> [--n 60] [--provider apple] [--port 1111]
import { readFileSync } from "node:fs"

const args = process.argv.slice(2)
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt }
const rows = readFileSync(args[0], "utf8").trim().split("\n").map((l) => JSON.parse(l))
const n = Number(opt("n", 60)), provider = opt("provider", "apple"), port = opt("port", 1111)

const train = [], test = []
for (const list of Object.values(Object.groupBy(rows, (r) => `${r.desk}/${r.agent}`))) {
  const cut = Math.floor(list.length * 0.7)
  train.push(...list.slice(0, cut)); test.push(...list.slice(cut))
}
const str = (v) => (typeof v === "string" ? v : JSON.stringify(v))

// slot types from the train rows
const fields = {}
for (const r of train.filter((r) => r.ok)) for (const [k, v] of Object.entries(r.input ?? {})) {
  const f = (fields[`${r.action}.${k}`] ??= { n: 0, vals: new Map() })
  f.n++; f.vals.set(str(v), (f.vals.get(str(v)) ?? 0) + 1)
}
function typeOf(key, v) {
  const f = fields[key]
  if (/^(path|url|file|from|to|cwd)$/.test(key.split(".").pop()) || /^(https?:|[\w.-]+\/)/.test(str(v))) return "ref"
  if (typeof v === "number") return "number"
  if (!f) return "text"
  const top = [...f.vals.values()].sort((a, b) => b - a).slice(0, 8).reduce((a, b) => a + b, 0)
  return top / f.n >= 0.9 ? "enum" : "text"
}
const words = (s) => new Set(String(s ?? "").toLowerCase().match(/[a-z0-9_.\/-]+/g) ?? [])
const overlap = (a, b) => { const A = words(a), B = words(b); if (!B.size) return A.size ? 0 : 1; let k = 0; for (const w of B) if (A.has(w)) k++; return k / B.size }

function fillEnum(key, ctx) {
  const vals = [...fields[key].vals.entries()]
  return vals.map(([v, c]) => [v, overlap(ctx, v) * 10 + c / 1000]).sort((a, b) => b[1] - a[1])[0][0]
}
function fillRef(ctx) {
  const refs = String(ctx).match(/https?:\/\/[^\s"')\]]+|(?:[\w.-]+\/)+[\w.-]*/g) ?? []
  return refs[0] ?? null
}
async function fillText(r, key) {
  const prompt = `Write only the value for one field of a tool call, as plain text, no quotes, no JSON.
TOOL: ${r.action}
FIELD: ${key.split(".").pop()}
REQUEST: ${String(r.request).slice(0, 300)}
THOUGHT (what this call must do): ${r.thought}`
  const res = await fetch(`http://localhost:${port}/__askk/llm/${provider}/v1/chat/completions`, {
    method: "POST", headers: { "content-type": "application/json", origin: `http://localhost:${port}` },
    body: JSON.stringify({ model: provider, messages: [{ role: "user", content: prompt }] }),
  })
  return ((await res.json()).choices?.[0]?.message?.content ?? "").trim()
}

const pool = test.filter((r) => r.ok && r.thought && Object.keys(r.input ?? {}).length)
const step = Math.max(1, Math.floor(pool.length / n))
const sample = pool.filter((_, i) => i % step === 0).slice(0, n)
const by = {}
let callsExact = 0, callsClose = 0
for (const r of sample) {
  const ctx = `${r.thought}\n${r.request}\n${r.last}`
  let allExact = true, allClose = true
  for (const [k, want] of Object.entries(r.input)) {
    const key = `${r.action}.${k}`, type = typeOf(key, want)
    const got = type === "enum" ? fillEnum(key, ctx)
      : type === "ref" ? fillRef(ctx)
      : type === "number" ? Number((String(ctx).match(/\b\d+(\.\d+)?\b/) ?? [NaN])[0])
      : await fillText(r, key)
    const exact = str(got) === str(want), close = exact || overlap(got, want) >= 0.6
    const t = (by[type] ??= { n: 0, exact: 0, close: 0 }); t.n++; if (exact) t.exact++; if (close) t.close++
    allExact &&= exact; allClose &&= close
  }
  if (allExact) callsExact++; if (allClose) callsClose++
}
const pct = (a, b) => `${((100 * a) / b).toFixed(1)}%`
console.log(`${sample.length} calls, typed fill (text slots on ${provider})`)
for (const [type, t] of Object.entries(by)) console.log(`  ${type.padEnd(6)} slots ${String(t.n).padStart(3)}  exact ${pct(t.exact, t.n).padStart(6)}  close ${pct(t.close, t.n).padStart(6)}`)
console.log(`  whole call: exact ${pct(callsExact, sample.length)} · close ${pct(callsClose, sample.length)}`)
