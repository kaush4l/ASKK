import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DEFAULTS, drive, MAX_TURNS } from '../../bench/driver.js'
import { makeTools } from '../../bench/tools.js'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'support', 'fixtures')
const capture = (name) => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'))

/**
 * The driver, held to the one thing that makes the rig a comparison: that
 * everything except the scaffold is the same for both arms.
 *
 * There was no test here at all. The two obvious ways to rig this measurement —
 * a turn cap or a sampling parameter chosen per arm — were applied to
 * `bench/driver.js` and the suite stayed green over both, which means a number
 * this rig printed afterwards could not be checked by anything. What follows
 * drives two scaffolds that differ only in their `id` and asserts that nothing
 * the driver sends or allows differs with it.
 */

/** Every request body the driver put on the wire, in order. */
let sent = []
let realFetch

/**
 * A stub endpoint. `replies` is consumed one per call; the last one repeats, so
 * a scaffold that never answers keeps getting the same tool call.
 */
function stubEndpoint(replies) {
  globalThis.fetch = async (_url, init) => {
    sent.push(JSON.parse(init.body))
    const reply = replies[Math.min(sent.length - 1, replies.length - 1)]
    return new Response(
      JSON.stringify({
        choices: [{ message: reply.message, finish_reason: reply.finish ?? 'stop' }],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }
}

/** Serve whole recorded reply bodies, in order; the last one repeats. */
function serveBodies(bodies) {
  globalThis.fetch = async (_url, init) => {
    sent.push(JSON.parse(init.body))
    const body = bodies[Math.min(sent.length - 1, bodies.length - 1)]
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
}

/** A scaffold that does nothing but exist, so the driver is the only variable. */
function stubScaffold(id) {
  return {
    id,
    label: id,
    init: () => ({ turns: [] }),
    request: (state) => ({ messages: [{ role: 'user', content: `turn ${state.turns.length}` }] }),
    parse: (text) => (text.startsWith('DONE') ? { kind: 'answer', text } : { kind: 'tool', text }),
    act: () => ({ observation: 'an observation', ran: [] }),
    observe: (state, event) => state.turns.push(event.turn),
  }
}

const task = { id: 'stub', prompt: 'do a thing' }
const tools = { workdir: '/tmp/askk-bench-driver-test', calls: [] }

beforeEach(() => {
  sent = []
  realFetch = globalThis.fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
})

describe('both arms are offered exactly the same call', () => {
  test('every sampling parameter is identical, whichever scaffold asked', async () => {
    stubEndpoint([{ message: { role: 'assistant', content: 'DONE' } }])
    for (const id of ['agent-zero', 'ours']) {
      await drive({ scaffold: stubScaffold(id), task, tools })
    }
    expect(sent.length).toBe(2)

    // Compared field by field rather than as a whole object, because `messages`
    // is the one thing that IS allowed to differ — it is the scaffold.
    const [first, second] = sent
    for (const field of ['model', 'temperature', 'seed', 'max_tokens']) {
      expect(`${field}=${JSON.stringify(second[field])}`).toBe(
        `${field}=${JSON.stringify(first[field])}`,
      )
    }
    expect(first.temperature).toBe(DEFAULTS.temperature)
    expect(first.seed).toBe(DEFAULTS.seed)
    expect(first.max_tokens).toBe(DEFAULTS.maxTokens)
  })

  test('a config override reaches both arms or neither', async () => {
    stubEndpoint([{ message: { role: 'assistant', content: 'DONE' } }])
    for (const id of ['agent-zero', 'ours']) {
      await drive({ scaffold: stubScaffold(id), task, tools, config: { temperature: 0.4 } })
    }
    expect(sent.map((body) => body.temperature)).toEqual([0.4, 0.4])
  })

  test('both arms are given the same number of turns before the cap', async () => {
    // A scaffold that never answers must be stopped at the same turn either
    // way. This is the assertion a per-arm cap fails.
    const runs = []
    for (const id of ['agent-zero', 'ours']) {
      sent = []
      stubEndpoint([{ message: { role: 'assistant', content: 'not an answer' } }])
      runs.push(await drive({ scaffold: stubScaffold(id), task, tools }))
    }
    expect(runs.map((run) => run.turns)).toEqual([MAX_TURNS, MAX_TURNS])
    expect(runs.map((run) => run.stop)).toEqual(['cap', 'cap'])
    expect(runs[0].events.filter((e) => e.type === 'turn-cap').length).toBe(1)
  })
})

describe('what the driver records', () => {
  test('an answer ends the run and the usage is summed', async () => {
    stubEndpoint([
      { message: { role: 'assistant', content: 'a tool call' } },
      { message: { role: 'assistant', content: 'DONE: forty-two' } },
    ])
    const run = await drive({ scaffold: stubScaffold('ours'), task, tools })
    expect(run.stop).toBe('answered')
    expect(run.turns).toBe(2)
    expect(run.answer).toBe('DONE: forty-two')
    expect(run.tokens).toEqual({ prompt: 22, completion: 14, total: 36 })
  })

  test('a reply the tree’s transport refuses ends the run, and never reaches the scaffold', async () => {
    // THE DEFECT THIS SLICE EXISTS FOR, driven by a real capture. The rig's own
    // fetch handed this body's `content` — 220 tokens of the model rehearsing
    // its own response format — to the scaffold as a reply. Our arm's parser
    // returns an unparseable reply as the answer (`BaseResponse.parse`), so the
    // results table said "1 turn, answered". Replayed over the fifteen recorded
    // runs, twelve of our arm's thirty-four replies are in this state.
    const raw = capture('truncated-in-think')
    serveBodies([raw])
    const seen = []
    const scaffold = {
      ...stubScaffold('ours'),
      parse: (text) => {
        seen.push(text)
        return { kind: 'answer', text }
      },
    }
    const run = await drive({ scaffold, task, tools })
    expect(run.stop).toBe('transport-refused')
    expect(run.turns).toBe(1)
    expect(run.answer).toBe('')
    // The parser was never called: `ReActEngine.run` ends the run on a transport
    // failure, and so does this.
    expect(seen).toEqual([])
    const refusal = run.events.at(-1)
    expect(refusal.type).toBe('transport-refusal')
    expect(refusal.state).toBe('thinking')
    expect(refusal.message).toContain('still thinking')
    // The refused text is not smuggled into the transcript under another key.
    expect(JSON.stringify(run.events)).not.toContain(raw.choices[0].message.content.slice(0, 40))
  })

  test('a refused reply is still paid for', async () => {
    // Its tokens count. A total that omitted the expensive replies would flatter
    // exactly the arm that produced them.
    serveBodies([capture('truncated-in-think')])
    const run = await drive({ scaffold: stubScaffold('ours'), task, tools })
    expect(run.tokens).toEqual({ prompt: 101, completion: 220, total: 321 })
  })

  test('a reply that merely ran out of room is an answer, with the note that says so', async () => {
    // The states are told apart, not lumped under `finish_reason: 'length'`.
    serveBodies([capture('truncated-past-think')])
    const scaffold = { ...stubScaffold('ours'), parse: (text) => ({ kind: 'answer', text }) }
    const run = await drive({ scaffold, task, tools })
    expect(run.stop).toBe('answered')
    expect(run.answer.length).toBeGreaterThan(0)
    const reply = run.events.find((event) => event.type === 'reply')
    expect(reply.state).toBe('cut')
    expect(reply.notes.join(' ')).toContain('cut off')
  })

  test('which model answered is recorded, whichever one it was', async () => {
    // The rig sends the model it wants; this endpoint serves four. The capture
    // below was answered by a different one, and the run says so.
    serveBodies([capture('spent-in-think')])
    const run = await drive({ scaffold: stubScaffold('ours'), task, tools })
    expect(run.models).toEqual(['gemma-4-12B-it-qat-mxfp8'])
    expect(sent[0].model).toBe(DEFAULTS.model)
    // Per reply as well as per run, because `run.js` builds `results.json`'s
    // `replies` rows and its per-arm `models` summary out of the EVENT.
    expect(run.events.find((event) => event.type === 'reply').model).toBe(
      'gemma-4-12B-it-qat-mxfp8',
    )
  })

  test('an endpoint failure is not scored as the scaffold’s', async () => {
    globalThis.fetch = async () => new Response('upstream is down', { status: 503 })
    const run = await drive({ scaffold: stubScaffold('ours'), task, tools })
    expect(run.stop).toBe('endpoint-error')
    expect(run.events.at(-1).error).toContain('503')
  })

  test('a scaffold may end its own run, and the reason is recorded verbatim', async () => {
    stubEndpoint([{ message: { role: 'assistant', content: 'not an answer' } }])
    const scaffold = { ...stubScaffold('agent-zero'), stopped: () => 'gave up on purpose' }
    const run = await drive({ scaffold, task, tools })
    expect(run.stop).toBe('scaffold-stop')
    expect(run.turns).toBe(1)
    expect(run.events.at(-1)).toMatchObject({ type: 'scaffold-stop', reason: 'gave up on purpose' })
  })

  test('the reasoning channel is recorded and never returned as the reply', async () => {
    stubEndpoint([
      {
        message: { role: 'assistant', content: 'DONE: x', reasoning_content: 'private working' },
      },
    ])
    const run = await drive({ scaffold: stubScaffold('ours'), task, tools })
    expect(run.answer).toBe('DONE: x')
    expect(run.events.find((e) => e.type === 'reply').reasoning).toBe('private working')
  })
})

/**
 * Our arm's run IS `ReActEngine.run`. The driver records it; it does not drive
 * it.
 *
 * Every case here is driven through the real `bench/scaffolds/ours.js` against
 * a stubbed endpoint, because the whole finding of the third panel was that the
 * rig's loop and the tree's loop had drifted: `Reason.OVERRUN` was sent back as
 * a turn in `src/` and ended the run in `bench/`, and 484 green tests could not
 * see it because nothing drove the two together. A test of the shipped loop
 * through a stub scaffold proves nothing about the arm the results table names.
 */
describe('our arm runs the loop this tree ships', () => {
  const ours = () => import('../../bench/scaffolds/ours.js').then((m) => m.scaffold)
  const rigTools = () => makeTools(mkdtempSync(join(tmpdir(), 'askk-bench-driver-')))
  const toolReply = (call) => ({
    message: {
      role: 'assistant',
      content: `think: [look]\n\nplan: [list, then answer]\n\nact: tool\n\nresult: ${call}`,
    },
  })
  const answerReply = (text) => ({
    message: {
      role: 'assistant',
      content: `think: [done]\n\nplan: [say it]\n\nact: answer\n\nresult: ${text}`,
    },
  })
  const asBody = (reply, finish = 'stop') => ({
    choices: [{ message: reply.message, finish_reason: finish }],
    usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    model: DEFAULTS.model,
  })

  test('an overrun is sent back as a turn, and the run recovers — RED at 1412ce1', async () => {
    // THE TEST THE BRIEF NAMES. Call one: the model's scratchpad arrives on
    // the answer channel at the token limit — `Reply.THINKING`, which the
    // transport refuses with `Reason.OVERRUN`. Call two: a complete tool call.
    // Call three: an answer. At 1412ce1 this records ONE turn and
    // `transport-refused`, because `bench/driver.js` ended every run on
    // `!reply.ok` and never called `ReActEngine.run`.
    serveBodies([
      capture('truncated-in-think'),
      asBody(toolReply('list_files({})')),
      asBody(answerReply('two files')),
    ])
    const run = await drive({ scaffold: await ours(), task, tools: rigTools() })

    expect(run.stop).toBe('answered')
    expect(run.turns).toBe(3)
    expect(run.answer).toBe('two files')

    // Turn 1 is recorded as what it was: a reply the transport refused, an
    // action that fit no contract, and the loop's own sentence back to the
    // model — the same three events the reference arm records for a cut
    // reply, so `blind.js` renders both with one grammar.
    const first = run.events.filter((event) => event.at === 1).map((event) => event.type)
    expect(first).toEqual(['request', 'reply', 'action', 'observation'])
    expect(run.events.find((e) => e.type === 'reply' && e.at === 1).state).toBe('thinking')
    const overran = run.events.find((e) => e.type === 'action' && e.at === 1).action
    expect(overran.kind).toBe('malformed')
    expect(overran.reason).toBe('overran')
    expect(overran.note).toContain('still thinking')
    const sentBack = run.events.find((e) => e.type === 'observation' && e.at === 1)
    expect(sentBack.observation).toContain('nothing was run and nothing was shown to the user')
    expect(sentBack.observation).toContain('1,200-token reply limit went on reasoning')

    // The recovery: turn 2's prompt carries the correction in WORK SO FAR, and
    // turn 2's reply is read as the tool call it is.
    const second = run.events.find((e) => e.type === 'request' && e.at === 2)
    expect(second.messages[0].content).toContain(
      'action: the reply ran out of tokens inside its private reasoning',
    )
    expect(run.events.find((e) => e.type === 'action' && e.at === 2).action).toMatchObject({
      kind: 'tool',
      call: 'list_files({})',
    })
    expect(run.events.find((e) => e.type === 'observation' && e.at === 2).observation).toContain(
      'list_files ->',
    )
    // No transport-refusal was recorded: the refusal was a turn, not an ending.
    expect(run.events.some((e) => e.type === 'transport-refusal')).toBe(false)
    // And the refused text still went nowhere.
    expect(JSON.stringify(run.events)).not.toContain(
      capture('truncated-in-think').choices[0].message.content.slice(0, 40),
    )
  })
})

describe('our arm, the loop’s own endings and the rig’s', () => {
  const ours = () => import('../../bench/scaffolds/ours.js').then((m) => m.scaffold)
  const rigTools = () => makeTools(mkdtempSync(join(tmpdir(), 'askk-bench-driver-')))
  const asBody = (content, finish = 'stop') => ({
    choices: [{ message: { role: 'assistant', content }, finish_reason: finish }],
    usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    model: DEFAULTS.model,
  })
  const tool = (call) => asBody(`think: [look]\n\nplan: [do]\n\nact: tool\n\nresult: ${call}`)

  test('two overruns in a row end the run through the loop’s own ceiling, not the transport’s', async () => {
    serveBodies([capture('truncated-in-think'), capture('spent-in-think')])
    const run = await drive({ scaffold: await ours(), task, tools: rigTools() })
    expect(run.stop).toBe('scaffold-stop')
    expect(run.turns).toBe(2)
    // Both passes are recorded as turns; the second has no observation because
    // nothing was sent back — the loop ended instead, and says why in its own
    // words. `unreadable` in `ReActEngine.js`.
    expect(run.events.map((e) => `${e.at}:${e.type}`)).toEqual([
      '0:task',
      '1:request',
      '1:reply',
      '1:action',
      '1:observation',
      '2:request',
      '2:reply',
      '2:action',
      '2:scaffold-stop',
    ])
    const stop = run.events.at(-1)
    expect(stop.reason).toContain('2 replies in a row ended without saying')
    expect(stop.reason).toContain('ran out of tokens inside its private reasoning')
    // The refused states are both on the record.
    expect(run.events.filter((e) => e.type === 'reply').map((e) => e.state)).toEqual([
      'thinking',
      'spent',
    ])
    expect(run.events.some((e) => e.type === 'transport-refusal')).toBe(false)
    // And both were paid for.
    expect(run.tokens.completion).toBe(220 + 120)
  })

  test('a reply that never said what to do is sent back, and the loop’s correction is the observation', async () => {
    serveBodies([
      asBody('think: hi\nplan: do\nact: banana\nresult: x'),
      asBody('think: [ok]\n\nplan: [say]\n\nact: answer\n\nresult: fine'),
    ])
    const run = await drive({ scaffold: await ours(), task, tools: rigTools() })
    expect(run.stop).toBe('answered')
    expect(run.answer).toBe('fine')
    const unsaid = run.events.find((e) => e.type === 'action' && e.at === 1).action
    expect(unsaid.kind).toBe('malformed')
    expect(unsaid.reason).toContain("neither 'tool' nor 'answer'")
    expect(unsaid.parsed.act).toBe('unsaid')
    expect(run.events.find((e) => e.type === 'observation' && e.at === 1).observation).toContain(
      "set act to exactly 'tool' or exactly 'answer'",
    )
  })

  test('a repeated call is answered by the loop without running the tool, and that is the observation', async () => {
    serveBodies([
      tool('list_files({})'),
      tool('list_files({})'),
      asBody('act: answer\n\nresult: nothing there'),
    ])
    const tools = rigTools()
    const run = await drive({ scaffold: await ours(), task, tools })
    const observed = run.events.filter((e) => e.type === 'observation').map((e) => e.observation)
    expect(observed[0]).toContain('list_files ->')
    expect(observed[1]).toContain('was already made 1 time(s), so it was not run again')
    expect(tools.calls.filter((c) => c.name === 'list_files').length).toBe(1)
    // `ran` is the reference arm's adapters saying what they called; this
    // loop runs its tools out of the rig's sight, so it says nothing there.
    expect(run.events.find((e) => e.type === 'observation').ran).toEqual([])
  })

  test('the rig’s turn cap falls on our arm at the same turn as on the reference arm', async () => {
    // A loop that never answers. Our engine has no turn cap of its own — its
    // bounds are `Budget` (24 steps, 600 s) and its unsaid ceiling — so the 12
    // must reach it from the rig, at the port, and record the same event the
    // driver's loop records for the reference arm.
    sent = []
    stubEndpoint([{ message: { role: 'assistant', content: 'not an answer' } }])
    const theirs = await drive({ scaffold: stubScaffold('agent-zero'), task, tools })
    sent = []
    serveBodies([tool('shell({"command": "true"})')])
    const mine = await drive({ scaffold: await ours(), task, tools: rigTools() })

    expect([theirs.turns, mine.turns]).toEqual([MAX_TURNS, MAX_TURNS])
    expect([theirs.stop, mine.stop]).toEqual(['cap', 'cap'])
    expect(sent.length).toBe(MAX_TURNS)
    expect(mine.events.at(-1)).toEqual({ type: 'turn-cap', at: MAX_TURNS, limit: MAX_TURNS })
    // Every one of the twelve turns has its observation, the twelfth
    // included: the loop assembled a thirteenth prompt before the port
    // refused the call, and that prompt is where the twelfth result was read.
    expect(mine.events.filter((e) => e.type === 'observation').map((e) => e.at)).toEqual(
      Array.from({ length: MAX_TURNS }, (_, i) => i + 1),
    )
    expect(mine.events.filter((e) => e.type === 'request').length).toBe(MAX_TURNS)
    expect(mine.answer).toBe('')
  })

  test('an endpoint failure is not scored as our arm’s either', async () => {
    globalThis.fetch = async () => new Response('upstream is down', { status: 503 })
    const run = await drive({ scaffold: await ours(), task, tools: rigTools() })
    expect(run.stop).toBe('endpoint-error')
    expect(run.turns).toBe(1)
    expect(run.events.at(-1).error).toContain('503')
    expect(run.events.some((e) => e.type === 'scaffold-stop')).toBe(false)
  })

  test('a refusal that is not an overrun still ends the run as the transport’s', async () => {
    // The shape guard: a 200 whose choice carries no message content and whose
    // finish reason is not `length`. Not reachable on this endpoint; reachable
    // in a test, and the one refusal the loop does NOT take another turn on.
    serveBodies([{ choices: [{ message: { role: 'assistant' }, finish_reason: 'stop' }] }])
    const run = await drive({ scaffold: await ours(), task, tools: rigTools() })
    expect(run.stop).toBe('transport-refused')
    expect(run.turns).toBe(1)
    expect(run.events.at(-1)).toMatchObject({ type: 'transport-refusal', at: 1 })
    expect(run.events.at(-1).message).toContain('no message content')
  })

  test('the sampling parameters our loop’s calls carry are the rig’s, same as the reference arm’s', async () => {
    sent = []
    stubEndpoint([{ message: { role: 'assistant', content: 'DONE' } }])
    await drive({ scaffold: stubScaffold('agent-zero'), task, tools, config: { temperature: 0.4 } })
    serveBodies([asBody('act: answer\n\nresult: x')])
    await drive({ scaffold: await ours(), task, tools: rigTools(), config: { temperature: 0.4 } })
    const [theirs, mine] = sent
    for (const field of ['model', 'temperature', 'seed', 'max_tokens']) {
      expect(`${field}=${JSON.stringify(mine[field])}`).toBe(
        `${field}=${JSON.stringify(theirs[field])}`,
      )
    }
    // One user message carrying the whole prompt — `OpenAICompatible._body`'s
    // shape, through the port.
    expect(mine.messages.length).toBe(1)
    expect(mine.messages[0].role).toBe('user')
  })
})
