// Structured response models for LLM output parsing.
// Port of LocalAgents core/responses.py.
//
// Hierarchy:
//   BaseResponse        parsing logic (JSON / TOON / fallback) + prompt instructions
//   ├─ ReActResponse    observe-think-plan-act fields
//   └─ TextResponse     a single free-text field
//
// Subclasses only declare `static fields`; parsing and instructions are inherited.
// Field spec: { type: "string" | "list" | "enum" | "string|list", default,
//               description, values?: [...] (enum), fallback? (enum) }

const stripWrappingQuotes = (value) => {
  const text = value.trim()
  if (text.length >= 2 && text[0] === text.at(-1) && (text[0] === "'" || text[0] === '"')) {
    return text.slice(1, -1)
  }
  return value
}

function extractJsonObject(text) {
  let depth = 0
  let start = -1
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      if (depth === 0) start = i
      depth += 1
    } else if (text[i] === "}") {
      depth -= 1
      if (depth === 0 && start >= 0) return text.slice(start, i + 1)
    }
  }
  throw new Error("No JSON object found")
}

const cleanToonKey = (raw) =>
  raw.trim().replace(/^[-*]+\s*/, "").replace(/^\d+\.\s*/, "").replace(/^\*+|\*+$/g, "").trim().toLowerCase()

// "[a, b(c, d)]" -> ["a", "b(c, d)"]; null when not bracketed.
function parseBracketList(value) {
  value = value.trim()
  if (!(value.startsWith("[") && value.endsWith("]"))) return null
  const inner = value.slice(1, -1).trim()
  if (!inner) return []
  const items = []
  let current = ""
  let depth = 0
  for (const char of inner) {
    if ("({[".includes(char)) depth += 1
    else if (")}]".includes(char)) depth -= 1
    if (char === "," && depth === 0) {
      items.push(current.trim())
      current = ""
    } else {
      current += char
    }
  }
  if (current) items.push(current.trim())
  return items
}

