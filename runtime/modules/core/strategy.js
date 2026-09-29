import { snapshot } from './prompt.js'

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const AGENT = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/
const TERMINAL = new Set(['done', 'failed', 'incomplete', 'cancelled', 'interrupted', 'skipped'])
const invalid = message => { throw new TypeError(`Invalid strategy: ${message}`) }
const object = (value, name) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(`${name} must be an object`)
}
const keys = (value, allowed, name) => {
  object(value, name)
  for (const key of Object.keys(value)) if (!allowed.includes(key)) invalid(`${name}.${key} is unsupported`)
}
const identifier = (value, name) => { if (typeof value !== 'string' || !IDENTIFIER.test(value)) invalid(`${name} must be a bounded identifier`); return value }
const integer = (value, min, max, name) => { if (!Number.isSafeInteger(value) || value < min || value > max) invalid(`${name} must be an integer from ${min} to ${max}`); return value }
const text = (value, name, limit) => { if (typeof value !== 'string' || value.length > limit) invalid(`${name} must be text of at most ${limit} characters`); return value }

/** Resolve template files before calling this pure validator. No templates execute code. */
export function validateStrategy(input, { hasAgent } = {}) {
  keys(input, ['version', 'id', 'kind', 'label', 'description', 'nodes', 'output', 'limits'], 'definition')
  if (input.version !== 1 || input.kind !== 'graph') invalid('expected version 1 and kind graph')
  const id = identifier(input.id, 'id')
  if (!Array.isArray(input.nodes) || !input.nodes.length || input.nodes.length > 64 || Array.from(input.nodes).some(node => !node)) invalid('nodes must contain 1 to 64 roles')
  keys(input.limits, ['maxParallel', 'maxWallMs'], 'limits')
  const limits = {
    maxParallel: integer(input.limits.maxParallel, 1, 32, 'limits.maxParallel'),
    maxWallMs: integer(input.limits.maxWallMs, 1, 86400000, 'limits.maxWallMs'),
  }
  const ids = new Set()
  const nodes = input.nodes.map((value, index) => {
    const name = `nodes[${index}]`
    keys(value, ['id', 'agent', 'dependsOn', 'template', 'inputs'], name)
    const nodeId = identifier(value.id, `${name}.id`)
    if (ids.has(nodeId)) invalid(`duplicate node ${nodeId}`)
    ids.add(nodeId)
    if (typeof value.agent !== 'string' || value.agent.length > 256 || !AGENT.test(value.agent) || hasAgent && !hasAgent(value.agent)) invalid(`${name}.agent is not an available role`)
    if (!Array.isArray(value.dependsOn) || value.dependsOn.length > 64 || value.dependsOn.some(dependency => typeof dependency !== 'string' || !IDENTIFIER.test(dependency)) || new Set(value.dependsOn).size !== value.dependsOn.length) invalid(`${name}.dependsOn must contain distinct node identifiers`)
    const template = text(value.template, `${name}.template`, 100000)
    object(value.inputs, `${name}.inputs`)
    if (Object.keys(value.inputs).length > 65) invalid(`${name}.inputs contains too many slots`)
    const inputs = Object.create(null)
    for (const [slot, source] of Object.entries(value.inputs)) {
      identifier(slot, `${name}.inputs slot`)
      keys(source, ['from', 'node', 'maxChars'], `${name}.inputs.${slot}`)
      if (!['goal', 'node'].includes(source.from)) invalid(`${name}.inputs.${slot}.from must be goal or node`)
      if (source.from === 'goal' && Object.hasOwn(source, 'node')) invalid(`${name}.inputs.${slot} cannot name a node for goal input`)
      if (source.from === 'node' && (!value.dependsOn.includes(source.node) || source.node === nodeId)) invalid(`${name}.inputs.${slot} must name an explicit dependency`)
      inputs[slot] = { from: source.from, ...(source.from === 'node' ? { node: source.node } : {}), maxChars: source.maxChars === undefined ? 12000 : integer(source.maxChars, 1, 1000000, `${name}.inputs.${slot}.maxChars`) }
    }
    const slots = new Set()
    const remainder = template.replace(/\{\{([\s\S]*?)\}\}/g, (_, raw) => {
      const slot = raw.trim()
      if (!IDENTIFIER.test(slot) || !Object.hasOwn(inputs, slot)) invalid(`${name}.template has an unknown input slot`)
      slots.add(slot)
      return ''
    })
    if (remainder.includes('{{')) invalid(`${name}.template has an unclosed input slot`)
    if (Object.keys(inputs).some(slot => !slots.has(slot))) invalid(`${name}.inputs contains an unused slot`)
    return { id: nodeId, agent: value.agent, dependsOn: [...value.dependsOn], template, inputs }
  })
  const byId = new Map(nodes.map(node => [node.id, node]))
  for (const node of nodes) for (const dependency of node.dependsOn) if (!byId.has(dependency)) invalid(`${node.id} depends on unknown node ${dependency}`)
  const seen = new Set(), visiting = new Set()
  const visit = id => {
    if (visiting.has(id)) invalid('dependencies contain a cycle')
    if (seen.has(id)) return
    visiting.add(id)
    for (const dependency of byId.get(id).dependsOn) visit(dependency)
    visiting.delete(id); seen.add(id)
  }
  for (const node of nodes) visit(node.id)
  const output = identifier(input.output, 'output')
  if (!byId.has(output)) invalid('output must name a node')
  const contributing = new Set()
  const collect = id => { if (contributing.has(id)) return; contributing.add(id); for (const dependency of byId.get(id).dependsOn) collect(dependency) }
  collect(output)
  if (contributing.size !== nodes.length) invalid('every node must contribute to the selected output')
  return snapshot({ version: 1, id, kind: 'graph', ...(input.label !== undefined ? { label: text(input.label, 'label', 512) } : {}), ...(input.description !== undefined ? { description: text(input.description, 'description', 4000) } : {}), nodes, output, limits })
}

