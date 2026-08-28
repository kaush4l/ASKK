// REALM: main
/**
 * Owns the `Worker` handle — the one piece of engine-adjacent state the main
 * realm holds (§3.3) — and is the only place a message is put on the wire.
 *
 * Nothing outside `client/` imports this: `actions.ts` sends through it and
 * `store.ts` listens to it (§5.8 rule 2). At 3.1 it had neither, and a seam
 * with no crossing was the defect §2.8 was written against; 3.2 is the
 * increment where `request()` and `subscribe()` get their first callers.
 *
 * **Three properties, each paid for by a failure this project has already had.**
 *
 * *The handshake is not a rule callers have to remember* (§6.6). `request()`
 * awaits `ready` internally, so a probe fired from a mount effect is ordered
 * correctly by construction rather than by discipline — the only version of
 * this that survives someone adding a new surface.
 *
 * *The id is assigned here and nowhere else.* `ToEngine` carries no `id`, so a
 * caller cannot invent one and two callers cannot collide.
 *
 * *Nothing ever waits forever* (§6.5). `worker.onerror` rejects every in-flight
 * request with `worker stopped`, and a boot that never answers becomes a
 * rendered `fatal` rather than a page that is still loading. A worker whose
 * chunk 404s under basePath, a worker that throws before it replies, and a
 * worker that simply never answers are otherwise indistinguishable from a page
 * that has not finished starting — and "a page that rendered and did nothing"
 * is this project's signature failure.
 *
 * The `new URL(..., import.meta.url)` form is load-bearing and must stay inline
 * in the `new Worker(...)` call — it is what makes webpack emit the worker as
 * its own chunk under `basePath`. `{type:'module'}` is deliberately absent:
 * MEASURED M2 records that webpack drops it and emits a classic worker anyway,
 * so writing it would be describing something this toolchain does not build.
 */

import { REPLY_OF } from '@/protocol/messages'
import type { FromEngine, ReplyTo, ToEngine } from '@/protocol/messages'

/**
 * How long the engine gets to elect and reply before the page is told it did
 * not answer. A reporting deadline, never a cancellation (§6.5): it stops the
 * page waiting, it does not claim to have stopped the worker.
 */
const BOOT_DEADLINE_MS = 15_000

interface Pending {
  expect: string
  settle: (message: FromEngine) => void
  fail: (error: Error) => void
}

let worker: Worker | null = null
let booted: Promise<FromEngine> | null = null
let nextId = 1
const pending = new Map<number, Pending>()
const listeners = new Set<(message: FromEngine) => void>()

/** Every message the engine sends, in arrival order. `store.ts` is the subscriber. */
export function subscribe(listener: (message: FromEngine) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Construct the worker and send `boot`. Idempotent, because the engine is one
 * per page: a second call from a second mount must not start a second worker,
 * which would lose its own election against the first.
 */
export function start(): void {
  if (worker !== null) return
  const started = new Worker(new URL('../engine/entry.worker.ts', import.meta.url))
  started.addEventListener('message', (event: MessageEvent) => receive(event.data as FromEngine))
  started.addEventListener('error', () => stopped('worker stopped'))
  worker = started
  const timer = window.setTimeout(() => stopped(`the engine did not answer boot in ${BOOT_DEADLINE_MS / 1000}s`), BOOT_DEADLINE_MS)
  // The gate never rejects. It resolves to whatever boot ended as, and
  // `request()` reads that — because a promise nobody has awaited yet, rejecting
  // in the background, is an unhandled rejection printed as a console error, and
  // `verify-worker.ts` fails the build on one of those.
  booted = send({ type: 'boot' }).catch((error: Error) => bootFailure(error.message))
  void booted.then(() => window.clearTimeout(timer))
}

/**
 * Send one request and resolve with its declared reply. `failed` rejects with
 * the engine's own sentence; a reply of any other type rejects rather than
 * being handed to a caller that asked for something else.
 */
export async function request<T extends ToEngine>(message: T): Promise<ReplyTo<T>> {
  start()
  const gate = await booted
  if (!gate) throw new Error('the engine never started')
  if (gate.type !== 'ready') throw new Error('message' in gate ? gate.message : `the engine answered boot with ${gate.type}`)
  return (await send(message)) as ReplyTo<T>
}

function send(message: ToEngine): Promise<FromEngine> {
  const id = nextId++
  const expect = REPLY_OF[message.type]
  return new Promise<FromEngine>((resolve, reject) => {
    pending.set(id, { expect, settle: resolve, fail: reject })
    worker?.postMessage({ ...message, id })
  })
}

/**
 * One message off the wire: settle whoever asked for it, then tell everyone.
 *
 * §6's opening rule, as a branch: **requests carry an `id` and get exactly one
 * reply; events carry none and are never awaited.** A `turn/delta` has no
 * waiter to find, and looking one up by `undefined` would settle whichever
 * request happened to be in flight with somebody else's message.
 */
function receive(message: FromEngine): void {
  if (message.type === 'fatal') {
    rejectAll(message.message)
  } else if ('id' in message) {
    const waiter = pending.get(message.id)
    pending.delete(message.id)
    if (message.type === 'failed') waiter?.fail(new Error(message.message))
    else if (waiter && waiter.expect !== message.type) {
      waiter.fail(new Error(`the engine answered with ${message.type}, and ${waiter.expect} was what this request declared (§6.1)`))
    } else waiter?.settle(message)
  }
  for (const listener of listeners) listener(message)
}

/**
 * The main realm's own `fatal` (§6.5). It is the one `FromEngine` this side
 * constructs, because a dead worker's replies are never coming and only this
 * side can know that.
 */
function stopped(message: string): void {
  receive(bootFailure(message))
}

function bootFailure(message: string): FromEngine {
  return { type: 'fatal', reason: 'internal', message }
}

function rejectAll(message: string): void {
  for (const [id, waiter] of pending) {
    pending.delete(id)
    waiter.fail(new Error(message))
  }
}
