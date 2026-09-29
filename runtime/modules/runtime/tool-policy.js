import { decide } from '../core/permissions.js'

const KEYS = ['disabledTools', 'approvalRisks', 'allowDelegation']
const APPROVAL_RISKS = new Set(['read', 'net', 'write', 'exec'])

/** A run policy only restricts existing permissions. Undefined preserves the legacy policy. */
export function normalizeToolPolicy(value) {
  if (value === undefined) return null
  const invalid = reason => { throw new TypeError(`Invalid run tool policy: ${reason}`) }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== KEYS.length || KEYS.some(key => !Object.hasOwn(value, key))) invalid('expected disabledTools, approvalRisks and allowDelegation')
  if (!Array.isArray(value.disabledTools) || value.disabledTools.length > 256 || [...value.disabledTools].some(name => typeof name !== 'string' || !name.length || name.length > 128 || name !== name.trim() || /[\u0000-\u001f\u007f]/.test(name))) invalid('disabledTools must contain at most 256 nonempty tool names of at most 128 characters')
  if (!Array.isArray(value.approvalRisks) || value.approvalRisks.length > 4 || [...value.approvalRisks].some(risk => !APPROVAL_RISKS.has(risk))) invalid('approvalRisks must contain only read, net, write or exec')
  if (typeof value.allowDelegation !== 'boolean') invalid('allowDelegation must be a boolean')
  return Object.freeze({ disabledTools: Object.freeze([...new Set(value.disabledTools)]), approvalRisks: Object.freeze([...new Set(value.approvalRisks)]), allowDelegation: value.allowDelegation })
}

export function toolSelected(item, toolPolicy) {
  return !toolPolicy || (!toolPolicy.disabledTools.includes(item.name) && (item.tier !== 'agent' || toolPolicy.allowDelegation))
}

export function scopedToolDecision(item, args, { toolPolicy = null, ...options } = {}) {
  const verdict = decide(item, args, options)
  if (verdict.action === 'deny') return verdict
  if (!toolSelected(item, toolPolicy)) return { ...verdict, action: 'deny', reason: item.tier === 'agent' && !toolPolicy.allowDelegation ? 'delegation is disabled for this run' : `${item.name} is disabled for this run` }
  if (toolPolicy?.approvalRisks.includes(verdict.risk)) return { ...verdict, action: 'ask', reason: `this run requires approval for ${verdict.risk} tools` }
  return verdict
}

/** Capabilities are advertised by the paired endpoint; an unknown requirement is unavailable. */
export function hasToolRequirement(requirement, host) {
  if (requirement === 'host') return Boolean(host)
  if (requirement === 'host:legacy-bridge') return host?.name === 'harness-bridge'
  if (typeof requirement === 'string' && requirement.startsWith('host:')) return Boolean(host?.capabilities?.includes(requirement.slice(5)))
  return false
}
