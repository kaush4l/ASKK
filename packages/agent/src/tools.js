/**
 * A TOOL DESCRIPTOR — one callable, as data: what it is called, what it is
 * for, the arguments it takes as a real schema, and the two properties the
 * Rust decided somewhere else entirely.
 *
 * No function pointer. Running a tool is I/O and happens in `core` behind the
 * seam, so this file is pure and the model cannot tell a built-in from an
 * authored tool from a sub-agent (I9).
 *
 * THE TWO DECLARED PROPERTIES. `verify::is_mutating` was `matches!(tool,
 * "write_file" | "write_agent")` and evidence was `tool == "exec"` — two
 * allowlists of NAMES, a hundred lines from the descriptors they judged, so a
 * tool added to the box was born non-mutating and nothing could notice. Each
 * tool now declares both, which is the whole difference between a property and
 * a list somebody has to remember to edit.
 *
 * THE ARGUMENTS ARE A SCHEMA AND NOT A SENTENCE. The Rust took `&["path",
 * "text"]` and formatted a usage line out of it; a name was all it had, so
 * nothing could say an argument was required, or a number, and the only
 * argument check that existed was "does this JSON parse". A model that sends
 * `write_file({"contents": …})` against a tool wanting `text` got an execution
 * error out of `core` instead of a sentence naming the key it missed.
 * @module
 */

import { shapeOf } from './shape.js'

/** @typedef {import('@harness/kernel').ToolId} ToolId */

/** What a value must be. The three JSON scalars a tool argument is ever written as; a shape beyond them is a tool that wants a document, and that is a `string`. @typedef {'string' | 'number' | 'boolean'} ArgType */

/** @typedef {{name: string, type: ArgType, required: boolean, description: string}} ToolArg */

/**
 * @typedef {object} Tool
 * @property {ToolId} name  what the model writes to call it
 * @property {string} description  one line: what it is for, in the words the model reads
 * @property {ToolArg[]} args  its schema, in the order the usage line states them
 * @property {boolean} mutates  it CHANGED something when it succeeds. Read by the turn's evidence fold: a successful mutation clears whatever was green, so anything still green at the end postdates the edit it is offered for.
 * @property {boolean} evidence  its output is something the verify stage may CITE. `exec` is one; `read_file` is not, because reading a file you just wrote proves the write and not the work.
 */

/**
 * One argument. Required by default: an optional argument is a decision, and
 * defaulting to optional makes every schema quietly permissive.
 * @param {string} name @param {ArgType} type @param {string} description
 * @param {{required?: boolean}} [opts]
 * @returns {ToolArg}
 */
export function arg(name, type, description, opts = {}) {
  return { name, type, description, required: opts.required ?? true }
}

/**
 * A tool. Both declared properties default to FALSE, which is the safe half of
 * each: a tool nobody said changes anything is not counted as an edit, and one
 * nobody said is evidence cannot be cited as proof.
 * @param {{name: ToolId, description: string, args?: ToolArg[], mutates?: boolean, evidence?: boolean}} spec
 * @returns {Tool}
 */
export function tool(spec) {
  return Object.freeze({
    name: spec.name,
    description: spec.description,
    args: [...(spec.args ?? [])],
    mutates: spec.mutates ?? false,
    evidence: spec.evidence ?? false,
  })
}

/**
 * ONE LINE, exactly the call shape and what it does — generated, so no two
 * tools can describe themselves differently and no line can go stale against
 * the schema it describes (I16).
 *
 * An optional argument SAYS it is optional, and every argument says its type.
 * Neither was sayable before, so the model learned both by being refused.
 * @param {Tool} t @returns {string}
 */
export function usage(t) {
  const pairs = t.args.map((a) => `"${a.name}": "<${a.type}${a.required ? '' : ', optional'}>"`)
  return `${t.name}({${pairs.join(', ')}}): ${t.description}`
}

/** The arguments read, or the one sentence saying why they could not be. @typedef {{values: Record<string, unknown>} | {problem: string}} ReadArgs */

/**
 * THE ARGUMENTS, READ AGAINST THE SCHEMA. Two failures, and both are the
 * model's to fix: the JSON did not parse, or it parsed and does not match what
 * the tool declared.
 *
 * A missing OPTIONAL argument is not a failure and a missing REQUIRED one is
 * named — the Rust could say neither, because it had no schema to say it
 * against. Extra keys are left alone: a model sending one more field than the
 * tool wants has not made a mistake this layer can be sure about, and refusing
 * a call over a spare key would cost a round to teach nothing.
 * @param {Tool} t @param {string} argsJson the JSON TEXT the model wrote, never a parsed object
 * @returns {ReadArgs}
 */
export function readArgs(t, argsJson) {
  const text = argsJson.trim() === '' ? '{}' : argsJson
  /** @type {unknown} */
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    return { problem: `they are not JSON (${cause instanceof Error ? cause.message : 'unreadable'})` }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { problem: `they are ${shapeOf(parsed)} where one JSON object was expected` }
  }
  const values = /** @type {Record<string, unknown>} */ (parsed)
  const problem = mismatch(t, values)
  return problem ? { problem } : { values }
}

/** The first argument that disagrees with the schema, worded for the model, or `''`. @param {Tool} t @param {Record<string, unknown>} values @returns {string} */
function mismatch(t, values) {
  for (const a of t.args) {
    const held = Object.hasOwn(values, a.name) ? values[a.name] : undefined
    if (held === undefined) {
      if (a.required) return `"${a.name}" is missing, and it is required — ${a.description}`
      continue
    }
    if (typeof held !== a.type) return `"${a.name}" is ${shapeOf(held)} where ${a.type} was expected`
  }
  return ''
}
