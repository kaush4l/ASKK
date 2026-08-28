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

/**
 * The turn, as the page renders it: what has arrived, how much of it, and how
 * it ended.
 *
 * **`text` is the concatenation of the deltas and nothing else.** It is not the
 * `answer` from `turn/done`, and the difference is the whole increment: if the
 * page showed the answer it would render once, at the end, and a stream that
 * had collapsed into buffer-then-chop would look identical. `deltas` is here
 * for the same reason — one chunk and forty chunks must be distinguishable from
 * outside, or no check can tell streaming from arriving.
 *
 * `status` carries §6.3's three distinct terminals. `aborted` is not `failed`:
 * one of them is the operator's decision.
 */
export interface TurnView {
  turnId: string
  status: 'streaming' | 'stopping' | 'done' | 'aborted' | 'failed'
  text: string
  deltas: number
  /** The answer, the failure's own sentence, or empty while it streams. */
  detail: string
  ms: number
}

/** Everything the page knows. Eleven messages' worth, today. */
export interface EngineView {
  boot: BootState
  probe: ProbeResult | null
  failure: string | null
  turn: TurnView | null
}

let view: EngineView = { boot: { kind: 'starting' }, probe: null, failure: null, turn: null }
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
    case 'turn/started':
      view = { ...view, turn: { turnId: message.turnId, status: 'streaming', text: '', deltas: 0, detail: '', ms: 0 } }
      break
    case 'turn/delta':
      view = { ...view, turn: grown(view.turn, message.turnId, message.text) }
      break
    case 'turn/abort:ok':
      view = { ...view, turn: ended(view.turn, message.turnId, 'stopping', '', 0) }
      break
    case 'turn/aborted':
      view = { ...view, turn: ended(view.turn, message.turnId, 'aborted', '', message.ms) }
      break
    case 'turn/done':
      view = { ...view, turn: ended(view.turn, message.turnId, 'done', message.answer, message.ms) }
      break
    case 'turn/failed':
      view = { ...view, turn: ended(view.turn, message.turnId, 'failed', message.message, 0) }
      break
    case 'failed':
      view = { ...view, failure: message.message }
      break
  }
  for (const notify of watchers) notify()
}

/**
 * One more partial. The text grows by exactly what arrived and the count grows
 * by one — the count is what makes "it streamed" and "it arrived" different
 * facts to anything reading this from outside.
 *
 * An event for a turn this page is not showing is dropped rather than merged.
 * There is one live turn per realm (§7.5), so the only way to see one is a
 * message that outlived its turn, and appending it would put one turn's words
 * inside another's.
 */
function grown(turn: TurnView | null, turnId: string, text: string): TurnView | null {
  if (turn === null || turn.turnId !== turnId) return turn
  return { ...turn, text: turn.text + text, deltas: turn.deltas + 1 }
}

/** How it ended, keeping every delta that arrived on the way there. */
function ended(turn: TurnView | null, turnId: string, status: TurnView['status'], detail: string, ms: number): TurnView | null {
  if (turn === null || turn.turnId !== turnId) return turn
  return { ...turn, status, detail: detail === '' ? turn.detail : detail, ms: ms === 0 ? turn.ms : ms }
}
