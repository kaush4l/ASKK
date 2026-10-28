// Argument-fill experiment (docs/jepa-router.md §11, next experiment): the big model's thought + tool name are
// given; a small local model writes only the tool's JSON input. Scored against what the big model actually sent.
// bun scripts/fill.js <steps.jsonl> [--n 60] [--provider apple] [--port 1111]
// Rows: held-out last 30% per agent, ok calls with a thought and a slotted template (the LOCAL route).
// Scores: json (parses), keys (same top-level keys), exact (equal input), close (≥ 60% word overlap on every value).
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
const examples = Object.groupBy(train.filter((r) => r.ok), (r) => r.action)
const pool = test.filter((r) => r.ok && r.thought && /<TEXT>|<N>|<DATE>/.test(r.template) && examples[r.action])
const step = Math.max(1, Math.floor(pool.length / n))
const sample = pool.filter((_, i) => i % step === 0).slice(0, n)

const words = (v) => new Set(String(typeof v === "string" ? v : JSON.stringify(v)).toLowerCase().match(/[a-z0-9_.]+/g) ?? [])
const overlap = (a, b) => { const A = words(a), B = words(b); if (!B.size) return A.size ? 0 : 1; let k = 0; for (const w of B) if (A.has(w)) k++; return k / B.size }

async function fill(r) {
  const ex = examples[r.action].slice(-2).map((e) => JSON.stringify(e.input)).join("\n")
  const prompt = `Write the JSON input for one tool call. Reply with the JSON object only.
TOOL: ${r.action}
EARLIER INPUTS OF THIS TOOL (shape only):
${ex}
REQUEST: ${r.request}
LAST RESULT: ${String(r.last).slice(0, 300)}
THOUGHT (what this call must do): ${r.thought}`
  const t0 = performance.now()
  const res = await fetch(`http://localhost:${port}/__askk/llm/${provider}/v1/chat/completions`, {
    method: "POST", headers: { "content-type": "application/json", origin: `http://localhost:${port}` },
    body: JSON.stringify({ model: provider, messages: [{ role: "user", content: prompt }] }),
  })
  const text = (await res.json()).choices?.[0]?.message?.content ?? ""
  return { text, ms: performance.now() - t0, chars: prompt.length }
}

const tally = { json: 0, keys: 0, exact: 0, close: 0, ms: 0, chars: 0 }
for (const r of sample) {
  const { text, ms, chars } = await fill(r)
  tally.ms += ms; tally.chars += chars
  let got = null
  try { got = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) } catch {}
  if (!got) { console.log(`✗ json  ${r.action}  ${text.slice(0, 80)}`); continue }
  tally.json++
  const want = r.input, ka = Object.keys(got).sort().join(), kb = Object.keys(want).sort().join()
  if (ka !== kb) { console.log(`✗ keys  ${r.action}  got ${ka} want ${kb}`); continue }
  tally.keys++
  if (JSON.stringify(got) === JSON.stringify(want)) tally.exact++
  const close = Object.keys(want).every((k) => overlap(got[k], want[k]) >= 0.6)
  if (close) tally.close++
  console.log(`${close ? "✓" : "~"} ${r.action}  got ${JSON.stringify(got).slice(0, 90)}  want ${JSON.stringify(want).slice(0, 90)}`)
}
const pct = (a) => `${((100 * a) / sample.length).toFixed(1)}%`
console.log(`\n${sample.length} calls on ${provider}: json ${pct(tally.json)} · keys ${pct(tally.keys)} · close ${pct(tally.close)} · exact ${pct(tally.exact)} · ${(tally.ms / sample.length).toFixed(0)} ms/call · ${(tally.chars / sample.length).toFixed(0)} prompt chars/call`)
