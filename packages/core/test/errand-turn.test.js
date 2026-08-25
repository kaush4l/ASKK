/**
 * THE SUB-AGENT'S HALF: a goal arrives as a message, an ordinary turn runs, and
 * the ending that turn recorded is what goes home.
 *
 * Every claim here is one a person can see on a screen: whose name is on the
 * message that opened the conversation, whether the caller was told an answer
 * or a failure, and whether any of it is still there after the Worker that
 * wrote it is gone.
 */
import { expect, test, describe } from 'bun:test'
import { CAPABILITIES } from '@harness/kernel'
import { beginMessage } from '@harness/agent'
import { boot, errandTurn, segStream, NO_ENDING } from '@harness/core'
import { fakeClock, testPorts } from '@harness/adapters-test'
import { harness, rows } from './harness.js'
import { memorySegments } from './doubles.js'

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

  test("its conversation is in the store under its own name, and a later boot reads it back", async () => {
    // THE DEFECT THIS IS ABOUT: a sub-agent whose store is a Map loses its whole
    // conversation the moment its Worker is terminated — which is at the end of
    // every errand. One store, two boots, and the second one is a reload.
    const segments = memorySegments()
    const { app, timer } = harness({ me: 'scout', segments, script: [{ text: 'looked, and here it is' }], auto: true })
    await errandTurn(app, begin('go and look', 'main'), { timer })
    await app.log.persist()

    const again = await boot({
      ports: testPorts({ clock: fakeClock() }),
      available: [...CAPABILITIES],
      segments,
      me: 'scout',
    })
    expect(rows(again, 'scout').map((r) => r.said)).toEqual(['go and look', 'looked, and here it is'])
    // …and under ITS name, not the entry agent's: a stream per agent is what
    // lets two conversations share one browser without crossing.
    expect(segments.indices(segStream('scout')).length).toBeGreaterThan(0)
    expect(segments.indices(segStream('main'))).toEqual([])
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
})

test('the protocol the two halves speak is the kernel-side one, not a second spelling', () => {
  // `beginMessage` is imported here purely to fail if the shape this suite
  // hand-writes above ever stops being the message the caller actually sends.
  expect(begin('go', 'main')).toEqual(beginMessage('e-1', 'go', 'main'))
})
