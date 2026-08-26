/**
 * WHAT FOLLOWS FROM A SIGNAL: a value computed from others, and a run performed
 * when others move. Both work the same way and that way is the point — they
 * RECORD what they read instead of being handed a list, so a dependency added
 * to the body cannot be forgotten in the declaration.
 *
 * Its own file rather than a second half of `signal.js` because the two are not
 * the same kind of thing: a signal HOLDS, and these two are the only code that
 * ever calls `recording`. Keeping the tracked run in one place is what makes
 * "reads are recorded" a claim you can check by opening one file.
 * @module
 */

import { announce, record, recording, watch } from './signal.js'

/** @typedef {import('./signal.js').Source} Source */

/**
 * A VALUE DERIVED FROM OTHERS, COMPUTED WHEN IT IS ASKED FOR AND NOT BEFORE.
 *
 * Lazy on purpose. An eager derived value recomputes on every write whether or
 * not the page is showing it, which for this product means re-projecting a
 * transcript nobody is looking at on every appended fact. What a write does is
 * mark this stale and say so; the recompute happens on the next `get`.
 *
 * The dependency set is REBUILT on every recompute, and it has to be: a
 * computation with a branch reads different signals in each arm, so a set
 * accumulated across runs would keep waking this for a value it no longer
 * reads.
 * @template T @param {() => T} compute pure; it will be re-run
 * @returns {import('./signal.js').Cell<T>}
 */
export function computed(compute) {
  /** @type {Source} */
  const source = { watchers: new Set() }
  /** @type {T} */
  let value
  let fresh = false
  /** @type {Array<() => void>} */
  let stops = []
  const stale = () => {
    // Already stale means already announced: without this an unread computed
    // announces once per write to every dependency, forever.
    if (!fresh) return
    fresh = false
    announce(source)
  }
  const refresh = () => {
    for (const stop of stops) stop()
    value = recording((seen) => {
      const answer = compute()
      stops = [...seen].map((dep) => watch(dep, stale))
      return answer
    })
    fresh = true
  }
  return {
    get: () => {
      if (!fresh) refresh()
      record(source)
      return value
    },
    subscribe: (fn) => watch(source, fn),
  }
}

/**
 * SOMETHING DONE WHEN A SIGNAL MOVES — the only place in this vocabulary where
 * a read causes anything, and therefore the only place the browser is allowed
 * to be touched from.
 *
 * It runs ONCE immediately, which is not a convenience: the first run is what
 * discovers the dependencies, so an effect that waited for a change would watch
 * nothing and never run at all.
 *
 * The stop is the return value and there is no other way to stop, because an
 * effect that outlives what it was written for is a leak with a render
 * attached — the predecessor's panes kept publishing after unmount.
 * @param {() => void} fn @returns {() => void} stop
 */
export function effect(fn) {
  /** @type {Array<() => void>} */
  let stops = []
  let live = true
  const run = () => {
    if (!live) return
    for (const stop of stops) stop()
    recording((seen) => {
      fn()
      stops = [...seen].map((dep) => watch(dep, run))
    })
  }
  run()
  return () => {
    live = false
    for (const stop of stops) stop()
    stops = []
  }
}
