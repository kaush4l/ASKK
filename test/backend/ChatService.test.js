import { describe, expect, test } from 'bun:test'
import { MemoryRepository } from '../../src/backend/repositories/MemoryRepository.js'
import { ChatService } from '../../src/backend/services/ChatService.js'
import { ConversationService } from '../../src/backend/services/ConversationService.js'
import { AgentSpec } from '../../src/core/agent/AgentSpec.js'
import { Outcome } from '../../src/core/Outcome.js'
import { EventName } from '../../src/protocol/Envelope.js'
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

function chatWith(replies, services = {}) {
  // The real `ConversationService` over an in-memory store, not a fake: the
  // thing under test is that the chat path writes through the domain model, and
  // a fake `appendMessage` would be this test agreeing with itself about a
  // schema neither of them owns.
  const repository = new MemoryRepository('conversation')
  repository.rows.set('c1', { id: 'c1', title: 'Chat', messages: [], createdAt: 1 })
  const conversations = new ConversationService(repository)

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
  const service = new ScriptedChat(inference, {
    conversations,
    settings,
    catalogue,
    pool: { ask: async () => Outcome.ok('') },
    ...services,
  })
  return { service, conversations: repository, inference }
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
    // COUNTED, not `toContain`. Every note was in this array twice — pushed
    // once and spread again — and `toContain` is true of a duplicate, which is
    // why a green suite shipped a notes panel that repeated itself and, because
    // `page.jsx` keys each note by its text, collided two React keys.
    const stopNote = 'you stopped this run after 2 step(s)'
    expect(sent.notes.filter((note) => note === stopNote)).toHaveLength(1)
    expect(new Set(sent.notes).size).toBe(sent.notes.length)
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

  test("the agent file's declared budget reaches the loop and bounds the run", async () => {
    // Asserted on BEHAVIOUR now rather than on a line in the prompt. The
    // running counters are gone — an A/B against an arm without them changed
    // nothing and they cost 30 tokens a turn — so what proves the declaration
    // arrived is that two steps is where a two-step budget stops.
    const { service, inference } = chatWith([
      toolTurn('shell({"command": "true"})'),
      toolTurn('shell({"command": "true"})'),
      answerTurn('never reached'),
    ])
    const spec = AgentSpec.of({
      metadata: { name: 'main', budget: { steps: 2 } },
      body: 'be brief',
      source: 'test',
    }).value
    service.catalogue.spec = async () => Outcome.ok(spec)

    const sent = await service.send({ id: 'c1', text: 'hello' })

    expect(inference.calls).toHaveLength(2)
    // The last turn was told in words that it was the last, and said so in the
    // prompt it was handed rather than being cut off after it.
    expect(inference.prompts[1]).toContain('THIS IS YOUR LAST TURN. the 2-step budget is spent')
    expect(sent.ok).toBe(false)
    expect(sent.error?.message ?? sent.failure.message).toContain('the 2-step budget ran out')
  })

  test('a stop that lands on a completed answer keeps it, and writes it down', async () => {
    // The other half of the engine's defect, seen where it would actually hurt:
    // the answer the user was one second away from reading has to survive into
    // the transcript, not be reported as "the model said nothing".
    const controller = new AbortController()
    const { service, conversations, inference } = chatWith([answerTurn('a linux kernel')])
    const original = inference.invoke.bind(inference)
    inference.invoke = async (...args) => {
      const reply = await original(...args)
      controller.abort()
      return reply
    }

    const sent = await service.send(
      { id: 'c1', text: 'what kernel is this?' },
      null,
      controller.signal,
    )

    expect(sent.ok).toBe(true)
    expect(sent.value.assistant.text).toBe('a linux kernel')
    expect(saved(conversations).map((m) => m.role)).toEqual(['user', 'assistant'])
  })
})

/**
 * What `_inferenceFor` actually hands the loop.
 *
 * Every other test in this file replaces that method, which is why a setting
 * could be added to `DEFAULT_SETTINGS`, documented in the transport, and never
 * arrive: the seam that drops it is the one seam the suite stubs out. So these
 * call the real one and read the object it built.
 */
