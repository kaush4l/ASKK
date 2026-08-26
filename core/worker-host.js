/** The agent worker protocol — both ends of one wire (PORT-MAP R3).
 *
 *     serve(self, { loadAgent })       // inside the worker
 *     new AgentWorker(name, handle)    // outside it
 *
 * The Python gave each agent a thread with its own event loop, because an agent's
 * resources — an MCP subprocess and its session above all — belong to the loop
 * that created them. A worker is the browser's version of that, and a stronger
 * one: nothing here is reachable from anywhere else at all.
 *
 * Both halves live in one file because they are one protocol, and a protocol
 * split across the file that happens to use it drifts. `serve` is still not the
 * worker's entry file: that file is what `bun build` is handed as its own
 * entrypoint (a worker is never emitted from a `new URL(...)` inside another
 * module; measured, PORTING-GUIDE §1.6), and it is where the environment is
 * assembled — the ports, and the `loadAgent` that uses them. Both arrive here as
 * arguments: a core that reached for either would stop being testable on the host.
 *
 * Four calls in — boot, invoke, messages, close — plus `attach`, which is how the
 * registry hands an agent the peers its frontmatter asked for. Two messages out
 * that nobody asked for: `peer`, when the engine calls one, and `state`, for a
 * transition only this side can see.
 *
 * Everything crosses as structured clone, and that is the whole contract: no
 * transferables (Bun's support is unverified) and none of Bun's worker extensions,
 * every one of which breaks the browser. A parsed response lands on the far side
 * as its data and not as its class — the prototype does not survive the copy, and
 * nothing over there needs it: `Tool.fromAgent` reads `.answer`.
 */

/** @typedef {import("./ports.js").WorkerHandle} WorkerHandle */
/** @typedef {{ postMessage(m: unknown): void, addEventListener(t: string, l: (e: any) => void): void }} WorkerScope */
/** @typedef {(name: string, dir: string, agentNames: string[]) => Promise<any>} LoadAgent */
/** @typedef {{ warning(m: string): void, info(m: string): void, error(m: string): void }} Log */
/** @typedef {{ resolve: (v: any) => void, reject: (e: Error) => void }} Waiter */
/** @typedef {{ scope: WorkerScope, loadAgent: LoadAgent, log: Log, engine: any, outbound: Map<string, Waiter>, counter: number }} Session */

/** A pure core does not own a logger. @type {Log} */
export const SILENT = { warning() {}, info() {}, error() {} }

/** @param {unknown} e @returns {string} */
export const why = (e) => (e instanceof Error ? e.message : String(e))

/** One worker, and the calls in flight on it. The outside half. */
export class AgentWorker {
  /** @param {string} name @param {WorkerHandle} worker */
  constructor(name, worker) {
    /** @type {string} */ this.name = `agent-${name}`
    /** @type {WorkerHandle} */ this.worker = worker
    /** @type {Map<string, Waiter>} */ this.pending = new Map()
    this.counter = 0
    this.stopped = false
    /** Route a sub-agent call this worker made. @type {(n: string, i: string) => Promise<any>} */
    this.onPeer = async () => {
      throw new Error("no peers attached")
    }
    /** @type {(status: string, detail: string) => void} */
    this.onState = () => {}
    this.worker.addEventListener("message", (event) => this.receive(event?.data))
    // A dead worker takes every call on it with it, and the reply is never
    // coming — rejecting is the only honest answer.
    this.worker.addEventListener("error", (e) => this.abandon(String(e?.message ?? "worker error")))
  }

  /** Await one call on this agent's worker, from anywhere else. A call made after
   * the worker stopped fails at once rather than waiting for a reply that cannot
   * come. @param {Record<string, unknown>} message @returns {Promise<any>} */
  run(message) {
    if (this.stopped) return Promise.reject(new Error("worker stopped"))
    const id = `call-${this.counter++}`
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ ...message, id })
    })
  }

  /** @param {any} m */
  receive(m) {
    if (!m || typeof m !== "object") return
    if (m.type === "peer") return void this.serve(m)
    if (m.type === "state") return this.onState(String(m.status), String(m.detail ?? ""))
    settle(this.pending, m)
  }

  /** The engine called a peer. Peers live in other workers, so the call comes
   * out here, runs against the peer's own `WorkerAgent`, and goes back in.
   * @param {any} m */
  async serve(m) {
    const reply = { type: "peerResult", id: m.id, ok: true, result: /** @type {any} */ (null), error: "" }
    try {
      reply.result = await this.onPeer(String(m.name), String(m.input ?? ""))
    } catch (e) {
      reply.ok = false
      reply.error = why(e)
    }
    this.worker.postMessage(reply)
  }

  /** @param {string} reason */ abandon(reason) {
    for (const waiter of this.pending.values()) waiter.reject(new Error(reason))
    this.pending.clear()
  }

  stop() {
    this.stopped = true
    this.abandon("worker stopped")
    this.worker.terminate()
  }
}

