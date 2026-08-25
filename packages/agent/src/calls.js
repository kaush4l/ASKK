/**
 * THE FALLBACK, AND IT IS DECLARED. A model with a native tool API hands the
 * port a `calls[]` array and nothing here ever runs; a model without one can
 * only write its calls into prose, and this is the single scanner that reads
 * them back out.
 *
 * WHICH OF THE TWO IS IN USE IS A PROPERTY OF THE MODEL (`AgentState.calling`,
 * off the model card), never a guess made from the text. The predecessor
 * scanned unconditionally, so "no `name({…})` in this reply" meant "the model
 * answered" for every model — and a reply reading `exec({"command": "cat
 * a.md"}, {"command": "cat b.md"})`, which is not one call, ended a six-part
 * task under a card saying `main finished`. That heuristic (`reply::
 * malformed_call`) is not ported: the signal decides the ending now, and this
 * decides only what a scanned model asked for.
 *
 * ONE LINE IS NO LONGER ONE BATCH. The Rust grouped calls by layout — same
 * line, run together; new line, run after — because the whole reply was one
 * blob of prose. A provider's `calls[]` carries no layout at all, so keeping
 * the rule would mean two schedules for one loop, one of which no native model
 * can express. Every call in one reply is one round, and a model that needs a
 * result before its next call writes a second reply.
 * @module
 */

/** @typedef {import('@harness/kernel').TurnId} TurnId */
/** @typedef {import('./turn.js').ToolCall} ToolCall */

/** @typedef {'native' | 'scanned'} CallStyle */

/** The model's own API carries the calls; the port parses them and this file is never reached. @type {CallStyle} */
export const NATIVE = 'native'

/** The calls are read out of the reply's text by [`scanCalls`]. Named on the state, so a person can see which reading a turn used. @type {CallStyle} */
export const SCANNED = 'scanned'

/**
 * Every `name({…})` in the text, in the order written.
 *
 * THE IDS ARE DERIVED AND NOT DRAWN. A scanned call has no provider id, and
 * correlation needs one; `turn#index` is unique within the turn that owns the
 * batch, which is the whole scope an id has to be unique in. Randomness would
 * be I/O in a pure function (I7) and would make the same reply produce a
 * different state twice.
 * @param {string} text @param {TurnId} turnId @returns {ToolCall[]}
 */
export function scanCalls(text, turnId) {
  /** @type {ToolCall[]} */
  const found = []
  const opener = /(?<![A-Za-z0-9_])([A-Za-z_]\w*)\s*\(/g
  for (let m = opener.exec(text); m !== null; m = opener.exec(text)) {
    const name = m[1]
    const closed = argsAt(text, m.index + m[0].length)
    if (!name || !closed) continue
    found.push({ id: `${turnId}#${found.length}`, tool: name, args: closed.args })
    opener.lastIndex = closed.end
  }
  return found
}

/**
 * THE CALL'S OWN CLOSING TEXT, INSIDE AN ARGUMENT (R13-2, R14-P0-2).
 *
 * `write_file({"path": "b.csv", "contents": "\"item,cost\\ncoffee,4.50\"})"})`
 * is valid JSON, and both this and the Rust are right to parse it: what it
 * decodes to is fifty bytes ending in the three characters that end a call.
 * The model escaped its argument one level too many and swallowed its own
 * terminator — the file on disk was one line, `wc -l` said 0, and the model
 * reported success. Measured in a browser against gemma-4-12B.
 *
 * The bytes are garbage either way, so the only question is whether the model
 * gets to fix them, and a refusal it can read beats a corrupt file plus a false
 * success. The predicate is exactly as narrow as it was: a string value ending
 * in `"})`, nothing wider, because a false refusal on a legitimate write would
 * be worse than the bug.
 * @param {string} argsJson @returns {boolean}
 */
export function swallowedClose(argsJson) {
  /** @type {unknown} */
  let parsed
  try {
    parsed = JSON.parse(argsJson)
  } catch {
    return false
  }
  if (typeof parsed !== 'object' || parsed === null) return false
  return Object.values(parsed).some((v) => typeof v === 'string' && v.trimEnd().endsWith('"})'))
}

/**
 * The `( … )` that must follow the identifier, from just past the `(`. A JSON
 * object or nothing at all: `now()` takes no arguments and is a call.
 * @param {string} text @param {number} from @returns {{args: string, end: number} | null}
 */
function argsAt(text, from) {
  const open = skipSpace(text, from)
  const close = text[open] === '{' ? scanObject(text, open) : open
  if (close < 0) return null
  const end = skipSpace(text, close)
  if (text[end] !== ')') return null
  return { args: close > open ? text.slice(open, close) : '{}', end: end + 1 }
}

/**
 * The end of the JSON object opening at `open`, string- and nesting-aware, or
 * -1. The Python this descends from stopped at the first `}`, so a nested
 * object — which a real MCP tool sends — was refused as unreadable.
 * @param {string} text @param {number} open @returns {number}
 */
function scanObject(text, open) {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = open; i < text.length; i += 1) {
    const c = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === '{') depth += 1
    else if (c === '}' && (depth -= 1) === 0) return i + 1
  }
  return -1
}

/** @param {string} text @param {number} from @returns {number} */
function skipSpace(text, from) {
  let i = from
  while (i < text.length && /\s/.test(text[i] ?? '')) i += 1
  return i
}
