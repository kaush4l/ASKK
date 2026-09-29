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
    if (!['workspace.artifact', 'workspace.command', 'workspace.commands'].includes(check.capability)) fail(`unsupported check capability: ${String(check.capability)}`)
    if (seen.has(check.capability)) fail(`duplicate check: ${check.capability}`)
    seen.add(check.capability)
    const options = check.options ?? {}
    if (check.capability === 'workspace.commands') {
      keys(options, ['commands', 'requireFresh'], 'workspace.commands options')
      if (!Array.isArray(options.commands) || !options.commands.length || options.commands.length > 16) fail('commands must contain 1–16 exact command strings')
      const commands = Array.from(options.commands)
      if (commands.some(command => typeof command !== 'string' || !command.trim() || command.length > 8192 || command.includes('\0'))) fail('each command must be a nonempty string of at most 8192 characters without NUL')
      if (new Set(commands).size !== commands.length) fail('commands must be unique')
      if (Object.hasOwn(options, 'requireFresh') && options.requireFresh !== true) fail('workspace.commands requires fresh evidence')
      return { capability: check.capability, options: { commands, requireFresh: true } }
    }
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
