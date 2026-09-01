import { afterEach, describe, expect, test } from 'bun:test'
import { Budget } from '../../../src/core/engine/Budget.js'
import { ReActEngine } from '../../../src/core/engine/ReActEngine.js'
import { OpenAICompatible } from '../../../src/core/inference/OpenAICompatible.js'
import { Role } from '../../../src/core/Message.js'
import { Outcome, Reason } from '../../../src/core/Outcome.js'
import { Tool } from '../../../src/core/tools/Tool.js'
import { Toolbox } from '../../../src/core/tools/Toolbox.js'
import { fixture } from '../../support/fixtures.js'
import { ScriptedFetch } from '../../support/ScriptedFetch.js'
import { ScriptedInference } from '../../support/ScriptedInference.js'

/**
 * The loop, driven by a scripted model, because the only way to see a ReAct
 * turn is from outside it.
 *
 * What matters here is not that the loop terminates. It is what the SECOND
 * prompt contains: a tool's observation reaches the model only by being
 * rendered into the next prompt, and if the scratchpad went missing the run
 * would still finish, still answer, and simply answer without ever having read
 * what the tool returned. No exception, no failed assertion anywhere else in
 * the tree — just a worse answer. So the assertions are on the prompt strings
 * the transport was handed.
 *
 * The bound is tested the same way, and for the same reason: what a budget puts
 * in the prompt is one SENTENCE, on the turn that has no room left, so the
 * assertion that matters is the one on the prompt string. The running counters
 * that used to sit beside it are gone — measured against an arm without them,
 * they changed nothing and cost 30 tokens a turn — so the assertions here are
 * that the block is ABSENT while there is room and present in words when there
 * is not.
 */

class EchoTool extends Tool {
  constructor() {
    super({
      name: 'echo',
      description: 'Say something back.',
      parameters: { text: { type: 'string' } },
    })
    this.received = []
  }

  async call({ text } = {}) {
    this.received.push(text)
    return Outcome.ok(`you said ${text}`)
  }
}

const toolTurn = (call) => `think: []\n\nplan: []\n\nact: tool\n\nresult: ${call}`
const answerTurn = (text) => `think: []\n\nplan: []\n\nact: answer\n\nresult: ${text}`

const history = [{ role: Role.USER, text: 'say hello for me' }]

function engineWith(replies, { toolbox } = {}) {
  const inference = new ScriptedInference({ replies })
  const engine = new ReActEngine({ system: 'You are careful.', inference, toolbox })
  return { engine, inference }
}

/** A model that only ever calls a tool: the runaway this slice exists to stop. */
const neverAnswers = (n) => Array.from({ length: n }, (_, i) => toolTurn(`echo({"text": "${i}"})`))

/**
 * The shipped transport, answering from captured HTTP responses.
 *
 * `ScriptedInference` replaces the transport, so nothing driven through it can
 * see what the transport DOES with a reply — and two of the four states a reply
 * can be in are decided there and never reach the engine as text. Every test
 * below that names a `Reply` state goes through this instead: the real
 * `OpenAICompatible` over a `ScriptedFetch`, so what the engine receives is what
 * the shipped code would hand it for what the endpoint really said.
 *
 * A name ending `.sse` is streamed, which is the path the running app actually
 * takes — `ChatService` always passes an `onDelta`. A plain object is served
 * as JSON, which is how a WHOLE reply with a chosen contract is put on the wire:
 * no capture happens to hold a complete `act: answer`, so `whole()` below takes
 * the captured envelope and puts one in it.
 */
let restore = null
afterEach(() => {
  restore?.()
  restore = null
})

function realTransport(fixtures, { maxTokens = 1135 } = {}) {
  const fetching = new ScriptedFetch(
    fixtures.map((name) => {
      if (typeof name !== 'string') return { json: name }
      return name.endsWith('.sse') ? { sse: fixture(name) } : { json: JSON.parse(fixture(name)) }
    }),
  )
  restore = fetching.install()
  const inference = new OpenAICompatible({ baseUrl: 'http://127.0.0.1:8873/v1', maxTokens })
  return { fetching, engine: new ReActEngine({ system: 'You are careful.', inference }) }
}

/** `complete.json`'s envelope — `finish_reason: stop`, reasoning routed — carrying `content`. */
function whole(content) {
  const body = JSON.parse(fixture('complete.json'))
  body.choices[0].message.content = content
  return body
}

