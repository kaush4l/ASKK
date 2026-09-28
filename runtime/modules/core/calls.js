/**
 * Tool calls as the model writes them: `name({"key": "value"})`, grouped into stages.
 *
 *     stages('[[a({"x": 1}), b({})], [c({})]]')   // [[a, b], [c]] — a and b together, then c
 *     stages('a({"x": 1})\nb({})')                // one stage per line
 *
 * The skeleton splits on commas while counting brackets, and counts brackets inside JSON
 * strings too, so `write({"text": "a, [b"})` breaks it. This scanner knows where strings
 * are, so a comma or bracket inside one is only text.
 */

const NAME = /[A-Za-z_][\w./-]*/y

/** Validate the entire legacy payload before allowing any of its calls to execute. */
export function parseStages(text) {
  if (typeof text !== 'string' || !text.trim()) return { stages: [], faults: ['act: expected non-empty tool-call text'] }
  const source = text.trim()
  let pieces
  if (source.startsWith('[')) {
    if (matching(source, 0) !== source.length - 1 || !source.endsWith(']')) return { stages: [], faults: ['act: unclosed or trailing stage content'] }
    pieces = top(source.slice(1, -1), true)
  } else pieces = source.split('\n').map((piece) => piece.trim()).filter(Boolean)
  const faults = []
  const result = pieces.map((piece) => {
    if (piece.startsWith('[')) {
      if (matching(piece, 0) !== piece.length - 1 || !piece.endsWith(']')) {
        faults.push('act: malformed stage')
        return []
      }
      piece = piece.slice(1, -1)
    }
    const calls = top(piece, true).map((source) => {
      const match = /^([A-Za-z_][\w./-]*)\s*\(/.exec(source)
      const open = match ? source.indexOf('(', match[1].length) : -1
      if (!match || matching(source, open) !== source.length - 1 || !source.endsWith(')')) {
        faults.push(`act: expected a complete name({"key":"value"}) call, got ${source.slice(0, 100)}`)
        return null
      }
      const call = { name: match[1], ...parseArgs(source.slice(open + 1, -1)), text: source }
      if (call.error) faults.push(`act: ${call.error}`)
      return call
    }).filter(Boolean)
    if (!calls.length) faults.push('act: empty stages are not allowed')
    return calls
  })
  if (!result.length) faults.push('act: at least one tool call is required')
  return { stages: faults.length ? [] : result, faults }
}

/** Version 2 uses JSON data, never executable call-like strings. */
export function structuredStages(value) {
  const faults = []
  if (!Array.isArray(value) || !value.length) return { stages: [], faults: ['act: expected a non-empty array of stages'] }
  const result = value.map((stage) => {
    if (!Array.isArray(stage) || !stage.length) {
      faults.push('act: each stage must be a non-empty array of calls')
      return []
    }
    return stage.map((call) => {
      if (!call || typeof call !== 'object' || Array.isArray(call) || typeof call.name !== 'string' || !/^[A-Za-z_][\w./-]*$/.test(call.name) || !call.args || typeof call.args !== 'object' || Array.isArray(call.args) || Object.keys(call).some((key) => !['name', 'args'].includes(key))) {
        faults.push('act: each call must contain only name (tool name) and args (JSON object)')
        return null
      }
      return { name: call.name, args: call.args, text: `${call.name}(${JSON.stringify(call.args)})` }
    }).filter(Boolean)
  })
  return { stages: faults.length ? [] : result, faults }
}

/** The calls in `text`, as stages: an array of arrays of `{name, args, text, error?}`. */
export function stages(text) {
  const source = String(text ?? '').trim()
  if (!source) return []
  if (source.startsWith('[')) {
    const close = matching(source, 0)
    const inner = close === -1 ? source.slice(1) : source.slice(1, close)
    return top(inner)
      .map(scan)
      .filter((stage) => stage.length)
  }
  return source
    .split('\n')
    .map(scan)
    .filter((stage) => stage.length)
}

/** Every `name(...)` in a piece of text, in order, with its arguments parsed. */
export function scan(text) {
  const found = []
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (char === '"') {
      index = skipString(text, index)
      continue
    }
    const starts = /[A-Za-z_]/.test(char) && (index === 0 || !/[\w./-]/.test(text[index - 1]))
    NAME.lastIndex = index
    const match = starts ? NAME.exec(text) : null
    if (!match) {
      index += 1
      continue
    }
    let open = index + match[0].length
    while (text[open] === ' ') open += 1
    if (text[open] !== '(') {
      index += match[0].length
      continue
    }
    const close = matching(text, open)
    const end = close === -1 ? text.length : close
    const raw = text.slice(open + 1, end).trim()
    found.push({ name: match[0], ...parseArgs(raw), text: text.slice(index, end + 1).trim() })
    index = end + 1
  }
  return found
}

/** Arguments as the tool will receive them. A bare value is kept as `value`. */
export function parseArgs(raw) {
  if (!raw) return { args: {} }
  const attempt = (text) => {
    const value = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? { args: value } : { args: { value } }
  }
  try {
    return attempt(raw)
  } catch {
    // Small models write single-quoted strings or bare keys. One careful repair, then give up.
    try {
      const repaired = raw
        .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, body) => JSON.stringify(body))
        .replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":')
      return attempt(repaired)
    } catch {
      return { args: {}, error: `the arguments are not JSON: ${raw.slice(0, 160)}` }
    }
  }
}

/** Split on top-level commas: not inside a string, bracket, brace or call. */
export function top(text, keepEmpty = false) {
  const items = []
  let depth = 0
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '"') {
      index = skipString(text, index) - 1
      continue
    }
    if ('([{'.includes(char)) depth += 1
    else if (')]}'.includes(char)) depth -= 1
    else if (char === ',' && depth === 0) {
      items.push(text.slice(start, index))
      start = index + 1
    }
  }
  items.push(text.slice(start))
  const trimmed = items.map((item) => item.trim())
  return keepEmpty ? trimmed : trimmed.filter(Boolean)
}

/** The index of the bracket that closes the one at `open`, or -1 if it never closes. */
export function matching(text, open) {
  const stack = []
  for (let index = open; index < text.length; index += 1) {
    const char = text[index]
    if (char === '"') {
      index = skipString(text, index) - 1
      continue
    }
    if ('([{'.includes(char)) stack.push(char)
    else if (')]}'.includes(char)) {
      if (stack.pop() !== { ')': '(', ']': '[', '}': '{' }[char]) return -1
      if (stack.length === 0) return index
    }
  }
  return -1
}

/** The index just past the double-quoted string that starts at `start`. */
function skipString(text, start) {
  for (let index = start + 1; index < text.length; index += 1) {
    if (text[index] === '\\') index += 1
    else if (text[index] === '"') return index + 1
  }
  return text.length
}
