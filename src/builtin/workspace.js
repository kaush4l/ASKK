/** Tools resolve through the task's chosen workspace/execution binding. */
import { assertArtifactManifest } from '../workspace/contracts.js'
const short = (value, limit = 2048) => value.length > limit ? `${value.slice(0, limit - 1)}…` : value
const text = value => typeof value === 'string' && Boolean(value.trim())
// Match the artifact inspector's canonical action fields. It deliberately drops
// unrelated optional keys from submitted steps, including null reload fields.
const planShape = rows => rows.map(({ action, selector, value, count }) => ({ action, ...(action !== 'reload' ? { selector } : {}), ...(['fill', 'assertText'].includes(action) ? { value } : {}), ...(action === 'assertCount' ? { count } : {}) }))

/** Check receipts are evidence, not an arbitrary object with an ok flag. */
function invalidCheck(result, submitted) {
  if (!result || typeof result !== 'object' || Array.isArray(result) || typeof result.ok !== 'boolean') return true
  const errors = Array.isArray(result.errors) && result.errors.every(text)
  if (!result.ok && result.assertions === undefined && result.results === undefined) return !(text(result.reason) || text(result.error) || errors && result.errors.length)
  const plan = result.assertions
  if (!Array.isArray(plan) || !plan.length || plan.length > 100 || !Array.isArray(submitted) || plan.some(row => !row || typeof row !== 'object') || submitted.some(row => !row || typeof row !== 'object')) return true
  if (JSON.stringify(planShape(plan)) !== JSON.stringify(planShape(submitted))) return true
  let lastAction = -1; let lastOutcome = -1; let pendingReload = false
  for (let index = 0; index < plan.length; index++) {
    const row = plan[index]
    if (!['click', 'fill', 'blur', 'assertText', 'assertCount', 'reload'].includes(row.action)) return true
    if (row.action === 'reload') { if (pendingReload || row.selector !== undefined || row.value !== undefined || row.count !== undefined) return true; pendingReload = true; continue }
    if (!text(row.selector) || row.selector.length > 1000 || ['fill', 'assertText'].includes(row.action) && (typeof row.value !== 'string' || row.value.length > 10000) || row.action === 'assertText' && !text(row.value) || row.action === 'assertCount' && (!Number.isSafeInteger(row.count) || row.count < 0 || row.count > 10000)) return true
    if (row.action === 'assertText' || row.action === 'assertCount') { lastOutcome = index; pendingReload = false }
    else { if (pendingReload) return true; lastAction = index }
  }
  if (pendingReload || lastOutcome < 0 || lastOutcome < lastAction) return true
  if (!Array.isArray(result.results) || result.results.length > plan.length || !errors) return true
  let frame = 0
  for (let index = 0; index < result.results.length; index++) {
    const row = result.results[index]
    if (plan[index].action === 'reload') frame++
    if (!row || row.index !== index || row.action !== plan[index].action || row.ok !== true || row.frame !== frame) return true
  }
  if (result.ok ? result.errors.length || result.results.length !== plan.length : !result.errors.length && !text(result.reason)) return true
  if (result.timing !== undefined && (!result.timing || typeof result.timing !== 'object' || !Number.isFinite(result.timing.budgetMs) || result.timing.budgetMs <= 0 || !Number.isFinite(result.timing.elapsedMs) || result.timing.elapsedMs < 0)) return true
  return !text(result.artifactId) || !text(result.buildId) || !Number.isSafeInteger(result.revision) || result.revision < 0 || result.interactionMode !== 'programmatic-dom' || !Number.isFinite(result.checkedAt) || result.checkedAt < 0
}

function observation(result, mode, submitted) {
  let invalid = mode === 'check' ? invalidCheck(result, submitted) : mode === 'exit' && !Number.isInteger(result?.code ?? result?.exitCode) && !result?.cancelled
  if (mode === 'write') invalid = !result || typeof result !== 'object' || Array.isArray(result) || (!result.conflict && (typeof result.ok !== 'boolean' || result.ok && !(text(result.rev) || Number.isSafeInteger(result.rev) && result.rev > 0)))
  if (mode === 'build') {
    try {
      const manifest = assertArtifactManifest(result?.manifest, { sourceRevision: result?.revision })
      invalid = result.status !== 'ready' || result.id !== manifest.id || result.revision !== manifest.sourceRevision || result.ok === false
    } catch { invalid = true }
  }
  const receipt = invalid ? { ok: false, error: `Invalid ${mode} receipt`, received: result ?? null } : result
  const encoded = JSON.stringify(receipt)
  if (invalid || receipt?.ok === false || receipt?.conflict || mode === 'exit' && (receipt?.cancelled || (receipt?.code ?? receipt?.exitCode) !== 0)) throw new Error(encoded)
  return encoded
}