describe('ReActEngine.run', () => {
  test('a tool turn, then an answer — and the observation is in the second prompt', async () => {
    const tool = new EchoTool()
    const { engine, inference } = engineWith(
      [toolTurn('echo({"text": "hello"})'), answerTurn('I said hello.')],
      { toolbox: new Toolbox([tool]) },
    )
    const steps = []

    const outcome = await engine.run(history, { onStep: (event) => steps.push(event) })

    expect(outcome.ok).toBe(true)
    expect(outcome.value.answer).toBe('I said hello.')
    expect(tool.received).toEqual(['hello'])
    expect(inference.calls).toHaveLength(2)
    expect(steps.map((event) => event.step)).toEqual([1, 2])

    // The first prompt has no working to show yet.
    expect(inference.prompts[0]).not.toContain('WORK SO FAR')
    // The second one carries the call and what it returned, as the model's own
    // scratchpad rather than as something the user said.
    expect(inference.prompts[1]).toContain(
      '# WORK SO FAR\n\naction: echo({"text": "hello"})\nobservation: echo -> you said hello',
    )
    expect(inference.prompts[1]).not.toContain('[USER]: echo -> you said hello')
    expect(outcome.notes).toContain('answered after 2 steps')
  })

  test('the prompt the transport receives is the assembled prompt, and it is told where the prefix ends', async () => {
    const { engine, inference } = engineWith([answerTurn('done')])

    await engine.run(history)

    // Built against a SECOND budget with the same pinned clock and no passes,
    // because the run's own has counted a step by the time this reads it.
    const plan = engine.plan(history, [], new Budget({ now: () => 0 }))
    expect(inference.calls[0].prompt).toBe(plan.text)
    expect(inference.calls[0].options.cacheAt).toBe(plan.boundary)
    expect(plan.boundary).toBeGreaterThan(0)
  })

  test('an identical call is answered from the record instead of being run again', async () => {
    const tool = new EchoTool()
    const { engine, inference } = engineWith(
      [
        toolTurn('echo({"text": "hello"})'),
        toolTurn('echo({"text": "hello"})'),
        answerTurn('I already knew that.'),
      ],
      { toolbox: new Toolbox([tool]) },
    )

    const outcome = await engine.run(history)

    expect(outcome.ok).toBe(true)
    // Run once, not twice: the second observation is a statement about the
    // repeat, which is the loop's whole defence against going nowhere.
    expect(tool.received).toEqual(['hello'])
    expect(inference.prompts[2]).toContain('this exact call was already made 1 time(s)')
  })

  test('an agent with no tools is told so rather than being left to guess', async () => {
    const { engine, inference } = engineWith([
      toolTurn('echo({"text": "hello"})'),
      answerTurn('I could not.'),
    ])

    await engine.run(history)

    expect(inference.prompts[1]).toContain('no tools are available')
  })

  test('a transport failure ends the run, keeping its message and naming the step', async () => {
    const { engine } = engineWith([])

    const outcome = await engine.run(history)

    expect(outcome.ok).toBe(false)
    expect(outcome.failure.message).toContain('the script ran out after 1 call(s)')
    expect(outcome.notes).toContain('failed on step 1')
  })

  test('an engine with no inference reports it as an ordinary failure', async () => {
    const outcome = await new ReActEngine({}).run(history)

    expect(outcome.ok).toBe(false)
    expect(outcome.failure.message).toBe('react: no inference is configured')
    expect(outcome.failure.hint).toBe('Choose a model in settings.')
  })

  test('a model that never answers is stopped by the budget and not by the script running out', async () => {
    // The runaway, with room for ten replies and a budget for three. Nothing in
    // here is a ceiling the loop applies quietly: the third prompt says so, and
    // the failure below names the budget rather than the script.
    const tool = new EchoTool()
    const { engine, inference } = engineWith(neverAnswers(10), {
      toolbox: new Toolbox([tool]),
    })

    const outcome = await engine.run(history, { budget: { steps: 3 } })

    expect(inference.calls).toHaveLength(3)
    expect(outcome.ok).toBe(false)
    expect(outcome.failure.message).toBe(
      'react: the 3-step budget ran out before the agent answered',
    )
    // Never a silent truncation: the note says exactly what ran out, and the
    // turn the model did produce comes back with the failure rather than being
    // discarded.
    // Never a silent truncation, and never a value nobody reads: what the model
    // wrote is QUOTED in the note, which is a channel the page renders. The
    // Outcome's value carried it before and `ChatService` dropped it on the
    // floor, so the comment promising nothing was thrown away described a
    // throw-away.
    expect(outcome.notes).toContain(
      'stopped after 3 steps: the 3-step budget is spent and the last turn wrote "echo({"text": "2"})" instead of an answer',
    )
    expect(outcome.value.answer).toContain('echo(')
  })

  test('and what it wrote is bounded before it goes in the note', async () => {
    // A note is read by a person scanning a failed run, so it carries a
    // sentence of the turn and not the turn. The bound is a real one — a tool
    // call can be a whole file's contents — and it is the DEFAULT of `quote`,
    // which the unsaid correction deliberately overrides with a longer one
    // because that string is read by the model rather than by a person.
    const long = toolTurn(`echo({"text": "${'x'.repeat(300)}"})`)
    const { engine } = engineWith([long, long], { toolbox: new Toolbox([new EchoTool()]) })

    const outcome = await engine.run(history, { budget: { steps: 1 } })

    const note = outcome.notes.find((line) => line.includes('instead of an answer'))
    expect(note).toContain(`echo({"text": "${'x'.repeat(100)}`)
    expect(note).toContain('..." instead of an answer')
    expect(note).not.toContain('x'.repeat(150))
    // 217 with the bound, 414 without it.
    expect(note.length).toBeLessThan(250)
  })
})

