/**
 * THE DRIVER THE WALK TESTS SHARE: the shipped agent files and briefs, a
 * scripted model, and a table of tool results. It is `core`'s driver's job
 * done by hand — run each effect, hand the fact back — and nothing in between
 * guesses anything.
 * @module
 */

import { adoptSpec, arg, loadAgents, loadBriefs, newAgentState, step, tool } from '@harness/agent'
import { CARD } from './card.js'

/** @typedef {import('@harness/agent').AgentState} AgentState */
/** @typedef {import('@harness/agent').Effect} Effect */
/** @typedef {import('@harness/agent').Incoming} Incoming */
/** @typedef {import('@harness/kernel').Fact} Fact */
/** @typedef {{text?: string, calls?: Array<{id: string, tool: string, args: string}>, finish?: import('@harness/agent').FinishReason}} Said */

export const AT = 1_700_000_000_000

/** The files the page actually fetches. Fixturing them would prove the walk against briefs nobody ships. */
const PUBLIC = `${import.meta.dir}/../../../apps/web/public`
const read = (/** @type {string} */ path) => Bun.file(`${PUBLIC}/${path}`).text()
const roster = loadAgents(await Promise.all(['main', 'critic'].map(async (name) => ({
  path: `public/agents/${name}/agent.md`, text: await read(`agents/${name}/agent.md`),
}))))
const loaded = loadBriefs(await Promise.all(
  ['strategy', 'plan', 'verify', 'critique', 'durable'].map(async (key) => ({ key, text: await read(`stages/${key}.md`) })),
))
/** @param {string} why @returns {never} */
function fail(why) { throw new Error(why) }
const BRIEFS = 'refusal' in loaded ? fail(loaded.refusal.message) : loaded.briefs
const MAIN = roster.specs.find((s) => s.name === 'main') ?? fail('the shipped main did not load')

export const CATALOGUE = [
  tool({ name: 'exec', description: 'Run a command.', args: [arg('command', 'string', 'the command')], evidence: true }),
  tool({ name: 'write_file', description: 'Write a file.', args: [arg('path', 'string', 'where'), arg('text', 'string', 'the contents')], mutates: true }),
  tool({ name: 'list_skills', description: 'List the skills.' }),
  tool({ name: 'read_skill', description: 'Read one skill.', args: [arg('name', 'string', 'its name')] }),
]

/** The shipped `main`, adopted: its stage list, its critic and its toolbox all come off the file. @returns {AgentState} */
export function agent() {
  const { state } = adoptSpec(newAgentState(), MAIN, { catalogue: CATALOGUE, offered: undefined, peers: roster.specs, card: CARD })
  return { ...state, briefs: BRIEFS }
}

/**
 * THE WHOLE LOOP, DRIVEN, with a scripted model and a table of tool results —
 * the same job `core`'s driver does and nothing in between guessing anything.
 * Every assembled document is kept, because what the model was SHOWN is half of
 * every claim below.
 * @param {AgentState} start @param {string} message @param {Said[]} script
 * @param {(tool: string, args: string) => {ok: boolean, output: string}} [runTool]
 */
export function drive(start, message, script, runTool = () => ({ ok: true, output: 'ok' })) {
  let state = start
  /** @type {Incoming[]} */
  const inbox = [{ at: AT, turnId: 'turn-1', fact: { type: 'user_message', text: message, agent: 'main', from: 'person' } }]
  /** @type {Fact[]} */
  const facts = []
  /** @type {Array<{sections: Array<{id: string, parts: Array<{text?: string}>}>}>} */
  const papers = []
  for (let guard = 0; inbox.length > 0; guard += 1) {
    if (guard > 40) throw new Error('the loop did not terminate')
    const incoming = /** @type {Incoming} */ (inbox.shift())
    const taken = step(state, incoming)
    state = taken.state
    for (const effect of taken.effects) {
      if (effect.type === 'CallModel') {
        papers.push(/** @type {{sections: Array<{id: string, parts: Array<{text?: string}>}>}} */ (effect.document))
        inbox.push(replied(effect, script[papers.length - 1] ?? { text: 'done.' }))
      } else if (effect.type === 'InvokeTool') {
        inbox.push(ran(effect, runTool(effect.tool, effect.args)))
      } else if (effect.type === 'Emit') facts.push(effect.fact)
    }
  }
  return { state, facts, papers }
}

/** @param {Effect & {type: 'CallModel'}} call @param {Said} said @returns {Incoming} */
function replied(call, said) {
  const calls = said.calls ?? []
  return {
    at: AT, turnId: call.turnId,
    fact: { type: 'model_replied', agent: 'main', text: said.text ?? '', reasoning: '', finish: 'stop' },
    reply: { calls, finish: said.finish ?? (calls.length > 0 ? 'tool_calls' : 'stop') },
  }
}

/** @param {Effect & {type: 'InvokeTool'}} invoke @param {{ok: boolean, output: string}} result @returns {Incoming} */
function ran(invoke, result) {
  return {
    at: AT, turnId: invoke.turnId, callId: invoke.callId,
    fact: { type: 'tool_invoked', agent: 'main', tool: invoke.tool, args: invoke.args, ...result, onBehalfOf: '' },
  }
}

/** Every stage this turn entered, in order — read off the log, not off the state, because the log is what a person reads it back from. @param {Fact[]} facts @returns {string[]} */
export const walked = (facts) => facts.flatMap((f) => (f.type === 'stage_entered' ? [f.stage] : []))

/** @param {Fact[]} facts @param {string} kind @returns {Record<string, unknown>} */
export function payloadOf(facts, kind) {
  const found = facts.find((f) => f.type === 'custom' && f.kind === kind)
  if (found?.type !== 'custom') throw new Error(`no ${kind} was emitted`)
  return /** @type {Record<string, unknown>} */ (found.payload)
}

/** @param {{sections: Array<{id: string, parts: Array<{text?: string}>}>}} paper @param {string} id @returns {string} */
export function body(paper, id) {
  return (paper.sections.find((s) => s.id === id)?.parts ?? []).map((p) => p.text ?? '').join('\n')
}


/** One scripted vote. Its own helper because every walk below opens with one and none of them is about the vote's wording. @param {string} route @returns {Said} */
export const VOTE = (route) => ({ text: `ROUTE: ${route}\nWHY: because.` })
