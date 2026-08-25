/**
 * Capabilities (I6: default deny). A module receives nothing it was not
 * granted, and a secret never enters a module's environment — which is
 * structural here, because no capability below carries a credential: the
 * brokered ports attach those, downstream of every grant.
 * @module
 */

/**
 * @typedef {(
 *   'clock'|'rng'|'emit'|'kv'|'blob'|'model'|'net'|'agents'|'workspace'|'space'
 * )} CapabilityId
 */

/** @type {readonly CapabilityId[]} */
export const CAPABILITIES = /** @type {const} */ ([
  'clock', 'rng', 'emit', 'kv', 'blob', 'model', 'net', 'agents', 'workspace', 'space',
])

/** One sentence per capability — what granting it actually lets a module do. */
export const CAPABILITY_SENTENCE = /** @type {Record<CapabilityId, string>} */ ({
  clock: 'read the current time',
  rng: 'draw random bytes',
  emit: 'record facts in the log',
  kv: 'read and write its own key/value storage',
  blob: 'read and write its own large files',
  model: 'call the configured model endpoint',
  net: 'fetch from an allowlisted endpoint',
  agents: 'delegate a goal to another agent',
  workspace: 'run commands in the workspace',
  space: 'read and write the shared space',
})

/** @typedef {{module: string, granted: CapabilityId[]}} CapabilityGrant */

/** Whether a grant covers a capability. The one authorization question. */
export function grants(/** @type {CapabilityGrant} */ grant, /** @type {CapabilityId} */ id) {
  return grant.granted.includes(id)
}

/**
 * The grant a module ACTUALLY gets: the intersection of what it asked for and
 * what this build can offer. Narrowing here and nowhere else is what makes
 * "default deny" true by construction rather than by discipline.
 * @param {string} module
 * @param {readonly CapabilityId[]} requested
 * @param {readonly CapabilityId[]} available
 * @returns {CapabilityGrant}
 */
export function effectiveGrant(module, requested, available) {
  return { module, granted: requested.filter((id) => available.includes(id)) }
}
