/**
 * SIGNALS — the reactive primitive the Rust harness had and the first JS build
 * did not.
 *
 * Dioxus gave every component `use_signal`, and the port replaced it with a
 * change COUNTER that each pane compared by hand: `lib/session.js` kept a `Set`
 * of watchers, bumped an integer, and every reader re-read everything because
 * an integer cannot say WHAT moved. That works and it is what shipped, but it
 * pushes the bookkeeping into every consumer, and the bookkeeping is the part a
 * reader has to hold in their head.
 *
 * A signal is one value plus the set of things that read it. Reading inside a
 * `computed` or an `effect` RECORDS the dependency, so nothing declares a list
 * that can drift from the reads it is supposed to describe — the defect this
 * project has found in four other shapes (a capability list beside an adapter,
 * a budget beside a model card, a fidelity name beside a ladder).
 *
 * IT IS IN THE KERNEL AND IT IS PURE. No `window`, no timer, no microtask: a
 * `set` notifies synchronously unless a `batch` is open, which is what lets the
 * host tests assert the exact number of notifications rather than awaiting one.
 * React binds to it through `useSyncExternalStore` in `apps/web`, and that
 * binding is the only place React is named.
 * @module
 */

/**
 * A value that says when it changed.
 * @template T
 * @typedef {{get: () => T, subscribe: (fn: () => void) => () => void}} Cell
 */

/**
 * A value that says when it changed, and can be told to.
 * @template T
 * @typedef {Cell<T> & {set: (next: T) => void}} Signal
 */

/** @typedef {{watchers: Set<() => void>}} Source what a read can be recorded against */

/**
 * THE READS BEING RECORDED RIGHT NOW, or `null` outside a tracked run. One
 * module-level variable and not a stack of them: `derive.js` saves and restores
 * it around its own run, which is what makes a `computed` read inside another
 * `computed` land in the inner set and then the outer one.
 * @type {Set<Source>|null}
 */
let tracking = null

/** How many `batch` calls are open. Zero means a `set` notifies immediately. */
let depth = 0

/** Watchers a `set` inside an open batch has deferred. A Set, so one fires once. */
const deferred = new Set()

/**
 * Record that the run in progress read this source. A no-op outside one, which
 * is what makes an ordinary `signal.get()` in a component free.
 * @param {Source} source
 */
export function record(source) {
  tracking?.add(source)
}

/**
 * Run `fn` while recording every source it reads.
 * @template T @param {(source: Set<Source>) => T} fn given the sources it read
 * @returns {T}
 */
export function recording(fn) {
  const seen = new Set()
  const outer = tracking
  tracking = seen
  try {
    return fn(seen)
  } finally {
    tracking = outer
  }
}

/**
 * Tell everything watching this source that it moved — or, inside a batch,
 * remember to. The watcher list is COPIED first: a watcher that unsubscribes
 * itself while being notified would otherwise mutate the set being walked.
 * @param {Source} source
 */
export function announce(source) {
  for (const watcher of [...source.watchers]) {
    if (depth > 0) deferred.add(watcher)
    else watcher()
  }
}

/**
 * Watch a source. Returns the stop, which is the only way to stop.
 * @param {Source} source @param {() => void} fn @returns {() => void}
 */
export function watch(source, fn) {
  source.watchers.add(fn)
  return () => source.watchers.delete(fn)
}

/**
 * ONE NOTIFICATION FOR A RUN OF WRITES. Without it, a turn that appends three
 * facts wakes every pane three times and the second and third renders are of
 * states nobody will ever see.
 *
 * `finally`, so a throw inside `fn` still closes the batch: the alternative is
 * a page that has silently stopped notifying and gives no sign of it.
 * @template T @param {() => T} fn @returns {T}
 */
export function batch(fn) {
  depth += 1
  try {
    return fn()
  } finally {
    depth -= 1
    if (depth === 0) flush()
  }
}

/** Fire what the closing batch deferred, clearing FIRST so a write inside a
 *  watcher queues for the next flush rather than extending this walk. */
function flush() {
  const due = [...deferred]
  deferred.clear()
  for (const watcher of due) watcher()
}

/**
 * A value that says when it changed.
 *
 * `same` is `Object.is` because that is the comparison React already uses and
 * agreeing with it is worth more than any other default. It is a parameter
 * rather than a hardcode for the one case this build has: a projection is a
 * fresh object on every read, so the thing held in a signal is its VERSION and
 * the identity comparison is exactly right — but a caller holding a list can
 * pass a shallow compare instead of re-deriving one.
 * @template T @param {T} initial @param {(a: T, b: T) => boolean} [same]
 * @returns {Signal<T>}
 */
export function signal(initial, same = Object.is) {
  /** @type {Source} */
  const source = { watchers: new Set() }
  let value = initial
  return {
    get: () => {
      record(source)
      return value
    },
    set: (next) => {
      if (same(value, next)) return
      value = next
      announce(source)
    },
    subscribe: (fn) => watch(source, fn),
  }
}
