import { loader } from '../core/folder.js'
import { snapshot } from '../core/prompt.js'
import { createStrategyRun, validateStrategy } from '../core/strategy.js'
import { normalizeToolPolicy } from './tool-policy.js'

const idPattern = /^[a-z][a-z0-9-]{0,63}$/
const digest = async value => `sha256:${Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))), byte => byte.toString(16).padStart(2, '0')).join('')}`
const only = (object, keys) => Object.keys(object).every(key => keys.includes(key))

function validateAgentStrategy(hub, value) {
  if (!value || value.version !== 1 || value.kind !== 'agent' || !idPattern.test(value.id) || !hub.specs.has(value.agent) || !['none', 'declared'].includes(value.delegation) || value.session !== 'agent' || !only(value, ['version', 'kind', 'id', 'label', 'description', 'agent', 'delegation', 'session'])) throw new Error('Invalid configured agent strategy')
  for (const key of ['label', 'description']) if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].length > 4000)) throw new Error(`Invalid strategy ${key}`)
  return snapshot(value)
}

/** Resolve only published configuration and literal prompt files; never executable expressions. */
export async function loadStrategy(hub, reference) {
  const published = (path, prefix, extension) => typeof path === 'string' && path.startsWith(`${prefix}/`) && path.endsWith(extension) && /^[A-Za-z0-9_./-]+$/.test(path) && !path.split('/').some(part => !part || part === '.' || part === '..') && hub.index.files[path] != null
  if (!published(reference, 'strategies', '.json')) throw new Error('Strategy must name a published strategies/*.json file')
  const load = loader(hub.base, hub.index, hub.fetch)
  const raw = JSON.parse(await load(reference))
  const files = { [reference]: hub.index.files[reference] }
  if (raw.kind === 'graph' && Array.isArray(raw.nodes)) {
    raw.nodes = await Promise.all(raw.nodes.map(async node => {
      if (!node || !Object.hasOwn(node, 'templateFile')) return node
      if (Object.hasOwn(node, 'template') || !published(node.templateFile, 'prompts', '.md')) throw new Error('Role template must name one published prompts/*.md file')
      const { templateFile, ...rest } = node
      files[templateFile] = hub.index.files[templateFile]
      return { ...rest, template: await load(templateFile) }
    }))
  }
  const definition = raw.kind === 'agent' ? validateAgentStrategy(hub, raw) : validateStrategy(raw, { hasAgent: path => hub.specs.has(path) })
  return snapshot({ definition, definitionHash: await digest(definition), files })
}

