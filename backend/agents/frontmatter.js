// Minimal YAML frontmatter parser for agent.md / soul.md / team.md headers:
//
//   ---
//   name: researcher
//   tools: [web.read, notes.read]     inline list
//   context:                          block list
//     - time
//   permissions:                      nested map (by indentation, any depth)
//     notes_write: ask
//   toolkits:
//     research:
//       mcp: [github.search, notes.read]
//   ---
//
// Scalars: strings (optionally quoted), numbers, true/false. Nothing else.
// Block-list items stay strings (even with ": " inside); lists of maps are not supported.

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

function parseFrontmatter(text) {
  const data = {}
  // Open blocks, innermost last: { indent, holder, key } — holder[key] is filled by the deeper lines below it
  // (null until the first one says list or map). A line at or left of a block's indent closes it.
  const open = []

  const close = (indent) => {
    while (open.length && open.at(-1).indent >= indent) {
      const block = open.pop()
      // a nested `key:` that got no lines stays "" (top-level ones stay null), as before
      if (block.holder !== data && block.holder[block.key] === null) block.holder[block.key] = ""
    }
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const indent = rawLine.length - rawLine.trimStart().length
    close(indent)
    const block = open.at(-1)

    if (!block) {
      const match = line.match(KEY_LINE)
      if (!match || indent) throw new Error(`Invalid frontmatter line: ${line}`)
      const [, key, value] = match
      data[key] = value === "" ? null : scalar(value)
      if (value === "") open.push({ indent, holder: data, key })
      continue
    }

    const { holder, key } = block
    if (line.startsWith("- ")) {
      if (!Array.isArray(holder[key])) holder[key] = []
      holder[key].push(scalar(line.slice(2)))
      continue
    }
    const nested = line.match(KEY_LINE)
    if (!nested) throw new Error(`Invalid frontmatter line: ${line}`)
    if (holder[key] === null || typeof holder[key] !== "object" || Array.isArray(holder[key])) holder[key] = {}
    const map = holder[key]
    map[nested[1]] = nested[2] === "" ? null : scalar(nested[2])
    if (nested[2] === "") open.push({ indent, holder: map, key: nested[1] })
  }
  close(-1)
  return data
}

// Split a Markdown document into { data, body }. No frontmatter → data = {}.
export function splitFrontmatter(markdown) {
  const match = markdown.match(/^\s*---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/)
  if (!match) return { data: {}, body: markdown.trim() }
  return { data: parseFrontmatter(match[1]), body: markdown.slice(match[0].length).trim() }
}
