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
})
