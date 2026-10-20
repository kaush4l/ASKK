// A small, indentation-aware YAML subset for agent inputs that are structures written as text (2026-10-18: the dev
// desk's lead wrote preview.show's visual as "kind: bars / bars: / - label: … / value: …" — the reply format's block
// reader keeps a map with a nested list as text). Plain JS (the kernel runs in a tab too): maps ("key: value"), lists
// ("- item", "- key: value" with its other fields indented under it), nesting by indentation, scalars as the reply
// format reads them (numbers, true/false/null, quoted text, inline JSON). Not YAML: no anchors, tags, multi-line
// scalars or flow maps beyond JSON. parseYamlish(text) → the structure, or null when a line does not fit (the caller
// keeps its text).

const KEY = /^([A-Za-z_][\w.-]*)\s*:(?:\s+(.*))?$/

function scalar(raw) {
  const v = String(raw ?? "").trim()
  if (v === "") return ""
  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(v)) return Number(v)
  if (v === "true" || v === "false") return v === "true"
  if (v === "null" || v === "~") return null
  if ((v.startsWith("{") && v.endsWith("}")) || (v.startsWith("[") && v.endsWith("]"))) {
    try {
      return JSON.parse(v)
    } catch {}
    if (v.startsWith("[")) return v.slice(1, -1).split(",").map((x) => scalar(x.trim().replace(/^["']|["']$/g, ""))).filter((x) => x !== "")
  }
  if (v.length >= 2 && v[0] === v.at(-1) && (v[0] === '"' || v[0] === "'")) return v.slice(1, -1)
  return v
}

export function parseYamlish(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith("#"))
    .map((l) => ({ indent: l.length - l.trimStart().length, text: l.trim() }))
  if (!lines.length) return null
  let i = 0
  const fail = () => {
    throw new Error("not yamlish")
  }

  // a map whose keys sit at `indent` (the first may already be read: `first`)
  function map(indent, first = null) {
    const out = {}
    const field = (m) => {
      const key = m[1]
      const rest = m[2] ?? ""
      if (rest !== "") {
        out[key] = scalar(rest)
        return
      }
      // an empty value: a nested list (at this indent or deeper) or map (deeper), else ""
      const next = lines[i]
      if (next && next.text.startsWith("- ") && next.indent >= indent) out[key] = list(next.indent)
      else if (next && next.indent > indent && KEY.test(next.text)) out[key] = map(next.indent)
      else out[key] = ""
    }
    if (first) field(first)
    while (i < lines.length && lines[i].indent === indent && !lines[i].text.startsWith("- ")) {
      const m = lines[i].text.match(KEY)
      if (!m) fail()
      i++
      field(m)
    }
    return out
  }

  function list(indent) {
    const out = []
    while (i < lines.length && lines[i].indent === indent && lines[i].text.startsWith("- ")) {
      const line = lines[i]
      const item = line.text.slice(2).trim()
      i++
      const m = item.match(KEY)
      if (m && !/^[[{"']/.test(item)) {
        // "- key: value" — its other fields sit at the item text's own indent
        const inner = indent + 2 + (line.text.slice(2).length - line.text.slice(2).trimStart().length)
        out.push(map(inner, m))
      } else out.push(scalar(item))
    }
    return out
  }

  try {
    const top = lines[0].indent
    const value = lines[0].text.startsWith("- ") ? list(top) : map(top)
    return i === lines.length ? value : null
  } catch {
    return null
  }
}