describe('the inference a turn is given', () => {
  const service = () =>
    new ChatService({ conversations: new ConversationService(new MemoryRepository('c')) })
  const bare = AgentSpec.of({ metadata: { name: 'main' }, body: 'be brief', source: 'test' }).value
  const base = { kind: 'openai', model: 'm', baseUrl: 'http://127.0.0.1:8873/v1', apiKey: '' }

  test('the app-wide thinking setting reaches the transport', async () => {
    const built = await service()._inferenceFor({ ...base, thinking: false }, bare)

    expect(built.value.thinking).toBe(false)
  })

  test('and an agent file overrides it, the way temperature and max tokens do', async () => {
    const quiet = AgentSpec.of({
      metadata: { name: 'main', thinking: false },
      body: 'be brief',
      source: 'test',
    }).value

    const built = await service()._inferenceFor({ ...base, thinking: true }, quiet)

    expect(built.value.thinking).toBe(false)
  })

  test('a settings record written before the field existed still thinks', async () => {
    // `SettingsService.get` merges the defaults over what was stored, so an old
    // record yields `thinking: true` rather than `undefined`. This asserts the
    // end of that path: undefined must not read as off.
    const built = await service()._inferenceFor(base, bare)

    expect(built.value.thinking).toBe(true)
  })
})

/**
 * The capabilities a tool needs arrive in the constructor, like every other
 * collaborator in this backend.
 *
 * `http` used to be written onto `service.services` by `composition.js` after
 * the object was built — the one seam in the backend that broke the tree's own
 * port-in-the-constructor rule, and the only backend object that was half built
 * when its constructor returned. The failure it invites is silent: a tool built
 * without a port does not throw, it answers `this build cannot make an HTTP
 * request`, so a caller that forgets the second statement gets an agent that
 * runs, holds a `fetch` tool, and can never fetch anything.
 *
 * These run the real `resolveTools` path — `send` builds the agent, the agent
 * resolves `fetch` from `this.services`, and the port either answers or does
 * not. Nothing here reads the `services` record directly, because reading the
 * record only proves the constructor agrees with itself.
 */
describe('the port a tool is given', () => {
  const webAgent = AgentSpec.of({
    metadata: { name: 'main', tools: ['fetch'] },
    body: 'be brief',
    source: 'test',
  }).value

  const page = (text) =>
    Outcome.ok({
      url: 'https://example.com/',
      status: 200,
      contentType: 'text/plain',
      text,
      bytes: text.length,
      truncated: false,
      stopped: '',
      blocked: '',
    })

  test('a port passed to the constructor is the one the fetch tool calls', async () => {
    const asked = []
    const http = async (request) => {
      asked.push(request.url)
      return page('the guest is alpine')
    }
    const { service, inference } = chatWith(
      [toolTurn('fetch({"url": "https://example.com/"})'), answerTurn('alpine')],
      { http },
    )
    service.catalogue.spec = async () => Outcome.ok(webAgent)

    const sent = await service.send({ id: 'c1', text: 'what is on that page?' })

    expect(sent.ok).toBe(true)
    // The port was reached, and what it returned was handed back to the model.
    expect(asked).toEqual(['https://example.com/'])
    expect(inference.prompts[1]).toContain('the guest is alpine')
  })

  test('and with no port the same run reaches nothing, which is why it must be passed', async () => {
    // The shape of the old defect, written down. This is what the agent got on
    // every turn if the statement after the constructor was ever dropped: a
    // run that succeeds, a tool that answers, and no request made at all.
    const { service, inference } = chatWith(
      [toolTurn('fetch({"url": "https://example.com/"})'), answerTurn('nothing')],
      {},
    )
    service.catalogue.spec = async () => Outcome.ok(webAgent)

    const sent = await service.send({ id: 'c1', text: 'what is on that page?' })

    expect(sent.ok).toBe(true)
    expect(inference.prompts[1]).toContain('this build cannot make an HTTP request')
  })
})

/**
 * The transcript this service writes, and who owns its shape.
 *
 * This class used to take the repository and push message literals onto the
 * record it had loaded — `{id, role, text, createdAt}` for the question and the
 * same plus `thinking` for the reply. `Message.toJSON()` emitted neither
 * `thinking` nor any of its repairs, so the two writers held two spellings of
 * one schema and the first round trip through `ConversationService` deleted the
 * field only one of them knew about. These pin the single owner.
 */