describe('a budget the agent can read', () => {
  test('a run with room to spare is charged nothing for its budget', async () => {
    const { engine, inference } = engineWith([toolTurn('echo({"a": 1})'), answerTurn('done')])

    await engine.run(history, { budget: { steps: 6, tokens: 9000, seconds: 120 } })

    // Not "contains no numbers" — the heading itself is absent, because an
    // empty body takes the whole block out of the prompt. This is the assertion
    // that would fail if somebody put the running counters back.
    expect(inference.prompts[0]).not.toContain('# BUDGET')
    expect(inference.prompts[1]).not.toContain('# BUDGET')
  })

  test('the bound still binds without being printed', async () => {
    // The numbers left the prompt; the budget did not stop counting them.
    const tool = new EchoTool()
    const { engine, inference } = engineWith(neverAnswers(10), { toolbox: new Toolbox([tool]) })

    await engine.run(history, { budget: { steps: 3 } })

    expect(inference.calls).toHaveLength(3)
  })

  test('the last turn is told it is the last, in words, before it is sent', async () => {
    const { engine, inference } = engineWith([toolTurn('echo({"a": 1})'), answerTurn('what I got')])

    const outcome = await engine.run(history, { budget: { steps: 2 } })

    expect(inference.prompts[0]).not.toContain('# BUDGET')
    expect(inference.prompts[1]).toContain(
      '# BUDGET\n\nTHIS IS YOUR LAST TURN. the 2-step budget is spent',
    )
    // And the run ends with an answer rather than a severed rope, which is the
    // whole reason the last word exists.
    expect(outcome.ok).toBe(true)
    expect(outcome.value.answer).toBe('what I got')
  })

  test('a declared budget does not leak into the next run', async () => {
    const { engine, inference } = engineWith([answerTurn('one'), answerTurn('two')])
    const declared = { steps: 4 }

    await engine.run(history, { budget: declared })
    await engine.run(history, { budget: declared })

    // Both runs answered on their first step, which a leaked counter would have
    // made impossible: four steps spent across two runs of a 4-step budget
    // would close the second one before it started.
    expect(inference.calls).toHaveLength(2)
    expect(inference.prompts[1]).not.toContain('# BUDGET')
  })
})

