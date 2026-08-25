import { expect, test, describe } from 'bun:test'
import { scriptedModel } from '@harness/adapters-test'
import { ANSWERED, ENDED, arg, endedRounds, endedWhy, newAgentState, step, tool } from '@harness/agent'
import { CARD } from './card.js'

/** @typedef {import('@harness/agent').AgentState} AgentState */
/** @typedef {import('@harness/agent').Incoming} Incoming */
/** @typedef {import('@harness/agent').Effect} Effect */
/** @typedef {ReturnType<typeof scriptedModel>} ScriptedModel */

const AT = 1_700_000_000_000

const BOX = [tool({
  name: 'exec',
  description: 'Run a command.',
  args: [arg('command', 'string', 'the command')],
  evidence: true,
})]

/**
 * THE WHOLE LOOP, DRIVEN — the pure step, a scripted model and a fake
 * executor, with nothing in between guessing anything.
 *
 * The driver is the test's, because `core`'s is lane C's. It does the two
 * things a real one does: it runs each effect and hands the fact back. Two
 * details are deliberate. The paper assembly is B11, so this puts the turn's
 * observations in the body itself — the claim is that the model IS TOLD what
 * was wrong, and a driver that never showed it could not execute that claim.
 * And the finish SIGNAL is scripted beside the replies rather than inferred
 * from whether calls came back — inferring it is precisely the silence this
 * loop refuses to end on. It rides beside the script because `ModelReply`
 * carries no `finish` field yet; that is the cross-lane request this lane
 * filed, and when the port carries it this reads it off the reply.
 * @param {AgentState} start @param {string} message
 * @param {ScriptedModel} model
 * @param {(tool: string, args: string) => {ok: boolean, output: string}} runTool
 * @param {import('@harness/agent').FinishReason[]} signals one per scripted reply, in order
 */
async function drive(start, message, model, runTool, signals) {
  let state = start
  /** @type {Incoming[]} */
  const inbox = [{ at: AT, turnId: 'turn-1', fact: { type: 'user_message', text: message, agent: 'main', from: 'person' } }]
  /** @type {Effect[]} */
  const recorded = []
  for (let guard = 0; inbox.length > 0; guard += 1) {
    if (guard > 20) throw new Error('the loop did not terminate')
    const incoming = /** @type {Incoming} */ (inbox.shift())
    const taken = step(state, incoming)
    state = taken.state
    for (const effect of taken.effects) {
      if (effect.type === 'CallModel') inbox.push(await said(model, effect, state, signals[model.calls.length] ?? 'error'))
      else if (effect.type === 'InvokeTool') inbox.push(did(effect, runTool(effect.tool, effect.args)))
      else recorded.push(effect)
    }
  }
  return { state, recorded }
}

/** @param {ScriptedModel} model @param {Effect & {type: 'CallModel'}} call @param {AgentState} state @param {import('@harness/agent').FinishReason} finish @returns {Promise<Incoming>} */
async function said(model, call, state, finish) {
  const reply = await model.call(call.endpoint, { document: call.document, observations: state.observations })
  return {
    at: AT, turnId: call.turnId,
    fact: { type: 'model_replied', agent: 'main', text: reply.text, reasoning: reply.reasoning, finish: 'stop' },
    reply: { calls: reply.calls, finish },
  }
}

/** @param {Effect & {type: 'InvokeTool'}} invoke @param {{ok: boolean, output: string}} result @returns {Incoming} */
function did(invoke, result) {
  return {
    at: AT, turnId: invoke.turnId, callId: invoke.callId,
    fact: { type: 'tool_invoked', agent: 'main', tool: invoke.tool, args: invoke.args, ...result, onBehalfOf: '' },
  }
}

describe('a malformed call costs one extra round, not the run', () => {
  test('the model is told what was wrong, and the next reply parses', async () => {
    /** @type {string[]} */
    const ran = []
    const model = scriptedModel([
      { calls: [{ id: 'c1', tool: 'exec', args: '{"command": ' }] },
      { calls: [{ id: 'c2', tool: 'exec', args: '{"command":"ls -1"}' }] },
      { text: 'The folder holds a.md and b.md.' },
    ])
    const { state, recorded } = await drive({ ...newAgentState(), toolbox: BOX, card: CARD }, 'what is in this folder?', model, (_tool, args) => {
      ran.push(args)
      return { ok: true, output: 'a.md\nb.md' }
    }, ['tool_calls', 'tool_calls', 'stop'])

    // Three model calls where a clean run takes two: exactly one extra round.
    expect(model.calls).toHaveLength(3)
    expect(String(model.calls[1]?.observations)).toContain('Could not read the arguments')
    expect(String(model.calls[1]?.observations)).toContain('exec({"command": "<string>"}): Run a command.')
    // The broken call NEVER RAN. The predecessor handed the unreadable argument
    // to the executor, which is how 179 bytes of un-parsed fragment reached a
    // file on disk under a success the model reported.
    expect(ran).toEqual(['{"command":"ls -1"}'])
    expect(state.turnId).toBe('')
    // The rounds live in the ENDING, because an ending clears the counters it
    // reports: two rounds, the first of which nothing ran in.
    expect(endedRounds(payloadOf(recorded, ENDED))).toBe(2)
    expect(endedWhy(payloadOf(recorded, ENDED))).toBe(ANSWERED)
  })

  test('a run with nothing malformed in it takes the round the malformed one cost, and no more', async () => {
    const model = scriptedModel([
      { calls: [{ id: 'c1', tool: 'exec', args: '{"command":"ls -1"}' }] },
      { text: 'The folder holds a.md and b.md.' },
    ])
    const { recorded } = await drive({ ...newAgentState(), toolbox: BOX, card: CARD }, 'what is in this folder?', model, () => ({ ok: true, output: 'a.md' }), ['tool_calls', 'stop'])
    expect(model.calls).toHaveLength(2)
    expect(endedRounds(payloadOf(recorded, ENDED))).toBe(1)
  })
})

/** @param {Effect[]} effects @param {string} kind @returns {unknown} */
function payloadOf(effects, kind) {
  const found = effects.find((e) => e.type === 'Emit' && e.fact.type === 'custom' && e.fact.kind === kind)
  if (found?.type !== 'Emit' || found.fact.type !== 'custom') throw new Error(`no ${kind} was emitted`)
  return found.fact.payload
}
