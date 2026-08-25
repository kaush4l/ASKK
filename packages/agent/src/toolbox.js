/**
 * THE SET one agent may call, and the gate every call passes before it can
 * run. `tools.js` describes a TOOL; this describes a set of them.
 *
 * A TOOLBOX IS AN ARRAY. The Rust wrapped `Vec<Tool>` in a struct to hang
 * methods off it and to get a distinct type; neither buys anything here, and
 * the narrowing a stage does is [`grant`] in `stages.js` — generic over
 * anything with a name, applied to this. A scope of `none` yields an empty
 * array, which is why a stage that may not act cannot even NAME a tool to the
 * model: the affordances section is built from the granted set.
 *
 * EVERY REFUSAL IS A TOOL RESULT, and that is the whole design. A typed error
 * that reaches a trace view teaches the model nothing, so the next reply
 * repeats the call and the run dies of it. Each of these sentences names what
 * was wrong AND what to write instead, so a malformed call costs one extra
 * round rather than the turn.
 * @module
 */

import { swallowedClose } from './calls.js'
import { readArgs, usage } from './tools.js'

/** @typedef {import('./tools.js').Tool} Tool */
/** @typedef {import('./turn.js').ToolCall} ToolCall */

/** The opening of the swallowed-terminator refusal. A const because the trace folds a person's copy of it behind a disclosure and recognises it by this prefix; two spellings would be two stories. */
export const NOTHING_RAN = 'Nothing ran: an argument ends with'

/** The tool this call names, or `null`. @param {readonly Tool[]} box @param {string} name @returns {Tool | null} */
export function named(box, name) {
  return box.find((t) => t.name === name) ?? null
}

/** One `name(args): description` line per tool, in toolbox order — what the affordances section carries, and the only thing the prompt ever wanted from a tool. @param {readonly Tool[]} box @returns {string[]} */
export function usages(box) {
  return box.map(usage)
}

/** A checked call, or the sentence handed back to the model in its place. @typedef {{tool: Tool, values: Record<string, unknown>} | {refusal: string}} Checked */

/**
 * ONE CALL, CHECKED. Four refusals, in the order a call fails them.
 *
 * THE BLANK NAME GETS THE TERSE ONE, WITHOUT THE CATALOGUE. A call with no
 * name is not a model reaching for a tool it cannot find — it is data that
 * arrived shaped like a call — and answering it with every tool's usage line
 * spends the context window restating what the prompt already said, on the one
 * failure where the model has nothing to look up.
 * @param {readonly Tool[]} box @param {ToolCall} call @returns {Checked}
 */
export function check(box, call) {
  if (call.tool.trim() === '') return { refusal: 'That was data, not a call: no tool was named.' }
  const tool = named(box, call.tool)
  if (!tool) return { refusal: `Tool not found: ${call.tool}. Available: ${catalogue(box)}` }
  if (swallowedClose(call.args)) return { refusal: swallowed(tool) }
  const read = readArgs(tool, call.args)
  if ('problem' in read) {
    return {
      refusal: `Could not read the arguments: ${read.problem}. Write them as JSON on one line, `
        + `escaping any " inside a string and using \\n for a line break — ${usage(tool)}`,
    }
  }
  return { tool, values: read.values }
}

/**
 * WHAT THIS AGENT MAY CALL, in a refusal. `none` and not an empty list: a
 * granted set of nothing is a stage that may not act, and a model reading a
 * blank list would take it for a rendering fault and call the tool again.
 * @param {readonly Tool[]} box @returns {string}
 */
function catalogue(box) {
  return box.length === 0 ? 'none' : box.map((t) => t.name).join(', ')
}

/** @param {Tool} tool @returns {string} */
function swallowed(tool) {
  return `${NOTHING_RAN} "}), this call's own closing text. The value was escaped one level too `
    + 'many, so it swallowed the end of the call and holds those delimiters instead of what you '
    + `meant. Write the call again with the value as one JSON string — \\n for a line break, \\" `
    + `for a quote inside it, and no "}) inside the value — ${usage(tool)}`
}