describe('stopping a run', () => {
  test('the signal reaches the transport, not just the loop', async () => {
    const { engine, inference } = engineWith([answerTurn('done')])
    const controller = new AbortController()

    await engine.run(history, { signal: controller.signal })

    // Only that the object was handed over. That it ABORTS anything is proved
    // in `test/core/inference/Inference.test.js`, against a fetch, because
    // nothing at this seam can see it.
    expect(inference.calls[0].options.signal).toBe(controller.signal)
  })

  test('a run stopped before the model said anything comes back ok and empty', async () => {
    const { engine, inference } = engineWith([answerTurn('never sent')])
    const controller = new AbortController()
    controller.abort()

    const outcome = await engine.run(history, { signal: controller.signal })

    expect(outcome.ok).toBe(true)
    expect(outcome.value).toBe(null)
    expect(inference.calls).toHaveLength(0)
    expect(outcome.notes).toContain(
      'you stopped this run after 0 step(s), before the model had said anything',
    )
  })

  test('a COMPLETED answer is not destroyed by the stop that arrived after it', async () => {
    // The defect this replaces, and it was invisible to every test here. A
    // stream aborted mid-flight still comes back ok when text had arrived, so
    // at the moment of the abort check the loop was holding a parsed, complete
    // answer — and assigned `last` one line too late, binning it and reporting
    // "before the model had said anything" about a turn it had in hand.
    const controller = new AbortController()
    const inference = new ScriptedInference({
      replies: [toolTurn('echo({"text": "0"})'), answerTurn('HERE IS THE ANSWER')],
    })
    const original = inference.invoke.bind(inference)
    inference.invoke = async (...args) => {
      const reply = await original(...args)
      // Stopped as the second reply lands: the endpoint answered, the user's
      // finger was already down. Exactly the last second of a long run.
      if (inference.calls.length === 2) controller.abort()
      return reply
    }
    const engine = new ReActEngine({ inference, toolbox: new Toolbox([new EchoTool()]) })

    const outcome = await engine.run(history, { signal: controller.signal })

    expect(outcome.ok).toBe(true)
    expect(outcome.value.answer).toBe('HERE IS THE ANSWER')
    expect(outcome.value.isAnswer).toBe(true)
    // And the note no longer contradicts the value sitting beside it.
    expect(outcome.notes).toContain('you stopped this run after 2 step(s)')
    expect(outcome.notes.join(' ')).not.toContain('before the model had said anything')
  })

  test('a stop returns while a tool is still running, rather than waiting it out', async () => {
    // Measured before the race existed: abort at 300 ms into a 1,500 ms tool,
    // run returned at 1,504 ms. The tool cannot be killed — the wasm guest and
    // an MCP server mid-call have no cancel — so the loop leaves rather than
    // waits, and the tool finishes into a scratchpad nobody reads.
    const controller = new AbortController()
    let released = null
    class SlowTool extends Tool {
      constructor() {
        super({ name: 'slow', description: 'never finishes on its own', parameters: {} })
      }

      async call() {
        return new Promise((resolve) => {
          released = () => resolve(Outcome.ok('finally'))
        })
      }
    }
    const { engine } = engineWith([toolTurn('slow({})'), answerTurn('unreached')], {
      toolbox: new Toolbox([new SlowTool()]),
    })

    const running = engine.run(history, { signal: controller.signal })
    // Let the first model call and the tool dispatch happen, then press stop.
    await new Promise((resolve) => setTimeout(resolve, 20))
    controller.abort()
    const outcome = await running

    expect(outcome.ok).toBe(true)
    expect(outcome.notes.some((note) => note.startsWith('you stopped this run'))).toBe(true)
    // The tool really was still outstanding — this is what makes the assertion
    // above a race and not a coincidence of timing.
    expect(released).toBeInstanceOf(Function)
    released()
  })

  test('a run stopped part-way carries the work it had done', async () => {
    const tool = new EchoTool()
    const controller = new AbortController()
    const inference = new ScriptedInference({ replies: neverAnswers(5) })
    // Stopped from outside while the second call is in flight, which is where a
    // user actually presses the button.
    const original = inference.invoke.bind(inference)
    inference.invoke = async (...args) => {
      if (inference.calls.length === 1) controller.abort()
      return original(...args)
    }
    const engine = new ReActEngine({ inference, toolbox: new Toolbox([tool]) })

    const outcome = await engine.run(history, { signal: controller.signal })

    // Ok, not failed: nothing broke, somebody ended it.
    expect(outcome.ok).toBe(true)
    expect(inference.calls).toHaveLength(2)
    expect(tool.received).toEqual(['0'])
    // The unanswered turn travels, so a caller can decide what it is worth —
    // and `isAnswer` is how it tells this apart from a real reply.
    expect(outcome.value.isAnswer).toBe(false)
    expect(outcome.notes).toContain('you stopped this run after 2 step(s)')
  })
})

/**
 * The reply that never says what it wants to do, and what the loop does with it.
 *
 * This block is driven through the REAL transport against replies captured from
 * `http://127.0.0.1:8873/v1`, not through `ScriptedInference`, and that is the
 * only way it could have caught anything. The defect spans three files — the
 * transport classifies the truncation, `ReActResponse.parse` decides whether a
 * decision was reached, and this loop decides what to do about it — and a
 * scripted string handed straight to the engine skips the first two. Every
 * earlier test here that could have seen this passed a `think:`/`act:` string
 * that a real endpoint had never produced.
 *
 * Before the fix, the first assertion of the first test failed: the loop ended
 * on the truncated reply and made exactly ONE call.
 */
