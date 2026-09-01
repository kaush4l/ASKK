import { describe, expect, test } from 'bun:test'
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
 * The last test records the absence of a bound rather than testing a feature:
 * the loop runs as long as the model keeps calling tools, and the script's
 * length is the only thing that ends it.
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

    const plan = engine.plan(history)
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

  test('nothing bounds the loop but the model — three tool turns run three tool turns', async () => {
    // Recorded, not celebrated. `CAPABILITIES.md` lists "bound it: nothing" and
    // this is what that costs: with a model that never answers, the run ends
    // only when the transport does.
    const tool = new EchoTool()
    const { engine, inference } = engineWith(
      [
        toolTurn('echo({"text": "a"})'),
        toolTurn('echo({"text": "b"})'),
        toolTurn('echo({"text": "c"})'),
      ],
      { toolbox: new Toolbox([tool]) },
    )

    const outcome = await engine.run(history)

    expect(tool.received).toEqual(['a', 'b', 'c'])
    expect(inference.calls).toHaveLength(4)
    expect(outcome.ok).toBe(false)
    expect(outcome.notes).toContain('failed on step 4')
  })
})
