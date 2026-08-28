// REALM: worker
/**
 * THE worker entrypoint. The engine lives here and nowhere else: if this fails
 * to start, the page shows a failure and the engine does not fall back onto the
 * main thread (§3.1).
 *
 * It is four lines because it has one job — name the realm's scope and hand it
 * to the switch. Everything the engine does with a message is `engine/host.ts`,
 * so a new message is a case there and never an edit here.
 *
 * This file replaces `probe.worker.ts`, which was wave-1 scaffold that ran on
 * every production page load. The measurements it stood for are not lost: M1
 * (a worker built from `new URL(..., import.meta.url)` loads and runs under
 * basePath) is asserted against `WORKER_MARK` in `ready`, and M5's election is
 * asserted against `lease.ts` through a real second instance of the page rather
 * than through a synthetic pair of lock requests.
 */

import { serve } from '@/engine/host'
import type { Scope } from '@/engine/host'

/**
 * The dedicated worker scope, named once. This tsconfig loads both the DOM and
 * WebWorker libs, so `self` is typed as a window and its `postMessage` takes an
 * origin this realm has no use for.
 */
serve(self as unknown as Scope)
