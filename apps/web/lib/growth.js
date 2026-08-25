/**
 * WHAT COUNTS AS THE LOG HAVING GROWN, AND WHAT DOES NOT.
 *
 * Its own file because it is the whole of one defect and it is testable on its
 * own: `lib/session.js` is the interface's hold on the application, and this is
 * the one rule that hold applies.
 */

/** @typedef {import('@harness/kernel').Request} Request */
/** @typedef {import('@harness/kernel').Response} Response */

/**
 * A READ THAT FAILED WROTE A FACT, AND A READ IS NOT A CHANGE.
 *
 * `handle` records `request_handled` for every request that changed something
 * OR FAILED (`packages/core/src/dispatch.js`), and `subscribe` fires whenever
 * the log grows. Those two together are a spin: a pane reads `GET /`, this
 * build serves no such route, the 404 appends a fact, the log grows, every pane
 * re-reads, and the 404 appends again. MEASURED, and it is not a slow screen
 * but a dead one — the growth is announced in a microtask, so the browser never
 * reaches the end of its queue and Chrome kills the renderer with no console
 * error. That is how this defect presented for three rounds.
 *
 * The STATUS is the discriminator, because it is the same condition `handle`
 * appends under and it is known synchronously. WHAT IS COUNTED, NOT FLAGGED:
 * one render pass reads once PER PANE, so N failing reads owe N swallowed
 * announcements, and a boolean lets the N+1th through — which wakes every pane,
 * which reads again. Counting is the whole difference between this holding for
 * one pane and holding for a screen made of panes.
 *
 * WHAT IS GUARANTEED: a failing read swallows exactly one announcement,
 * whenever it arrives — inside the read or in a later microtask — and an
 * announcement owed but never delivered is RELEASED AT THE END OF THE TICK.
 * That bound is not decoration. The moment the core stops recording a failed
 * GET (filed for the lead), nothing arrives to consume what a 404 armed, and an
 * unbounded arming would eat the next genuine append instead: the reply would
 * sit in the log with the screen still showing the question. The cost of the
 * bound is one stale pane, and only for a real change that lands inside the
 * same tick as a failing read.
 *
 * THE REAL FIX IS A ROUTE THAT DOES NOT WRITE WHEN IT IS READ, and it is the
 * core's. Filed for the lead in STATUS.md.
 * @param {() => void} bump what to do when the log grew for a REAL reason
 */
export function growthGate(bump) {
  let reading = false
  let seen = 0
  let owed = 0
  const owe = () => {
    owed += 1
    if (owed === 1) setTimeout(() => { owed = 0 }, 0)
  }
  return {
    announced: () => {
      if (reading) return void (seen += 1)
      if (owed > 0) return void (owed -= 1)
      bump()
    },
    /** @param {(request: Request) => Response} seam @returns {(request: Request) => Response} */
    reading: (seam) => (request) => {
      reading = true
      seen = 0
      const answered = seam(request)
      reading = false
      // One announcement belongs to this read, and only when it failed: take it
      // if it already came, otherwise wait for it. Anything else that fired
      // during the read is somebody's real append and still owes a bump.
      if (answered.status >= 400) {
        if (seen === 0) owe()
        else seen -= 1
      }
      if (seen > 0) bump()
      return answered
    },
  }
}
