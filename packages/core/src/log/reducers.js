/**
 * PROJECTIONS ARE REGISTERED REDUCERS, FOLDED ONCE PER FACT.
 *
 * The Rust rebuilt every view from `app.log.iter()` on every request and
 * `dispatch.rs:108` cloned the whole history into the handler's context, so a
 * request cost O(history) and a session cost O(history²) with four panes
 * polling. A fold that runs at APPEND time costs O(1) per fact forever, and it
 * is the only shape a snapshot can be taken of (I20).
 *
 * A reducer carries a VERSION because its state is persisted. Change what a
 * reducer computes without moving the number and boot restores yesterday's
 * meaning under today's name — a bug that survives a refresh and reads as
 * corrupt data. Move it, and every snapshot holding the old number is refused
 * and replayed from a segment boundary.
 * @module
 */

import { LogError } from '../errors.js'

/** @typedef {import('@harness/kernel').Event} Event */

/**
 * One projection. `any` for the state, with the reason: this registry holds
 * reducers over DIFFERENT state types at once and JavaScript has no way to say
 * "some type" — each reducer's own definition site stays honestly typed.
 *
 * State is persisted as JSON — it must round-trip, and `snapshot()` hands out a
 * SHALLOW copy that is serialised immediately, so a fold may mutate its own
 * state but nothing may hold the copy.
 * @typedef {{name: string, version: number, init: () => any, fold: (state: any, event: Event) => any}} Reducer
 */

/** @typedef {{seq: number, reducerVersions: Record<string, number>, state: Record<string, unknown>}} Snapshot */

/** @typedef {ReturnType<typeof createProjections>} Projections */

/**
 * The live fold. `seq` is the first fact NOT yet folded in, so it doubles as
 * the cursor a snapshot is taken at and the point a replay resumes from.
 * @param {Reducer[]} reducers
 * @param {Snapshot|null} [restored] a snapshot whose versions already matched
 */
export function createProjections(reducers, restored = null) {
  /** @type {Record<string, unknown>} */
  const state = restored
    ? { ...restored.state }
    : Object.fromEntries(reducers.map((r) => [r.name, r.init()]))
  let seq = restored ? restored.seq : 0
  return {
    get seq() {
      return seq
    },
    /** Fold one fact into every projection. The whole cost of a fact, forever. */
    apply(/** @type {Event} */ event) {
      for (const r of reducers) state[r.name] = r.fold(state[r.name], event)
      seq = event.seq + 1
    },
    /**
     * One projection's state. Throws on a name nobody registered rather than
     * answering `undefined`, because a view rendered from `undefined` is a view
     * that looks empty instead of looking broken.
     */
    read(/** @type {string} */ name) {
      if (!(name in state)) {
        throw new LogError('unknown_projection', `no reducer named ${name} is registered`, {
          detail: `registered: ${reducers.map((r) => r.name).join(', ') || 'none'}`,
        })
      }
      return state[name]
    },
    /** @returns {Snapshot} */
    snapshot() {
      return { seq, reducerVersions: versionsOf(reducers), state: { ...state } }
    },
  }
}

/**
 * The snapshot as the bytes that will be stored. A projection holding a `Set`,
 * a `Map` or a `Date` does not survive `JSON.parse`: the `Set` restores as
 * `{}`, the `Date` as a string, `snapshotMatches` accepts either because the
 * VERSIONS agree, and a pane then renders a projection that is wrong with
 * nothing anywhere saying so. Refuse it at the write, naming the reducer,
 * rather than at whichever boot happens to trip over it first.
 *
 * The check reads `this[key]` and not `value`, because `JSON.stringify` calls
 * `toJSON` before the replacer — a `Date` reaches the replacer already
 * disguised as the string that will not come back as a `Date`.
 * @param {Snapshot} snapshot
 * @returns {string}
 */
export function serialiseSnapshot(snapshot) {
  let owner = ''
  return JSON.stringify(snapshot, /** @this {Record<string, unknown>} */ function (key, value) {
    if (this === snapshot.state) owner = key
    const raw = this[key]
    if (!isJsonish(raw)) {
      throw new LogError('unserialisable_projection', `the ${owner} projection cannot be persisted`, {
        detail: `${owner}${this === snapshot.state ? '' : `.${key}`} is ${describe(raw)}, which does not survive JSON`,
      })
    }
    return value
  })
}

/** What JSON carries back unchanged. Anything else restores as something else. */
function isJsonish(/** @type {unknown} */ raw) {
  if (raw === null || Array.isArray(raw)) return true
  const type = typeof raw
  if (type === 'string' || type === 'number' || type === 'boolean') return true
  if (type !== 'object') return false
  const proto = Object.getPrototypeOf(raw)
  return proto === Object.prototype || proto === null
}

/** The value's kind, for the person reading the refusal. */
function describe(/** @type {unknown} */ raw) {
  if (raw === undefined) return 'undefined'
  const name = Object.getPrototypeOf(raw)?.constructor?.name
  return typeof name === 'string' ? `a ${name}` : typeof raw
}

/** @param {Reducer[]} reducers @returns {Record<string, number>} */
export function versionsOf(reducers) {
  return Object.fromEntries(reducers.map((r) => [r.name, r.version]))
}

/**
 * Whether a stored snapshot still means what this build means. ALL of them or
 * none: one reducer's state going stale would leave the others correct, but
 * mixing a fresh fold with a stale one produces a history no single build ever
 * held, and no view could say which half it was reading.
 * @param {Reducer[]} reducers
 * @param {Snapshot} snapshot
 */
export function snapshotMatches(reducers, snapshot) {
  const want = versionsOf(reducers)
  const have = snapshot.reducerVersions
  const names = new Set([...Object.keys(want), ...Object.keys(have)])
  return [...names].every((n) => want[n] === have[n])
}

/** Read a snapshot record back, or say why it is not one. @returns {Snapshot|string} */
export function readSnapshot(/** @type {string} */ text) {
  /** @type {unknown} */
  let value
  try {
    value = JSON.parse(text)
  } catch {
    return 'the snapshot is not readable JSON'
  }
  if (!value || typeof value !== 'object') return 'the snapshot is not an object'
  const snap = /** @type {Partial<Snapshot>} */ (value)
  if (typeof snap.seq !== 'number' || !snap.reducerVersions || !snap.state) {
    return 'the snapshot is missing seq, reducerVersions or state'
  }
  return { seq: snap.seq, reducerVersions: snap.reducerVersions, state: snap.state }
}
