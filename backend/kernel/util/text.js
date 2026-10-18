// Text helpers for desk tools.

export const READ_CHARS = 40000 // a page's text kept at most
export const FIND_CHARS = 6000 // with `find`: passages kept by default
export const FIND_AROUND = 600 // with `find`: chars kept either side of a match

// The parts of a page an agent asked for, so a 40K page does not land in its context whole: with `find`, only the
// passages around each term (±FIND_AROUND chars, overlaps merged, in page order); then at most `max` chars.
//   narrowText(text, { find: ["cpi", "fomc"], max: 4000 }) -> { text, truncated }
export function narrowText(text, { find, max } = {}) {
  let out = String(text ?? "")
  const terms = [].concat(find ?? []).map((t) => String(t).trim().toLowerCase()).filter(Boolean)
  let note = ""
  if (terms.length) {
    const lower = out.toLowerCase()
    const spans = []
    for (const term of terms) {
      for (let at = lower.indexOf(term); at >= 0; at = lower.indexOf(term, at + term.length)) {
        spans.push([Math.max(0, at - FIND_AROUND), Math.min(out.length, at + term.length + FIND_AROUND)])
      }
    }
    spans.sort((a, b) => a[0] - b[0])
    const merged = []
    for (const s of spans) {
      const last = merged[merged.length - 1]
      if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1])
      else merged.push([...s])
    }
    note = merged.length ? `[${merged.length} passage(s) matching ${terms.join(", ")}]\n` : `[no passage matches ${terms.join(", ")}]`
    out = merged.map(([a, b]) => `${a > 0 ? "…" : ""}${out.slice(a, b).trim()}${b < out.length ? "…" : ""}`).join("\n\n")
  }
  const cap = Math.min(Number(max) || (terms.length ? FIND_CHARS : READ_CHARS), READ_CHARS)
  const cut = out.length > cap
  return { text: `${note}${cut ? out.slice(0, cap) : out}`, truncated: cut }
}
