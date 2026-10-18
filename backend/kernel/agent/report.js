// The one report format every agent answers in, so every board, quest result and owner answer
// reads the same way and code can check it (no LLM call to grade the shape).

export const REPORT_FIELDS = ["VERDICT", "EVIDENCE", "CONFIDENCE", "FALSIFIER", "GAPS"]

export const REPORT_FORMAT = `Your answer is a REPORT, exactly these 5 lines (the request's OUTCOME says what the VERDICT must deliver; an answer missing a line comes back to you):
VERDICT: <one line: the call or the finding>
EVIDENCE: <number (tool, time); number (tool, time); …>
CONFIDENCE: <0.00–1.00>
FALSIFIER: <the observation that would prove the verdict wrong: a level, number or event>
GAPS: <what you could not measure — "unknown", never an estimate — or none>`

export function parseReport(text) {
  const out = {}
  for (const line of String(text ?? "").split("\n")) {
    const m = line.match(/^\s*\**\s*(VERDICT|EVIDENCE|CONFIDENCE|FALSIFIER|GAPS)\s*\**\s*:\s*(.*)$/i)
    if (m) out[m[1].toUpperCase()] = (out[m[1].toUpperCase()] ? `${out[m[1].toUpperCase()]} ` : "") + m[2].trim()
  }
  return out
}

// Missing or empty fields; a CONFIDENCE that is not a number in 0..1 counts as missing.
export function checkReport(text) {
  const r = parseReport(text)
  const missing = REPORT_FIELDS.filter((f) => !r[f])
  const c = Number.parseFloat(r.CONFIDENCE)
  if (r.CONFIDENCE && !(c >= 0 && c <= 1)) missing.push("CONFIDENCE (0.00–1.00)")
  return missing
}

// Quality, scored in code, 0–5: format complete · ≥2 numbers in EVIDENCE · a source/time in
// parentheses · confidence 0..1 · a falsifier that names a level, number or event.
export function scoreReport(text) {
  const r = parseReport(text)
  const evidence = r.EVIDENCE ?? ""
  const parts = {
    format: checkReport(text).length === 0,
    numbers: (evidence.match(/-?\d+(\.\d+)?%?/g) ?? []).length >= 2,
    sources: /\([^)]*[a-z][^)]*\)/i.test(evidence),
    confidence: (() => {
      const c = Number.parseFloat(r.CONFIDENCE)
      return c >= 0 && c <= 1
    })(),
    falsifier: /\d|break|close|print|above|below|reclaim|loses?|fails?/i.test(r.FALSIFIER ?? ""),
  }
  return { score: Object.values(parts).filter(Boolean).length, parts, verdict: r.VERDICT ?? null, confidence: Number.parseFloat(r.CONFIDENCE) || null }
}
