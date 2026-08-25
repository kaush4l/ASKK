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

import { CAPABILITY_SENTENCE } from '@harness/kernel'
import { swallowedClose } from './calls.js'
import { arg, available, readArgs, tool, usage } from './tools.js'

/** @typedef {import('@harness/kernel').CapabilityId} CapabilityId */
/** @typedef {import('./tools.js').Tool} Tool */
/** @typedef {import('./turn.js').ToolCall} ToolCall */
/** @typedef {import('./spec.js').AgentSpec} AgentSpec */

/** What one agent's file resolved to. `withheld` and `unresolved` are two different failures and neither is silent: one is a capability this build does not have, the other is a name nothing here answers to. @typedef {{toolbox: Tool[], withheld: Tool[], unresolved: string[], notice: string}} Resolved */

/**
 * WHAT THIS AGENT MAY ACTUALLY CALL, from its file and this build's
 * capabilities. Three rules, and each one was a defect first.
 *
 * `engine: base` IS THE EMPTY TOOLBOX. The card said "answers in one reply,
 * without calling tools" while nothing enforced it, so the one shipped `base`
 * agent was the most capable file in the tree.
 *
 * A NON-EMPTY `tools:` LIST IS THE WHOLE ALLOWLIST, so the catalogue is what
 * makes a tool available to NAME rather than a set appended after the filter.
 * Appended, `tools: [read_file, list_files]` would silently also grant `exec`,
 * and a read-only agent would be unrepresentable.
 *
 * A NAME THAT IS NEITHER is reported, never refused: it may be a peer agent
 * that is not written yet, and refusing here would make "write the caller, then
 * write the sub-agent" impossible while "write them in the other order" was
 * fine — a rule about typing order enforced as if it were about capability.
 * @param {AgentSpec} spec
 * @param {{catalogue: readonly Tool[], offered: readonly CapabilityId[] | undefined, peers?: readonly AgentSpec[]}} env
 * @returns {Resolved}
 */
export function toolboxFor(spec, env) {
  if (spec.engine === 'base') return { toolbox: [], withheld: [], unresolved: [], notice: '' }
  const wanted = spec.tools.length === 0
    ? env.catalogue.map((t) => t.name)
    : spec.tools
  /** @type {Resolved} */
  const out = { toolbox: [], withheld: [], unresolved: [], notice: '' }
  for (const name of wanted) {
    const held = named(env.catalogue, name)
    const peer = (env.peers ?? []).find((p) => p.name === name && p.name !== spec.name)
    if (held) (available(held, env.offered) ? out.toolbox : out.withheld).push(held)
    else if (peer) out.toolbox.push(peerTool(peer))
    else out.unresolved.push(name)
  }
  return { ...out, notice: absence(out.withheld) }
}

/**
 * A PEER AGENT AS AN ORDINARY TOOL (I9): the model is never told which of its
 * tools is another agent, because the distinction would be noise in the prompt
 * and everything is invoked identically. Its own file's `description` is the
 * line the caller reads, which is why a peer's description is worth writing.
 * @param {AgentSpec} peer @returns {Tool}
 */
export function peerTool(peer) {
  return tool({
    name: peer.name,
    description: peer.description,
    args: [arg('query', 'string', 'the whole task, in one string — it cannot see your conversation')],
  })
}

/**
 * THE CAPABILITY THAT IS ABSENT, IN WORDS (I16). A model told nothing about a
 * constraint does not treat it as unknown; it treats it as absent from the
 * problem and plans as though the tool were there but broken. So a withheld
 * tool is not merely hidden — the prompt SAYS which capability this build does
 * not have and which calls went with it.
 *
 * Grouped by capability and in catalogue order, so two identical builds word
 * this identically (I14).
 * @param {readonly Tool[]} withheld @returns {string}
 */
function absence(withheld) {
  /** @type {Map<string, string[]>} */
  const by = new Map()
  for (const t of withheld) {
    if (t.needs === '') continue
    by.set(t.needs, [...(by.get(t.needs) ?? []), t.name])
  }
  return [...by].map(([cap, names]) => {
    const sentence = CAPABILITY_SENTENCE[/** @type {CapabilityId} */ (cap)]
    const verb = names.length === 1 ? 'is' : 'are'
    return `This build cannot ${sentence}, so ${names.join(', ')} ${verb} not available to you here.`
  }).join(' ')
}

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