function coerce(spec, value) {
  switch (spec.type) {
    case "list": {
      if (Array.isArray(value)) return value.map(String)
      const text = String(value)
      return (
        parseBracketList(text) ??
        text
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => line.replace(/^\s*(\d+\.|-|\*)\s*/, "").trim())
      )
    }
    case "enum": {
      const cleaned = String(value).trim().replace(/^['"]|['"]$/g, "").toLowerCase()
      return spec.values.includes(cleaned) ? cleaned : (spec.fallback ?? spec.default)
    }
    case "string|list":
      // A nested list stays a list (a parallel group of tool calls).
      return Array.isArray(value) ? value.map((v) => (Array.isArray(v) ? v.map(String) : String(v))) : String(value)
    default:
      return Array.isArray(value) ? value.join("\n") : String(value)
  }
}

export class BaseResponse {
  static fields = {}
  // Per-field TOON example lines; subclasses override entries to steer the model.
  static toonExamples = {}

  constructor(data = {}) {
    for (const [name, spec] of Object.entries(this.constructor.fields)) {
      this[name] = name in data ? data[name] : structuredClone(spec.default)
    }
  }

  // Hook for subclass field normalization (runs after coercion).
  static normalize(data) {
    return data
  }

  static typeLabel(spec) {
    if (spec.type === "enum") return spec.values.join(" | ")
    if (spec.type === "string|list") return "string | list"
    return spec.type
  }

  // ── instruction generation ──────────────────────────────────────────────

  static getInstructions(fmt = "json") {
    const fieldNames = Object.keys(this.fields)
    const fieldsText = Object.entries(this.fields)
      .map(([name, spec]) => `- **${name}** (${this.typeLabel(spec)}): ${spec.description ?? ""}`)
      .join("\n")

    if (fmt === "json") {
      return (
        "## RESPONSE FORMAT\n\n" +
        "Respond with a single JSON object containing these fields:\n\n" +
        `${fieldsText}\n\n` +
        "Important: Output ONLY the JSON object, no markdown fences.\n"
      )
    }

    // TOON format
    const examples = {
      plan: "plan: [step one, step two]",
      action: "action: answer",
      response: "response: <final answer OR tool call>",
      ...this.toonExamples,
    }
    const exampleBlock = fieldNames.map((n) => examples[n] ?? `${n}: <your ${n} here>`).join("\n\n")

    return (
      "## RESPONSE FORMAT\n\n" +
      "You MUST respond with EXACTLY these fields, in order, one per block.\n" +
      "Each field starts on its own line as `field_name: value`.\n" +
      "Separate fields with a blank line.\n" +
      `The ONLY valid field names are: ${fieldNames.join(", ")}.\n\n` +
      `### Field descriptions\n\n${fieldsText}\n\n` +
      "### Rules\n\n" +
      "1. Write the field name in lowercase, followed by a colon and a space, then the value.\n" +
      "2. Multi-line values: just keep writing on the next lines — do NOT repeat the field name.\n" +
      "3. List fields: one item per line, each starting with \"- \". A short list may use [item1, item2] instead.\n" +
      "4. Do NOT add markdown bold (**), bullets (-), or any decoration to field names.\n" +
      "5. Do NOT use any field names other than the ones listed above.\n" +
      "6. CRITICAL — action values: The 'action' field MUST be EXACTLY the literal word 'tool' or EXACTLY the literal word " +
      "'answer'. Never write a tool name in 'action'. For example, 'action: tool_name' is ALWAYS WRONG and will " +
      "break the system. The ONLY valid values are 'action: tool' and 'action: answer'.\n" +
      "7. CRITICAL — tool calls: When you want to call a tool, write 'action: tool' and place the full " +
      "tool invocation in the 'response' field as tool_name({\"key\": \"value\"}). Several calls: one per line " +
      "(sequential), or parallel[call_a(...), call_b(...)] (parallel).\n\n" +
      "### Correct vs Wrong\n\n" +
      "CORRECT:\n" +
      "```\n" +
      "action: tool\n\n" +
      'response: tool_name({"key": "value"})\n' +
      "```\n\n" +
      "WRONG (never do this):\n" +
      "```\n" +
      "action: tool_name\n\n" +
      'response: tool_name({"key": "value"})\n' +
      "```\n\n" +
      `### Full Example\n\n\`\`\`\n${exampleBlock}\n\`\`\`\n`
    )
  }

  // ── TOON parsing ────────────────────────────────────────────────────────

  // Two-pass key-aware TOON parser.
  static parseToon(text) {
    const known = new Set(Object.keys(this.fields))
    const aliases = { tool: "response" }
    const lines = text.split(/\r?\n/)

    // Pass 1 — find field start positions. Each field starts once. A plain
    // "plan: …" line wins over a bulleted "- plan: …" (an item inside a list
    // field such as thinking); a bulleted one counts only when no plain one
    // exists (a model that decorated the field names).
    const candidates = new Map() // key -> { plain, bulleted } line candidates
    lines.forEach((line, idx) => {
      const stripped = line.trim()
      const colon = stripped.indexOf(":")
      if (colon === -1) return
      let key = cleanToonKey(stripped.slice(0, colon))
      key = aliases[key] ?? key
      if (!known.has(key)) return
      const entry = candidates.get(key) ?? {}
      const kind = /^[-*]\s/.test(stripped) ? "bulleted" : "plain"
      entry[kind] ??= [idx, key, stripped.slice(colon + 1).trim()]
      candidates.set(key, entry)
    })
    const fieldStarts = [...candidates.values()].map((c) => c.plain ?? c.bulleted).sort((x, y) => x[0] - y[0])
    if (!fieldStarts.length) return {}

    // Pass 2 — extract values between field boundaries
    const data = {}
    fieldStarts.forEach(([startIdx, name, firstVal], i) => {
      const endIdx = i + 1 < fieldStarts.length ? fieldStarts[i + 1][0] : lines.length
      const parts = firstVal ? [firstVal] : []
      parts.push(...lines.slice(startIdx + 1, endIdx))
      const value = parts.join("\n").trim()
      data[name] = parseBracketList(value) ?? value
    })

    // Coerce an invalid action ("action: web_search", "action: web_search({...})") to "tool".
    const action = typeof data.action === "string" ? data.action.trim() : ""
    if (action && action !== "tool" && action !== "answer") {
      if ((action.includes("(") || action.includes("{")) && !data.response) data.response = action
      data.action = "tool"
    }
    return data
  }

  // ── public parser ───────────────────────────────────────────────────────

  static validate(data) {
    const clean = {}
    for (const [name, spec] of Object.entries(this.fields)) {
      if (data[name] !== undefined && data[name] !== null) clean[name] = coerce(spec, data[name])
    }
    return new this(this.normalize(clean))
  }

  // Parse raw LLM output into a typed response.
  // Tries: JSON → TOON → fallback.
  static fromRaw(raw) {
    const text = String(raw ?? "")

    try {
      const data = JSON.parse(extractJsonObject(text))
      if (Object.keys(data).some((key) => key in this.fields)) return this.validate(data)
    } catch {
      // not JSON — fall through to TOON
    }

    const toon = this.parseToon(text)
    if (Object.keys(toon).length) return this.validate(toon)

    return this.validate("response" in this.fields ? { response: text.trim() } : {})
  }

  toJSON() {
    return Object.fromEntries(Object.keys(this.constructor.fields).map((name) => [name, this[name]]))
  }
}

export class ReActResponse extends BaseResponse {
  static toonExamples = {
    observation: "observation:\n- <a new fact from the request or the latest result>",
    decision: "decision: <the move you are making, and the fact it rests on>",
  }

  static fields = {
    observation: {
      type: "list",
      default: [],
      description:
        "New facts since the last step, one per item: what the request asks, what the latest result showed. " +
        "At most 4 short items.",
    },
    decision: {
      type: "string",
      default: "",
      description: "One line: the move you are making and the fact it rests on. A conclusion, not a working-out.",
    },
    plan: {
      type: "list",
      default: [],
      description: "0-3 short, concrete next steps. Use [] when obvious.",
    },
    action: {
      type: "enum",
      values: ["tool", "answer"],
      default: "answer",
      fallback: "tool",
      description: "'tool' to invoke a tool, 'answer' to provide the final response.",
    },
    response: {
      type: "string|list",
      default: "",
      description: "If action='tool': tool call(s). If action='answer': final response text.",
    },
  }

  static normalize(data) {
    if (typeof data.decision === "string") data.decision = stripWrappingQuotes(data.decision)
    for (const key of ["observation", "plan"]) {
      if (Array.isArray(data[key])) data[key] = data[key].map(stripWrappingQuotes).filter((item) => item.trim())
    }
    if (typeof data.response === "string") data.response = stripWrappingQuotes(data.response)
    else if (Array.isArray(data.response)) {
      data.response = data.response.map((v) => (Array.isArray(v) ? v.map(stripWrappingQuotes) : stripWrappingQuotes(v)))
    }
    return data
  }
}

export class TextResponse extends BaseResponse {
  static fields = {
    response: { type: "string", default: "", description: "Your answer as plain text." },
  }

  static normalize(data) {
    if (typeof data.response === "string") data.response = stripWrappingQuotes(data.response)
    return data
  }
}
