/**
 * Reading an agent file at runtime.
 *
 * The agent folder ships to `public/agents/` and is fetched by the running app,
 * not compiled into it. That is what makes an agent editable in a deployed
 * build: change the markdown, reload, and the agent has changed — no toolchain
 * on the machine that is running it.
 *
 * Because the parse happens in the browser, the frontmatter reader is a small
 * YAML *subset* rather than a dependency. What it supports is exactly what an
 * agent file needs:
 *
 *     key: value            strings, numbers, booleans, null
 *     key: [a, b, c]        inline lists
 *     key:                  block lists
 *       - a
 *       - b
 *     key:                  nested maps
 *       inner: value
 *     key:                  lists of maps — an MCP server's configuration
 *       - name: host
 *         command: mcp-disk
 *     # comments and blank lines
 *
 * Nesting is here because a server is a record, not a string. It was a string
 * once — `name=command` — and the moment a server needed arguments, an
 * environment and an allowlist, that syntax was a small bad language with its
 * own escaping rules. A map is what the config already is everywhere else.
 *
 * Anything else — anchors, multi-line scalars, flow maps — is reported as an
 * unread line and skipped, so an unsupported construct costs one setting rather
 * than the file.
 */

function scalar(raw) {
  const text = raw.trim()
  if (!text) return ''
  if (
    (text.startsWith('"') && text.endsWith('"') && text.length > 1) ||
    (text.startsWith("'") && text.endsWith("'") && text.length > 1)
  ) {
    return text.slice(1, -1)
  }
  if (text === 'true') return true
  if (text === 'false') return false
  if (text === 'null' || text === '~') return null
  if (/^-?\d+$/.test(text)) return Number.parseInt(text, 10)
  if (/^-?\d*\.\d+$/.test(text)) return Number.parseFloat(text)
  return text
}

/** Split `[a, b(c, d)]` on top-level commas only. */
function inlineList(inner) {
  const items = []
  let current = ''
  let depth = 0
  for (const char of inner) {
    if ('([{'.includes(char)) depth++
    else if (')]}'.includes(char)) depth--
    if (char === ',' && depth === 0) {
      items.push(current)
      current = ''
    } else {
      current += char
    }
  }
  items.push(current)
  return items.map(scalar).filter((v) => v !== '')
}

/**
 * The frontmatter's lines, with blanks and comments already gone.
 *
 * Indentation is measured once, here, because every decision below is about
 * how deep a line sits and re-measuring it at each of them is how an
 * off-by-one gets in.
 */
function significant(text) {
  const rows = []
  const lines = text.split('\n')
  for (let number = 0; number < lines.length; number++) {
    const line = lines[number]
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    rows.push({ indent: line.length - line.trimStart().length, text: trimmed, number: number + 1 })
  }
  return rows
}

/**
 * A block of `key: value` lines at one indentation, and whatever nests inside.
 *
 * Recursive, and deliberately so: a server's configuration is a map inside a
 * list inside a map, and a parser that handles two levels because two is what
 * today's file needs is a parser that breaks on tomorrow's. Recursion is the
 * shorter code as well as the more general one.
 *
 * @returns {[object, number]} the map, and the row this block stopped at
 */
function parseMap(rows, from, indent, notes, source) {
  const map = {}
  let at = from

  while (at < rows.length && rows[at].indent >= indent) {
    // Deeper than expected with no key above it to belong to: a stray line.
    if (rows[at].indent > indent) {
      notes.push(`${source}: unexpected indentation at line ${rows[at].number}`)
      at++
      continue
    }

    const { text, number } = rows[at]
    const colon = text.indexOf(':')
    if (colon < 0) {
      notes.push(`${source}: could not read frontmatter line ${number} (${JSON.stringify(text)})`)
      at++
      continue
    }

    const key = text.slice(0, colon).trim()
    const rest = text.slice(colon + 1).trim()
    at++

    if (rest.startsWith('[') && rest.endsWith(']')) {
      map[key] = inlineList(rest.slice(1, -1))
      continue
    }
    if (rest !== '') {
      map[key] = scalar(rest)
      continue
    }

    // An empty value means the value is what follows, indented under it.
    const [nested, next] = parseNested(rows, at, indent, notes, source)
    map[key] = nested
    at = next
  }
  return [map, at]
}

/**
 * What sits under a key that gave no value on its own line: a list, a list of
 * maps, or a map. Nothing at all is an empty list, which is what an unfinished
 * `tools:` means and is the reading that costs nothing.
 */
function parseNested(rows, from, parentIndent, notes, source) {
  if (from >= rows.length || rows[from].indent <= parentIndent) return [[], from]

  const indent = rows[from].indent
  if (!rows[from].text.startsWith('- ')) {
    return parseMap(rows, from, indent, notes, source)
  }

  const items = []
  let at = from
  while (at < rows.length && rows[at].indent === indent && rows[at].text.startsWith('- ')) {
    const body = rows[at].text.slice(2).trim()
    const colon = body.indexOf(':')

    // `- key: value` opens a map, and the rest of its keys are the lines
    // indented under the dash. Everything else is a plain list entry.
    if (colon > 0 && !body.slice(0, colon).includes(' ')) {
      // The dash counts as indentation for the keys that follow it, which is
      // why the item's own indent is measured from after it.
      const inner = indent + 2
      const first = body.slice(0, colon).trim()
      const value = body.slice(colon + 1).trim()
      const [rest, next] = parseMap(rows, at + 1, inner, notes, source)
      items.push({
        [first]:
          value.startsWith('[') && value.endsWith(']')
            ? inlineList(value.slice(1, -1))
            : value === ''
              ? []
              : scalar(value),
        ...rest,
      })
      at = next
      continue
    }
    items.push(scalar(body))
    at++
  }
  return [items, at]
}

/** @returns {{data: object, notes: string[]}} */
export function parseFrontmatter(text, source = '<agent file>') {
  const notes = []
  const rows = significant(text)
  const [data] = parseMap(rows, 0, rows.length ? rows[0].indent : 0, notes, source)
  return { data, notes }
}

/**
 * Split an agent file into metadata and body.
 *
 * A malformed file costs that file its frontmatter, never its instructions: a
 * file with no frontmatter at all is a perfectly good agent that declares
 * nothing and is all instructions.
 *
 * @returns {{metadata: object, body: string, notes: string[]}}
 */
export function parseAgentFile(text, source = '<agent file>') {
  const content = String(text ?? '')
  if (!content.startsWith('---')) {
    return {
      metadata: {},
      body: content.trim(),
      notes: [`${source}: no frontmatter; the whole file is treated as instructions`],
    }
  }

  const rest = content.slice(3)
  const close = rest.indexOf('\n---')
  if (close < 0) {
    return {
      metadata: {},
      body: content.trim(),
      notes: [
        `${source}: frontmatter was never closed with '---'; the whole file is treated as instructions`,
      ],
    }
  }

  const { data, notes } = parseFrontmatter(rest.slice(0, close), source)
  return { metadata: data, body: rest.slice(close + 4).trim(), notes }
}
