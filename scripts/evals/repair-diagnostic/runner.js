import { Engine } from '../../../src/core/engine.js'
import { contexts } from '../../../src/core/context.js'
import { inference, InferenceError } from '../../../src/core/inference.js'
import { resolve } from '../../../src/core/models.js'
import { snapshot } from '../../../src/core/prompt.js'
import { fromModule, tool, toolbox } from '../../../src/core/tools.js'
import { decide, withAgentRules } from '../../../src/core/permissions.js'
import * as workspace from '../../../src/builtin/workspace.js'
import * as board from '../../../src/builtin/board.js'
import * as memory from '../../../src/builtin/memory.js'
import * as todo from '../../../src/builtin/todo.js'
import { inspectArtifact } from '../../../src/workspace/artifacts.js'
import { LIMITS, counter, boundModel, evidenceRecorder, executionAssessment } from './limits.js'

const modules = { workspace, board, memory, todo }
export const GOAL = 'Repair verification of the immutable Daylight fixture. The artifact is already built from the supplied source. Inspect source and the observed failing check, preserve application behavior, and propose a corrected check of the intended tasks in Active and Completed filters and state after reload. Identify task identity rather than assuming order. Source writes, commands, rebuilds and delegation are unavailable in this bounded diagnostic. There is one remaining real inspection; finish only after it passes. Historical fixture turns are observations supplied by the evaluator, not actions performed by this fresh agent. No owner correction will follow.'

/** Uses real production parsing, rendering, tool status/projection and inspector.
 * This is deliberately not a Hub/delegation/durability integration benchmark. */
