// The context meter's data (2026-10-26 owner: prompt length is the limit): an agent's newest prompt measure
// (stats.promptParts, kernel Agent #measure) as a stacked bar's segments and a legend of its largest parts. Pure.
//
//   meterOf(parts, top = 3) → {total, segments: [{label, chars, pct}], legend: the top largest} | null

export function meterOf(parts, top = 3) {
  const kept = (parts ?? []).filter((p) => p && p.chars > 0)
  const total = kept.reduce((n, p) => n + p.chars, 0)
  if (!total) return null
  const segments = kept.map((p) => ({ label: String(p.label), chars: p.chars, pct: (p.chars / total) * 100 }))
  const legend = [...segments].sort((a, b) => b.chars - a.chars).slice(0, top)
  return { total, segments, legend }
}