/** A coordinator owns state and receipts; every role still executes in an ordinary agent worker. */
export async function startHubStrategy(hub, value, query, { context = null, definitionHash = null, admissionGuard = () => true, verifyCompletion = null } = {}) {
  if (typeof query !== 'string' || query.length > 1000000) throw new Error('Strategy goal must be text of at most 1000000 characters')
  if (typeof admissionGuard !== 'function' || verifyCompletion !== null && typeof verifyCompletion !== 'function') throw new Error('Invalid strategy lifecycle callbacks')
  const definition = value?.kind === 'agent' ? validateAgentStrategy(hub, value) : validateStrategy(value, { hasAgent: path => hub.specs.has(path) })
  const actualHash = await digest(definition)
  if (definitionHash && actualHash !== definitionHash) throw new Error('Strategy definition changed after selection; reload the configuration before starting')
  if (!admissionGuard() || hub.disposed) throw new Error('Strategy admission was cancelled')
  const policy = normalizeToolPolicy(context?.toolPolicy)
  if (definition.kind === 'agent') {
    if (verifyCompletion) throw new Error('Agent strategies do not accept a verifyCompletion callback; declare workflow.completion checks and bind the named completion adapter instead')
    const restricted = { disabledTools: [], approvalRisks: [], allowDelegation: true, ...policy }
    if (definition.delegation === 'none') restricted.allowDelegation = false
    return hub.startRun(definition.agent, query, { context: snapshot({ ...context, toolPolicy: restricted }), strategyDefinition: definition, strategyDefinitionHash: actualHash })
  }
  if (policy?.allowDelegation === false) throw new Error('This configured role workflow requires Allow delegation. Select a single-agent workflow or enable delegation before starting.')
  if (hub.disposed) throw new Error('The agent runtime has stopped')
  if (verifyCompletion && context?.workflow?.completion?.checks?.length) throw new Error('Declared workflow completion checks cannot be replaced by a verifyCompletion callback; bind the named completion adapter instead')
  const output = definition.nodes.find(node => node.id === definition.output)
  const run = hub.createRun(output.agent, query, { kind: 'strategy', context, strategyDefinition: definition, strategyDefinitionHash: actualHash })
  if (run.completion.checks.length && !verifyCompletion) verifyCompletion = current => hub.verifyCompletion(current)
  run.slot = { ...run.slot, status: 'starting', maxSteps: definition.nodes.length, steps: 0 }
  const project = state => {
    if (run.ended) return
    run.strategyState = snapshot(state)
    run.slot = { ...run.slot, status: state.status === 'queued' ? 'starting' : state.status, steps: state.nodes.filter(node => node.status === 'done').length, current: state.nodes.filter(node => ['running', 'waiting', 'cancelling'].includes(node.status)).map(node => node.nodeId).join(', '), error: state.reason || '' }
    hub.publish({ type: 'strategy', run: run.id, task: snapshot({ ...state, definition }) })
    hub.publish({ type: 'status', run: run.id, slot: run.slot })
    hub.persist(run)
  }
  const coordinator = createStrategyRun(definition, {
    id: run.id, trace: run.trace, goal: query, context: run.context, definitionHash: actualHash,
    startAgent: ({ agent, nodeId, query: input }) => {
      if (run.ended || hub.disposed) throw new Error('The strategy has stopped')
      const child = hub.startRun(agent, input, { parent: run.id, kind: 'strategy-role', call: nodeId, stageId: nodeId, fresh: true })
      return { runId: child.id, finished: child.answer.then(() => ({ status: child.slot.status, output: child.result, reason: child.slot.error || child.slot.terminationReason || '' })) }
    },
    cancelAgent: childId => { const child = hub.runs.get(childId); if (child && !child.ended) hub.abort(child) },
    onEvent: state => project(state.status === 'done' && verifyCompletion ? { ...state, status: 'verifying', endedAt: null } : state),
  })
  run.strategyRunner = coordinator
  run.strategyState = coordinator.getSnapshot()
  run.cancelStrategy = () => {
    if (run.ended) return
    if (run.strategyState.status === 'verifying') {
      project({ ...run.strategyState, seq: run.strategyState.seq + 1, status: 'cancelled', reason: 'Verification stopped by the owner', endedAt: Date.now() })
      hub.end(run, '(cancelled: verification stopped by the owner)', false, 'Verification stopped by the owner', { status: 'cancelled', terminationReason: 'cancelled' })
    } else coordinator.cancel()
  }
  coordinator.finished.then(async result => {
    if (run.ended) return
    let status = result.status; let reason = result.reason
    if (status === 'done' && verifyCompletion) {
      let verification
      try { verification = await verifyCompletion(run) }
      catch (error) { verification = { ok: false, reason: error.message } }
      if (run.ended) return
      if (verification?.ok !== true) { status = 'incomplete'; reason = verification?.reason || 'Independent completion checks did not pass' }
      project({ ...run.strategyState, seq: run.strategyState.seq + 1, status, reason, endedAt: Date.now(), verification: snapshot(verification ?? { ok: false }) })
    }
    const ok = status === 'done'
    hub.end(run, ok ? result.output : `(${status}: ${reason || 'The role workflow did not complete'})`, ok, reason, { status, terminationReason: ok ? 'completed' : status })
  }).catch(error => { if (!run.ended) hub.end(run, `(failed: ${error.message})`, false, error.message) })
  // Persist the immutable definition before any role admission. Storage failure never launches tools.
  try { await hub.writeRunRecord(hub.runRecord(run)) }
  catch (error) {
    project({ ...run.strategyState, seq: run.strategyState.seq + 1, status: 'failed', reason: `Strategy admission could not be saved: ${error.message}`, endedAt: Date.now() })
    hub.end(run, `(failed: strategy admission could not be saved: ${error.message})`, false, error.message)
    coordinator.cancel()
    return run
  }
  if (run.ended || hub.disposed || !admissionGuard()) { coordinator.cancel(); return run }
  coordinator.start()
  return run
}

/** Approvals are host-observed waits; model text cannot fabricate them. */
export function strategyChildState(hub, run) {
  if (!run?.stageId || !run.parent) return
  const parent = hub.runs.get(run.parent)
  if (!parent?.strategyRunner || parent.ended) return
  const approvals = [...hub.approvals.values()].filter(approval => approval.run === run.id)
  const waiting = approvals.length ? { kind: 'approval', approvalIds: approvals.map(approval => approval.id) } : run.slot.status === 'waiting' ? { kind: 'agent', approvalIds: [] } : null
  parent.strategyRunner.updateAgent(run.stageId, run.id, { waiting })
}
