// REALM: worker
/**
 * The wave-1 probe worker. It is not the engine — `engine/entry.worker.ts` is
 * increment 3.1 — and its only job is to keep four architectural commitments
 * from expiring silently.
 *
 * §3.2's no-runtime-ESM rule, §7.3's single-writer election, §8.1's bundle
 * check and the whole realm map rest on facts measured **once**, in a scratch
 * probe, outside this repository (`docs/scratch/MEASURED.md`). A toolchain
 * upgrade invalidates all four at the same moment and nothing in the tree would
 * notice. This file is what notices: it re-measures them from the built export,
 * served at its subpath, on every deploy.
 *
 * Two things here look like style and are not:
 *
 * 1. **Presence is tested with `in`, never with `typeof`.** MEASURED M3 found
 *    `typeof window` folded to a constant by the bundler before the code ran,
 *    and §3.5 bans the operator outright on realm-discriminating globals. `in`
 *    is a real property lookup on a real object and no compiler folds it.
 * 2. **The hold returns a promise that never settles.** `navigator.locks`
 *    releases when the callback's promise settles, so a callback that returns
 *    releases immediately and both tabs write. §7.3 spells this out; the
 *    election is the never-settling promise and nothing else.
 */

/** The string the probe puts on the wire. `scripts/verify-worker.ts` compares against it. */
export const PROBE_SENTINEL = 'ASKK_WORKER_ALIVE'

/**
 * The dedicated worker scope, named once. This tsconfig loads both the DOM and
 * WebWorker libs, so `self` is typed as a window and its `postMessage` takes an
 * origin this realm has no use for.
 */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null
  postMessage: (message: unknown) => void
}

/** What the platform gave this realm, per API — there is no realm tier to ask for (§3.4). */
function facts(): Record<string, unknown> {
  return {
    sentinel: PROBE_SENTINEL,
    hasIDB: 'indexedDB' in scope,
    hasLS: 'localStorage' in scope,
    hasLocks: 'locks' in navigator,
  }
}

/**
 * Take the lock the way §7.3's election takes it, and keep it. Resolves `true`
 * when this worker is the writer, `false` when another already is; either way
 * the lock is still held when the promise settles, because the callback's own
 * promise is what releases it and that one never settles.
 */
function hold(name: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    void navigator.locks.request(name, { ifAvailable: true }, (lock) => {
      if (lock === null) {
        resolve(false)
        return Promise.resolve()
      }
      resolve(true)
      return new Promise<never>(() => {})
    })
  })
}

/** Ask for the lock and give it straight back. `true` if it was free. */
function attempt(name: string): Promise<boolean> {
  return navigator.locks
    .request(name, { ifAvailable: true }, (lock) => lock !== null)
    .then((granted) => granted === true)
}

scope.onmessage = (event: MessageEvent) => {
  const request = event.data as { id: number; op: string; name?: string }
  const reply = (result: unknown): void => scope.postMessage({ id: request.id, result })
  const name = request.name ?? ''
  if (request.op === 'facts') reply(facts())
  else if (request.op === 'hold') void hold(name).then(reply)
  else if (request.op === 'try') void attempt(name).then(reply)
  else reply({ error: `unknown op ${request.op}` })
}
