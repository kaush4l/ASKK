// Step router (2026-10-27, docs/jepa-router.md): predicts a step's calls from the run's previous two steps, learned
// from exported steps (scripts/steps.js rows {prev, action, template, input, ok}). Only call shapes with no masked
// slot qualify (fixed arguments, nothing for a model to write); held out, this route agreed 100% at 4.5% coverage.
// `act: false` (default) = shadow: the agent records the prediction on its step event and asks the model as usual.
const SLOT = /<TEXT>|<N>|<DATE>/
// read-only calls: replaying one can change nothing, so these are the only ones an acting router may run
export const READ_ONLY = ["files.list", "files.read", "files.search", "terminal.read", "terminal.list", "dispatch.wait", "dispatch.list", "dispatch.read", "agent.catalog", "desk.list", "preview.text", "preview.console"]

export function scriptRouter(rows, { tau = 0.9, minN = 3, act = false, only = READ_ONLY } = {}) {
  const table = new Map() // "prev0>prev1" → Map("tool input" → {tool, input, n})
  for (const r of rows) {
    if (!r.ok || SLOT.test(r.template) || !only.includes(r.action)) continue
    const key = r.prev.join(">")
    const seen = table.get(key) ?? new Map()
    const id = `${r.action} ${JSON.stringify(r.input)}`
    const e = seen.get(id) ?? { tool: r.action, input: r.input, n: 0 }
    e.n++; seen.set(id, e); table.set(key, seen)
  }
  const totals = new Map()
  for (const r of rows) if (r.ok) totals.set(r.prev.join(">"), (totals.get(r.prev.join(">")) ?? 0) + 1)
  return {
    act,
    decide({ steps }) {
      const tools = steps.filter((s) => s.calls?.length).map((s) => s.calls.map((c) => c.tool).join("+"))
      const prev = ["<start>", "<start>", ...tools].slice(-2)
      const key = prev.join(">")
      const best = [...(table.get(key)?.values() ?? [])].sort((a, b) => b.n - a.n)[0]
      const total = totals.get(key) ?? 0
      const p = best && total ? best.n / total : 0
      if (!best || total < minN || p < tau) return { mode: "big", p }
      return { mode: "script", p, calls: [{ tool: best.tool, input: best.input }], why: `${best.n}/${total} after ${key}` }
    },
  }
}

// Local fill in shadow (2026-10-27): `fill({request, thought, tool, examples})` → the input a small local model wrote.
// Compared with the big model's input: same keys, exact. `tally` is what a LOCAL route would have got right; `log(row)`
// keeps each comparison (main.js: memory/<desk>/router/shadow.jsonl).
export function withShadowFill(router, { fill, examples = {}, log = () => {} }) {
  const tally = { n: 0, json: 0, keys: 0, exact: 0 }
  return {
    ...router,
    tally,
    async shadowFill({ request, thought, call }) {
      const t0 = Date.now()
      const got = await fill({ request, thought, tool: call.tool, examples: examples[call.tool] ?? [] })
      const want = call.input ?? {}
      const keys = !!got && Object.keys(got).sort().join() === Object.keys(want).sort().join()
      const exact = keys && JSON.stringify(got) === JSON.stringify(want)
      tally.n++; if (got) tally.json++; if (keys) tally.keys++; if (exact) tally.exact++
      log({ at: new Date().toISOString(), tool: call.tool, got, want, keys, exact, ms: Date.now() - t0 })
    },
  }
}
