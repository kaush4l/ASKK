// Each kernel agent's transcript lives beside its definition (agents/<path>/agent.md, the agent's
// `config.folder`): transcript.jsonl, one row per finished run — who asked, the request, every step
// (thought, calls with their inputs, results) and the answer. At start the newest runs come back as
// the agent's EARLIER RUNS and as its thread (kernel-team.js), so a restart keeps every call on the
// agent page and the Live feed. Auto-compact: past `maxBytes` the file moves to
// history/transcript-<time>.jsonl and a fresh one starts; the newest `keep` archives stay, and restore reads on into
// them when the fresh file holds fewer answered runs than it needs.
//
//   {at, from, request, steps: [{thought, calls: [{tool, input}], results: [{tool, ok, output}], order?, gate?}],
//    answer, flags, guidance?, times?, error?}
//
// What the thread showed that the kernel's steps do not hold (the run's trail, from kernel-team.js) rides along:
// order — the step's results in the order they arrived (calls in one step run together), as call indices (results[k]
// answers calls[k]), only when it is not the call order; gate — the step's refused-answer row {kind: gate | format, content};
// guidance — the owner's notes to the run {pos, from, text}, pos = the run's thread rows before it (after the
// request); times — every thread row's time before the answer (epoch ms, the request first). A row written before
// these existed restores without them.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"

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

export function createTranscripts({ enabled = true, maxBytes = 512 * 1024, keep = 6, outputChars = 1500, textChars = 6000 } = {}) {
  // A fixture run (tests, dry runs) reads no transcript and writes none.
  const fileOf = (agent) => (enabled && agent.config.folder ? join(agent.config.folder, "transcript.jsonl") : null)

  const historyOf = (agent) => join(agent.config.folder, "history")
  // An archive is a name compaction writes, transcript-<ISO time with ":" and "." as "-">.jsonl, read back to the same
  // time: names sort by time, so the newest is the last (2026-10-17: any transcript-*.jsonl counted, and a name that
  // is not a time could sort after every name compaction can write).
  const nameOf = (ms) => `transcript-${new Date(ms).toISOString().replace(/[:.]/g, "-")}.jsonl`
  const timeOf = (f) => {
    const m = f.match(/^transcript-(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.jsonl$/)
    return m ? Date.parse(`${m[1]}:${m[2]}:${m[3]}.${m[4]}Z`) : NaN
  }
  const archived = (f) => {
    const ms = timeOf(f)
    return Number.isFinite(ms) && nameOf(ms) === f
  }

  function compact(agent) {
    const file = fileOf(agent)
    if (!file || !existsSync(file) || statSync(file).size < maxBytes) return
    const dir = historyOf(agent)
    mkdirSync(dir, { recursive: true })
    // Named by time, never before the newest archive: max(now, newest + 1 ms), so the new archive sorts last and the
    // prune below drops only older ones. 2026-10-17: a taken name moved a ms on to the first free one, so after a prune
    // freed an older name a same-ms compaction took it, sorted oldest and was pruned at once; a clock stepped back
    // named it before the newest archives too. Restore reads them newest first.
    const old = readdirSync(dir).filter(archived).sort()
    const ms = old.length ? Math.max(Date.now(), timeOf(old.at(-1)) + 1) : Date.now()
    renameSync(file, join(dir, nameOf(ms)))
    old.push(nameOf(ms))
    for (const f of old.slice(0, Math.max(0, old.length - keep))) rmSync(join(dir, f))
  }

  // The files that hold an agent's runs, newest first: transcript.jsonl, then the newest `keep` archives in history/
  // (the ones compaction keeps), so a restore reads (keep + 1) files at most.
  function filesOf(agent) {
    const file = fileOf(agent)
    if (!file) return []
    const dir = historyOf(agent)
    const archives = existsSync(dir) ? readdirSync(dir).filter(archived).sort().reverse().slice(0, keep).map((f) => join(dir, f)) : []
    return [file, ...archives].filter((f) => existsSync(f))
  }

  return {
    // The newest `n` answered runs, oldest first: every step's results an array with outputs clipped (a row from
    // before steps were kept has steps: []). Read newest row first until n answered runs are found, however many
    // failed runs follow them (2026-10-17: only the last n*4 rows were read, so a streak of failed runs restored
    // none); transcript.jsonl first, then on into history/ newest archive first while runs are missing (2026-10-17:
    // a compaction moved the whole file there, so a streak of failed runs past maxBytes restored none). Bounded:
    // the current file and the archives compaction keeps, each about maxBytes.
    restore(agent, n = agent.config.historyKeep ?? 3) {
      const runs = []
      for (const f of filesOf(agent)) {
        if (runs.length >= n) break
        let lines
        try {
          lines = readFileSync(f, "utf8").split("\n")
        } catch {
          continue
        }
        for (let i = lines.length - 1; i >= 0 && runs.length < n; i--) {
          if (!lines[i].trim()) continue
          try {
            const r = JSON.parse(lines[i])
            if (r && r.answer != null) runs.unshift(r)
          } catch {}
        }
      }
      return runs
        .map((r) => ({
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
        appendFileSync(file, `${JSON.stringify(row)}\n`)
        compact(agent)
      } catch {}
    },
  }
}