// Public diagnostics are bounded and strip common credential forms. Exact provider/tool
// failures belong to the corresponding child evidence record, not strategy success data.
function reason(value, fallback) {
  const message = typeof value === 'string' ? value : value instanceof Error ? value.message : fallback
  return String(message || fallback).replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\b(api[_-]?key|token|secret|password)["']?\s*[:=]\s*["']?[^\s"',;&]+/gi, '$1=[redacted]').slice(0, 512)
}
const actualResult = value => Boolean(value && typeof value === 'object' && !Array.isArray(value) && ['done', 'failed', 'incomplete', 'cancelled', 'interrupted'].includes(value.status) && (value.status !== 'done' || typeof value.output === 'string'))

/**
 * Deterministic orchestration only. Every role's model loop stays in its own worker.
 * startAgent must allocate synchronously and return {runId, finished}; a thrown start
 * means no worker/run was admitted. Its finished promise is the sole completion receipt.
 */
export function createStrategyRun(input, options) {
  const definition = validateStrategy(input, { hasAgent: options?.hasAgent })
  const { id, trace = id, goal, context = {}, startAgent, cancelAgent, onEvent = () => {}, definitionHash = null } = options ?? {}
  if (typeof id !== 'string' || !id.length || id.length > 256 || typeof trace !== 'string' || !trace.length || trace.length > 256) invalid('execution id and trace are required')
  text(goal, 'goal', 1000000)
  if (typeof startAgent !== 'function' || typeof cancelAgent !== 'function' || typeof onEvent !== 'function') invalid('startAgent, cancelAgent and onEvent must be functions')
  if (definitionHash !== null && (typeof definitionHash !== 'string' || definitionHash.length > 256)) invalid('definitionHash must be a bounded string')
  if (context?.toolPolicy?.allowDelegation === false) invalid('the owner disabled delegation; a role graph cannot start')
  const inherited = snapshot(context)
  const clock = options.clock ?? { now: () => performance.timeOrigin + performance.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: timer => clearTimeout(timer) }
  if (['now', 'setTimeout', 'clearTimeout'].some(name => typeof clock[name] !== 'function')) invalid('clock must supply now, setTimeout and clearTimeout')
  const nodes = definition.nodes.map(node => ({ nodeId: node.id, attemptId: `${id}:${node.id}:1`, agent: node.agent, dependsOn: [...node.dependsOn], runId: null, status: 'queued', reason: '', waiting: null, result: null, cancellationError: '' }))
  const records = new Map(nodes.map(node => [node.nodeId, node]))
  const active = new Set(), outputs = new Map(), cancellationIssued = new Set(), runIds = new Set()
  let status = 'queued', seq = 0, startedAt = null, endedAt = null, terminalReason = '', stopping = null, timer = null, pumping = false, completed = false
  let resolveFinished
  const finished = new Promise(resolve => { resolveFinished = resolve })
  const getSnapshot = () => snapshot({ id, trace, definitionId: definition.id, definitionHash, seq, status, startedAt, endedAt, outputNode: definition.output, reason: terminalReason, nodes })
  const emit = () => {
    seq++
    // An observer cannot interrupt worker cancellation or change scheduling authority.
    try { const pending = onEvent(getSnapshot()); if (pending && typeof pending.catch === 'function') pending.catch(() => {}) } catch {}
  }
  const complete = () => {
    if (completed || active.size || nodes.some(node => !TERMINAL.has(node.status))) return
    completed = true
    if (timer !== null) clock.clearTimeout(timer)
    status = stopping?.status ?? (nodes.every(node => node.status === 'done') ? 'done' : 'failed')
    terminalReason = stopping?.reason ?? (status === 'done' ? '' : 'A required role did not complete')
    endedAt = clock.now(); emit()
    resolveFinished(snapshot({ status, output: status === 'done' ? outputs.get(definition.output) ?? '' : '', reason: terminalReason, snapshot: getSnapshot() }))
  }
  const requestCancel = node => {
    if (!node.runId || cancellationIssued.has(node.runId)) return
    cancellationIssued.add(node.runId)
    const rejected = error => {
      if (completed || !active.has(node.nodeId)) return
      node.cancellationError = reason(error, 'Cancellation could not be acknowledged; awaiting the actual role result'); emit()
    }
    try { Promise.resolve(cancelAgent(node.runId, stopping.reason)).catch(rejected) } catch (error) { rejected(error) }
  }
  const stop = (terminalStatus, why) => {
    if (completed) return
    if (!stopping) stopping = { status: terminalStatus, reason: reason(why, 'Strategy stopped') }
    terminalReason = stopping.reason
    for (const node of nodes) {
      if (node.status === 'queued') { node.status = 'skipped'; node.reason = 'Not started because the strategy stopped' }
      else if (active.has(node.nodeId)) { node.status = 'cancelling'; node.waiting = null }
    }
    status = active.size ? 'cancelling' : stopping.status; emit()
    for (const node of nodes) if (active.has(node.nodeId)) requestCancel(node)
    complete()
  }
  const enforceDeadline = () => {
    if (!stopping && startedAt !== null && clock.now() - startedAt >= definition.limits.maxWallMs) stop('incomplete', 'Strategy wall-clock limit reached; awaiting admitted role outcomes')
  }
  const settle = (node, value) => {
    // Browser timer callbacks can be delayed. A late receipt cannot beat an expired
    // deadline merely because its promise callback ran before the timer callback.
    enforceDeadline()
    if (!active.delete(node.nodeId)) return
    node.waiting = null
    const valid = actualResult(value)
    const actual = valid ? value.status : 'failed'
    node.status = actual
    node.reason = node.status === 'done' ? '' : reason(valid ? value.reason : null, valid ? `Role ended with ${actual}` : 'Role returned an invalid completion receipt')
    node.result = { status: actual, outputRef: { runId: node.runId, field: 'result' } }
    if (node.status === 'done') outputs.set(node.nodeId, value.output)
    emit()
    if (node.status !== 'done' && !stopping) stop(node.status, node.reason)
    if (stopping) complete()
    else pump()
  }
  const admit = configured => {
    const node = records.get(configured.id)
    let query
    try {
      const values = Object.create(null)
      for (const [slot, source] of Object.entries(configured.inputs)) {
        const value = source.from === 'goal' ? goal : outputs.get(source.node)
        if (typeof value !== 'string' || value.length > source.maxChars) throw new Error(`Input ${slot} exceeds its configured limit or has no completed output`)
        values[slot] = value
      }
      query = configured.template.replace(/\{\{([\s\S]*?)\}\}/g, (_, slot) => values[slot.trim()])
    } catch (error) {
      node.status = 'incomplete'; node.reason = reason(error, 'Role input could not be composed'); emit(); stop('incomplete', node.reason); return
    }
    node.status = 'running'; active.add(node.nodeId); emit()
    // Cancellation may be requested synchronously by an observer of this admission.
    if (stopping) { active.delete(node.nodeId); node.status = 'skipped'; node.reason = 'Cancelled before worker dispatch'; complete(); return }
    try {
      const handle = startAgent(snapshot({ strategyId: id, definitionId: definition.id, nodeId: node.nodeId, attemptId: node.attemptId, agent: node.agent, query, context: inherited, session: 'fresh' }))
      if (!handle || typeof handle.runId !== 'string' || !handle.runId || handle.runId.length > 256) throw new Error('startAgent did not return an admitted run identity')
      node.runId = handle.runId
      const duplicate = runIds.has(handle.runId); runIds.add(handle.runId)
      let outcome
      try {
        outcome = handle.finished
        if (duplicate || !outcome || typeof outcome.then !== 'function') throw new Error('startAgent must return a unique runId and its actual finished promise')
      } catch (error) {
        // A known admitted run cannot be declared finished because its adapter lost
        // the promise. Preserve its identity until settleAgent supplies a real receipt.
        node.reason = reason(error, 'The admitted role completion receipt is unavailable')
        node.cancellationError = 'Outcome unknown: no valid completion handle; awaiting an explicit role receipt'
        stop('failed', node.reason); return
      }
      emit()
      Promise.resolve(outcome).then(value => settle(node, value), error => settle(node, { status: 'failed', reason: reason(error, 'Role completion rejected') }))
      enforceDeadline()
      if (stopping) requestCancel(node)
    } catch (error) {
      active.delete(node.nodeId); node.status = 'failed'; node.reason = reason(error, 'Role could not start'); emit(); stop('failed', node.reason)
    }
  }
  function pump() {
    if (pumping || completed || stopping) return
    enforceDeadline()
    if (stopping) return
    pumping = true
    try {
      for (const configured of definition.nodes) {
        if (stopping || active.size >= definition.limits.maxParallel) break
        const node = records.get(configured.id)
        if (node.status === 'queued' && configured.dependsOn.every(dependency => records.get(dependency).status === 'done')) admit(configured)
      }
      complete()
    } finally { pumping = false }
  }
  return {
    id, finished, getSnapshot,
    start() {
      if (status !== 'queued' || completed) return finished
      startedAt = clock.now(); status = 'running'; emit()
      if (stopping || completed) return finished
      timer = clock.setTimeout(() => stop('incomplete', 'Strategy wall-clock limit reached; awaiting admitted role outcomes'), definition.limits.maxWallMs)
      pump(); return finished
    },
    cancel(why = 'Stopped by the owner') { stop('cancelled', why); return finished },
    /** Recovery for a known admitted handle only; neither cancellation ACK nor text is proof. */
    settleAgent(nodeId, runId, result) {
      const node = records.get(nodeId)
      if (!node || !runId || node.runId !== runId || !active.has(nodeId) || !actualResult(result)) return false
      settle(node, result); return true
    },
    updateAgent(nodeId, runId, value) {
      const node = records.get(nodeId)
      if (!node || node.runId !== runId || !active.has(nodeId) || stopping) return false
      const waiting = value?.waiting
      if (waiting != null && (!waiting || typeof waiting.kind !== 'string' || !['approval', 'agent', 'question', 'tool', 'provider'].includes(waiting.kind) || waiting.approvalIds !== undefined && (!Array.isArray(waiting.approvalIds) || waiting.approvalIds.length > 256 || waiting.approvalIds.some(id => typeof id === 'string' ? !id.length || id.length > 256 : !Number.isSafeInteger(id) || id < 0)))) return false
      node.waiting = waiting ? { kind: waiting.kind, approvalIds: [...(waiting.approvalIds ?? [])] } : null
      emit(); return true
    },
  }
}
