/**
 * Markdown with YAML frontmatter — the format agents, souls and skills are written in.
 *
 *     const { settings, body } = read(text)
 *
 * Port of the skeleton's `core/markdown.py`. The body is unwrapped on the way in: a file is
 * line-wrapped so a person can read it, and the model pays a token per break and gets
 * nothing back. Lines that open a list, heading, quote, table or fence keep their break,
 * because there the break is the meaning.
 *
 * The frontmatter parser reads the subset of YAML agent files use — scalars, block and
 * inline lists, and nested maps by indentation. There is no dependency, because a worker
 * cannot resolve bare imports and this file runs in both realms.
 */

const STRUCTURE = ['-', '*', '#', '>', '|', '`']

/** Split a markdown file into its frontmatter settings and its unwrapped body. */
export function read(text) {
  const source = String(text ?? '').replace(/\r\n/g, '\n')
  if (!source.startsWith('---')) return { settings: {}, body: unwrap(source.trim()) }
  const end = source.indexOf('\n---', 3)
  if (end === -1) return { settings: {}, body: unwrap(source.trim()) }
  const front = source.slice(source.indexOf('\n') + 1, end)
  const after = source.indexOf('\n', end + 1)
  const body = after === -1 ? '' : source.slice(after + 1)
  return { settings: yaml(front), body: unwrap(body.trim()) }
}

/** Every paragraph on one line; structural lines and fenced code keep their breaks. */
export function unwrap(text) {
  const blocks = []
  let fenced = false
  for (const block of text.split(/\n\s*\n/)) {
    const lines = []
    for (const line of block.split('\n')) {
      const trimmed = line.trimStart()
      const fence = trimmed.startsWith('```')
      const joins = lines.length && !fenced && !fence && !STRUCTURE.some((mark) => trimmed.startsWith(mark))
      if (fence) fenced = !fenced
      if (joins) lines[lines.length - 1] += ` ${line.trim()}`
      else lines.push(line.trimEnd())
    }
    blocks.push(lines.join('\n'))
  }
  return blocks.join('\n\n')
}

/** The YAML subset agent frontmatter uses. Unknown shapes become strings; never throws. */
export function yaml(text) {
  const lines = text
    .split('\n')
    .map((raw) => ({ indent: raw.length - raw.trimStart().length, text: stripComment(raw).trim() }))
    .filter((line) => line.text)
  const [value] = block(lines, 0)
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function block(lines, start) {
  if (start >= lines.length) return [null, start]
  const { indent, text } = lines[start]
  return text === '-' || text.startsWith('- ') ? list(lines, start, indent) : map(lines, start, indent)
}

function map(lines, start, indent) {
  const out = {}
  let index = start
  while (index < lines.length && lines[index].indent === indent && !isItem(lines[index].text)) {
    const { text } = lines[index]
    const colon = keyColon(text)
    index += 1
    if (colon === -1) continue
    const key = unquote(text.slice(0, colon).trim())
    const rest = text.slice(colon + 1).trim()
    const next = lines[index]
    if (rest) out[key] = scalar(rest)
    else if (next && next.indent > indent) [out[key], index] = block(lines, index)
    else if (next && next.indent === indent && isItem(next.text)) [out[key], index] = list(lines, index, indent)
    else out[key] = null
  }
  return [out, index]
}

function list(lines, start, indent) {
  const out = []
  let index = start
  while (index < lines.length && lines[index].indent === indent && isItem(lines[index].text)) {
    const item = lines[index].text.slice(1).trim()
    index += 1
    if (!item) {
      const next = lines[index]
      if (next && next.indent > indent) {
        let value
        ;[value, index] = block(lines, index)
        out.push(value)
      } else out.push(null)
      continue
    }
    const colon = keyColon(item)
    if (colon !== -1 && !/^["'[{]/.test(item)) {
      // "- key: value" opens a map; its further keys sit deeper than the dash.
      const inner = [{ indent: indent + 2, text: item }]
      while (index < lines.length && lines[index].indent > indent) inner.push({ ...lines[index++], indent: indent + 2 })
      out.push(map(inner, 0, indent + 2)[0])
    } else out.push(scalar(item))
  }
  return [out, index]
}

function isItem(text) {
  return text === '-' || text.startsWith('- ')
}

function scalar(text) {
  if (text.startsWith('[') && text.endsWith(']')) return splitTop(text.slice(1, -1)).map(scalar)
  if (text.startsWith('{') && text.endsWith('}')) {
    const out = {}
    for (const pair of splitTop(text.slice(1, -1))) {
      const colon = keyColon(pair)
      if (colon !== -1) out[unquote(pair.slice(0, colon).trim())] = scalar(pair.slice(colon + 1).trim())
    }
    return out
  }
  if (/^(true|yes)$/i.test(text)) return true
  if (/^(false|no)$/i.test(text)) return false
  if (/^(null|~)$/i.test(text)) return null
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text)
  return unquote(text)
}

function splitTop(text) {
  const items = []
  let depth = 0
  let quote = ''
  let current = ''
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = ''
    } else if (char === '"' || char === "'") quote = char
    else if ('[{'.includes(char)) depth += 1
    else if (']}'.includes(char)) depth -= 1
    if (char === ',' && depth === 0 && !quote) {
      items.push(current.trim())
      current = ''
    } else current += char
  }
  if (current.trim()) items.push(current.trim())
  return items
}

function keyColon(text) {
  let quote = ''
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quote) {
      if (char === quote) quote = ''
    } else if (char === '"' || char === "'") quote = char
    else if (char === ':' && (index + 1 === text.length || text[index + 1] === ' ')) return index
  }
  return -1
}

function stripComment(raw) {
  let quote = ''
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]
    if (quote) {
      if (char === quote) quote = ''
    } else if (char === '"' || char === "'") quote = char
    else if (char === '#' && (index === 0 || raw[index - 1] === ' ')) return raw.slice(0, index)
  }
  return raw
}

function unquote(text) {
  const quoted = text.length >= 2 && /^(["']).*\1$/s.test(text)
  return quoted ? text.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"') : text
}
