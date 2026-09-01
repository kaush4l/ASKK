import { describe, expect, test } from 'bun:test'
import { MemoryRepository } from '../../src/backend/repositories/MemoryRepository.js'
import { ChatService } from '../../src/backend/services/ChatService.js'
import { AgentSpec } from '../../src/core/agent/AgentSpec.js'
import { Outcome } from '../../src/core/Outcome.js'
import { ScriptedInference } from '../support/ScriptedInference.js'

/**
 * What ends up in the transcript when a run does not finish.
 *
 * This is the case a test on the engine cannot reach. The loop hands back an
 * unanswered turn when it is stopped mid tool call — that is correct, and the
 * value is worth carrying — but whether `result: shell({"command": "rm -rf /"})`
 * then gets WRITTEN DOWN as the assistant's reply is decided here, and a stop
 * that corrupts the conversation it stopped is worse than no stop at all.
 *
 * The user's own message is the other half: it is saved before the model is
 * called precisely so that a run that goes nowhere does not also lose what they
 * typed, and a cancel must not undo that.
 */

const toolTurn = (call) => `think: []\n\nplan: []\n\nact: tool\n\nresult: ${call}`
const answerTurn = (text) => `think: []\n\nplan: []\n\nact: answer\n\nresult: ${text}`

/**
 * The real service with its transport replaced.
 *
 * `_inferenceFor` is the seam: it is the one method that reaches for a network
 * client, and overriding it is what lets the rest of the use case — the reads,
 * the writes, the agent build, the persistence decision — run exactly as it
 * does in the worker.
 */
class ScriptedChat extends ChatService {
  constructor(inference, ...rest) {
    super(...rest)
    this._scripted = inference
  }

  async _inferenceFor() {
    return Outcome.ok(this._scripted)
  }
}

function chatWith(replies) {
  const conversations = new MemoryRepository('conversation')
  conversations.rows.set('c1', { id: 'c1', title: 'Chat', messages: [] })

  const spec = AgentSpec.of({ metadata: { name: 'main' }, body: 'be brief', source: 'test' }).value
  const catalogue = {
    async spec() {
      return Outcome.ok(spec)
    },
    async all() {
      return Outcome.ok([spec])
    },
  }
  const settings = {
    async get() {
      return Outcome.ok({ agent: 'main', kind: 'openai', model: 'm', baseUrl: '', apiKey: '' })
    },
  }
  const inference = new ScriptedInference({ replies })
  const service = new ScriptedChat(inference, conversations, settings, catalogue, {
    ask: async () => Outcome.ok(''),
  })
  return { service, conversations, inference }
}

const saved = (conversations) => conversations.rows.get('c1').messages

describe('ChatService and a run that was stopped', () => {
  test('a stop mid tool call keeps what the user typed and writes no reply at all', async () => {
    const controller = new AbortController()
    const { service, conversations, inference } = chatWith([
      toolTurn('shell({"command": "uname -a"})'),
      toolTurn('shell({"command": "uname -a"})'),
    ])
    const original = inference.invoke.bind(inference)
    inference.invoke = async (...args) => {
      // Stopped while the second call is in flight, which is where a user
      // actually presses the button.
      if (inference.calls.length === 1) controller.abort()
      return original(...args)
    }

    const sent = await service.send(
      { id: 'c1', text: 'what kernel is this?' },
      null,
      controller.signal,
    )

    expect(sent.ok).toBe(true)
    expect(sent.value.user.text).toBe('what kernel is this?')
    // No assistant turn. The loop had a parsed reply in hand and it was a TOOL
    // CALL — writing it down would put `shell(...)` in the transcript as
    // something the assistant said to the user.
    expect(sent.value.assistant).toBe(null)
    expect(saved(conversations).map((m) => m.role)).toEqual(['user'])
    expect(saved(conversations)[0].text).toBe('what kernel is this?')
    expect(sent.notes).toContain('you stopped this run after 2 step(s)')
  })

  test('a stop before the model said anything still leaves the question in the transcript', async () => {
    const controller = new AbortController()
    controller.abort()
    const { service, conversations } = chatWith([answerTurn('never sent')])

    const sent = await service.send({ id: 'c1', text: 'are you there?' }, null, controller.signal)

    expect(sent.ok).toBe(true)
    expect(sent.value.assistant).toBe(null)
    expect(saved(conversations).map((m) => m.text)).toEqual(['are you there?'])
  })

  test('an ordinary answer is still written down, so the guard is not eating replies', async () => {
    const { service, conversations } = chatWith([answerTurn('a linux kernel')])

    const sent = await service.send({ id: 'c1', text: 'what kernel is this?' })

    expect(sent.value.assistant.text).toBe('a linux kernel')
    expect(saved(conversations).map((m) => m.role)).toEqual(['user', 'assistant'])
  })

  test("the agent file's declared budget reaches the loop and is in the prompt", async () => {
    const { service, inference, conversations } = chatWith([answerTurn('brief')])
    // Declared the way an agent file declares it, through the same spec the
    // catalogue hands over.
    const spec = AgentSpec.of({
      metadata: { name: 'main', budget: { steps: 5 } },
      body: 'be brief',
      source: 'test',
    }).value
    service.catalogue.spec = async () => Outcome.ok(spec)

    await service.send({ id: 'c1', text: 'hello' })

    expect(inference.prompts[0]).toContain('steps: 0 of 5 used')
    expect(saved(conversations)).toHaveLength(2)
  })
})
