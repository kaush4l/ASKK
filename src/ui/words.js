/**
 * The words on screen (UX U2, U5.2, U11.4), defined once.
 */

export const ACTIVE = new Set(['thinking', 'calling', 'waiting', 'compacting'])
export const FINISHED = new Set(['done', 'failed', 'interrupted'])

export const isActive = (slot) => Boolean(slot && ACTIVE.has(slot.status))

/** The name of a call: the text before its first `(`. */
export const callName = (text) => String(text ?? '').split('(')[0].trim()

/** `current` is "call text +n": the call now running and how many more the stage runs. */
export function splitCurrent(current) {
  const match = /^(.*?)(?: \+(\d+))?$/s.exec(String(current ?? ''))
  return { call: match?.[1] ?? '', more: Number(match?.[2] ?? 0) }
}

/** Circling: repeats ≥ 2, shown as `same call ×n` with n = repeats + 1. */
export const circling = (slot) => (slot?.repeats ?? 0) >= 2 && isActive(slot)
export const circlingWords = (slot) => `same call ×${(slot?.repeats ?? 0) + 1}`

const VERBS = {
  host_exec: 'Ran a command on your machine',
  host_read: 'Read a file on your machine',
  host_write: 'Wrote a file on your machine',
  host_list: 'Listed a folder on your machine',
  host_fetch: 'Fetched a page through the bridge',
  board_post: 'Posted to the board',
  board_resolve: 'Resolved a board entry',
  board_tell: 'Left a note for another run',
  board_list: 'Read the board',
  skill: 'Loaded a skill',
}

/** A work line's verb, from the call's name only, never its arguments. */
export function verb(name, { agent = null } = {}) {
  if (agent) return `Asked ${agent}`
  return VERBS[name] ?? `Called ${name}`
}

/** The dot and the word colour for a status (U11.4). `awaiting` = waiting on the owner. */
export function mark(status, { awaiting = false } = {}) {
  if (awaiting) return { dot: 'ring-bad', word: 'waiting on you', tone: 'bad' }
  switch (status) {
    case 'thinking':
    case 'calling':
    case 'compacting':
      return { dot: 'pulse', word: status, tone: 'text' }
    case 'waiting':
      return { dot: 'ring', word: 'waiting', tone: 'text' }
    case 'done':
      return { dot: 'ring-dim', word: 'done', tone: 'dim' }
    case 'failed':
      return { dot: 'bad', word: 'failed', tone: 'bad' }
    case 'interrupted':
      return { dot: 'ring-bad', word: 'interrupted', tone: 'dim' }
    default:
      return { dot: null, word: status || 'idle', tone: 'faint' }
  }
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
