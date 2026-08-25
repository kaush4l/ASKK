import { expect, test } from 'bun:test'

import { get, problem } from '@harness/kernel'

import { growthGate } from '../lib/growth.js'

/**
 * WHAT COUNTS AS GROWTH, EXECUTED — over `growthGate` itself and not through a
 * session, because the two states that break it are about WHEN an announcement
 * arrives, and a session cannot vary that. The one test that used to stand for
 * this whole defect drove one failing read announcing synchronously, which is
 * the single path a boolean survives.
 */

/**
 * TWO FAILING READS IN ONE PASS SWALLOW TWO ANNOUNCEMENTS.
 *
 * A screen is made of panes and each one reads for itself, so the count above
 * is the normal case, not the exotic one. The core here is the second shape
 * `growth.js` is written against — it appends and announces ONE MICROTASK
 * LATER — and with a boolean the first announcement consumed the arming and the
 * second called `bump()`: measured, one bump where none is allowed. That bump
 * wakes every pane, every pane re-reads, both 404s append, and the loop is the
 * microtask that never drains.
 */
test('two reads that both failed in one pass wake nobody, however late the news arrives', async () => {
  /** @type {Set<() => void>} */
  const watchers = new Set()
  const seam = (/** @type {import('@harness/kernel').Request} */ request) => {
    queueMicrotask(() => { for (const watcher of [...watchers]) watcher() })
    return problem(404, 'Nothing here answers that.', { kind: 'no_route', id: request.path })
  }
  let bumps = 0
  const gate = growthGate(() => { bumps += 1 })
  watchers.add(gate.announced)
  const read = gate.reading(seam)

  expect(read(get('/')).status).toBe(404)
  expect(read(get('/files')).status).toBe(404)
  await Promise.resolve()
  await Promise.resolve()

  expect(bumps).toBe(0)
})

/**
 * A FAILING READ THAT ANNOUNCES NOTHING DOES NOT EAT THE NEXT REAL APPEND.
 *
 * This is the state the build ENTERS the day the core stops recording a failed
 * GET, which is FACE's own filed request: nothing arrives to consume what the
 * 404 armed, so an unbounded arming swallows the driver's reply instead and the
 * screen keeps showing the question. The arming is bounded to its own tick, so
 * one macrotask later the guard is gone.
 */
test('a failed read that appended nothing releases its claim on the next real growth', async () => {
  // The counter `session.js` keeps is this bump and nothing else, so counting
  // the bumps is counting what `useSyncExternalStore` compares.
  let version = 0
  const gate = growthGate(() => { version += 1 })
  const read = gate.reading(() => problem(404, 'Nothing here answers that.', { kind: 'no_route', id: '/' }))

  expect(read(get('/')).status).toBe(404)
  await new Promise((resume) => setTimeout(resume, 0))
  gate.announced()

  expect(version).toBe(1)
})
