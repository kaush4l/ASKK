import { createWriteObservations } from '../core/write-observations.js'
/** Tools resolve through the task's chosen workspace/execution binding. */
import { resolveCommandReference } from '../core/command-reference.js'
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
/** Decode this adapter's JSON once for model context; raw receipts stay in events.
 * A successful write need not repeat the content already present in the action. */
const projectReceipt = ({ text: raw, ok, name }) => {
  const prefix = `${name} failed: `
  try { return JSON.parse(!ok && raw.startsWith(prefix) ? raw.slice(prefix.length) : raw) }
  catch { return raw }
}
const projectWrite = value => {
  const receipt = projectReceipt(value)
  if (!value.ok && receipt?.conflict === true) return { ...receipt, outcome: receipt.committed === true ? 'committed_then_changed' : 'write_not_applied', recovery: 'Read this file again, reconcile your change with its saved content, then retry with observed:true or the returned exact revision. Do not use expect:0 for an existing file.' }
  if (!value.ok || !receipt || receipt.ok !== true || !Object.hasOwn(receipt, 'content')) return receipt
  const { content, ...acknowledgement } = receipt
  return { ...acknowledgement, contentOmitted: true }
}
/** Bound only the model's command transcript; execution receipts remain exact.
 * The shared budget counts retained UTF-16 units, excluding omission markers. */
