// The agent's reply: TOON-style fields, one per line, with complex values between markers — no JSON to
// escape, so a multi-line REPORT or a list of predictions goes in as written.
//
//   thought: one line
//   call: market.intraday
//   symbols: ACME,BETA,GAMMA
//   call: tape                         ← calls in one reply run together; each starts with "call:"
//   requirement: ACME above VWAP 769.6, HOD 771.9, 40 min left
//   ask: does ACME hold 770 into the close?
//   outcome: side to the close, the flip level, one race call
//   call: desk.predict
//   predictions: <<<
//   - symbol: ACME
//     p: 0.62
//     up: 773.5
//     down: 768
//     tf: close
//     drivers: momentum, levels
//   >>>
//   answer: <<<                        ← the final answer (no calls): any number of lines
//   VERDICT: …
//   >>>
//
// A value: a number, true / false / null, inline JSON ({…} or […]), else text. Between <<< and >>>: JSON,
// a "- " list (items as text, or as key: value lines), key: value lines (an object), else text.
// parseReply also reads the older JSON object reply and plain text (= the answer).

// The one place a prompt says how to reply (rendered as # RESPONSE, the prompt's last section — read right before the
// model writes, with # TOOLS just above it): roles and desks never repeat it.
export const RESPONSE_FORMAT = `Reply in fields, one per line — no JSON object, no code fences.
Every tool under # TOOLS is yours: call it, and its result comes back in your next prompt (# WORK DONE ON THIS REQUEST); answer from those results, never from the request's numbers alone.
thought: one line
call: <tool name>
<input field>: <value>          ← only that tool's inputs as # TOOLS lists them
<input field>: <<<              ← a list or a long text, between <<< and >>>
- <key>: <value>                ← one item per "- ", its other fields indented below it
  <key>: <value>
>>>
More "call:" blocks in one reply run together: batch the independent ones. A tool error names the fix: fix the input and call once more.
When the work is done — no calls — the answer:
thought: one line
answer: <<<
<your report>
>>>`

const KEY = /^([A-Za-z_][\w.-]*)\s*:\s?(.*)$/
const OPEN = "<<<"
const CLOSE = ">>>"

function scalar(raw) {
  const v = String(raw ?? "").trim()
  if (v === "") return ""
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v)
  if (v === "true" || v === "false") return v === "true"
  if (v === "null") return null
  if ((v.startsWith("{") && v.endsWith("}")) || (v.startsWith("[") && v.endsWith("]"))) {
    try {
      return JSON.parse(v)
    } catch {}
    // [a, b] of bare words: a list (TOON's short list)
    if (v.startsWith("[")) return v.slice(1, -1).split(",").map((x) => scalar(x.trim().replace(/^["']|["']$/g, ""))).filter((x) => x !== "")
  }
  if (v.length >= 2 && v[0] === v.at(-1) && (v[0] === '"' || v[0] === "'")) return v.slice(1, -1)
  return v
}

// key: value lines → an object (a line without a key continues the previous value)
function fields(lines) {
  const out = {}
  let last = null
  for (const line of lines) {
    const m = line.trim().match(KEY)
    if (m) {
      last = m[1]
      out[last] = scalar(m[2])
    } else if (last && line.trim()) out[last] = `${out[last]}\n${line.trim()}`
  }
  return out
}

// The text between the markers, as data.
function block(text) {
  const t = text.trim()
  if (!t) return ""
  try {
    return JSON.parse(t)
  } catch {}
  const lines = t.split("\n")
  if (lines[0].trim().startsWith("- ")) {
    const items = []
    for (const line of lines) {
      if (line.trim().startsWith("- ")) items.push([line.trim().slice(2)])
      else if (items.length && line.trim()) items.at(-1).push(line.trim())
    }
    // an item is key: value lines, an inline JSON object ("- {…}"), or text
    // "- symbol: ACME, p: 0.6, tf: close" on one line is split into its fields
    const inline = (lines) => lines.flatMap((l) => l.split(/,\s*(?=[A-Za-z_][\w.-]*\s*:\s)/))
    return items.map((it) => (KEY.test(it[0]) ? fields(inline(it)) : /^[[{]/.test(it[0]) ? scalar(it.join(" ")) : it.join("\n")))
  }
  if (lines.every((l) => !l.trim() || KEY.test(l.trim()))) return fields(lines)
  return t
}

function parseFields(text) {
  // A structure line joined with " · " (a model copying a one-line example) is split back into fields.
  const lines = text.split(/\r?\n/).flatMap((l) => (/^\s*(thought|call)\s*:/.test(l) && /\s·\s(call|answer)\s*:/.test(l) ? l.split(/\s·\s(?=[A-Za-z_][\w.-]*\s*:)/) : [l]))
  let thought = ""
  let answer = null
  const calls = []
  let i = 0
  // a value that opens a block runs to the line ">>>" (or to the end)
  const take = (first) => {
    const rest = first.slice(OPEN.length)
    const inline = rest.indexOf(CLOSE)
    if (inline >= 0) return rest.slice(0, inline)
    const body = rest.trim() ? [rest] : []
    while (++i < lines.length && lines[i].trim() !== CLOSE) body.push(lines[i])
    return body.join("\n")
  }
  let last = null // the call field a line without a key continues
  for (; i < lines.length; i++) {
    const line = lines[i]
    const m = line.trim().match(KEY)
    if (!m) {
      const call = calls.at(-1)
      if (call && last && typeof call.input[last] === "string" && line.trim() && line.trim() !== CLOSE) call.input[last] = `${call.input[last]}\n${line.trim()}`
      continue
    }
    const [, key, value] = m
    const v = value.trim()
    if (key === "thought") thought = v
    else if (key === "answer") {
      // the answer is the last field: a marked one ends at ">>>", an unmarked one runs to the end
      answer = v.startsWith(OPEN) ? take(v) : [v, ...lines.slice(i + 1)].join("\n")
      break
    } else if (key === "call") {
      const [, name = v, inline = ""] = v.match(/^(\S+)\s+(\{.*\})\s*$/) ?? []
      calls.push({ tool: name, input: inline ? (scalar(inline) ?? {}) : {} })
      last = null
    } else if (calls.length) {
      calls.at(-1).input[key] = v.startsWith(OPEN) ? block(take(v)) : scalar(v)
      last = key
    }
  }
  return { thought, calls, answer: answer == null ? null : answer.trim() }
}

// Tolerant parse: fields first; the older JSON object; plain text = the answer.
export function parseReply(raw) {
  const text = String(raw ?? "").trim()
  // a reply in fields (a "thought:" line alone is one too: no calls, no answer — the loop asks again)
  if (/^(thought|call|answer)\s*:/m.test(text) && !text.startsWith("{")) return parseFields(text)
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start >= 0 && end > start) {
    try {
      const obj = JSON.parse(text.slice(start, end + 1))
      const calls = Array.isArray(obj.calls) ? obj.calls.filter((c) => c && c.tool) : []
      return { thought: String(obj.thought ?? ""), calls, answer: obj.answer ?? null }
    } catch {}
  }
  return { thought: "", calls: [], answer: text }
}
