// Minimal YAML frontmatter parser for agent.md / soul.md headers:
//
//   ---
//   name: researcher
//   tools: [web.read, notes.read]     inline list
//   context:                          block list
//     - time
//   permissions:                      one-level nested map
//     notes_write: ask
//   ---
//
// Scalars: strings (optionally quoted), numbers, true/false. Nothing else.

function scalar(raw) {
  const value = raw.trim()
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim()
    return inner ? inner.split(",").map(scalar) : []
  }
  if (/^(['"]).*\1$/.test(value)) return value.slice(1, -1)
  if (value === "true") return true
  if (value === "false") return false
  if (value !== "" && !Number.isNaN(Number(value))) return Number(value)
  return value
}

const KEY_LINE = /^([A-Za-z_][\w.-]*):\s*(.*)$/

export function parseFrontmatter(text) {
  const data = {}
  let parent = null // key awaiting an indented block

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const indented = /^\s/.test(rawLine)

    if (indented && parent) {
      if (line.startsWith("- ")) {
        if (!Array.isArray(data[parent])) data[parent] = []
        data[parent].push(scalar(line.slice(2)))
        continue
      }
      const nested = line.match(KEY_LINE)
      if (nested) {
        if (data[parent] === null || Array.isArray(data[parent])) data[parent] = {}
        data[parent][nested[1]] = scalar(nested[2])
        continue
      }
    }

    const match = line.match(KEY_LINE)
    if (!match || indented) throw new Error(`Invalid frontmatter line: ${line}`)
    const [, key, value] = match
    if (value === "") {
      data[key] = null
      parent = key
    } else {
      data[key] = scalar(value)
      parent = null
    }
  }
  return data
}

// Split a Markdown document into { data, body }. No frontmatter → data = {}.
export function splitFrontmatter(markdown) {
  const match = markdown.match(/^\s*---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/)
  if (!match) return { data: {}, body: markdown.trim() }
  return { data: parseFrontmatter(match[1]), body: markdown.slice(match[0].length).trim() }
}
