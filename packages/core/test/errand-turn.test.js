/**
 * THE SUB-AGENT'S HALF: a goal arrives as a message, an ordinary turn runs, and
 * the ending that turn recorded is what goes home.
 *
 * Every claim here is one a person can see on a screen: whose name is on the
 * message that opened the conversation, and whether the caller was told an
 * answer, a failure, or somebody else's sentence. That the turn is WRITTEN DOWN
 * before the Worker dies is the entry module's line to run, and it is executed
 * where it lives (`adapters-web/test/agent-entry.test.js`).
 */
import { expect, test, describe } from 'bun:test'
import { beginMessage } from '@harness/agent'
import { errandTurn, NO_ENDING } from '@harness/core'
import { harness, rows } from './harness.js'

/** @param {string} goal @param {string} from */
const begin = (goal, from) => ({ v: 1, type: /** @type {const} */ ('begin'), errandId: 'e-1', goal, from })

describe("an errand is one ordinary turn of the sub-agent's own loop", () => {
  test("the message that opens it names the LEAD, and the answer goes home", async () => {
    const { app, timer } = harness({ me: 'scout', script: [{ text: 'three results, all from 2024' }], auto: true })
    const ended = await errandTurn(app, begin('find the release date', 'main'), { timer })

    // The transcript a person opens at ?agent=scout. `from` is why the first
    // row does not read "You": the seam's own POST /chat writes an empty one,
    // and a delegation pushed through that door would be filed as the person's.
    expect(rows(app, 'scout').map((r) => [r.kind, r.speaker, r.said])).toEqual([
      ['user', 'main asked scout', 'find the release date'],
      ['assistant', 'scout', 'three results, all from 2024'],
    ])
    expect(ended).toEqual({ v: 1, type: 'ended', errandId: 'e-1', ok: true, text: 'three results, all from 2024', why: 'answered' })
  })

  test('a turn that ended WITHOUT an answer reports the ending it recorded, not silence', async () => {
    // No script at all: every model call fails, `step` retries to its ceiling
    // and ends the turn quoting the driver. The caller must learn that word —
    // the predecessor inferred one outcome for every ending there was.
    const { app, timer } = harness({ me: 'scout', script: [], auto: true })
    const ended = await errandTurn(app, begin('go and look', 'main'), { timer })

    expect(ended.ok).toBe(false)
    expect(ended.why).not.toBe('')
    expect(ended.why).not.toBe(NO_ENDING)
    expect(ended.errandId).toBe('e-1')
  })

  test('the answer is the last thing the model SAID, and a silent round does not erase it', async () => {
    // A reply that calls a tool and says nothing is normal, and it is not a row.
    // Reporting that silence would throw away the sentence the caller waits for.
    const { app, timer } = harness({
      me: 'scout',
      script: [{ text: 'the file is 12 lines long', calls: [{ id: 'c1', tool: 'now', args: '{}' }] }, { text: '' }],
      auto: true,
    })
    const ended = await errandTurn(app, begin('measure it', 'main'), { timer })
    expect(ended.text).toBe('the file is 12 lines long')
  })
})

describe('what the caller is told when the run went sideways', () => {
  test('an ending belonging to another turn is not reported as this errand`s answer', async () => {
    // The turn is matched by the id it carries (I21). Nothing in this build
    // reuses a Worker today; a reader that took the NEWEST ending instead would
    // report a previous errand's outcome the first time one did.
    const { app, timer } = harness({ me: 'scout', script: [{ text: 'first' }, { text: 'second' }], auto: true })
    const one = await errandTurn(app, begin('first errand', 'main'), { timer })
    const two = await errandTurn(app, { ...begin('second errand', 'main'), errandId: 'e-2' }, { timer })
    expect([one.text, two.text]).toEqual(['first', 'second'])
    expect(two.errandId).toBe('e-2')
  })

  test('an errand whose model said NOTHING answers with nothing, never with the last errand`s sentence', async () => {
    // A reply with no text and no tool calls ends `ok` and writes no row — so a
    // reader that scanned the whole transcript backwards for the newest
    // assistant row handed this caller the PREVIOUS errand's answer to the
    // question it had just asked. Empty is honest; borrowed is not (I21, I16).
    const { app, timer } = harness({ me: 'scout', script: [{ text: 'the release was in March' }, { text: '' }], auto: true })
    const one = await errandTurn(app, begin('look it up', 'main'), { timer })
    const two = await errandTurn(app, { ...begin('and the price?', 'main'), errandId: 'e-2' }, { timer })
    expect(one.text).toBe('the release was in March')
    expect(two.text).not.toBe(one.text)
    expect(two.text).toBe('')
  })
})

test('the protocol the two halves speak is the kernel-side one, not a second spelling', () => {
  // `beginMessage` is imported here purely to fail if the shape this suite
  // hand-writes above ever stops being the message the caller actually sends.
  expect(begin('go', 'main')).toEqual(beginMessage('e-1', 'go', 'main'))
})