/** Hand one reply to whoever waits on it. Both ends correlate the same way, so both
 * use this. @param {Map<string, Waiter>} pending @param {any} m */
function settle(pending, m) {
  const waiter = pending.get(m.id)
  if (!waiter) return
  pending.delete(m.id)
  if (m.ok) waiter.resolve(m.result)
  else waiter.reject(new Error(String(m.error)))
}

/** The engine, or a failure the caller can read. @param {Session} s @returns {any} */
const built = (s) => {
  if (!s.engine) throw new Error("agent not built")
  return s.engine
}

/** A peer agent as this worker sees it: `name`, `description`, `invoke` — exactly
 * the duck type `Toolbox.of` accepts, so the engine wraps it with `Tool.fromAgent`
 * and no adapter for a sub-agent exists anywhere. The peer itself is in another
 * worker; only the shape crosses. @param {Session} s @param {{ name: string, description?: string }} peer @returns {any} */
function remote(s, peer) {
  return {
    name: peer.name,
    description: peer.description ?? "",
    invoke: (/** @type {string} */ input) =>
      new Promise((resolve, reject) => {
        const id = `peer-${s.counter++}`
        s.outbound.set(id, { resolve, reject })
        s.scope.postMessage({ type: "peer", id, name: peer.name, input })
      }),
  }
}

/** The whole inbound surface. @type {Record<string, (s: Session, p: any) => Promise<any>>} */
const HANDLERS = {
  async boot(s, p) {
    s.engine = await s.loadAgent(String(p.name), String(p.dir), p.agentNames ?? [])
    // The one transition the other side cannot observe: it knows a boot was
    // asked for, not that an engine now exists.
    s.scope.postMessage({ type: "state", status: "idle" })
    return { name: s.engine.name, description: s.engine.description }
  },
  async invoke(s, p) {
    const answer = await built(s).invoke(String(p.input ?? ""))
    // The transcript rides back with the answer. `messages` cannot be a live
    // view across a worker — R3's rule holds within one realm, and this is two
    // — so the far side is refreshed at the only moment it changes.
    return { answer, messages: built(s).messages }
  },
  async messages(s) {
    return { messages: built(s).messages }
  },
  async attach(s, p) {
    const peers = (p.peers ?? []).map((/** @type {any} */ peer) => remote(s, peer))
    if (p.role === "tools") built(s).addTools(...peers)
    else built(s)[String(p.role)] = peers[0] ?? null
    return {}
  },
  async close(s) {
    if (s.engine) await s.engine.close()
    s.engine = null
    return {}
  },
}

/** @param {Session} s @param {any} m */
async function answer(s, m) {
  const handler = HANDLERS[m.type]
  if (!handler) return s.scope.postMessage({ id: m.id, ok: false, error: `unknown call '${m.type}'` })
  try {
    s.scope.postMessage({ id: m.id, ok: true, result: await handler(s, m) })
  } catch (e) {
    s.log.error(`${m.type} failed: ${why(e)}`)
    s.scope.postMessage({ id: m.id, ok: false, error: why(e) })
  }
}

/** Serve one agent on this worker. The inside half. `scope` is the worker's own
 * global, passed in rather than read off `self`, which the core may not touch.
 * @param {WorkerScope} scope @param {{ loadAgent: LoadAgent, log?: Log }} deps @returns {void} */
export function serve(scope, { loadAgent, log = SILENT }) {
  /** @type {Session} */
  const s = { scope, loadAgent, log, engine: null, outbound: new Map(), counter: 0 }
  scope.addEventListener("message", (event) => {
    const m = event?.data
    if (!m || typeof m !== "object") return
    if (m.type === "peerResult") settle(s.outbound, m)
    else void answer(s, m)
  })
}
