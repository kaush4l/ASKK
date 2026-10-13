// Tool plan — every tool call in one response, as ordered stages.
//
//   notes.read({"key": "a"})                one call
//   notes.read({"key": "a"})                sequential: one per line (or comma);
//   web.read({"url": "https://…"})          each starts after the previous ends
//   parallel[web.read({…}), web.read({…})]  parallel: started together, joined
//
// Stages mix freely; a parallel group is one stage. In the JSON response
// format, `response` may also be a list: strings are sequential, a nested list
// is a parallel group.
//
//   parseToolPlan(response) -> [[{ name, inputs }], …]   (stage = calls)

const NAME = /[A-Za-z_][\w.-]*/y
const PARALLEL = /parallel\s*\[/iy
const SPACE = /\s*/y

// Index just past the JSON object starting at `start` (string-aware), or -1.
function objectEnd(text, start) {
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (c === "\\") i++
      else if (c === '"') inString = false
    } else if (c === '"') inString = true
    else if (c === "{") depth++
    else if (c === "}" && --depth === 0) return i + 1
  }
  return -1
}

const skipSpace = (text, i) => ((SPACE.lastIndex = i), SPACE.exec(text), SPACE.lastIndex)

// Arguments written JS-style by small models ({symbols: [...], 'a': 1, x: 2,}) → strict JSON.
// Outside strings only: quote bare keys, turn single-quoted strings into double-quoted, drop trailing commas.
function lenient(raw) {
  const fix = (code) => code.replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":').replace(/,(\s*[}\]])/g, "$1")
  let out = ""
  let code = ""
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (c !== '"' && c !== "'") {
      code += c
      continue
    }
    let j = i + 1
    let s = ""
    while (j < raw.length && raw[j] !== c) {
      if (raw[j] === "\\") {
        s += raw[j] + (raw[j + 1] ?? "")
        j += 2
        continue
      }
      s += c === "'" && raw[j] === '"' ? '\\"' : raw[j]
      j++
    }
    out += fix(code) + `"${s}"`
    code = ""
    i = j
  }
  return out + fix(code)
}

// `name(` at `i` already read: parse `{…})` or `)`. Null when not a call.
function readArgs(text, i) {
  i = skipSpace(text, i)
  // `name {json}` without parentheses (small models copy runbook shorthand): a call only when the object parses.
  if (text[i] === "{") {
    const end = objectEnd(text, i)
    if (end === -1) return null
    const raw = text.slice(i, end)
    for (const parse of [() => JSON.parse(raw), () => JSON.parse(lenient(raw))]) {
      try {
        const inputs = parse()
        if (inputs && typeof inputs === "object" && !Array.isArray(inputs)) return { inputs, end }
      } catch {}
    }
    return null
  }
  if (text[i] !== "(") return null
  i = skipSpace(text, i + 1)
  let inputs = {}
  if (text[i] === "{") {
    const end = objectEnd(text, i)
    if (end === -1) return null
    const raw = text.slice(i, end)
    try {
      inputs = JSON.parse(raw)
    } catch {
      try {
        inputs = JSON.parse(lenient(raw))
      } catch {
        inputs = { query: raw }
      }
    }
    i = skipSpace(text, end)
  }
  return text[i] === ")" ? { inputs, end: i + 1 } : null
}

function scan(text) {
  const stages = []
  let group = null // calls of an open parallel[…]
  let i = 0
  while (i < text.length) {
    PARALLEL.lastIndex = i
    if (!group && PARALLEL.test(text)) {
      group = []
      i = PARALLEL.lastIndex
      continue
    }
    if (group && text[i] === "]") {
      if (group.length) stages.push(group)
      group = null
      i++
      continue
    }
    NAME.lastIndex = i
    const word = NAME.exec(text)
    if (!word) {
      i++
      continue
    }
    const args = readArgs(text, NAME.lastIndex)
    if (!args) {
      i = NAME.lastIndex
      continue
    }
    const call = { name: word[0], inputs: args.inputs }
    if (group) group.push(call)
    else stages.push([call])
    i = args.end
  }
  if (group?.length) stages.push(group) // unclosed group
  return stages
}

export function parseToolPlan(response) {
  if (!Array.isArray(response)) return scan(String(response ?? ""))
  const stages = []
  for (const item of response) {
    if (Array.isArray(item)) {
      const calls = item.flatMap((part) => scan(String(part)).flat())
      if (calls.length) stages.push(calls)
    } else {
      stages.push(...scan(String(item)))
    }
  }
  return stages
}
