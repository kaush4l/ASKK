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
  let restore = null
  afterEach(() => {
    restore?.()
    restore = null
  })

  /**
   * The shipped transport, answering from captured HTTP responses. A name ending
   * `.sse` is streamed, which is the path the running app actually takes —
   * `ChatService` always passes an `onDelta`.
   */
  function realTransport(fixtures) {
    const fetching = new ScriptedFetch(
      fixtures.map((name) =>
        name.endsWith('.sse') ? { sse: fixture(name) } : { json: JSON.parse(fixture(name)) },
      ),
    )
    restore = fetching.install()
    const inference = new OpenAICompatible({
      baseUrl: 'http://127.0.0.1:8873/v1',
      maxTokens: 1135,
    })
    return { fetching, engine: new ReActEngine({ system: 'You are careful.', inference }) }
  }

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
    // nothing was cut at all.
    expect(outcome.failure.hint).not.toContain('max tokens')
    expect(outcome.failure.hint).toContain('The notes say whether the endpoint cut each reply off')
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
