// REALM: main
/**
 * Starts the probe worker and collects what it found. The main realm owns the
 * `Worker` handle (§3.3), so the construction lives here and not in the page.
 *
 * Two workers, not one, because the property under test is a property of two
 * tabs: the first holds the writer lock for its whole life, and the second must
 * be told `null` **while that first hold is still pending**. One worker asking
 * itself twice would prove nothing about the election.
 *
 * The `new URL(..., import.meta.url)` form is load-bearing and must stay inline
 * in the `new Worker(...)` call — it is what makes webpack emit the worker as
 * its own chunk under `basePath`. `{type:'module'}` is deliberately absent:
 * MEASURED M2 records that webpack drops it and emits a classic worker anyway,
 * so writing it would be describing something the toolchain does not build.
 */

/** Everything the probe establishes about the worker realm, in one flat record. */
export interface WorkerProbe {
  sentinel: string
  hasIDB: boolean
  hasLS: boolean
  hasLocks: boolean
  /** `{ifAvailable:true}` grants a lock nobody holds. */
  freeGrant: boolean
  /** The first worker became the writer. */
  heldByFirst: boolean
  /** The second worker was granted the same lock while the first still held it. Must be false. */
  secondGrantedWhileHeld: boolean
  /**
   * The lock this run actually contended for. Reported because it is generated
   * per run: a failure message naming a fixed lock sends whoever reads it
   * grepping for a string that is in no source file.
   */
  lockName: string
}

/** How long any single worker reply gets before the run is called broken rather than slow. */
const REPLY_BUDGET_MS = 15_000

function spawn(): Worker {
  return new Worker(new URL('../engine/probe.worker.ts', import.meta.url))
}

/** One request, one reply, matched by id so two in flight cannot answer each other. */
function call(worker: Worker, id: number, op: string, name?: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // Both exits detach the listener. The timeout path used not to, so a late
    // reply still ran a handler against a settled promise — harmless only
    // because `runWorkerProbe` terminates the worker, and this shape is the one
    // `client/worker-client.ts` is going to be written from at 3.1.
    const done = (): void => {
      window.clearTimeout(timer)
      worker.removeEventListener('message', onMessage)
    }
    const timer = window.setTimeout(() => {
      done()
      reject(new Error(`the worker did not answer \`${op}\` in ${REPLY_BUDGET_MS / 1000}s`))
    }, REPLY_BUDGET_MS)
    const onMessage = (event: MessageEvent): void => {
      const data = event.data as { id: number; result: unknown }
      if (data.id !== id) return
      done()
      resolve(data.result)
    }
    worker.addEventListener('message', onMessage)
    worker.postMessage({ id, op, name })
  })
}

/** A lock name unique to this run, so two open tabs cannot answer each other's probe. */
function lockName(): string {
  return `askk.probe.${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}`
}

export async function runWorkerProbe(): Promise<WorkerProbe> {
  const first = spawn()
  const second = spawn()
  try {
    const facts = (await call(first, 1, 'facts')) as Omit<
      WorkerProbe,
      'freeGrant' | 'heldByFirst' | 'secondGrantedWhileHeld' | 'lockName'
    >
    const name = lockName()
    const freeGrant = (await call(second, 2, 'try', `${name}.free`)) as boolean
    // Order is the whole assertion: `hold` resolves once the callback has been
    // entered and its never-settling promise returned, so the lock is still
    // held for every line below it.
    const heldByFirst = (await call(first, 3, 'hold', name)) as boolean
    const secondGrantedWhileHeld = (await call(second, 4, 'try', name)) as boolean
    return { ...facts, freeGrant, heldByFirst, secondGrantedWhileHeld, lockName: name }
  } finally {
    first.terminate()
    second.terminate()
  }
}
