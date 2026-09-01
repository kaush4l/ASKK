import { describe, expect, test } from 'bun:test'
import { Budget } from '../../../src/core/engine/Budget.js'
import { ReActEngine } from '../../../src/core/engine/ReActEngine.js'
import { Role } from '../../../src/core/Message.js'
import { Outcome } from '../../../src/core/Outcome.js'
import { Tool } from '../../../src/core/tools/Tool.js'
import { Toolbox } from '../../../src/core/tools/Toolbox.js'
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
 * The bound is tested the same way, and for the same reason. A budget that is
 * counted but never rendered is not a bound the agent can act on, so the
 * assertion that matters is the one on the prompt string, not on the number.
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
    expect(outcome.notes).toContain(
      'stopped after 3 steps: the 3-step budget is spent and the last turn did not answer',
    )
    expect(outcome.value.answer).toContain('echo(')
  })
})

describe('a budget the agent can read', () => {
  test('the block is in the prompt the transport was handed, from the very first call', async () => {
    const { engine, inference } = engineWith([answerTurn('done')])

    await engine.run(history, { budget: { steps: 6, tokens: 9000, seconds: 120 } })

    expect(inference.prompts[0]).toContain(
      '# BUDGET\n\nsteps: 0 of 6 used\ntokens: 0 of 9,000 used (estimated)\ntime: 0s of 120s used',
    )
  })

  test('what the last prompt spent is in the next one, so the agent watches it go', async () => {
    const { engine, inference } = engineWith([toolTurn('echo({"a": 1})'), answerTurn('done')])

    await engine.run(history, { budget: { steps: 6 } })

    expect(inference.prompts[1]).toContain('steps: 1 of 6 used')
    // The estimate for the first prompt, standing because this transport
    // reports no usage — and the block says which of the two it is.
    expect(inference.prompts[1]).toMatch(/tokens: \d{3,} of 250,000 used \(estimated\)/)
  })

  test('the last turn is told it is the last, in words, before it is sent', async () => {
    const { engine, inference } = engineWith([toolTurn('echo({"a": 1})'), answerTurn('what I got')])

    const outcome = await engine.run(history, { budget: { steps: 2 } })

    expect(inference.prompts[0]).not.toContain('LAST TURN')
    expect(inference.prompts[1]).toContain('THIS IS YOUR LAST TURN. the 2-step budget is spent')
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

    expect(inference.prompts[1]).toContain('steps: 0 of 4 used')
  })
})

describe('stopping a run', () => {
  test('the signal reaches the transport, not just the loop', async () => {
    const { engine, inference } = engineWith([answerTurn('done')])
    const controller = new AbortController()

    await engine.run(history, { signal: controller.signal })

    // The argument at the boundary. A stop that is only polled between
    // iterations leaves the model call open for as long as the endpoint takes,
    // which is precisely the wait the button was pressed to end.
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
