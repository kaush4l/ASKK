// REALM: main
/**
 * Owns the `Worker` handle — the one piece of engine-adjacent state the main
 * realm holds (§3.3) — and performs the boot handshake.
 *
 * Nothing outside `client/` imports this. `client/actions.ts` at 3.2 is what
 * gives it its `request(msg)` half and its callers; today the only message that
 * crosses is `boot`, so the only thing here is the handshake and the three ways
 * it can end.
 *
 * **Every ending is a rendered state, and that is the point.** A worker whose
 * chunk 404s under basePath, a worker that throws before it replies, and a
 * worker that simply never answers are all indistinguishable from a page that
 * is still loading — and "a page that rendered and did nothing" is this
 * project's signature failure. So the handshake never hangs and never rejects:
 * it resolves to a state the page can show.
 *
 * The `new URL(..., import.meta.url)` form is load-bearing and must stay inline
 * in the `new Worker(...)` call — it is what makes webpack emit the worker as
 * its own chunk under `basePath`. `{type:'module'}` is deliberately absent:
 * MEASURED M2 records that webpack drops it and emits a classic worker anyway,
 * so writing it would be describing something this toolchain does not build.
 */

/** What the engine answered, or why it did not. The page renders one of these. */
export type EngineState =
  | { kind: 'ready'; mark: string; schemaVersion: number }
  | { kind: 'fatal'; reason: string; message: string }

/**
 * How long the engine gets to elect and reply before the page is told it did
 * not answer. A reporting deadline, never a cancellation (§6.5): it stops the
 * page waiting, it does not claim to have stopped the worker.
 */
const BOOT_DEADLINE_MS = 15_000

/** The id of the one request this increment sends. Replies are matched against it (§6). */
const BOOT_ID = 1

/** A started engine: the boot outcome, and the way to put the worker down. */
export interface EngineHandle {
  state: Promise<EngineState>
  stop(): void
}

/**
 * One message off the wire, read as a state. `fatal` carries no `id` — it is
 * unsolicited and may arrive instead of any reply (§6.3) — so it is recognised
 * before the reply pairing is looked at.
 */
function received(data: unknown): EngineState {
  const message = data as {
    id?: number
    type?: string
    reason?: string
    message?: string
    mark?: string
    schemaVersion?: number
  }
  if (message.type === 'fatal') {
    return { kind: 'fatal', reason: String(message.reason), message: String(message.message) }
  }
  if (message.type === 'ready' && message.id === BOOT_ID) {
    return { kind: 'ready', mark: String(message.mark), schemaVersion: Number(message.schemaVersion) }
  }
  return {
    kind: 'fatal',
    reason: 'internal',
    message: `the engine answered boot with ${JSON.stringify(data)}`,
  }
}

/** Constructs the worker, sends `boot`, and resolves however that ends. */
export function startEngine(): EngineHandle {
  const worker = new Worker(new URL('../engine/entry.worker.ts', import.meta.url))
  let settle: (state: EngineState) => void = () => {}
  const state = new Promise<EngineState>((resolve) => {
    settle = (value) => {
      window.clearTimeout(timer)
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      resolve(value)
    }
  })
  const timer = window.setTimeout(() => {
    settle({
      kind: 'fatal',
      reason: 'internal',
      message: `the engine did not answer boot in ${BOOT_DEADLINE_MS / 1000}s`,
    })
  }, BOOT_DEADLINE_MS)
  const onMessage = (event: MessageEvent): void => settle(received(event.data))
  // §6.5: a dead worker's replies are never coming, and pretending otherwise
  // hangs the page forever. The message is the one that document names.
  const onError = (): void => settle({ kind: 'fatal', reason: 'internal', message: 'worker stopped' })
  worker.addEventListener('message', onMessage)
  worker.addEventListener('error', onError)
  worker.postMessage({ id: BOOT_ID, type: 'boot' })
  return { state, stop: () => worker.terminate() }
}
