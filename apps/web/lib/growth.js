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
 * appends under and it is known synchronously. The announcement may arrive
 * inside the read or one microtask after it, and both are handled — nothing
 * here depends on the order two queued callbacks happen to take.
 *
 * THE REAL FIX IS A ROUTE THAT DOES NOT WRITE WHEN IT IS READ, and it is the
 * core's: this cannot tell a fact the driver appended during the read from the
 * one the read caused, so a genuine change landing in that window leaves a pane
 * stale until the next one. Filed for the lead in STATUS.md.
 * @param {() => void} bump what to do when the log grew for a REAL reason
 */
export function growthGate(bump) {
  let reading = false
  let swallowed = false
  let expected = false
  return {
    announced: () => {
      if (reading) return void (swallowed = true)
      if (expected) return void (expected = false)
      bump()
    },
    /** @param {(request: Request) => Response} seam @returns {(request: Request) => Response} */
    reading: (seam) => (request) => {
      reading = true
      swallowed = false
      const answered = seam(request)
      reading = false
      // Exactly one announcement belongs to this read, and only when it failed.
      if (answered.status >= 400 && !swallowed) expected = true
      if (answered.status < 400 && swallowed) bump()
      return answered
    },
  }
}

