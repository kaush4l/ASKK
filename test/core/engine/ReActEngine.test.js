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
