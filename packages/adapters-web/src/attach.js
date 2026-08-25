/**
 * THE INTERFACE'S ONLY DOOR. It holds the App, calls `handle`, and runs the
 * driver for whatever the request queued — so a component never awaits a model
 * call and never touches state.
 *
 * `subscribe` fires WHEN THE LOG HAS GROWN, and that is the only signal the
 * interface gets that anything happened. There is no store, no context provider
 * holding domain state, and no second path: a component re-reads its projection
 * through `seam` and renders it.
 * @module
 */

import { drive, handle } from '@harness/core'

import { browserTimer } from './ports.js'

/** @typedef {import('@harness/core').App} App */
/** @typedef {import('@harness/kernel').Request} Request */
/** @typedef {import('@harness/kernel').Response} Response */

/**
 * @param {App} app
 * @returns {{seam: (request: Request) => Response, run: () => Promise<void>, subscribe: (fn: () => void) => () => void}}
 */
export function attach(app) {
  const growth = wakeOnGrowth(app)
  const timer = browserTimer()
  /** @type {Promise<void>|null} */
  let running = null
  return {
    seam: (request) => handle(app, request),
    /**
     * Drain what the last request queued, then write the facts down. One drain
     * at a time: a second call while the first is in flight joins it rather
     * than starting a second driver over the same queue.
     */
    run() {
      running ??= drive(app, { timer })
        .then(() => app.log.persist())
        .then(() => undefined)
        .finally(() => {
          running = null
        })
      return running
    },
    subscribe: growth.subscribe,
  }
}

/**
 * THE ONLY SIGNAL THE INTERFACE GETS. The log is wrapped HERE, at the root, and
 * nowhere else — the alternative is for the log to hold listeners, which would
 * put an interface concern inside the one thing every projection is folded from.
 * @param {App} app
 */
function wakeOnGrowth(app) {
  /** @type {Set<() => void>} */
  const listeners = new Set()
  let announced = app.log.length
  let scheduled = false
  const announce = () => {
    if (scheduled) return
    scheduled = true
    // A MICROTASK LATE, ALWAYS. The log grows from inside a fold and from
    // inside the driver's own loop, and a listener that re-read its projection
    // there would be reading a state mid-write — and would re-enter `handle`
    // from within `append`.
    queueMicrotask(() => {
      scheduled = false
      if (app.log.length === announced) return
      announced = app.log.length
      for (const listener of [...listeners]) listener()
    })
  }
  const append = app.log.append
  // FORWARD WHATEVER IT WAS GIVEN. A wrapper installed at the composition root
  // must not narrow the door it wraps: `append` takes a `turnId` third, I21
  // needs that turn PERSISTED, and a browser silently dropping it would be
  // invisible to every host test — none of them go through `attach`.
  app.log.append = /** @type {typeof app.log.append} */ ((...args) => {
    const event = append(...args)
    announce()
    return event
  })
  return {
    subscribe: (/** @type {() => void} */ fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}
