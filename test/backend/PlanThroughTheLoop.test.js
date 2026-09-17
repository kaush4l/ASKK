import { describe, expect, test } from 'bun:test'
import { MemoryRepository } from '../../src/backend/repositories/MemoryRepository.js'
import { ChatService } from '../../src/backend/services/ChatService.js'
import { ConversationService } from '../../src/backend/services/ConversationService.js'
import { AgentSpec } from '../../src/core/agent/AgentSpec.js'
import { Outcome } from '../../src/core/Outcome.js'
import { ScriptedInference } from '../support/ScriptedInference.js'

/**
 * A plan written on one turn and read back on a later one — through the loop
 * the browser runs, not around it.
 *
 * This is the measurement the roadmap asks of item 2, executed: a goal is
 * decomposed, the decomposition survives the turn that wrote it, and finishing
 * one part changes the block the next turn reads. Everything here is real
 * except the model — the real `ChatService`, the real `buildAgent`, the real
 * `ReActEngine`, the real `Toolbox` parsing the call out of the model's text,
 * the real `PlanTool` resolved by NAME from an agent spec, and the real
 * `ConversationService` over a real repository.
 *
 * The prompts asserted are the ones the TRANSPORT was handed. A tool's return
 * value proves the tool ran; only the prompt proves the agent will read it.
 */

const toolTurn = (call) => `think: []\n\nplan: []\n\nact: tool\n\nresult: ${call}`
const answerTurn = (text) => `think: []\n\nplan: []\n\nact: answer\n\nresult: ${text}`

/** The real service with only its transport replaced. */
class ScriptedChat extends ChatService {
  constructor(inference, ...rest) {
    super(...rest)
    this._scripted = inference
  }

  async _inferenceFor() {
    return Outcome.ok(this._scripted)
  }
}

function chat({ goal = '', tools = ['plan'] } = {}) {
  const repository = new MemoryRepository('conversation')
  repository.rows.set('c1', { id: 'c1', title: 'Chat', goal, messages: [], createdAt: 1 })
  repository.rows.set('c2', { id: 'c2', title: 'Other', messages: [], createdAt: 2 })
  const spec = AgentSpec.of({
    metadata: { name: 'main', tools },
    body: 'be brief',
    source: 'test',
  }).value
  const send = (replies) => {
    const inference = new ScriptedInference({ replies })
    const service = new ScriptedChat(inference, {
      conversations: new ConversationService(repository),
      settings: {
        async get() {
          return Outcome.ok({ agent: 'main', kind: 'openai', model: 'm', baseUrl: '', apiKey: '' })
        },
      },
      catalogue: {
        async spec() {
          return Outcome.ok(spec)
        },
        async all() {
          return Outcome.ok([spec])
        },
        async soul() {
          return Outcome.ok('')
        },
      },
      pool: { ask: async () => Outcome.ok('') },
    })
    return { service, inference }
  }
  send.repository = repository
  return send
}

describe('a plan, across turns', () => {
  test('what one turn composes, a later turn reads in its prompt', async () => {
    const send = chat({ goal: 'ship the parser' })

    const first = send([
      toolTurn('plan({"steps": ["read the spec", "write the test", "make it pass"]})'),
      answerTurn('Three parts.'),
    ])
    const composed = await first.service.send({ id: 'c1', text: 'how would you do this?' })
    expect(composed.ok).toBe(true)

    // A DIFFERENT service instance, a different agent build, an empty
    // scratchpad. Nothing carries over but the stored conversation — which is
    // what a reload is.
    const second = send([answerTurn('Starting on the spec.')])
    await second.service.send({ id: 'c1', text: 'carry on' })

    expect(second.inference.prompts[0]).toContain('# PLAN')
    expect(second.inference.prompts[0]).toContain('1. [ ] read the spec')
    expect(second.inference.prompts[0]).toContain('3. [ ] make it pass')
  })

  test('finishing a part changes the block the next turn reads', async () => {
    const send = chat({ goal: 'ship the parser' })

    const first = send([
      toolTurn('plan({"steps": ["read the spec", "write the test"]})'),
      answerTurn('Two parts.'),
    ])
    await first.service.send({ id: 'c1', text: 'plan it' })

    const second = send([toolTurn('plan({"done": 1})'), answerTurn('Spec read.')])
    await second.service.send({ id: 'c1', text: 'do the first part' })

    const third = send([answerTurn('On the test now.')])
    await third.service.send({ id: 'c1', text: 'and then?' })

    expect(third.inference.prompts[0]).toContain('1. [x] read the spec')
    expect(third.inference.prompts[0]).toContain('2. [ ] write the test')
  })

  test('a step ticked off mid-turn is read as done by the rest of that turn', async () => {
    // The live object, all the way from `ChatService` to the prompt: within one
    // turn there is no reload to re-read the record, so a copy would leave the
    // agent's own scratchpad disagreeing with its own plan block.
    const send = chat({ goal: 'ship the parser' })

    const { service, inference } = send([
      toolTurn('plan({"steps": ["read the spec", "write the test"]})'),
      toolTurn('plan({"done": 1})'),
      answerTurn('Done the first.'),
    ])
    await service.send({ id: 'c1', text: 'go' })

    // Three prompts: before the plan existed, after it was composed, after the
    // first step was ticked off.
    expect(inference.prompts[0]).not.toContain('# PLAN')
    expect(inference.prompts[1]).toContain('1. [ ] read the spec')
    expect(inference.prompts[2]).toContain('1. [x] read the spec')
  })

  test('a plan belongs to its conversation and is not read in another', async () => {
    // The mistake `owner` already exists to prevent for tasks: one job's
    // decomposition steering a different job.
    const send = chat({ goal: 'ship the parser' })

    const first = send([toolTurn('plan({"steps": ["mine alone"]})'), answerTurn('Planned.')])
    await first.service.send({ id: 'c1', text: 'plan it' })

    const other = send([answerTurn('Nothing here.')])
    await other.service.send({ id: 'c2', text: 'what are you doing?' })

    expect(other.inference.prompts[0]).not.toContain('mine alone')
    expect(other.inference.prompts[0]).not.toContain('# PLAN')
  })

  test('a conversation nobody planned gets no heading promising one', async () => {
    const send = chat({ goal: 'ship the parser' })
    const { service, inference } = send([answerTurn('Ask me anything.')])

    await service.send({ id: 'c1', text: 'hello' })

    expect(inference.prompts[0]).toContain('# GOAL')
    expect(inference.prompts[0]).not.toContain('# PLAN')
  })

  test('the plan is on the stored record, so it outlives the tab', async () => {
    const send = chat({ goal: 'ship the parser' })
    const { service } = send([
      toolTurn('plan({"steps": ["one", "two"], "done": 1})'),
      answerTurn('Ok.'),
    ])

    await service.send({ id: 'c1', text: 'plan it' })

    expect(send.repository.rows.get('c1').plan.steps).toEqual([
      { text: 'one', state: 'done' },
      { text: 'two', state: 'pending' },
    ])
  })
})
