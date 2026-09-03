import { describe, expect, test } from 'bun:test'
import { Engine } from '../../../src/core/engine/Engine.js'
import { ReActResponse } from '../../../src/core/response/ReActResponse.js'

/**
 * The kernel's own assertions, as distinct from a loop's.
 *
 * `ReActEngine.test.js` drives a whole turn and reads the prompt strings the
 * transport was handed. That is the right test for the loop and the wrong one
 * for this: it exercises the blocks a ReAct run happens to fill, and says
 * nothing about the two largest STATIC ones, which come from the response
 * contract rather than from anything the loop does.
 *
 * Those two were uncovered. `contract` is the single most expensive block in
 * the prompt, and `blocks()` could return an empty body for it — or for
 * `reminder` — with the entire suite still green, on every realm, forever. The
 * contract's TEXT is well pinned on `ReActResponse`; what was missing is that
 * it REACHES the prompt. Hence assertions on the block list itself, at the seam
 * where the engine reads `responseModel` and nowhere further downstream.
 */

const engineWith = (responseModel) => new Engine({ responseModel, system: 'You are careful.' })
const bodyOf = (blocks, id) => blocks.find((block) => block.id === id)?.body

describe('the prompt blocks the kernel builds', () => {
  test('the contract block carries the response model’s instructions', () => {
    const blocks = engineWith(ReActResponse).blocks([])

    expect(bodyOf(blocks, 'contract')).toContain('# RESPONSE FORMAT')
    expect(bodyOf(blocks, 'contract')).toContain('- think (list):')
  })

  test('the reminder block carries the one-line restatement, at the tail', () => {
    const blocks = engineWith(ReActResponse).blocks([])
    const reminder = blocks.find((block) => block.id === 'reminder')

    expect(reminder.body).toContain('Reply with these fields, in this order, one per line:')
    // Tail is what keeps it after the volatile blocks; a reminder that renders
    // correctly and lands before the transcript is a reminder of nothing.
    expect(reminder.tail).toBe(true)
  })

  test('an engine with no contract renders both blocks empty rather than failing', () => {
    // `null` is a real configuration — plain text, no contract — so the empty
    // string here is the answer, not a missing writer.
    const blocks = engineWith(null).blocks([])

    expect(bodyOf(blocks, 'contract')).toBe('')
    expect(bodyOf(blocks, 'reminder')).toBe('')
  })

  test('the soul block is first and carries the shared character', () => {
    const engine = new Engine({
      soul: 'You are careful and you say what you did.',
      system: 'You research things.',
      responseModel: ReActResponse,
    })
    const blocks = engine.blocks([])

    expect(blocks[0].id).toBe('soul')
    expect(blocks[0].body).toBe('You are careful and you say what you did.')
    expect(blocks[0].volatility).toBe('static')
  })

  test('an agent with no soul renders no soul block body', () => {
    const blocks = new Engine({ system: 'x', responseModel: ReActResponse }).blocks([])
    expect(blocks.find((block) => block.id === 'soul').isEmpty).toBe(true)
  })
})

describe('what the kernel does with a tool call', () => {
  const toolbox = {
    isEmpty: false,
    isRepeatable: () => false,
    run: async (text) => ({ observation: `ran ${text}`, count: 1 }),
  }

  test('a first call is dispatched to the toolbox', async () => {
    const engine = new Engine({ toolbox, responseModel: ReActResponse })
    const said = await engine.observe({ answer: 'search({"q":"x"})' }, 1, null)
    expect(said).toBe('ran search({"q":"x"})')
  })

  test('a repeat is answered without running anything', async () => {
    const engine = new Engine({ toolbox, responseModel: ReActResponse })
    const said = await engine.observe({ answer: 'search({"q":"x"})' }, 2, null)
    expect(said).toContain('was already made')
    expect(said).not.toContain('ran search')
  })

  test('an agent with no tools is told to answer instead', async () => {
    const engine = new Engine({ responseModel: ReActResponse })
    const said = await engine.observe({ answer: 'search({})' }, 1, null)
    expect(said).toContain('no tools are available')
  })

  test("verify runs the agent's own check once and hands back what it said", async () => {
    const engine = new Engine({
      toolbox,
      check: 'shell({"cmd":"test"})',
      responseModel: ReActResponse,
    })
    const first = await engine.verify(null)

    expect(first.entry.action).toBe('shell({"cmd":"test"})')
    expect(first.entry.observation).toContain('ran shell')
    expect(first.note).toContain("ran this agent's check")
    // Once per engine, so a check the agent keeps failing cannot spend a run.
    expect(await engine.verify(null)).toBe(null)
  })
})