describe('a reply that never said what to do', () => {
  test('the run does not end on it, and the correction reaches the next prompt', async () => {
    // `truncated-mid-contract.json`: finish_reason `length`, `reasoning_content`
    // present and correctly routed, `content` stopping inside `plan:` with no
    // `act` line anywhere. It used to parse as `act: answer` with an empty
    // `result`, so the loop returned it and the transcript recorded "(the model
    // returned nothing)" as the assistant's reply.
    const { fetching, engine } = realTransport([
      'truncated-mid-contract.json',
      'truncated-past-think.json',
    ])

    const outcome = await engine.run(history)

    // One call is the defect. Two is the fix.
    expect(fetching.bodies).toHaveLength(2)
    expect(outcome.ok).toBe(true)
    expect(outcome.value.isAnswer).toBe(true)
    // The answer is the SECOND reply — itself a cut reply, and one that did
    // reach an answer, which is why the transport hands cut replies on at all.
    expect(outcome.value.answer.startsWith('1\n2\n3\n')).toBe(true)
    // The correction the model is sent back with, in the prompt it is sent in —
    // and it carries THE REPLY, not only a complaint about it. A correction
    // whose whole justification is that it changes the prompt has to change it
    // with something about the failure, and a ReAct scratchpad holds
    // action/observation pairs, so the previous reply is nowhere in this prompt
    // unless the loop puts it there.
    const second = fetching.bodies[1].messages[0].content
    expect(second).toContain('the reply stopped before it reached the act line')
    // The WHOLE of what it had written, not the first sentence: this is the
    // model's evidence for writing a better reply, and a cut that loses `plan`
    // loses the half that says what it was about to do.
    expect(second).toContain(
      'it had written "think: Need inspect workspace before writing module files, Need ensure Node treats .js as ES module | plan: [List workspace root, Create src/slugify.js and test/slugify"',
    )
    expect(second).toContain("set act to exactly 'tool' or exactly 'answer'")
    // And the transport's own classification travelled the whole way, so the
    // user is told WHY the loop needed a second turn.
    expect(outcome.notes.join(' ')).toContain('cut off at the 1,135-token limit')
  })

  test('and the same reply STREAMED takes the same branch', async () => {
    // The app streams whenever anyone is watching, and the two paths through
    // `OpenAICompatible` classify separately. This capture is the same reply
    // arriving as 7 content deltas after 3,923 characters of reasoning; a fix
    // that only held on `invoke` would leave every live run unguarded.
    const { fetching, engine } = realTransport([
      'truncated-mid-contract.sse',
      'truncated-past-think.sse',
    ])

    const outcome = await engine.run(history, { onDelta: () => {} })

    expect(fetching.bodies).toHaveLength(2)
    expect(fetching.bodies[0].stream).toBe(true)
    expect(outcome.ok).toBe(true)
    expect(outcome.value.isAnswer).toBe(true)
    expect(fetching.bodies[1].messages[0].content).toContain(
      'the reply stopped before it reached the act line',
    )
  })

  test('twice in a row ends the run, as a failure that says so', async () => {
    const { fetching, engine } = realTransport([
      'truncated-mid-contract.json',
      'truncated-mid-contract.json',
      'truncated-mid-contract.json',
    ])

    const outcome = await engine.run(history)

    // The ceiling, not the script: a third reply was available and unused.
    expect(fetching.bodies).toHaveLength(2)
    expect(outcome.ok).toBe(false)
    expect(outcome.failure.code).toBe(Reason.UNAVAILABLE)
    // The message names WHICH of the two routes the last reply took, because
    // they have opposite remedies and the ending is otherwise the same words.
    expect(outcome.failure.message).toBe(
      'react: 2 replies in a row ended without saying whether to use a tool or to answer — the reply stopped before it reached the act line',
    )
    // And the hint names no lever, on purpose. Naming "raise max tokens" here
    // is the defect `OpenAICompatible.RAISABLE` exists to stop — this file does
    // not hold `maxTokens` and must not guess at it — and on the other route
    // nothing was cut at all. Pinned whole rather than by its opening words: an
    // edit to its second half — "that ceiling is the lever" — survived a
    // mutation run while the opening was all this test read, and that half is
    // where the hint had started arguing with the note beside it.
    expect(outcome.failure.hint).toBe(
      "The notes say what happened to each reply: cut off at a ceiling the note names, or spent inside the model's reasoning with the transport's own remedy beside it. If they say neither, the model wrote something in act that is neither 'tool' nor 'answer', and sending the same request again will not change that — ask for something narrower, or use a different model.",
    )
    // Not a scratchpad wearing an answer's clothes.
    expect(outcome.value).toBe(null)
    // The cause sits beside the consequence, on the channel the page renders.
    expect(outcome.notes.join(' ')).toContain('cut off at the 1,135-token limit')
    expect(outcome.notes).toContain(
      'stopped after 2 steps: 2 replies in a row ended before saying what to do, so nothing was run and nothing was shown',
    )
  })

  test('a tool name written where a verb belongs is sent back, not answered', async () => {
    // The other route into the same state, and the one this file's own comment
    // used to call "the loop's most reliable terminator". `act: shell` ended the
    // run and showed `result` to the user as the final reply.
    const { engine, inference } = engineWith([
      'think: []\n\nplan: []\n\nact: shell\n\nresult: the file is empty',
      answerTurn('the file is empty'),
    ])

    const outcome = await engine.run(history)

    expect(inference.calls).toHaveLength(2)
    expect(outcome.ok).toBe(true)
    expect(outcome.value.answer).toBe('the file is empty')
    // The other route says so in its own words. "Ran out of room" is false here
    // — the reply is complete — so the correction the model reads must not be
    // the truncation one.
    expect(inference.prompts[1]).toContain(
      "the model wrote act: shell, which is neither 'tool' nor 'answer'",
    )
  })

  test('a REAL complete reply with a number in act costs a turn, and says why', async () => {
    // The disclosed regression, pinned rather than left in a report. This is
    // `complete.json`: a genuine `finish_reason: stop` capture off the testbed
    // model whose contract-shaped reply ends `act: 4` / `result: 4`. It used to
    // ANSWER "4" in one call, correctly, and now it does not — you cannot keep
    // `act: 4` answering without keeping `act: shell` answering, which is the
    // fail-open this slice exists to close. The trade is deliberate and this is
    // what it costs, in the only place that can notice if the cost changes.
    const { fetching, engine } = realTransport(['complete.json', 'complete.json'])

    const outcome = await engine.run(history)

    expect(fetching.bodies).toHaveLength(2)
    expect(outcome.ok).toBe(false)
    expect(outcome.value).toBe(null)
    // The failure names the word, so a reader is not sent looking for a ceiling.
    expect(outcome.failure.message).toContain(
      "the model wrote act: 4, which is neither 'tool' nor 'answer'",
    )
    // Nothing was cut: the transport classified both replies WHOLE and wrote no
    // note. This is the run on which "raise max tokens" would have been a lie.
    expect(outcome.notes.join(' ')).not.toContain('cut off')
    expect(outcome.failure.hint).not.toContain('max tokens')
    // And the correction it was given in between named the same word.
    expect(fetching.bodies[1].messages[0].content).toContain(
      "the model wrote act: 4, which is neither 'tool' nor 'answer' — it had written",
    )
  })

  test('the correction is spent per streak, not per run', async () => {
    // A run that was corrected, did real work and then ran short again is not
    // the run the ceiling exists to stop. Three unsaid replies here, none of
    // them adjacent, and the run still finishes.
    const unsaid = 'think: [half a]'
    const { engine, inference } = engineWith([
      unsaid,
      toolTurn('echo({"text": "0"})'),
      unsaid,
      toolTurn('echo({"text": "1"})'),
      unsaid,
      answerTurn('done'),
    ])
    const tool = new EchoTool()
    engine.toolbox = new Toolbox([tool])

    const outcome = await engine.run(history)

    expect(outcome.ok).toBe(true)
    expect(outcome.value.answer).toBe('done')
    expect(inference.calls).toHaveLength(6)
    expect(tool.received).toEqual(['0', '1'])
  })
})

