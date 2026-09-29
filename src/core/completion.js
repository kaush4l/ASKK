/** Declarative completion requirements. Implementations remain trusted desk adapters. */
import { snapshot } from './prompt.js'

const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)))
const fail = message => { throw Object.assign(new TypeError(`Invalid completion contract: ${message}`), { code: 'COMPLETION_CONTRACT' }) }
const keys = (value, allowed, name) => { if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(`${name} has unsupported fields`) }
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) } return value }

export function normalizeCompletion(value) {
  keys(value, ['checks'], 'completion')
  if (!Array.isArray(value.checks) || value.checks.length > 16) fail('checks must contain at most 16 named capabilities')
  const seen = new Set()
  const checks = Array.from(value.checks).map(check => {
    keys(check, ['capability', 'options'], 'check')
    if (!['workspace.artifact', 'workspace.command'].includes(check.capability)) fail(`unsupported check capability: ${String(check.capability)}`)
    if (seen.has(check.capability)) fail(`duplicate check: ${check.capability}`)
    seen.add(check.capability)
    const options = check.options ?? {}
    const defaults = check.capability === 'workspace.command' ? { requireFresh: true } : { requireFresh: true, requireInteraction: true }
    keys(options, Object.keys(defaults), `${check.capability} options`)
    for (const [name, value] of Object.entries(options)) if (typeof value !== 'boolean') fail(`${name} must be boolean`)
    return { capability: check.capability, options: { ...defaults, ...options } }
  })
  return freeze({ checks })
}

export const LEGACY_ARTIFACT_COMPLETION = normalizeCompletion({ checks: [{ capability: 'workspace.artifact' }] })

/** Capture requirements before awaiting adapters; cancellation cannot become success. */
export async function evaluateCompletion(value, adapters = {}, { assertActive = () => {} } = {}) {
  const completion = normalizeCompletion(value)
  const selected = completion.checks.map(check => {
    const handler = Object.hasOwn(adapters, check.capability) ? adapters[check.capability] : null
    if (typeof handler !== 'function') throw new Error(`Completion capability is unavailable: ${check.capability}`)
    return { check, handler }
  })
  const checks = []
  for (const { check, handler } of selected) {
    assertActive()
    let result
    try { result = await handler(check.options) }
    catch (error) { result = { ok: false, reason: String(error?.message ?? error) } }
    assertActive()
    const ok = plain(result) && result.ok === true
    checks.push({ capability: check.capability, options: check.options, ok, evidence: snapshot(result ?? null) })
  }
  assertActive()
  const failed = checks.find(check => !check.ok)
  return snapshot({ ok: !failed, checks, reason: failed ? failed.evidence?.reason || `${failed.capability} did not pass` : checks.length ? 'All configured completion checks passed.' : 'No independent completion checks declared.' })
}
