/**
 * The WIRE vocabulary (ARCHITECTURE.md §7.4). Declared here, never imported
 * from `core`: `client → protocol` is a value import, so `protocol → core`
 * would make `client → protocol → core` a runtime path and put the core in the
 * main bundle. Types only — this file emits nothing.
 *
 * §4 lists twelve shapes here. **One exists**, because eleven of them mirror
 * storage records that arrive with the database at 3.4 and a shape with no
 * writer and no reader is the declared-but-never-emitted defect one level down
 * from a message. They arrive with the records they mirror.
 */

/**
 * What a probe learned. Four outcomes, and §6.2's fifth — `cors` — is
 * deliberately **not** here.
 *
 * §6.2 rules the closed union `'ok' | 'refused' | 'cors' | 'http' | 'timeout'`
 * and rules the refused/CORS distinction load-bearing, because they have
 * different remedies and only one of them is the user's fault. In a browser
 * both arrive as an identical `TypeError`; separating them takes a second
 * `mode: 'no-cors'` fetch, whose *opaque success* is what proves the server was
 * reachable and the browser did the blocking. That code is four lines. The
 * problem is proving it: a CORS block cannot be produced in Bun (its `fetch`
 * enforces no origin policy), and in the browser check it needs a cross-origin
 * host that is reachable from **both** the local subpath server and the
 * deployed https origin — which loopback is not, under mixed content.
 *
 * So this build reports what it measured. `unreachable` is *"the request never
 * reached a server this page can read"*, which is true of both; calling it
 * `refused` would be a label claiming a fact nothing established. DESIGN §4.1's
 * Door lands at 6.5, its browser check runs against the local server where the
 * `localhost`/`127.0.0.1` pair **is** a real cross-origin, and the split
 * belongs there.
 */
export type ProbeOutcome = 'ok' | 'http' | 'timeout' | 'unreachable'

/**
 * `elapsedMs` is what DESIGN §4.1's Loading state prints instead of a spinner,
 * and `detail` is the sentence a person reads when the outcome alone is not
 * enough. Declared as a type alias and not an `interface` on purpose: an
 * interface has no implicit index signature, so it cannot satisfy the
 * structured-clone constraint `messages.ts` checks every payload against.
 */
export type ProbeResult = {
  outcome: ProbeOutcome
  models: readonly string[]
  elapsedMs: number
  detail: string
}

/**
 * Where the model is, as the page knows it.
 *
 * **This crosses on `turn/start`, and §6.2 does not list it there.** It is on
 * the message because at 3.3 there is nowhere else for it to be: the config
 * store is `engine/stores/config.ts` `[3.4]`, and §6.6's `configured === true`
 * precondition is a read of that store. A resident that invented a default
 * endpoint would be answering with a server nobody named. When 3.4 lands, the
 * endpoint is read from the store by the worker and this field goes with the
 * increment that makes `configured` computable — `PLAN.md`'s 3.3 obligation
 * already names that pairing for `boot.seedBaseUrl` and `ready.configured`.
 *
 * `apiKey` crosses **outward only**. §7.2's rule is that a key never comes back
 * to the render realm, not that the realm may not send one; the main realm
 * cannot fetch, so a key the user typed has no other route to the socket.
 */
export type Endpoint = {
  baseUrl: string
  apiKey?: string
  model: string
}
