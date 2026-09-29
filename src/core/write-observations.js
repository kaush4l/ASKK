const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
const fail = message => { throw Object.assign(new TypeError(`Invalid workspace write observation: ${message}`), { code: 'WRITE_OBSERVATION' }) }
const revision = value => typeof value === 'string' ? Boolean(value.trim()) : Number.isSafeInteger(value) && value >= 0
const pathValid = path => typeof path === 'string' && Boolean(path.trim()) && !path.includes('\0') && !path.includes('\\') && !path.startsWith('/') && path.split('/').every(part => part && part !== '.' && part !== '..')
const own = (value, key) => Object.hasOwn(value, key)

/** Trusted read receipts only; never reconstruct this ledger from conversation text. */
export function createWriteObservations() {
  const records = new Map(), latest = new Map()
  return {
    accept(path, receipt) {
      const reference = receipt?.writeObservation
      const validContent = receipt?.found === false ? receipt.content === null && receipt.rev === 0 : typeof receipt?.content === 'string' && (receipt.found === undefined || receipt.found === true)
      if (!pathValid(path) || !plain(receipt) || receipt.ok === false || receipt.conflict || !validContent || !revision(receipt.rev) || !plain(reference) || typeof reference.id !== 'string' || !reference.id.trim() || reference.path !== path || reference.revision !== receipt.rev) fail('expected a successful explicit read with matching path and revision')
      const previous = records.get(reference.id)
      if (previous && (previous.path !== path || previous.revision !== receipt.rev)) fail('observation identity cannot be reassigned')
      const record = Object.freeze({ id: reference.id, path, revision: receipt.rev })
      records.set(record.id, record); latest.set(path, record)
      return record
    },
    resolve(args, { resolved = false } = {}) {
      const keys = resolved ? ['path', 'content', 'expect', 'observed', 'observationId'] : ['path', 'content', 'expect', 'observed']
      if (!plain(args) || Reflect.ownKeys(args).some(key => !keys.includes(key)) || !pathValid(args.path) || typeof args.content !== 'string') fail('expected a relative file path and literal content')
      const hasExpect = own(args, 'expect'), hasObserved = own(args, 'observed')
      if (hasObserved && args.observed !== true) fail('observed must be true')
      if (!hasObserved) {
        if (!hasExpect || !revision(args.expect) || own(args, 'observationId')) fail('supply expect or observed:true')
        return Object.freeze({ path: args.path, content: args.content, expect: args.expect })
      }
      if (!resolved && hasExpect) fail('supply exactly one of expect or observed:true')
      const record = resolved ? records.get(args.observationId) : latest.get(args.path)
      if (!record || record.path !== args.path) fail('read this file in the current run before using observed:true')
      if (resolved && (!hasExpect || args.expect !== record.revision || args.observationId !== record.id)) fail('resolved revision does not match its read observation')
      return Object.freeze({ path: args.path, content: args.content, observed: true, expect: record.revision, observationId: record.id })
    },
    invalidate(path) {
      latest.delete(path)
      for (const [id, record] of records) if (record.path === path) records.delete(id)
    },
  }
}

/** Adapter-side provenance, scoped to the actual run object and execution identity. */
export function createObservedWorkspace({ read, write, identity }) {
  const runs = new WeakMap()
  const scope = run => {
    if (!run || typeof run !== 'object') fail('a run is required')
    const current = identity()
    if (typeof current !== 'string' || !current.trim()) fail('execution identity is unavailable')
    let state = runs.get(run)
    if (!state) { state = { identity: current, observations: createWriteObservations() }; runs.set(run, state) }
    if (state.identity !== current) fail('execution identity changed; start a new run and read again')
    return state
  }
  return {
    async read(args, run) {
      const state = scope(run)
      if (!pathValid(args?.path)) fail('expected a relative file path')
      try {
        const receipt = await read(args, run)
        scope(run)
        const absent = receipt === null
        if (!absent && (!receipt || receipt.ok === false || receipt.conflict || typeof receipt.content !== 'string')) { state.observations.invalidate(args.path); return receipt }
        if (!absent && receipt.found !== undefined && receipt.found !== true) fail('contradictory file presence in read receipt')
        const rev = absent ? 0 : receipt.rev ?? receipt.revision
        const result = { ...(absent ? { path: args.path, found: false, content: null } : { ...receipt, found: true }), rev, writeObservation: Object.freeze({ id: crypto.randomUUID(), path: args.path, revision: rev }) }
        state.observations.accept(args.path, result)
        return result
      } catch (error) { state.observations.invalidate(args.path); throw error }
    },
    async write(args, run) {
      let state = runs.get(run)
      try {
        let concrete = args
        if (own(args, 'observed') || own(args, 'observationId')) {
          state = scope(run)
          concrete = state.observations.resolve(args, { resolved: true })
        }
        const receipt = await write(concrete, run)
        if (receipt?.conflict || receipt?.ok === false) state?.observations.invalidate(args.path)
        return receipt
      } catch (error) { state?.observations.invalidate(args?.path); throw error }
    },
  }
}
