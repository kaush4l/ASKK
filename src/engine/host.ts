// REALM: worker
/**
 * `serve(scope)` — the protocol switch (ARCHITECTURE.md §4, §6). Every
 * `ToEngine` type has one case here, and `checks/protocol.ts` rule 2 fails on a
 * member whose case is missing or empty.
 *
 * **Two things this file guarantees that the type system cannot.**
 *
 * *The worker never dies from a handled path* (§6.5). A handler that throws is
 * caught here and returned as `failed` carrying the thrower's own words. The
 * one that actually happens is `new URL(...)` on something a person typed.
 *
 * *§6.6's order is not a convention.* The ordered sequence says `boot` comes
 * first and comes once. `worker-client.request()` awaits `ready` internally, so
 * an out-of-order message cannot be sent **by this build's client** — but the
 * wire is not the client, and a precondition that only holds because everybody
 * remembered it is the race that shows up on a cold profile and nowhere else.
 * So the two orderings that are expressible here are rejected by name:
 * anything before `boot`, and a second `boot`. §6.6: never a silent no-op, and
 * never a message queued for a condition that may never arrive.
 *
 * `scope` is a parameter and not the ambient global, which is what lets
 * `tests/protocol.test.ts` drive the real switch — the real election excepted,
 * since `navigator.locks` is a browser fact and `scripts/verify-worker.ts` is
 * where that one is asserted.
 *
 * **`turn/start` is served here with one of §6.6's three preconditions.**
 * §6.6 requires `ready`, a session opened in this worker, and
 * `configured === true`. Only the first exists at 3.3: sessions and the config
 * store are both 3.4, so the endpoint arrives on the message
 * (`protocol/shapes.ts`) and the turn is not tied to a session. The two missing
 * preconditions become refusals in the increment that can compute them, and
 * `PROGRESS.md` 3.3 records it rather than leaving §6.6 quietly half-applied.
 */

import { elect } from '@/engine/lease'
import { probe } from '@/engine/probe'
import { Resident } from '@/engine/turns'
import type { FromEngine, Request } from '@/protocol/messages'

/**
 * The literal that identifies the worker chunk **by content**, because the
 * chunk has no name — webpack emits it as `chunks/<number>.<hash>.js` beside
 * everything else (§8.1). It lives in the worker realm and nowhere else: put it
 * in `protocol/` and both realms would contain it, so "two candidates" would
 * trip on every correct build forever. It moved here from `entry.worker.ts` at
 * 3.2 because `ready` is built here now, and the alternative was an import
 * cycle between the entrypoint and the switch.
 */
export const WORKER_MARK = 'askk/engine@entry.worker'

/** The store layout this build speaks. `engine/db.ts` upgrades to it at 3.4. */
const SCHEMA_VERSION = 1

/**
 * The worker's own scope, as the two members this file uses. The tsconfig loads
 * both the DOM and WebWorker libs, so the ambient `self` is typed as a window
 * whose `postMessage` takes an origin this realm has no use for.
 */
export interface Scope {
  onmessage: ((event: MessageEvent) => void) | null
  postMessage: (message: FromEngine) => void
}

/**
 * Everything this worker knows across messages, which today is one fact: it
 * won the writer lock (§7.3). It hangs off the served scope rather than off the
 * module, so serving a second scope — which is what a host test does — starts a
 * second engine rather than inheriting the first one's election.
 */
interface HostState {
  elected: boolean
  /** The resident (`RESIDENT.md` §2.2), one per served scope, for that scope's whole life. */
  resident: Resident
}

/** Wire every inbound message to its handler. Called once, by `entry.worker.ts`. */
export function serve(scope: Scope): void {
  const state: HostState = { elected: false, resident: new Resident((message) => scope.postMessage(message)) }
  scope.onmessage = (event: MessageEvent) => {
    void dispatch(scope, state, event.data as Request)
  }
}

async function dispatch(scope: Scope, state: HostState, request: Request): Promise<void> {
  try {
    // `null` is one handler saying it has already replied for itself. Only the
    // resident does: it opens a stream on the same wire, and it is the only
    // thing that can order its own reply against the events that follow it.
    const reply = await answer(state, request)
    if (reply !== null) scope.postMessage(reply)
  } catch (error) {
    scope.postMessage({ type: 'failed', id: request.id, message: error instanceof Error ? error.message : String(error) })
  }
}

/** One case per `ToEngine` member, behind §6.6's two expressible ordering failures. */
async function answer(state: HostState, request: Request): Promise<FromEngine | null> {
  if (request.type !== 'boot' && !state.elected) {
    return refuse(request.id, `${request.type} arrived before boot — §6.6 orders the election first, and this worker has not held it`)
  }
  switch (request.type) {
    case 'boot':
      if (state.elected) return refuse(request.id, 'boot arrived twice — §6.6 boots a worker once, and a second election would ask this worker to take a lock it already holds')
      return await boot(state, request.id)
    case 'config/probe':
      return { type: 'config/probed', id: request.id, result: await probe(request.baseUrl, request.apiKey) }
    case 'turn/start':
      state.resident.start(request.id, request.text, request.endpoint)
      return null
    case 'turn/abort':
      if (!state.resident.abort(request.turnId)) {
        return refuse(request.id, `no turn ${request.turnId} is running — §6.6 answers a stale turn id by name, never with silence`)
      }
      return { type: 'turn/abort:ok', id: request.id, turnId: request.turnId }
  }
}

function refuse(id: number, message: string): FromEngine {
  return { type: 'failed', id, message }
}

/**
 * §6.6's boot, as far as it exists: elect, then answer. The three steps that
 * follow it there — open the database under a reporting deadline, seed,
 * reconcile orphan turns — arrive with the database at 3.4, and so do `ready`'s
 * `configured` and `activeSessionId`: both are read out of the store, and a
 * hardcoded `configured: false` is a field the Shell would branch the entire
 * cold open on.
 */
async function boot(state: HostState, id: number): Promise<FromEngine> {
  const refused = await elect()
  if (refused !== null) return { type: 'fatal', reason: 'another-tab', message: refused }
  state.elected = true
  return { type: 'ready', id, mark: WORKER_MARK, schemaVersion: SCHEMA_VERSION }
}