const projectCommand = value => {
  const receipt = projectReceipt(value)
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) || receipt.received !== undefined || !(Number.isInteger(receipt.code ?? receipt.exitCode) || receipt.cancelled === true)) return receipt
  const fields = ['output', 'stdout', 'stderr'].filter(key => typeof receipt[key] === 'string')
  if (fields.reduce((size, key) => size + receipt[key].length, 0) <= 6000) return receipt
  const projected = { ...receipt }, projection = {}
  let remaining = 6000
  // Small fields stay exact when they fit their share, leaving room for larger streams.
  fields.sort((a, b) => receipt[a].length - receipt[b].length)
  for (const [index, key] of fields.entries()) {
    const source = receipt[key], limit = Math.floor(remaining / (fields.length - index))
    if (source.length <= limit) { remaining -= source.length; continue }
    let headEnd = Math.floor(limit / 3), tailStart = source.length - (limit - headEnd)
    const splitsPair = position => position > 0 && position < source.length && /[\uD800-\uDBFF]/.test(source[position - 1]) && /[\uDC00-\uDFFF]/.test(source[position])
    if (splitsPair(headEnd)) headEnd--
    if (splitsPair(tailStart)) tailStart++
    const omitted = tailStart - headEnd
    projected[key] = `${source.slice(0, headEnd)}\n… [${omitted} UTF-16 units omitted] …\n${source.slice(tailStart)}`
    projection[key] = { originalLength: source.length, omitted, retainedLength: source.length - omitted }
    remaining -= source.length - omitted
  }
  return { ...projected, modelOutputProjection: projection }
}
// These adapters interpret only this module's validated receipt format.
const receiptActivity = mode => ({ text: raw, ok, name, args }) => {
  const prefix = `${name} failed: `
  if (typeof raw !== 'string' || !ok && !raw.startsWith(prefix)) return {}
  const receipt = JSON.parse(ok ? raw : raw.slice(prefix.length))
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return {}
  if (mode === 'exit') {
    if (!(Number.isInteger(receipt.code ?? receipt.exitCode) || receipt.cancelled === true) || receipt.received !== undefined) return {}
    return { commandId: receipt.id }
  }
  if (!ok) return {}
  if (mode === 'write') return receipt.ok === true && !receipt.conflict && (text(receipt.rev) || Number.isSafeInteger(receipt.rev) && receipt.rev > 0) ? { path: args.path } : {}
  if (mode === 'read') return typeof receipt.content === 'string' && receipt.rev !== undefined ? { path: args.path } : {}
  if (mode === 'check') return !invalidCheck(receipt, args.assertions) && receipt.ok ? { artifactId: receipt.artifactId } : {}
  if (mode === 'build') {
    const manifest = assertArtifactManifest(receipt.manifest, { sourceRevision: receipt.revision })
    return receipt.status === 'ready' && receipt.id === manifest.id && receipt.revision === manifest.sourceRevision && receipt.ok !== false ? { artifactId: receipt.id } : {}
  }
  return {}
}
const objectInput = (properties = {}, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false })
const pathInput = { type: 'string', minLength: 1, maxLength: 1024, description: 'Workspace-relative file name, including extension.' }
const emptyInput = objectInput()
export const workspace_list = { projectObservation: projectReceipt, inputSchema: emptyInput, description: 'List project files and current revisions.', parameters: {}, risk: 'read', repeatable: true, run: async (_, ctx) => JSON.stringify(await ctx.request('workspace.list')) }
export const workspace_read = { projectObservation: projectReceipt, inputSchema: objectInput({ path: pathInput }), description: 'Read a project file with its revision. After a successful read, write using observed:true to bind to that exact observed revision, or copy the revision into expect.', parameters: { path: 'string' }, risk: 'read', repeatable: true, projectActivity: receiptActivity('read'), run: async (args, ctx) => { try { const receipt = await ctx.request('workspace.read', args); if (receipt?.writeObservation) ctx.writeObservations?.accept(args.path, receipt); else ctx.writeObservations?.invalidate(args.path); return JSON.stringify(receipt) } catch (error) { ctx.writeObservations?.invalidate(args.path); throw error } } }
export const workspace_write = { resolveArguments: (args, ctx) => (ctx.writeObservations ?? createWriteObservations()).resolve(args), projectObservation: projectWrite, inputSchema: objectInput({ path: pathInput, content: { type: 'string', description: 'The complete literal source code or text to store inside the file, not its filename. Escape quotes and newlines for JSON.' }, expect: { type: ['string', 'integer'], description: 'Exact revision from the most recent read, or 0 only to create a file. Supply this OR observed:true.' }, observed: { type: 'boolean', enum: [true], description: 'Use the exact revision from your last successful workspace_read of this path. No hash copying needed. Supply this OR expect.' } }, ['path', 'content']), description: 'Commit a UTF-8 project file. To edit: workspace_read the path, then write with observed:true. To create: expect:0. Supply exactly one of observed:true or expect. A conflict means read and reconcile before retrying; never repeat expect:0 for an existing file.', parameters: { path: 'string', content: 'string', expect: 'string or integer' }, risk: 'write', writes: true, repeatable: true, projectActivity: receiptActivity('write'), run: async (args, ctx) => { try { return observation(await ctx.request('workspace.write', args), 'write') } catch (error) { ctx.writeObservations?.invalidate(args.path); throw error } } }
export const workspace_run = { projectObservation: projectCommand, resolveArguments: (args, ctx) => resolveCommandReference(args, ctx.completion), inputSchema: objectInput({ command: { type: 'string', minLength: 1 }, requiredCheck: { type: 'integer', description: 'Zero-based index in workspace environment referenceCompletion workspace.commands. Supply this OR command, never both.' } }, []), description: 'Run a configured required check from workspace environment referenceCompletion using {requiredCheck:0} (zero-based index), or supply {command: "shell text"}. Exactly one is required. References preserve the configured command and use the same execution permission. Run a real shell command in the selected execution environment, stream output, and return the exit receipt. Browser uses Node/npm; local uses Bun. Do not assume one shell command retains cwd for the next.', parameters: { command: 'string' }, risk: 'exec', repeatable: true, projectActivity: receiptActivity('exit'), run: async (args, ctx) => observation(await ctx.request('workspace.run', args), 'exit') }
export const workspace_build = { projectObservation: projectReceipt, inputSchema: emptyInput, description: 'Run package.json build script and package the Next static export in out/ as an isolated single-page artifact. Returns a build receipt; this is not interaction verification.', parameters: {}, risk: 'exec', repeatable: true, projectActivity: receiptActivity('build'), run: async (_, ctx) => observation(await ctx.request('workspace.build'), 'build') }
export const workspace_check = { inputSchema: objectInput({ assertions: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object' } } }), description: 'Verify the current built artifact using an ordered JSON assertions array: {action:"click"|"fill"|"blur"|"assertText"|"assertCount",selector:"CSS selector",value?:"text",count?:number}, or {action:"reload"} with no selector. These are programmatic DOM actions, not trusted pointer/keyboard or focus verification. Use blur on the edited input to dispatch blur/focusout and commit onBlur handlers without moving the owner\'s focus. Include a click/fill followed by a concrete outcome. To test persistence, change state, reload, then assert restored state before another interaction. Reload drains pending askkArtifact.storage writes, recreates the opaque frame, and retains the same scoped test storage. Each check call starts with fresh test storage. Native localStorage is unavailable in the opaque sandbox. Receipts include ordered results tied to the built source revision.', parameters: { assertions: 'array' }, risk: 'read', repeatable: true, projectObservation: projectCheck, projectActivity: receiptActivity('check'), run: async (args, ctx) => observation(await ctx.request('workspace.check', args), 'check', args.assertions) }
export const workspace_environment = { projectObservation: projectReceipt, inputSchema: emptyInput, description: 'Inspect the actual execution environment, supported capabilities, source revision, and current artifact verification.', parameters: {}, risk: 'read', repeatable: true, run: async (_, ctx) => JSON.stringify(await ctx.request('workspace.environment')) }