export async function runDiagnostic(input, { allowInference = false, signal, onProgress = () => {} } = {}) {
  if (!allowInference) throw new Error('Inference is disabled; explicit operator execution is required')
  const fixture = snapshot(input.fixture), artifact = snapshot(input.artifact)
  const evidence = evidenceRecorder(), counts = { main: counter(6, 'Main request'), compactor: counter(1, 'Compactor request'), inspections: counter(2, 'Artifact inspection') }
  const forbidden = [], checks = [], boardRows = [], memories = []
  let plan = [], phase = 'baseline', compactions = 0, summary = '', compactInput = '', latestCheck = null
  const combined = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(LIMITS.wallMs)])
  const sourceFiles = new Map(fixture.files.map(file => [file.path, file]))
  const environment = { target: 'evaluation', status: 'ready', capabilities: ['fs.read', 'artifact.inspect'], sourceRevision: 26, sourceFingerprint: fixture.sourceFingerprint, files: fixture.files.map(({ content, ...file }) => file), artifact: { id: artifact.id, buildId: artifact.buildId, revision: artifact.revision }, restrictions: 'Immutable historical source; actual native build receipt supplied. No live execution port, writes, commands or delegated agents. Two inspections total: baseline and proposed repair.' }
  const request = async (op, args = {}) => {
    combined.throwIfAborted()
    if (op === 'workspace.environment') return environment
    if (op === 'workspace.goal') return { text: GOAL, revision: 1 }
    if (op === 'workspace.list') return environment.files
    if (op === 'workspace.read') { const file = sourceFiles.get(args.path); if (!file) throw new Error('File not in immutable fixture'); return file }
    if (op === 'workspace.check') {
      counts.inspections.take() // Reserve before asynchronous inspection, including parallel calls.
      const result = await inspectArtifact(artifact, args.assertions)
      checks.push(snapshot({ phase, receipt: result }))
      if (phase === 'main') latestCheck = result
      return result
    }
    if (op === 'workspace.acceptance') return { ok: latestCheck?.ok === true && forbidden.length === 0, reason: latestCheck?.ok ? 'Actual repair inspection passed; independent summary/coverage audit remains required.' : 'The proposed repair has not passed its real inspection.' }
    if (op === 'todo.get') return plan
    if (op === 'todo.set') { plan = structuredClone(args.items); return plan }
    if (op === 'board.list') return boardRows
    if (op === 'board.post') { const row = { ...args, id: boardRows.length + 1, author: 'main' }; boardRows.push(row); return row }
    if (op === 'board.resolve') { const row = boardRows.find(row => row.id === args.id); if (!row) throw new Error('No board entry'); row.resolved = true; return row }
    if (op === 'memory.list') return memories
    if (op === 'memory.save') { const row = { ...args, id: memories.length + 1, agent: args.scope === 'shared' ? 'shared' : 'main' }; memories.push(row); return row }
    if (op === 'memory.search') return memories.filter(row => row.text.includes(args.query))
    if (op === 'memory.forget') { const index = memories.findIndex(row => row.id === args.id); if (index >= 0) memories.splice(index, 1); return { ok: true } }
    forbidden.push({ op, at: Date.now() })
    throw new Error(`Immutable evaluation refused ${op}; no operation was performed`)
  }
  const resolvedSettings = {}
  function create(spec, kind) {
    if (spec.localTools.length || spec.owned.length || Object.keys(spec.commonTools).length || spec.grants.some(grant => !modules[grant])) throw new Error('Production tool composition changed; update and review this diagnostic adapter before running')
    const builtins = spec.grants.flatMap(grant => fromModule(modules[grant], { tier: 'built-in', source: `built-in ${grant}` }))
    const delegates = spec.peers.map(path => tool({ name: path, description: input.peers[path]?.description || `the ${path} agent`, parameters: { query: 'string' }, run: () => request('call', { agent: path }), risk: 'read' }, { tier: 'agent', source: `agents/${path}` }))
    const policy = withAgentRules(undefined, spec.path, spec.permissions)
    const tools = toolbox([builtins, delegates]).tools.map(item => ({ ...item, run: async (args, ctx) => {
      const verdict = decide(item, args, { policy, agent: spec.path })
      if (verdict.action !== 'allow') { forbidden.push({ op: item.name, at: Date.now(), policy: verdict.action }); throw new Error(`Evaluation cannot request owner steering: ${verdict.reason}`) }
      return item.run(args, ctx)
    } }))
    const settings = resolve(spec.inference, input.catalogue)
    resolvedSettings[kind] = snapshot(settings)
    if (settings.provider !== 'openai' || settings.baseUrl !== 'http://127.0.0.1:8873/v1' || settings.model !== 'Qwen3.8-27B-Uncensored-oQ4e-fp16-mtp' || settings.apiKey || settings.via || Object.keys(settings.headers ?? {}).length || settings.temperature !== 0 || settings.contextLength !== 32768 || settings.maxOutputTokens !== (kind === 'main' ? 8192 : 2048) || JSON.stringify(settings.requestParams) !== JSON.stringify({ chat_template_kwargs: { enable_thinking: false } })) throw new Error('Agent model override differs from the explicitly authorized diagnostic profile')
    // One transport request per stream. Six includes malformed/failed attempts;
    // no retry can evade the diagnostic cap. All sampling/output settings stay configured.
    const llm = inference({ ...settings, retries: 1 })
    const bounded = boundModel(llm, counts[kind])
    const model = { ...bounded, async *stream(messages, options) { if (kind === 'main' && compactions !== 1) throw new InferenceError('Required compaction was not adopted; no main request was sent', 'eval_compaction'); yield* bounded.stream(messages, options) } }
    const engine = new Engine({ name: spec.name, path: spec.path, description: spec.description, systemPrompt: spec.body, soul: spec.soul, learned: '', llm: async () => model, tools,
      ...spec.engine, maxSteps: kind === 'main' ? 6 : 1, repairs: kind === 'main' ? spec.engine.repairs ?? 2 : 0,
      context: contexts(spec.context, spec.notes),
      ctx: { request, agent: { name: spec.name, path: spec.path }, host: null, runContext: { evaluation: 'immutable-repair-v1', sourceFingerprint: fixture.sourceFingerprint }, board: { list: () => request('board.list') }, memory: { list: () => request('memory.list') } },
      verifyCompletion: kind === 'main' ? () => request('workspace.acceptance') : null,
    })
    engine.listen(event => {
      evidence.record(kind, phase, event)
      if (event.kind === 'compacted') compactions++
      if (['status', 'request', 'completion', 'call', 'observation', 'compacted', 'compaction_failed'].includes(event.kind)) onProgress({ agent: kind, phase, kind: event.kind, name: event.name, status: event.slot?.status, counts: Object.fromEntries(Object.entries(counts).map(([name, value]) => [name, value.count])) })
    })
    return engine
  }
  const main = create(input.specs.main, 'main'), compactor = create(input.specs.compactor, 'compactor')
  const startedAt = new Date().toISOString()
  let answer = '', error = ''
  try {
    const call = { do: 'tool', act: [[{ name: 'workspace_check', args: { assertions: fixture.originalFailure.assertions } }]] }
    // The evaluator executes the historical plan once through the real tool adapter.
    // Its typed observation is then fixture history; these are not model completions.
    const observed = await main.act(call)
    const baseline = checks[0]?.receipt
    if (!baseline || baseline.ok || baseline.results.length !== fixture.auditAnchor.failedIndex || !baseline.errors.some(error => error.includes('actual text') && error.includes(fixture.auditAnchor.expectedActualFromSource))) throw new Error('Counterexample baseline did not reproduce; no model request was sent')
    main.history = [
      { role: 'user', content: 'Evaluator fixture observations follow. The source and baseline inspection are real; these turns were not generated by this fresh agent.' },
      { role: 'observation', content: JSON.stringify({ fixtureSourceReads: fixture.files }) },
      { role: 'assistant', content: JSON.stringify(call) },
      { role: 'observation', content: observed },
    ]
    main.compactAt = 0; main.keep = 1
    main.summarise = async text => {
      compactInput = text
      main.compactAt = Infinity; main.summarise = null // Exactly one forced invocation; never compress again.
      phase = 'compaction'
      summary = await compactor.invoke(text, { signal: combined })
      phase = 'main'
      if (compactor.status !== 'done') throw new Error(`Compactor ended ${compactor.status}; summary rejected`)
      return summary
    }
    phase = 'main'
    answer = await main.invoke(GOAL, { signal: combined })
  } catch (cause) { error = cause?.message ?? String(cause) }
  const measured = Object.fromEntries(Object.entries(counts).map(([name, value]) => [name, value.count]))
  return snapshot({ version: 1, evaluation: 'immutable-repair-v1', startedAt, completedAt: new Date().toISOString(), userAgent: globalThis.navigator?.userAgent ?? 'not-browser',
    provenance: input.provenance, resolvedModelSettings: resolvedSettings, fixture: { provenance: fixture.provenance, sourceFingerprint: fixture.sourceFingerprint, originalFailureSha256: fixture.originalFailureSha256, originalFailure: fixture.originalFailure, auditAnchor: fixture.auditAnchor },
    artifact: { id: artifact.id, buildId: artifact.buildId, revision: artifact.revision }, build: input.build,
    deviations: ['Fresh in-memory Engine; no Hub, worker, persistent history, or owner steering.', 'Frozen native-built artifact; only fixture file reads and actual browser inspections. Mutation/delegation attempts are denied and fail the evaluation.', 'One forced compaction before the first main request; six main requests, one compactor request, two total inspections; transport retries disabled. Inference/admission deadline is 15 minutes. An already-running inspector drains under its production maximum 240-second deadline and is never replayed.', 'Explicit authorized evaluation model catalogue (not saved UI settings): Qwen local endpoint, temperature 0, thinking false, main output 8192, context32768. AgentSpec bodies/templates/projection stay current; compactor keeps its production output override2048. Exact resolved settings and ProviderRequests are recorded.', 'Independent human summary-fidelity and behavioral-coverage review is required. A passing inspector alone cannot prove correct task coverage.'],
    counts: measured, forbidden, main: { status: main.status, reason: main.terminationReason, answer, turns: main.history }, compactor: { status: compactor.status, summary, source: compactInput, compactions },
    error, checks, events: evidence.snapshot(), assessment: executionAssessment({ baseline: checks[0]?.receipt, repaired: latestCheck, originalPlan: fixture.originalFailure.assertions, compactions, main, counts: measured, forbidden }),
  })
}
