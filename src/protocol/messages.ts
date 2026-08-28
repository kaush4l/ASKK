/**
 * The message vocabulary. **One list** (ARCHITECTURE.md §6.1): every request
 * names its reply in `REPLY_OF`, and the two unions are read against that map
 * by `checks/protocol.ts` — which enumerates their members from the *type
 * declarations* below, never by grepping the strings out of this file. Grep
 * them and rule 1 compares this file to itself.
 *
 * **Eleven messages, not twenty-four, and that is still the decision.** §6.2
 * and §6.3 table twenty-four. 3.2 shipped seven; 3.3 adds the four that carry a
 * turn — `turn/start`/`turn/started`, `turn/abort`/`turn/abort:ok` — and the
 * four terminals and partials a turn produces. The thirteen that remain have no
 * sender, no receiver or neither until the database (3.4), the tools (4.2/4.3)
 * or the flow table (4.5) exists. This project's recurring, three-times-recorded
 * defect is a rich union of which two members are ever sent, green because the
 * check only reads the declaration. Every member here is emitted by real code,
 * crosses a real `postMessage`, and is asserted on the side that received it.
 * The rest arrive with the thing that sends them. What is deferred, and to
 * where, is in `PROGRESS.md`'s 3.2 and 3.3 entries.
 *
 * **Deferred at 3.3, by name, each to the thing that gives it a sender:**
 * `turn/phase` and `turn/retry` need a loop that comes round more than once,
 * which needs tools (4.2); `turn/tool` needs the toolbox itself; `turn/message`
 * carries the `seq` the store allocates (3.4); `turn/prompt` and `turn/request`
 * carry the breakdown and the request record to surfaces DESIGN §4.3 and §4.4
 * put at 6.x. Each is emitted by a callback the core already fires
 * (`core/observer.ts`), so none of them is blocked on the core.
 *
 * This file holds no behaviour: no `function`, no `class`, no `let`, no `var`,
 * no `new`, and every exported value is `as const`. §2 rests the whole realm
 * split on that, and `checks/protocol.ts` rule 4 is what holds it.
 */

import type { Endpoint, ProbeResult } from '@/protocol/shapes'

/**
 * The one map pairing a request with its reply. Read at runtime by
 * `client/worker-client.ts`, which refuses a reply of the wrong type rather
 * than handing the caller a message it did not ask for, and at type level by
 * `ReplyTo<T>` below — so a row that is wrong is wrong in the compiler, in the
 * check, and in the running page, rather than in a table nobody executes.
 */
export const REPLY_OF = {
  boot: 'ready',
  'config/probe': 'config/probed',
  'turn/start': 'turn/started',
  'turn/abort': 'turn/abort:ok',
} as const

/**
 * The members of `FromEngine` that are **not** the reply to any request:
 * `failed` is the universal alternative reply to any of them (§6.1) and
 * `fatal` may arrive at any moment instead of anything. `checks/protocol.ts`
 * rule 1 reads this beside `REPLY_OF` — the two together are the closed
 * universe both unions are held to.
 */
export const UNSOLICITED = ['failed', 'fatal', 'turn/delta', 'turn/done', 'turn/aborted', 'turn/failed'] as const

/** Why the engine cannot continue. `storage-blocked` and `schema` arrive with the database at 3.4. */
export type FatalReason = 'another-tab' | 'internal'

/** Main → worker. Every member is constructed under `src/client/**` and handled in `engine/host.ts`. */
export type ToEngine =
  | { type: 'boot' }
  | { type: 'config/probe'; baseUrl: string; apiKey?: string }
  | { type: 'turn/start'; text: string; endpoint: Endpoint }
  | { type: 'turn/abort'; turnId: string }

/**
 * Worker → main. Every member is constructed under `src/engine/**` — except
 * the one case §6.5 assigns to the main side, a worker that died or never
 * answered, which `worker-client.ts` reports as `fatal { reason: 'internal' }`
 * because a dead worker's replies are never coming and pretending otherwise
 * hangs the page forever.
 */
export type FromEngine =
  | { type: 'ready'; id: number; mark: string; schemaVersion: number }
  | { type: 'config/probed'; id: number; result: ProbeResult }
  | { type: 'turn/started'; id: number; turnId: string }
  | { type: 'turn/abort:ok'; id: number; turnId: string }
  | { type: 'turn/delta'; turnId: string; seq: number; text: string }
  | { type: 'turn/done'; turnId: string; answer: string; rounds: number; ms: number }
  | { type: 'turn/aborted'; turnId: string; ms: number }
  | { type: 'turn/failed'; turnId: string; message: string }
  | { type: 'failed'; id: number; message: string }
  | { type: 'fatal'; reason: FatalReason; message: string }

/**
 * A request on the wire. The `id` is the client's, assigned in one place —
 * `worker-client.ts` — so no caller can invent one and no two callers can
 * collide. `ToEngine` itself carries no `id` for the same reason: a message an
 * action builds is not yet a message, and cannot be posted by accident.
 */
export type Request = ToEngine & { id: number }

/** The reply a given request gets, derived from `REPLY_OF` so the two cannot drift. */
export type ReplyTo<T extends ToEngine> = Extract<FromEngine, { type: (typeof REPLY_OF)[T['type']] }>

/**
 * What structured clone can carry (§6.4), as a type. `ArrayBuffer` is absent
 * until something sends one, and `Date` is absent because §7.1 rules every
 * timestamp a `number`.
 */
type Cloneable =
  | undefined
  | null
  | boolean
  | number
  | string
  | readonly Cloneable[]
  | { readonly [key: string]: Cloneable }

/**
 * The two unions, proved cloneable **at declaration time**. A payload holding
 * a class instance, a function, an `Error` or a `Date` fails `tsc` here, in the
 * file that declares it — rather than at runtime in a worker, where a
 * `DataCloneError` is a page that stopped for a reason the log does not name.
 * Exported because it is a claim, and a claim nothing can read is a comment.
 */
export type WireIsCloneable = [Assert<ToEngine>, Assert<FromEngine>]
type Assert<T extends Cloneable> = T