describe('the record a turn leaves behind', () => {
  const thinkingTurn = (thought, answer) =>
    `think: [${thought}]\n\nplan: []\n\nact: answer\n\nresult: ${answer}`

  test("the model's working-out is on disk, and is still there a turn later", async () => {
    const { service, conversations } = chatWith([
      thinkingTurn('it is linux', 'a linux kernel'),
      thinkingTurn('asked again', 'still linux'),
    ])

    const first = await service.send({ id: 'c1', text: 'what kernel is this?' })
    expect(first.value.assistant.thinking).toBe('it is linux')
    expect(saved(conversations)[1].thinking).toBe('it is linux')

    // The second turn rewrites the whole record. Before the schema had one
    // owner this is the exact write that erased the first turn's thinking.
    await service.send({ id: 'c1', text: 'are you sure?' })
    expect(saved(conversations).map((m) => m.thinking)).toEqual([
      undefined,
      'it is linux',
      undefined,
      'asked again',
    ])
  })

  test('the step the page draws and the record it is drawn beside are one reader', async () => {
    // Nothing in the tree drove `emit` at all, so the whole narration half of
    // `send` — four `EventName` emissions — had never been executed by a test.
    // Its three questions about a parsed reply were also spelled out a second
    // time, one branch below, for the record: `answer` was `?? ''` on the wire
    // and a bare `.answer` on the way to storage. Two spellings of one rule is
    // how `thinking` became a field only one writer had heard of, so what is
    // asserted is that the wire and the record AGREE, not merely that each is
    // individually plausible.
    const events = []
    const { service, conversations } = chatWith([
      thinkingTurn('a shell would settle it', 'shell({"command": "uname -a"})').replace(
        'act: answer',
        'act: tool',
      ),
      thinkingTurn('it is linux', 'a linux kernel'),
    ])

    await service.send({ id: 'c1', text: 'what kernel is this?' }, (name, payload) =>
      events.push([name, payload]),
    )

    const steps = events.filter(([name]) => name === EventName.STEP).map(([, event]) => event)
    expect(steps.map((s) => s.isAnswer)).toEqual([false, true])
    expect(steps[0].answer).toBe('shell({"command": "uname -a"})')
    expect(steps[0].thinking).toBe('a shell would settle it')
    // The last step and the message written down are the same two strings.
    const written = saved(conversations).at(-1)
    expect(written.text).toBe(steps.at(-1).answer)
    expect(written.thinking).toBe(steps.at(-1).thinking)
  })

  test('a reply with no text in it is written down as having said nothing', async () => {
    // Found by mutation: replacing the stand-in with `''` left every test in
    // this file green. A model that answers with an empty string still made a
    // turn, and the transcript would show a blank assistant bubble that nothing
    // — not the notes, not the record — explains.
    const { service, conversations } = chatWith([answerTurn('')])

    const sent = await service.send({ id: 'c1', text: 'what kernel is this?' })

    expect(sent.value.assistant.text).toBe('(the model returned nothing)')
    expect(saved(conversations)[1].text).toBe('(the model returned nothing)')
  })

  test('the domain model repairs the transcript this turn was appended to', async () => {
    // The repair path had never run on the live chat path at all, because
    // nothing here constructed a `Message`. A malformed row already on disk was
    // therefore read, sent to the model, and written back exactly as malformed.
    const { service, conversations } = chatWith([answerTurn('linux')])
    conversations.rows.get('c1').messages.push({ id: 'm0', role: 'wizard', text: 7, createdAt: 1 })

    await service.send({ id: 'c1', text: 'what kernel is this?' })

    const [repaired] = saved(conversations)
    expect(repaired.role).toBe('user')
    expect(repaired.text).toBe('7')
    expect(repaired.repairs).toHaveLength(2)
  })

  test('a message that arrives while the model is thinking is not overwritten', async () => {
    // The reply used to be pushed onto the record loaded before the model call
    // and put back whole, so anything written during the call — seconds, or
    // minutes against a local model — was deleted by a turn reporting success.
    const { service, conversations, inference } = chatWith([answerTurn('a linux kernel')])
    const original = inference.invoke.bind(inference)
    inference.invoke = async (...args) => {
      await service.conversations.appendMessage({
        id: 'c1',
        role: 'system',
        text: 'arrived mid-call',
      })
      return original(...args)
    }

    const sent = await service.send({ id: 'c1', text: 'what kernel is this?' })

    expect(sent.ok).toBe(true)
    expect(saved(conversations).map((m) => m.text)).toEqual([
      'what kernel is this?',
      'arrived mid-call',
      'a linux kernel',
    ])
  })

  test('the whole transcript is what the model is given, not just the new question', async () => {
    // Found by mutation: replacing the history with `[userMessage]` alone left
    // every test in this file green. An agent that is handed only the latest
    // question has no memory at all, and nothing here could see it.
    const { service, inference } = chatWith([answerTurn('linux'), answerTurn('yes, linux')])

    await service.send({ id: 'c1', text: 'what kernel is this?' })
    await service.send({ id: 'c1', text: 'are you sure?' })

    expect(inference.prompts[1]).toContain('what kernel is this?')
    expect(inference.prompts[1]).toContain('linux')
    expect(inference.prompts[1]).toContain('are you sure?')
  })

  test('a reply that cannot be written down still reports what was', async () => {
    // The failure shape has to match the stopped-run branch: the question was
    // persisted before the model was called, and a caller that is handed a bare
    // failure cannot tell whether it survived.
    const { service, conversations } = chatWith([answerTurn('a linux kernel')])
    const original = service.conversations.appendMessage.bind(service.conversations)
    let calls = 0
    service.conversations.appendMessage = async (...args) =>
      ++calls === 2 ? Outcome.failed('UNAVAILABLE', 'the database is closed') : original(...args)

    const sent = await service.send({ id: 'c1', text: 'what kernel is this?' })

    expect(sent.ok).toBe(false)
    expect(sent.value.user.text).toBe('what kernel is this?')
    expect(sent.value.assistant).toBe(null)
    expect(saved(conversations).map((m) => m.role)).toEqual(['user'])
  })

  test('a conversation that is gone fails by name rather than being invented', async () => {
    const { service } = chatWith([answerTurn('never sent')])

    const sent = await service.send({ id: 'no-such', text: 'hello?' })

    expect(sent.ok).toBe(false)
    expect(sent.failure.message).toBe('no conversation no-such')
    expect(sent.failure.hint).toContain('Start a new chat')
  })
})

