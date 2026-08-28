// REALM: main
/**
 * The render-shaped mirror (§4). **One switch over every `FromEngine` type**,
 * and `checks/protocol.ts` rule 3 fails on a member whose case is missing, or
 * whose case does not write the view from the message — an empty case, or a
 * type string sitting in a comment, is what the previous formulation of that
 * rule was satisfied by.
 *
 * This is the read side and it computes nothing (§3.3): every field below is
 * something the engine said, kept in the shape React renders. The view is
 * replaced rather than mutated because `useSyncExternalStore` decides "changed"
 * by identity, and a store that mutates in place renders once and then never
 * again — which is a page that rendered and did nothing.
 */

import { start, subscribe } from '@/client/worker-client'
import type { FromEngine } from '@/protocol/messages'
import type { ProbeResult } from '@/protocol/shapes'

/**
 * How boot ended, or that it has not. `scripts/verify-worker.ts` reads this
 * object out of the DOM, so `kind` and `reason` are a contract with a check.
 */
export type BootState =
  | { kind: 'starting' }
  | { kind: 'ready'; mark: string; schemaVersion: number }
  | { kind: 'fatal'; reason: string; message: string }

/** Everything the page knows. Four messages' worth, today. */
export interface EngineView {
  boot: BootState
  probe: ProbeResult | null
  failure: string | null
}

let view: EngineView = { boot: { kind: 'starting' }, probe: null, failure: null }
const watchers = new Set<() => void>()
let connected = false

/** The current view. Stable between messages, so `useSyncExternalStore` may hold it. */
export function snapshot(): EngineView {
  return view
}

export function watch(notify: () => void): () => void {
  watchers.add(notify)
  return () => watchers.delete(notify)
}

/**
 * Start the engine and mirror what it says. Called from the page's mount
 * effect and never at module scope: `new Worker` during Next's prerender is a
 * build that fails on a browser global.
 */
export function connect(): void {
  if (connected) return
  connected = true
  subscribe(receive)
  start()
}

/**
 * THE mirror. Exported because `tests/protocol.test.ts` asserts receipt by
 * driving the real switch with a real message, rather than asserting that the
 * engine sent one and hoping.
 */
export function receive(message: FromEngine): void {
  switch (message.type) {
    case 'ready':
      view = { ...view, boot: { kind: 'ready', mark: message.mark, schemaVersion: message.schemaVersion } }
      break
    case 'fatal':
      view = { ...view, boot: { kind: 'fatal', reason: message.reason, message: message.message } }
      break
    case 'config/probed':
      view = { ...view, probe: message.result, failure: null }
      break
    case 'failed':
      view = { ...view, failure: message.message }
      break
  }
  for (const notify of watchers) notify()
}
