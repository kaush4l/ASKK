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

    // The result of that call, against the step that made it. A page shown only
    // the calls can say what the agent tried and never what came back, which is
    // the half of a tool run a person actually reads.
    const observed = events
      .filter(([name]) => name === EventName.OBSERVATION)
      .map(([, event]) => event)
    expect(observed).toHaveLength(1)
    expect(observed[0].step).toBe(1)
    expect(observed[0].action).toBe('shell({"command": "uname -a"})')
    expect(typeof observed[0].observation).toBe('string')
    expect(observed[0].observation.length).toBeGreaterThan(0)
  })

  test('the guest download reports itself on the same channel the weights do', async () => {
    // `docs/LEDGER.md` row S24: the guest is the largest thing this app fetches
    // — tens of megabytes, fetched on the FIRST shell call rather than at boot
    // — and none of that arrival reached a user surface. The hook existed on
    // `TransformersInference` for weights and had no counterpart here.
    const events = []
    // The hook is a plain assignable property, exactly as it is on the real
    // sandbox and on `TransformersInference`. A resolver rather than a bare
    // function because `send` assigns it several awaits in, and a report fired
    // before that assignment would be testing the stand-in.
    const watching = Promise.withResolvers()
    const sandbox = {
      _report: () => {},
      get onProgress() {
        return this._report
      },
      set onProgress(fn) {
        this._report = fn
        watching.resolve(fn)
      },
      async run() {},
    }
    const { service } = chatWith([answerTurn('done')], { sandbox })

    const turn = service.send({ id: 'c1', text: 'run a command' }, (name, payload) =>
      events.push([name, payload]),
    )
    const report = await watching.promise
    // Reported DURING the turn: the emitter is set for the call and cleared
    // when it ends, so a bar cannot be drawn for a turn that is over.
    report({
      status: 'progress',
      file: 'Linux machine',
      loaded: 1_048_576,
      total: 52_602_121,
      percent: 2,
    })
    await turn

    const progress = events
      .filter(([name]) => name === EventName.PROGRESS)
      .map(([, event]) => event)
    expect(progress).toHaveLength(1)
    expect(progress[0].file).toBe('Linux machine')
    expect(progress[0].loaded).toBe(1_048_576)
    expect(progress[0].percent).toBe(2)

    // And the hook is let go with the call. Left in place, the next turn's
    // download would report into a request that has already been answered.
    events.length = 0
    sandbox.onProgress({
      status: 'progress',
      file: 'Linux machine',
      loaded: 2,
      total: 3,
      percent: 66,
    })
    expect(events).toEqual([])
  })

  test('an attachment is stored on the turn and handed to the model', async () => {
    // The chain under `send` — `Engine.step`, `OpenAICompatible._content`,
    // `AnthropicCompatible._content`, `Multimodality` — has taken attachments
    // since it was written, and `CAPABILITIES.md` names it as the standing
    // example of a capability declared and never wired: neither run site passed
    // any, so an image could reach a model only by editing the source.
    const png = 'data:image/png;base64,iVBORw0KGgo='
    const { service, conversations, inference } = chatWith([answerTurn('a small red square')])

    const sent = await service.send({ id: 'c1', text: 'what is this?', attachments: [png] })
    expect(sent.ok).toBe(true)

    // On the record, so a reload still shows what the question was about.
    const question = saved(conversations)[0]
    expect(question.role).toBe('user')
    expect(question.attachments).toEqual([png])

    // And on the wire, as the modality the data URL declares rather than as a
    // guess made here.
    expect(inference.multimodal).toHaveLength(1)
    expect(inference.multimodal[0].type).toBe('image')
    expect(inference.multimodal[0].urls).toEqual([png])
  })

  test('something that is not a data URL is refused as an attachment, not sent', async () => {
    // A remote URL is a request this app would make on the user's behalf to a
    // host they did not name, from a page whose whole claim is that nothing
    // leaves the browser except the model call they configured.
    const { service, conversations, inference } = chatWith([answerTurn('nothing attached')])

    const sent = await service.send({
      id: 'c1',
      text: 'read this',
      attachments: ['https://example.com/cat.png'],
    })

    expect(sent.ok).toBe(true)
    expect(inference.multimodal).toEqual([])
    // The RECORD omits an empty list, like `thinking` and `repairs` beside it —
    // a field carrying nothing on every message ever stored is bytes saying
    // nothing. `Message` puts it back as `[]` on the way out, so a reader that
    // rehydrates never sees `undefined` and one reading raw JSON must default.
    expect(saved(conversations)[0].attachments).toBeUndefined()
    expect(sent.notes.join(' ')).toContain('attachment')
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

/**
 * What a turn costs before the model is called.
 *
 * An agent that declares an MCP server in the guest used to pay for it on every
 * single turn: `initialize` and `tools/list` are two commands, the transport has
 * no session, and a command is an Alpine boot. Measured here at TWO
 * `sandbox.run` calls for a turn that only said hello — and on the first turn of
 * a session those two are the 50.2 MiB image, fetched and inflated, for a
 * question that never wanted a guest.
 *
 * So the guest's servers wait for the guest. This is the measurement, kept as a
 * test because the number is the whole argument.
 */
describe('what an mcp server in the guest costs a turn', () => {
  const withServer = AgentSpec.of({
    metadata: {
      name: 'main',
      mcp: [{ name: 'host', command: 'mcp-disk', include_tools: ['disk'] }],
    },
    body: 'be brief',
    source: 'test',
  }).value

  /** A guest that records every command and answers the handshake. */
  const guest = ({ warm }) => {
    const ran = []
    return {
      ran,
      get available() {
        return true
      },
      get warm() {
        return warm
      },
      async run(command) {
        ran.push(command)
        // The id is ECHOED, not fixed at 1. A canned `id: 1` answers the
        // handshake and leaves `tools/list` unanswered, so this fake used to
        // produce a FAILED discovery — and the caching test above it was
        // asserting that a failure is cached, which is the one thing that must
        // not be. `McpClient` correlates by id exactly as a real client does.
        // The LAST id on the command line, not the first: the transport
        // replays the handshake ahead of every request, so the line carries
        // `initialize` (id 1) and then the request actually being made.
        const ids = [...String(command).matchAll(/"id":\s*(\d+)/g)].map((m) => Number(m[1]))
        const listing = {
          jsonrpc: '2.0',
          id: ids.at(-1) ?? 1,
          result: { tools: [{ name: 'disk' }] },
        }
        return Outcome.ok({ stdout: `${JSON.stringify(listing)}\n`, stderr: '', code: 0 })
      },
    }
  }

  const chatFor = (sandbox) => {
    const { service } = chatWith([answerTurn('hello back')], {
      catalogue: {
        async spec() {
          return Outcome.ok(withServer)
        },
        async all() {
          return Outcome.ok([withServer])
        },
      },
      sandbox,
    })
    return service
  }

  test('a cold guest is not started, and the turn says nothing about it', async () => {
    const sandbox = guest({ warm: false })
    const service = chatFor(sandbox)

    const sent = await service.send({ id: 'c1', text: 'hello' })

    // BOTH HALVES, and the second is the newer contract. Not booting the guest
    // is the saving; saying nothing about not booting it is the rest of it.
    // There used to be a note here — "mcp server host is in the guest, which is
    // not running yet" — and it was under every reply of a session that had
    // asked for none of it, naming three internal things, in a state nobody can
    // act on. A server that has not started because nothing needed it yet is
    // not news, so `discoverMcpTools` drops the server in silence.
    //
    // Asserted as the ABSENCE OF ANY MENTION rather than of one sentence: the
    // failure this guards against is the note coming back under new words.
    expect(sandbox.ran).toEqual([])
    for (const note of sent.notes) {
      expect(note).not.toMatch(/host/i)
      expect(note).not.toMatch(/not running|waiting|will start/i)
    }
  })

  test('a guest that is already running is asked, once, and not again', async () => {
    const sandbox = guest({ warm: true })
    const service = chatFor(sandbox)

    await service.send({ id: 'c1', text: 'hello' })
    const afterFirst = sandbox.ran.length
    await service.send({ id: 'c1', text: 'hello again' })

    // Two commands for the handshake, and the same two are not paid twice: the
    // list cannot change while the page is open, because the agent file it came
    // from is fetched once and kept. A discovery that FAILED is not cached —
    // a server that was down on turn one must not stay invisible all session —
    // so this asserts the successful path, and the fake answers with the id it
    // was asked with for exactly that reason.
    expect(afterFirst).toBe(2)
    expect(sandbox.ran.length).toBe(2)
  })
})

/**
 * And the other half of that rule, which is the one a cache gets wrong.
 *
 * A tools list cannot change while the page is open. A server being DOWN can
 * change at any moment, so freezing "was not available" for the session means a
 * server that comes up a minute later stays invisible until someone reloads.
 */
describe('an mcp server that was down when it was first asked', () => {
  test('is asked again on the next turn, and its tools arrive', async () => {
    const spec = AgentSpec.of({
      metadata: { name: 'main', mcp: [{ name: 'host', command: 'mcp-disk' }] },
      body: 'be brief',
      source: 'test',
    }).value

    let up = false
    const sandbox = {
      get available() {
        return true
      },
      get warm() {
        return true
      },
      async run(command) {
        if (!up) return Outcome.ok({ stdout: '', stderr: '', code: 1 })
        const ids = [...String(command).matchAll(/"id":\s*(\d+)/g)].map((m) => Number(m[1]))
        return Outcome.ok({
          stdout: `${JSON.stringify({ jsonrpc: '2.0', id: ids.at(-1) ?? 1, result: { tools: [{ name: 'disk' }] } })}\n`,
          stderr: '',
          code: 0,
        })
      },
    }

    const { service, inference } = chatWith([answerTurn('one'), answerTurn('two')], {
      catalogue: {
        async spec() {
          return Outcome.ok(spec)
        },
        async all() {
          return Outcome.ok([spec])
        },
      },
      sandbox,
    })

    const first = await service.send({ id: 'c1', text: 'hello' })
    // A server that is down is one of the two things worth a note — something
    // went wrong, and the person who configured it is the one who can fix it —
    // so this asserts the whole sentence and not a fragment of it. It names the
    // server, what it cost, and the reason underneath.
    //
    // It is also the guard on a coupling that is not visible from either side.
    // `ChatService._mcpToolsFor` reads the words "was not available" out of
    // this note to decide that a discovery must NOT be cached, so those three
    // words are control flow wearing prose. Reworded past them, this test is
    // the only thing between a rewrite and a dead server staying invisible for
    // the whole session — which is the case the test below it exists for.
    expect(first.notes).toContain(
      'the tool server "host" was not available, so none of its tools could be used this turn: the server wrote no reply to request 1 (exit 1)',
    )
    expect(inference.prompts[0]).not.toContain('host_disk')

    up = true
    const second = await service.send({ id: 'c1', text: 'hello again' })

    expect(second.notes.some((note) => note.includes('was not available'))).toBe(false)
    // THE TOOLS THEMSELVES, in the prompt the model was handed, which is what
    // this test's name has always claimed. It used to read "offered 1 tool(s)"
    // out of the notes instead, and that note is gone: a server that worked is
    // not news, and a count of tools is not a thing anyone can act on. The
    // prompt is the stronger oracle anyway — the note only ever said discovery
    // believed it had a tool, while this says the agent was given one.
    expect(inference.prompts[1]).toContain('host_disk')
  })
})

/**
 * Whose handed-over work an agent is told about.
 *
 * The pool is one per tab and holds every task in it. Unscoped, a question
 * handed over in one conversation was announced in every other conversation's
 * prompt and could be read there — one person's research answering a different
 * question. And a finished task with no acknowledgement was announced for the
 * life of the tab, a line and an invitation to re-read it on every turn.
 */
describe('handed-over work in the prompt', () => {
  const withPeer = AgentSpec.of({
    metadata: { name: 'main', tools: ['helper', 'check_task'] },
    body: 'be brief',
    source: 'test',
  }).value
  const helper = AgentSpec.of({ metadata: { name: 'helper' }, body: 'help', source: 'test' }).value

  /** A pool that holds tasks the way the real one does, without threads. */
  const holding = (tasks) => ({
    ask: async () => Outcome.ok(''),
    tasks: () => tasks,
    task: (id) => tasks.find((one) => one.id === id) ?? null,
    acknowledge: (id) => {
      const found = tasks.find((one) => one.id === id)
      if (found) found.read = true
      return Boolean(found)
    },
    start: (name, task, _settings, { owner } = {}) => {
      const record = {
        id: `t${tasks.length + 1}`,
        agent: name,
        task,
        owner,
        state: 'running',
        startedAt: Date.now(),
        endedAt: 0,
        progress: null,
        result: null,
        read: false,
      }
      tasks.push(record)
      return { id: record.id, agent: name }
    },
  })

  const chatWithPool = (pool, replies) =>
    chatWith(replies, {
      pool,
      catalogue: {
        async spec() {
          return Outcome.ok(withPeer)
        },
        async all() {
          return Outcome.ok([withPeer, helper])
        },
      },
    })

  const promptsOf = (service, id, text) => {
    const seen = []
    return service
      .send({ id, text }, (name, data) => {
        if (name === EventName.PROMPT) seen.push(data)
      })
      .then(() => seen.map((event) => JSON.stringify(event)).join('\n'))
  }

  test('a task started here is named here, and one started elsewhere is not', async () => {
    const tasks = []
    const pool = holding(tasks)
    const { service } = chatWithPool(pool, [answerTurn('ok'), answerTurn('ok')])

    // Started by hand, as another conversation would have.
    pool.start('helper', 'someone else’s question', {}, { owner: 'other-chat' })
    pool.start('helper', 'this chat’s question', {}, { owner: 'c1' })

    const prompt = await promptsOf(service, 'c1', 'anything')

    // By id, because the line names the task and not the question: what it was
    // ASKED is the other conversation's business, and rendering it here would
    // leak the thing this scope exists to keep out.
    expect(prompt).toContain('handed over')
    expect(prompt).toContain('t2')
    expect(prompt).not.toContain('t1:')
  })

  test('a finished task is announced until it is read, and then it is not', async () => {
    const tasks = [
      {
        id: 't1',
        agent: 'helper',
        task: 'go',
        owner: 'c1',
        state: 'done',
        startedAt: 1000,
        endedAt: 2000,
        progress: null,
        result: { ok: true, value: 'the answer', failure: null, notes: [] },
        read: false,
      },
    ]
    const pool = holding(tasks)
    const { service } = chatWithPool(pool, [
      toolTurn('check_task({"id": "t1"})'),
      answerTurn('read it'),
      answerTurn('nothing new'),
    ])

    const first = await promptsOf(service, 'c1', 'what happened?')
    expect(first).toContain('handed over')

    const second = await promptsOf(service, 'c1', 'and now?')
    expect(second).not.toContain('handed over')
  })
})