/**
 * What the page hears while a SECOND agent is working.
 *
 * A delegated run is a whole other agent on a whole other thread, and until
 * this it said nothing at all until it was finished: the parent's view streams
 * every token the parent produces and showed a blank rail for the minutes a
 * sub-agent spent reading pages. A thread doing its fourth fetch and a thread
 * that was wedged were the same picture.
 *
 * The pool is faked here and the CHANNEL is what is under test: that
 * `ChatService` hands the pool somewhere to report to, that what arrives is
 * relabelled onto the parent's own request id, and that a caller who passed no
 * emitter is handed no channel and gets the same answer anyway. The thread
 * itself is proven in `bun run smoke`, which is the only place a Worker exists.
 */
describe('a sub-agent that is still working', () => {
  const delegating = [toolTurn('helper({"task": "go and read"})'), answerTurn('it said hello')]

  /** A pool that reports two passes before it answers, like a real thread. */
  const reportingPool = (seen) => ({
    async ask(name, task, _settings, _signal, onProgress) {
      seen.push({ name, task, watched: typeof onProgress === 'function' })
      onProgress?.({ agent: name, step: 1, doing: ['fetch'], answered: false })
      onProgress?.({ agent: name, step: 2, doing: [], answered: true })
      return Outcome.ok('hello')
    },
  })

  /** A second agent in the roster, so `helper` resolves to a peer and not a note. */
  const withPeer = (services) => {
    const main = AgentSpec.of({
      metadata: { name: 'main', tools: ['helper'] },
      body: 'be brief',
      source: 'test',
    }).value
    const helper = AgentSpec.of({
      metadata: { name: 'helper', description: 'goes and reads' },
      body: 'read it',
      source: 'test',
    }).value
    return {
      catalogue: {
        async spec() {
          return Outcome.ok(main)
        },
        async all() {
          return Outcome.ok([main, helper])
        },
      },
      ...services,
    }
  }

  test('every pass it finishes arrives on the parent’s request as a delegate event', async () => {
    const seen = []
    const { service } = chatWith(delegating, withPeer({ pool: reportingPool(seen) }))
    const events = []

    const sent = await service.send({ id: 'c1', text: 'ask the helper' }, (name, data) =>
      events.push({ name, data }),
    )

    expect(sent.ok).toBe(true)
    expect(seen).toEqual([{ name: 'helper', task: 'go and read', watched: true }])
    const delegated = events.filter((event) => event.name === EventName.DELEGATE)
    expect(delegated.map((event) => event.data)).toEqual([
      { agent: 'helper', step: 1, doing: ['fetch'], answered: false },
      { agent: 'helper', step: 2, doing: [], answered: true },
    ])
  })

  test('a caller watching nothing is handed no channel, and gets the same answer', async () => {
    const seen = []
    const { service } = chatWith(delegating, withPeer({ pool: reportingPool(seen) }))

    const sent = await service.send({ id: 'c1', text: 'ask the helper' })

    expect(sent.ok).toBe(true)
    expect(sent.value.assistant.text).toBe('it said hello')
    // Not merely unused: not passed. A pool given a callback nobody is listening
    // to would post messages across a realm boundary for nothing.
    expect(seen).toEqual([{ name: 'helper', task: 'go and read', watched: false }])
  })
})