/** Model-only view. The returned tool text/events retain the complete receipt. */
function projectCheck({ text: raw, ok, name }) {
  const prefix = `${name} failed: `
  let receipt
  try { receipt = JSON.parse(!ok && raw.startsWith(prefix) ? raw.slice(prefix.length) : raw) } catch { return { ok, diagnostic: short(raw) } }
  if (!receipt || typeof receipt !== 'object' || typeof receipt.ok !== 'boolean') return { ok, diagnostic: short(raw) }
  const result = { ok: ok && receipt.ok }
  for (const key of ['artifactId', 'revision', 'buildId', 'checkedAt', 'interactionMode']) if (receipt[key] !== undefined) result[key] = receipt[key]
  if (receipt.timing) result.timing = receipt.timing
  if (text(receipt.reason)) result.reason = short(receipt.reason)
  if (text(receipt.error)) result.error = short(receipt.error)
  if (Array.isArray(receipt.errors)) {
    result.errors = receipt.errors.slice(0, 4).map(error => short(error))
    if (receipt.errors.length > 4) result.errorsOmitted = receipt.errors.length - 4
  }
  if (Array.isArray(receipt.assertions) && Array.isArray(receipt.results)) {
    result.completedSteps = receipt.results.length; result.totalSteps = receipt.assertions.length
    result.outcomeAssertionsPassed = receipt.results.filter(row => row.action === 'assertText' || row.action === 'assertCount').length
    if (!result.ok && receipt.results.length < receipt.assertions.length) {
      const index = receipt.results.length; const step = receipt.assertions[index]
      result.firstIncompleteStep = { index, action: step.action, ...(step.selector ? { selector: step.selector } : {}), ...(step.value !== undefined ? { expected: short(step.value, 300) } : step.count !== undefined ? { expected: step.count } : {}) }
      // Errors carry captured-native actual text when available. A timeout does
      // not establish that this step's action never ran; do not label it unrun.
      if (result.errors?.length) result.firstIncompleteStep.diagnostic = result.errors[0]
    }
  }
  return result
}
export const workspace_list = { description: 'List project files and current revisions.', parameters: {}, risk: 'read', repeatable: true, run: async (_, ctx) => JSON.stringify(await ctx.request('workspace.list')) }
export const workspace_read = { description: 'Read a project file with its revision. Use that revision as expect when writing.', parameters: { path: 'string' }, risk: 'read', repeatable: true, run: async (args, ctx) => JSON.stringify(await ctx.request('workspace.read', args)) }
export const workspace_write = { description: 'Commit a UTF-8 project file. expect is the last read revision; use 0 to create. Conflicts must be read and resolved.', parameters: { path: 'string', content: 'string', expect: 'string or number (optional)' }, risk: 'write', writes: true, repeatable: true, run: async (args, ctx) => observation(await ctx.request('workspace.write', args), 'write') }
export const workspace_run = { description: 'Run a real shell command in the selected execution environment, stream output, and return the exit receipt. Browser uses Node/npm; local uses Bun. Do not assume one shell command retains cwd for the next.', parameters: { command: 'string' }, risk: 'exec', repeatable: true, run: async (args, ctx) => observation(await ctx.request('workspace.run', args), 'exit') }
export const workspace_build = { description: 'Run package.json build script and package the Next static export in out/ as an isolated single-page artifact. Returns a build receipt; this is not interaction verification.', parameters: {}, risk: 'exec', repeatable: true, run: async (_, ctx) => observation(await ctx.request('workspace.build'), 'build') }
export const workspace_check = { description: 'Verify the current built artifact using an ordered JSON assertions array: {action:"click"|"fill"|"blur"|"assertText"|"assertCount",selector:"CSS selector",value?:"text",count?:number}, or {action:"reload"} with no selector. These are programmatic DOM actions, not trusted pointer/keyboard or focus verification. Use blur on the edited input to dispatch blur/focusout and commit onBlur handlers without moving the owner\'s focus. Include a click/fill followed by a concrete outcome. To test persistence, change state, reload, then assert restored state before another interaction. Reload drains pending askkArtifact.storage writes, recreates the opaque frame, and retains the same scoped test storage. Each check call starts with fresh test storage. Native localStorage is unavailable in the opaque sandbox. Receipts include ordered results tied to the built source revision.', parameters: { assertions: 'array' }, risk: 'read', repeatable: true, projectObservation: projectCheck, run: async (args, ctx) => observation(await ctx.request('workspace.check', args), 'check', args.assertions) }
export const workspace_environment = { description: 'Inspect the actual execution environment, supported capabilities, source revision, and current artifact verification.', parameters: {}, risk: 'read', repeatable: true, run: async (_, ctx) => JSON.stringify(await ctx.request('workspace.environment')) }
