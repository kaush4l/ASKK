// REALM: worker
/**
 * THE worker entrypoint. The engine lives here and nowhere else: if this fails
 * to start, the page shows a failure and the engine does not fall back onto the
 * main thread (§3.1).
 *
 * What it does today is the front of §6.6's boot sequence — **elect the lease**,
 * then reply `ready`. The three steps that follow it there (open the database
 * under a reporting deadline, seed, reconcile orphan turns) arrive with the
 * database at 3.4, and the protocol switch over every `ToEngine` type arrives as
 * `engine/host.ts` at 3.2. Until then the client sends exactly one message and
 * there is no second case to dispatch on, so there is no switch here pretending
 * to be one.
 *
 * This file replaces `probe.worker.ts`, which was wave-1 scaffold that ran on
 * every production page load. The measurements it stood for are not lost: M1
 * (a worker built from `new URL(..., import.meta.url)` loads and runs under
 * basePath) is now asserted against `WORKER_MARK` in this file's `ready`, and
 * M5's election is asserted against `lease.ts` through a real second instance
 * of the page rather than through a synthetic pair of lock requests.
 */

import { elect } from '@/engine/lease'

/**
 * The literal that identifies the worker chunk **by content**, because the
 * chunk has no name — webpack emits it as `chunks/<number>.<hash>.js` beside
 * everything else (§8.1). It lives in this file and nowhere else: put it in
 * `protocol/` and both realms would contain it, so "two candidates" would trip
 * on every correct build forever.
 */
export const WORKER_MARK = 'askk/engine@entry.worker'

/** The store layout this build speaks. `engine/db.ts` upgrades to it at 3.4. */
const SCHEMA_VERSION = 1

/**
 * The dedicated worker scope, named once. This tsconfig loads both the DOM and
 * WebWorker libs, so `self` is typed as a window and its `postMessage` takes an
 * origin this realm has no use for.
 */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null
  postMessage: (message: unknown) => void
}

/**
 * §6.6's boot, as far as it exists. Any step may end the sequence with `fatal`
 * and none of the later steps then runs — which is why the election is awaited
 * rather than raced.
 */
async function boot(id: number): Promise<void> {
  const refused = await elect()
  if (refused !== null) {
    scope.postMessage({ type: 'fatal', reason: 'another-tab', message: refused })
    return
  }
  scope.postMessage({ id, type: 'ready', mark: WORKER_MARK, schemaVersion: SCHEMA_VERSION })
}

scope.onmessage = (event: MessageEvent) => {
  void boot((event.data as { id: number }).id)
}
