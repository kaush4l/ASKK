/**
 * What an agent is doing, as a closed vocabulary. The board is the fold of
 * AgentStatus facts over the log (I8) — never a table written directly.
 * @module
 */

/** @typedef {'idle'|'thinking'|'calling'|'waiting'|'failed'|'stopped'} Status */

/** @type {readonly Status[]} */
export const STATUSES = /** @type {const} */ ([
  'idle', 'thinking', 'calling', 'waiting', 'failed', 'stopped',
])

/** Whether a status means the agent is mid-turn. One definition, everywhere. */
export function isBusy(/** @type {Status} */ status) {
  return status === 'thinking' || status === 'calling' || status === 'waiting'
}

/** Human sentence for a status; the UI never invents its own wording. */
export function statusSentence(/** @type {Status} */ status) {
  switch (status) {
    case 'idle': return 'ready'
    case 'thinking': return 'thinking'
    case 'calling': return 'running a tool'
    case 'waiting': return 'waiting on another agent'
    case 'failed': return 'stopped by a failure'
    case 'stopped': return 'stopped'
  }
}