/**
 * The four states a reply can be in, each driven through the shipped transport,
 * and what the run does with each. One table, because the defect this block
 * was written for was a ROW of it being wrong: a reply that ran out of tokens
 * inside the model's scratchpad ended the run, on the argument that a transport
 * failure is not worth retrying — and it is not a transport failure.
 *
 *   WHOLE     answers, one call
 *   CUT       handed on; past the decision it answers, before it is sent back
 *   THINKING  withheld; the turn is sent back with a sentence, and the run goes on
 *   SPENT     the same
 *
 * Measured before the fix: the THINKING and SPENT rows made exactly one call
 * and returned `ok: false` with `failed on step 1` — eleven of this tree's
 * fifteen benchmark runs ended that way, against four of the reference arm's.
 */
describe('the four states, through the engine', () => {
  const dump = "We need answer user's request"

  test('WHOLE: answers in one call', async () => {
    const { fetching, engine } = realTransport([whole(answerTurn('4'))])

    const outcome = await engine.run(history)

    expect(fetching.bodies).toHaveLength(1)
    expect(outcome.ok).toBe(true)
    expect(outcome.value.answer).toBe('4')
    expect(outcome.notes).toEqual([])
  })

  test('CUT past the decision: answers in one call, and says it was cut', async () => {
    const { fetching, engine } = realTransport(['truncated-past-think.json'])

    const outcome = await engine.run(history)

    expect(fetching.bodies).toHaveLength(1)
    expect(outcome.ok).toBe(true)
    expect(outcome.value.answer.startsWith('1\n2\n3\n')).toBe(true)
    expect(outcome.notes.join(' ')).toContain('cut off at the 1,135-token limit')
  })

  test('THINKING: the run takes another turn, and the dump is not in it', async () => {
    // `truncated-in-think.json`: 965 characters of scratchpad on the answer
    // channel, no `reasoning_content` at all. The transport withholds it — that
    // part is right and unchanged — and the loop used to end on the refusal.
    const { fetching, engine } = realTransport([
      'truncated-in-think.json',
      whole(answerTurn('Linux, 6.1')),
    ])

    const outcome = await engine.run(history)

    // One call is the defect. Two is the fix.
    expect(fetching.bodies).toHaveLength(2)
    expect(outcome.ok).toBe(true)
    expect(outcome.value.answer).toBe('Linux, 6.1')
    const second = fetching.bodies[1].messages[0].content
    // The sentence is the whole mechanism: what happened, and what to do
    // differently. It sits in the scratchpad, the channel the loop already
    // uses to inform rather than stop. Pinned BYTE FOR BYTE, not by substring:
    // against the real model, four shorter versions of this sentence — each
    // of which contains every substring an earlier version of this test read
    // — recovered 0 of 12 turns where these bytes recovered 10 of 10. The number
    // in it is the one the model can plan against, read off the inference.
    expect(second).toContain('# WORK SO FAR')
    expect(second).toContain(
      'action: the reply ran out of tokens inside its private reasoning, before it wrote act or result\nobservation: nothing was run and nothing was shown to the user: the whole 1,135-token reply limit went on reasoning. Reply again and reason briefly — decide in a sentence or two, then write act and result. If the task is large, do one small part of it this turn and leave the rest for later turns.',
    )
    // And NOT the scratchpad itself. `_dumped`'s argument for withholding it
    // stands: the text is the model rehearsing tool calls, and it is not put
    // back in front of the layer that would read them as decisions.
    expect(second).not.toContain(dump)
    // The transport's own classification travels, so the user is told WHY the
    // loop needed a second turn — and the ceiling is named beside it.
    expect(outcome.notes.join(' ')).toContain('still thinking')
    expect(outcome.notes.join(' ')).toContain('965')
    expect(outcome.notes.join(' ')).toContain('currently 1,135')
    expect(outcome.notes).toContain('answered after 2 steps')
  })

  test('SPENT: the same turn back, for the opposite accident', async () => {
    // `spent-in-think.json`: reasoning correctly routed, no `content` key at
    // all. The scratchpad ate the whole reply without misrouting anything, and
    // from the loop's seat that is the same fact — nothing to act on.
    const { fetching, engine } = realTransport(['spent-in-think.json', whole(answerTurn('done'))])

    const outcome = await engine.run(history)

    expect(fetching.bodies).toHaveLength(2)
    expect(outcome.ok).toBe(true)
    expect(outcome.value.answer).toBe('done')
    expect(fetching.bodies[1].messages[0].content).toContain(
      'ran out of tokens inside its private reasoning',
    )
    expect(outcome.notes.join(' ')).toContain('before the model wrote any answer')
  })

  test('and STREAMED, the dump takes the same branch', async () => {
    // The app streams whenever anyone is watching, and the two paths through
    // `OpenAICompatible` classify separately. A fix that held on `invoke` alone
    // would leave every live run where it was.
    const { fetching, engine } = realTransport([
      'truncated-in-think.sse',
      'truncated-in-think.sse',
      'truncated-in-think.sse',
    ])

    const outcome = await engine.run(history, { onDelta: () => {} })

    expect(fetching.bodies[0].stream).toBe(true)
    expect(fetching.bodies).toHaveLength(2)
    expect(outcome.ok).toBe(false)
    expect(fetching.bodies[1].messages[0].content).toContain(
      'ran out of tokens inside its private reasoning',
    )
    expect(fetching.bodies[1].messages[0].content).not.toContain(dump)
  })

  test('twice in a row ends the run, named, at the ceiling the unsaid reply already has', async () => {
    const { fetching, engine } = realTransport([
      'truncated-in-think.json',
      'spent-in-think.json',
      'truncated-in-think.json',
    ])

    const outcome = await engine.run(history)

    // The ceiling, not the script: a third reply was available and unused.
    expect(fetching.bodies).toHaveLength(2)
    expect(outcome.ok).toBe(false)
    // UNAVAILABLE at the END, whatever the transport called each refusal:
    // this is the run's verdict and it is the same one `unreadable` gives the
    // other route — nothing in the app is broken, the answer is not available
    // on these terms.
    expect(outcome.failure.code).toBe(Reason.UNAVAILABLE)
    expect(outcome.failure.message).toBe(
      'react: 2 replies in a row ended without saying whether to use a tool or to answer — the reply ran out of tokens inside its private reasoning, before it wrote act or result',
    )
    expect(outcome.value).toBe(null)
    // Both refusals are in the notes, in the transport's own words, so the
    // hint's "the notes say" is true of this route as well as the cut one.
    const notes = outcome.notes.join('\n')
    expect(notes).toContain('still thinking')
    expect(notes).toContain('before the model wrote any answer')
    expect(notes).toContain('Raise max tokens (currently 1,135)')
    expect(outcome.notes).toContain(
      'stopped after 2 steps: 2 replies in a row ended before saying what to do, so nothing was run and nothing was shown',
    )
  })

  test('an overrun and a cut-before-the-decision are ONE streak, in either order', async () => {
    // The argument for one streak rather than two, as a measurement: a design
    // that counted them apart would make three calls here, spending two
    // corrections on what is the same failure one token apart.
    for (const order of [
      ['truncated-in-think.json', 'truncated-mid-contract.json'],
      ['truncated-mid-contract.json', 'truncated-in-think.json'],
    ]) {
      const { fetching, engine } = realTransport([...order, whole(answerTurn('unreached'))])

      const outcome = await engine.run(history)

      expect(fetching.bodies).toHaveLength(2)
      expect(outcome.ok).toBe(false)
      expect(outcome.failure.message).toContain('2 replies in a row')
      restore()
    }
  })

  test('the streak resets on a reply that decides, so the correction is spent per streak', async () => {
    const tool = new EchoTool()
    const { fetching, engine } = realTransport([
      'truncated-in-think.json',
      whole(toolTurn('echo({"text": "0"})')),
      'spent-in-think.json',
      whole(answerTurn('done')),
    ])
    engine.toolbox = new Toolbox([tool])

    const outcome = await engine.run(history)

    expect(fetching.bodies).toHaveLength(4)
    expect(outcome.ok).toBe(true)
    expect(outcome.value.answer).toBe('done')
    expect(tool.received).toEqual(['0'])
  })

  test('an overrun on the last turn is not reported as the previous turn', async () => {
    // The hard stop quotes what the final turn wrote. After an overrun there
    // is no final turn to quote, and a `last` left over from the tool call
    // before it would have been quoted as if the model wrote it twice.
    const tool = new EchoTool()
    const { fetching, engine } = realTransport([
      whole(toolTurn('echo({"text": "0"})')),
      'truncated-in-think.json',
    ])
    engine.toolbox = new Toolbox([tool])

    const outcome = await engine.run(history, { budget: { steps: 2 } })

    expect(fetching.bodies).toHaveLength(2)
    expect(outcome.ok).toBe(false)
    expect(outcome.failure.message).toBe(
      'react: the 2-step budget ran out before the agent answered',
    )
    const note = outcome.notes.find((line) => line.includes('instead of an answer'))
    expect(note).toContain('the last turn wrote nothing at all instead of an answer')
    expect(note).not.toContain('echo(')
    expect(outcome.value).toBe(null)
  })

  test('the overrun pass reaches the live view as a step holding nothing', async () => {
    // `Budget` counts the pass, `onUsage` bills it and `onPrompt` announces
    // it; a view that hears no STEP for it draws one step fewer than the run
    // made and keeps the overrun's streamed reasoning on screen under the next
    // turn's. `parsed: null` is what the loop is holding, not a stand-in.
    const steps = []
    const { fetching, engine } = realTransport([
      'truncated-in-think.json',
      whole(answerTurn('Linux, 6.1')),
    ])

    const outcome = await engine.run(history, { onStep: (event) => steps.push(event) })

    expect(outcome.ok).toBe(true)
    expect(fetching.bodies).toHaveLength(2)
    expect(steps.map((event) => event.step)).toEqual([1, 2])
    expect(steps[0].parsed).toBe(null)
    expect(steps[1].parsed.answer).toBe('Linux, 6.1')
  })

  test('a stop that lands on the overrun turn carries the reply the run had', async () => {
    // The overrun nulls `last` so the hard stop cannot quote the previous turn
    // as this one — and nulled ABOVE the abort check, a stop landing while
    // the overrun reply was on the wire said "before the model had said
    // anything" after a run that had made a tool call. A stop landing on a
    // dead fetch after the same tool turn carries that turn through; this one
    // must too. The stop is pressed from `onUsage`, which the transport calls
    // with the body in hand and before it classifies the reply.
    const tool = new EchoTool()
    const controller = new AbortController()
    const { fetching, engine } = realTransport([
      whole(toolTurn('echo({"text": "0"})')),
      'truncated-in-think.json',
    ])
    engine.toolbox = new Toolbox([tool])

    const outcome = await engine.run(history, {
      signal: controller.signal,
      onUsage: ({ step }) => {
        if (step === 2) controller.abort()
      },
    })

    expect(fetching.bodies).toHaveLength(2)
    expect(outcome.ok).toBe(true)
    expect(tool.received).toEqual(['0'])
    expect(outcome.value.isAnswer).toBe(false)
    expect(outcome.value.answer).toBe('echo({"text": "0"})')
    expect(outcome.notes).toContain('you stopped this run after 2 step(s)')
    expect(outcome.notes.join(' ')).not.toContain('before the model had said anything')
  })

  test('the ending does not argue with the note beside it about the ceiling', async () => {
    // Above `OpenAICompatible.RAISABLE` the transport's remedy says raising the
    // limit is not the answer, and the loop pushes that remedy into the notes.
    // A hint on the same Outcome that said "that ceiling is the lever" was the
    // one place this file named a lever, in words the note contradicted. The
    // hint defers to the notes and asserts nothing about the remedy.
    const { engine } = realTransport(['spent-in-think.json', 'spent-in-think.json'], {
      maxTokens: 131072,
    })

    const outcome = await engine.run(history)

    expect(outcome.ok).toBe(false)
    const notes = outcome.notes.join('\n')
    expect(notes).toContain('The limit is already 131,072 tokens, so raising it is not the answer')
    expect(outcome.failure.hint).not.toContain('lever')
    expect(outcome.failure.hint).not.toContain('max tokens')
    expect(outcome.failure.hint).toContain('The notes say what happened to each reply')
    expect(outcome.failure.hint).toContain("with the transport's own remedy beside it")
  })

  test('a transport that really failed still ends the run on the spot', async () => {
    // The class of the outcome is what decides, not the fact of a failure. A
    // dead endpoint is the case the old comment was right about: the next
    // request WOULD be the same request.
    const { fetching, engine } = realTransport([])

    const outcome = await engine.run(history)

    expect(fetching.bodies).toHaveLength(1)
    expect(outcome.ok).toBe(false)
    expect(outcome.failure.code).toBe(Reason.UNAVAILABLE)
    expect(outcome.notes).toContain('failed on step 1')
  })
})
