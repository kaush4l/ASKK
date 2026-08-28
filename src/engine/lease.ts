// REALM: worker
/**
 * The single-writer election (ARCHITECTURE.md §7.3) and the sentence MAIN
 * renders when it loses.
 *
 * Two tabs are two workers writing one database, so before the engine opens
 * anything it asks for an exclusive Web Lock. If the lock is already held, this
 * worker is not the writer and says so; it does not merge, reconcile or retry.
 *
 * **The hold is the whole mechanism, and it is not the obvious code.**
 * `navigator.locks.request(name, options, callback)` releases the lock when the
 * callback's returned promise **settles** — not when the tab closes. A callback
 * that awaits the database open and returns has released the lock by the time
 * the engine is ready, and the second tab is then granted it and writes. So the
 * callback here returns a promise that never settles: the lock is released only
 * when the browser tears the worker's realm down, which is exactly the lifetime
 * §7.3 wants. No heartbeat, no lease expiry, no stale-lock cleanup, and the
 * second tab works the moment the first is closed.
 *
 * MEASURED M5 proved `navigator.locks` grants in a classic worker under the
 * subpath export and yields `null` when held. It did **not** prove this — its
 * probe callback returned, so its lock released. `scripts/verify-worker.ts`
 * proves it against this election, in the product, on every deploy.
 */

/** One lock per database, and there is one database. */
const WRITER_LOCK = 'askk.writer'

/**
 * Ask to be the writer, and keep the lock for this realm's life.
 *
 * Resolves `null` when this worker won, or the sentence MAIN renders when it
 * did not. It resolves **while the callback is still pending**, so the lock is
 * held for every line that runs after it.
 */
export function elect(): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    void navigator.locks.request(WRITER_LOCK, { ifAvailable: true }, (lock) => {
      if (lock === null) {
        resolve(`this agent is open in another tab, which holds ${WRITER_LOCK}. Close it and reload.`)
        return Promise.resolve()
      }
      resolve(null)
      return new Promise<never>(() => {})
    })
  })
}
