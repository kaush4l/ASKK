import { createObservedWorkspace } from '../../src/core/write-observations.js'
/** Opt-in real-model evaluation. Agents use the production folder, worker, desk broker,
 * workspace adapters and real Local Bun commands. Independent checks never use LLM judgments. */
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { normalizeCompletion } from '../../src/core/completion.js'
import { resolveCommandReference } from '../../src/core/command-reference.js'
import { Hub } from '../../src/runtime/hub.js'
import { LocalExecution } from '../../src/execution/local.js'
import { createCompanion } from '../../host/companion.js'
import { listing } from '../listing.js'
import { createEvaluationWorkspace, ranDeclaredTests, bunTestReport, evaluationTimeoutSeconds } from './workspace-evidence.js'

// Expected failures belong inside assertions: the assertion succeeds only when
// the child rejects input. These are task configuration, not engine behavior.
const scriptCommands = [
  { args: ['2', '3'], output: '5\n' },
  { args: ['-2', '-3'], output: '-5\n' },
  { args: [], output: '0\n' },
  { args: ['invalid'], output: null },
].map(({ args, output }) => {
  const assertion = output === null
    ? 'Number.isInteger(r.exitCode)&&r.exitCode!==0&&!r.signalCode&&!r.error'
    : `r.exitCode===0&&!r.signalCode&&!r.error&&r.stdout.toString()===${JSON.stringify(output)}`
  return `bun -e 'const r=Bun.spawnSync([process.execPath,"total.js",...${JSON.stringify(args)}],{timeout:5000});if(!(${assertion}))process.exit(1)'`
})

const cases = {
  script: {
    goal: 'Create total.js in this workspace. It is a dependency-free CLI run with bun total.js followed by numeric arguments. Print their sum as one number and a newline; no arguments prints 0. Reject any nonnumeric argument with a nonzero exit code. Run concrete checks for positive and negative inputs, empty input, and invalid input. Do not create a web app.',
    completion: { checks: [{ capability: 'workspace.commands', options: { commands: scriptCommands, requireFresh: true } }] },
    checks: [['total.js', '19', '-7', '0.5'], ['total.js', '-8', '-2.25'], ['total.js'], ['total.js', 'invalid'], ['total.js', '12oops'], ['total.js', '3.5junk'], ['total.js', '1e'], ['total.js', '2', '1oops', '3']], expected: ['12.5\n', '-10.25\n', '0\n', null, null, null, null, null], exactOutput: true,
  },
  project: {
    goal: 'Scaffold a minimal dependency-free Bun JavaScript project. Export total(values) from src/total.js: sum finite numbers in an array, returning 0 for an empty array, throwing for nonnumeric or nonfinite entries. Include package.json with a test script and real bun:test tests. Run the test script with bun run test and check its results. Do not create a web app.',
    checks: [['-e', "import {total} from './src/total.js'; if(total([19,-7,0.5])!==12.5||total([])!==0)process.exit(2); for(const v of [['x'],[NaN],[Infinity]]){let failed=false;try{total(v)}catch{failed=true}if(!failed)process.exit(3)} console.log('withheld passed')"]], expected: ['withheld passed'],
  },
  repair: {
    goal: 'Repair the existing total(values) implementation in src/total.js. It must sum finite numeric array entries, return 0 for an empty array, and throw on nonnumeric or nonfinite entries. Read the existing source and tests, run the tests, fix the cause, and run the tests again. Preserve the dependency-free Bun project.',
    seed: { 'src/total.js': 'export function total(values) { return 0 }\n', 'package.json': '{"type":"module","scripts":{"test":"bun test"}}\n', 'total.test.js': "import {test,expect} from 'bun:test';import {total} from './src/total.js';test('adds',()=>expect(total([2,3])).toBe(5));\n" },
    checks: [['-e', "import {total} from './src/total.js';if(total([19,-7,0.5])!==12.5||total([])!==0)process.exit(2);for(const v of [['x'],[NaN],[Infinity]]){let failed=false;try{total(v)}catch{failed=true}if(!failed)process.exit(3)}console.log('withheld passed')"]], expected: ['withheld passed'],
  },
}

/** Require source/test reads, a failing test, an acknowledged source edit, and
 * the same test rerun successfully against the delivered source. */
export function repairCycle(events, commands, deliveredRevision) {
  const uniqueCall = id => {
    const matches = events.filter(row => row.kind === 'call' && row.callId === id)
    return matches.length === 1 ? matches[0] : null
  }
  const outcomes = events.filter(row => row.kind === 'observation').map(row => {
    const call = uniqueCall(row.callId)
    const receipts = commands.filter(command => command.id === row.activity?.commandId)
    return { row, call, receipt: receipts.length === 1 ? receipts[0] : null }
  }).filter(({ row, call }) => call && row.sequence > call.sequence)
  const testCommand = receipt => ['bun test', 'bun run test'].includes(receipt?.command?.trim())
  const completed = receipt => receipt?.stage === 'complete' && Number.isInteger(receipt.code) && !receipt.cancelled && !receipt.timedOut && !receipt.signal
  for (const failed of outcomes) {
    if (failed.call.name !== 'workspace_run' || failed.row.ok !== false || !completed(failed.receipt) || failed.receipt.code === 0 || !testCommand(failed.receipt)) continue
    const readRequired = ['src/total.js', 'total.test.js'].every(path => outcomes.some(read => read.call.name === 'workspace_read' && read.row.ok === true && read.row.activity?.path === path && read.row.sequence < failed.call.sequence))
    if (!readRequired) continue
    for (const edit of outcomes) {
      if (edit.call.name !== 'workspace_write' || edit.row.ok !== true || edit.row.activity?.path !== 'src/total.js' || !(edit.call.sequence > failed.row.sequence)) continue
      const passed = outcomes.find(check => check.call.name === 'workspace_run' && check.row.ok === true && completed(check.receipt) && check.receipt.code === 0 && check.receipt.command?.trim() === failed.receipt.command.trim() && check.call.sequence > edit.row.sequence && check.receipt.sourceUnchanged === true && (deliveredRevision === undefined || check.receipt.completedRevision === deliveredRevision))
      if (passed) return { passed: true, failedCallId: failed.row.callId, editCallId: edit.row.callId, passedCallId: passed.row.callId }
    }
  }
  return { passed: false, reason: 'No required reads → failing test → acknowledged source edit → same successful test against delivered source was observed.' }
}

/** Evaluation sampling belongs to the model profile, not agent logic. */
export function evaluationSampling(value = { temperature: 0 }) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('sampling must be an object')
  const rules = {
    temperature: n => Number.isFinite(n) && n >= 0 && n <= 2,
    top_p: n => Number.isFinite(n) && n > 0 && n <= 1,
    top_k: n => Number.isSafeInteger(n) && n > 0,
    min_p: n => Number.isFinite(n) && n >= 0 && n <= 1,
    seed: n => Number.isSafeInteger(n) && n >= 0,
  }
  for (const [key, number] of Object.entries(value)) if (!Object.hasOwn(rules, key) || !rules[key](number)) throw new Error(`Invalid evaluation sampling parameter: ${key}`)
  return { temperature: 0, ...value }
}

export async function evaluateProjectLoop({ baseUrl, model, directory, caseName = 'script', timeoutMs = 240000, commandTimeoutSeconds = 30, checkTimeoutSeconds = 10, contextLength = 32768, jsonOutput = false, enableThinking = false, maxOutputTokens = 2048, contractVersion, structuredOutput = false, historyFormat, sampling, responseProtocol, instructions, completion, rejectedCompletionHistory }) {
  evaluationTimeoutSeconds(commandTimeoutSeconds); evaluationTimeoutSeconds(checkTimeoutSeconds)
  if (rejectedCompletionHistory !== undefined && !['retain', 'omit'].includes(rejectedCompletionHistory)) throw new Error('Unsupported rejectedCompletionHistory')
  if (responseProtocol !== undefined && !['envelope', 'native'].includes(responseProtocol)) throw new Error('Unsupported responseProtocol')
  if (responseProtocol === 'native' && (contractVersion !== 3 || historyFormat !== 'messages')) throw new Error('Native evaluation requires contractVersion 3 and historyFormat messages')
  if (instructions !== undefined && (typeof instructions !== 'string' || !instructions.trim() || instructions.length > 32000)) throw new Error('Evaluation instructions must be nonempty text of at most 32000 characters')
  if (!cases[caseName]) throw new Error(`Choose one of ${Object.keys(cases).join(', ')}`)
  const completionContract = normalizeCompletion(completion ?? cases[caseName].completion ?? { checks: [{ capability: 'workspace.command', options: { requireFresh: true } }] })
  const resolvedSampling = evaluationSampling(sampling)
  const { temperature, ...samplingParams } = resolvedSampling
  if (!Number.isSafeInteger(contextLength) || contextLength < 4096) throw new Error('Evaluation context length must be an integer of at least 4096 tokens')
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens >= contextLength) throw new Error('maxOutputTokens must be a positive integer smaller than contextLength')
  if (typeof enableThinking !== 'boolean') throw new Error('enableThinking must be a boolean')
  if (contractVersion !== undefined && ![2, 3].includes(contractVersion)) throw new Error('Evaluation contractVersion must be 2 or 3')
  if (typeof structuredOutput !== 'boolean' || structuredOutput && jsonOutput) throw new Error('structuredOutput must be boolean and cannot be combined with jsonOutput')
  if (historyFormat !== undefined && !['transcript', 'messages'].includes(historyFormat)) throw new Error('Unsupported historyFormat')
  const evaluatorHashes = {}
  for (const name of ['project-loop.js', 'workspace-evidence.js']) evaluatorHashes[name] = createHash('sha256').update(await readFile(new URL(name, import.meta.url))).digest('hex')
  const definition = cases[caseName], root = resolve(directory), site = join(root, 'site'), project = join(root, 'project')
  // Refuse overwrite so every attempt retains its own source and evidence.
  await mkdir(root, { recursive: false }); await mkdir(project); await mkdir(site)
  for (const name of ['packages', 'tools']) await cp(new URL(`../../public/${name}`, import.meta.url), join(site, name), { recursive: true })
  if (contractVersion !== undefined) {
    const path = join(site, 'packages/starter/agents/builder/agent.md')
    await writeFile(path, (await readFile(path, 'utf8')).replace(/^contract_version: .*$/m, `contract_version: ${contractVersion}`))
  }
  if (responseProtocol !== undefined) {
    const path = join(site, 'packages/starter/agents/builder/agent.md')
    await writeFile(path, (await readFile(path, 'utf8')).replace('response_format: \"json\"', `response_format: \"json\"\nresponse_protocol: \"${responseProtocol}\"`))
  }
  if (historyFormat !== undefined) {
    const path = join(site, 'packages/starter/agents/builder/agent.md')
    await writeFile(path, (await readFile(path, 'utf8')).replace('observation_format: "compact"', `observation_format: "compact"\nhistory_format: "${historyFormat}"`))
  }
  if (rejectedCompletionHistory !== undefined) {
    const path = join(site, 'packages/starter/agents/builder/agent.md')
    const source = await readFile(path, 'utf8')
    const property = `rejected_completion_history: "${rejectedCompletionHistory}"`
    await writeFile(path, /^rejected_completion_history:.*$/m.test(source)
      ? source.replace(/^rejected_completion_history:.*$/m, property)
      : source.replace('observation_format: "compact"', `observation_format: "compact"\n${property}`))
  }
  if (instructions !== undefined) {
    const path = join(site, 'packages/starter/agents/builder/agent.md')
    const source = await readFile(path, 'utf8')
    const end = source.indexOf('\n---\n', 4)
    if (end < 0) throw new Error('Builder front matter terminator missing')
    await writeFile(path, source.slice(0, end + 5) + instructions.trim() + '\n')
  }
  await cp(new URL('../../public/desk.json', import.meta.url), join(site, 'desk.json'))
  await mkdir(join(site, 'agents'))
  await writeFile(join(site, 'models.json'), JSON.stringify({ default: 'evaluation', models: { evaluation: { provider: 'openai', model, base_url: baseUrl, context_length: contextLength, max_output_tokens: maxOutputTokens, temperature, ...(structuredOutput ? { structured_output: 'json_schema' } : {}), request_params: { ...samplingParams, chat_template_kwargs: { enable_thinking: enableThinking }, ...(jsonOutput ? { response_format: { type: 'json_object' } } : {}) } } } }))
  await writeFile(join(site, 'agents/index.json'), JSON.stringify(await listing(site)))
  // Bun searches ancestor directories for package scripts. Execute outside the
  // evidence/repository tree, including agent commands, not just withheld checks.
  const executionRoot = await mkdtemp(join(tmpdir(), 'askk-project-loop-'))
  let companion, execution, hub, timer, unsubscribe
  let workspace; const responses = [], attempts = new Map(); const startedAt = Date.now()
  try {
    companion = await createCompanion({ root: executionRoot, port: 0, capabilities: ['fs', 'exec'] })
    execution = new LocalExecution({ url: companion.url, token: companion.token, onEvent: event => workspace?.onEvent(event) })
    await execution.prepare()
    const executionEnvironment = { ...execution.describeCapabilities(), archiveRoot: project }
    await writeFile(join(root, 'execution-environment.json'), JSON.stringify(executionEnvironment, null, 2))
    workspace = createEvaluationWorkspace(execution, { commandTimeoutSeconds })
    const commands = workspace.commands
    for (const [path, content] of Object.entries(definition.seed ?? {})) await execution.write({ path, content, expectedRevision: 0 })
    hub = new Hub({ base: `${pathToFileURL(site).href}/`, storeName: `project-eval-${crypto.randomUUID()}` })
    unsubscribe = hub.subscribe(event => {
      if (event.type !== 'event') return
      if (event.kind === 'prompt') {
        const response = { runId: event.run, attemptId: event.attemptId, text: '' }
        responses.push(response); attempts.set(event.run, response)
      } else if (event.kind === 'delta' && attempts.has(event.run)) attempts.get(event.run).text += event.value
    })
    hub.externalOps = {
      'workspace.environment': async () => ({ target: 'local', status: 'ready', toolchain: execution.describeCapabilities().toolchain, files: (await execution.list()).map(row => row.path), capabilities: ['fs', 'exec'] }),
      'workspace.list': () => execution.list(),
      'workspace.read': ({ path }) => execution.read(path),
      'workspace.write': async ({ path, content, expect }) => { const result = await workspace.write({ path, content, expectedRevision: expect }); return result.conflict ? result : { ...result, ok: true, rev: result.rev ?? result.revision } },
      'workspace.run': (args, run) => workspace.run(resolveCommandReference(args, run?.completion, { resolved: true }).command, run),
    }
    const observedWorkspace = createObservedWorkspace({ read: hub.externalOps['workspace.read'], write: hub.externalOps['workspace.write'], identity: () => { const current = execution.describeCapabilities(); return JSON.stringify([current.runtimeId, current.root]) } })
    hub.externalOps['workspace.read'] = observedWorkspace.read
    hub.externalOps['workspace.write'] = observedWorkspace.write
    hub.completionAdapters = { 'workspace.command': (options, run) => workspace.check(options, run), 'workspace.commands': (options, run) => workspace.checkRequired(options, run) }
    await hub.start()
    await hub.settings.set({ policy: { defaults: { read: 'allow', net: 'deny', write: 'allow', exec: 'allow' } } })
    const goal = definition.goal + (completionContract.checks.some(check => check.capability === 'workspace.commands') ? '\nRun every configured command in workspace environment referenceCompletion through workspace_run after saving the final source. You may select each by its zero-based requiredCheck index instead of copying the command text. Each required command must itself exit zero.' : '')
    const run = hub.startRun('bundled/starter/builder', goal, { context: { workflow: { completion: completionContract } } })
    timer = setTimeout(() => { workspace.stop(); hub.abort(run) }, timeoutMs)
    await run.answer
    clearTimeout(timer)
    workspace.stop()
    await workspace.drain()
    const settledAt = Date.now()
    const checks = []
    const deliveredRevision = await workspace.revision()
    for (const [index, args] of definition.checks.entries()) {
      let output = ''
      let stderr = ''
      const result = await execution.startJob({ program: process.execPath, args, timeout: checkTimeoutSeconds, onOutput: event => {
        const text = event.data ?? event.text ?? ''
        if (event.stream === 'stderr') stderr += text
        else output += text
      } })
      checks.push({ args, code: result.code, signal: result.signal, cancelled: result.cancelled, timedOut: result.timedOut, output: definition.exactOutput ? output : output.trim(), stderr, passed: !result.signal && !result.cancelled && !result.timedOut && (definition.expected[index] === null ? Number.isInteger(result.code) && result.code !== 0 && checks.every(check => check.passed) : result.code === 0 && (definition.exactOutput ? output : output.trim()) === definition.expected[index]) })
    }
    if (caseName === 'project' || caseName === 'repair') {
      let declared = false
      try { const pkg = JSON.parse((await execution.read('package.json')).content); declared = typeof pkg.scripts?.test === 'string' && Boolean(pkg.scripts.test.trim()) } catch {}
      checks.push({ name: 'declared test script', passed: declared })
      if (caseName === 'project') checks.push({ name: 'agent ran the declared test script against delivered source', passed: declared && ranDeclaredTests(commands, run, deliveredRevision) })
      const reportPath = join(root, `bun-tests-${crypto.randomUUID()}.xml`)
      for (const args of [['run', 'test'], ['test', '--reporter=junit', `--reporter-outfile=${reportPath}`]]) {
        // Bun can resolve a missing package script from an ancestor project.
        // Never let this evaluator run the harness's own tests as project evidence.
        if (!declared) {
          checks.push({ name: args[0] === 'run' ? 'independent package test script' : 'independent Bun test discovery', passed: false, reason: 'No test script declared in the delivered project; command not started.' })
          continue
        }
        let output = ''
        const result = await execution.startJob({ program: process.execPath, args, timeout: checkTimeoutSeconds, onOutput: event => { output += event.data ?? event.text ?? '' } })
        const report = args[0] === 'test' ? bunTestReport(await readFile(reportPath, 'utf8').catch(() => '')) : null
        checks.push({ name: args[0] === 'run' ? 'independent package test script' : 'independent Bun test discovery', args, code: result.code, signal: result.signal, output, report, passed: result.code === 0 && !result.signal && !result.cancelled && !result.timedOut && (report === null || report.passed) })
      }
    }
    if (caseName === 'repair') checks.push({ name: 'observed failure-driven repair cycle', ...repairCycle(run.toolEvents, commands, deliveredRevision) })
    const checkedRevision = await workspace.revision()
    checks.push({ name: 'independent checks retained the delivered source', deliveredRevision, checkedRevision, passed: deliveredRevision === checkedRevision })
    const evidence = { version: 2, executionTimeouts: { agentSeconds: commandTimeoutSeconds, independentSeconds: checkTimeoutSeconds }, evaluatorHashes, instructionsOverride: instructions ?? null, deliveredRevision, checkedRevision, completion: run.completion, completionReceipts: run.completionReceipts ?? [], completionProposals: run.completionProposals ?? [], rejectedCompletionHistory: hub.specs.get('bundled/starter/builder')?.engine.rejectedCompletionHistory ?? 'retain', replyRejections: run.replyRejections ?? [], caseName, model, baseUrl, contextLength, sampling: resolvedSampling, responseProtocol: hub.specs.get('bundled/starter/builder')?.engine.responseProtocol ?? 'envelope', jsonOutput, structuredOutput, historyFormat: hub.specs.get('bundled/starter/builder')?.engine.historyFormat ?? 'transcript', enableThinking, maxOutputTokens, contractVersion: hub.specs.get('bundled/starter/builder')?.engine.contractVersion, responses, turns: run.turns, events: run.log, runtime: 'Local Bun (not Browser Linux)', startedAt, elapsedMs: Date.now() - startedAt, result: run.result, status: run.slot.status, passed: run.slot.status === 'done' && checks.every(row => row.passed), agentCompleted: run.slot.status === 'done', independentChecksPassed: checks.every(row => row.passed), checks, commands, prompts: run.prompts, requests: run.requests, completions: run.completions, tools: run.toolEvents, files: await execution.list(), metrics: { promptCount: run.prompts.length, repairs: run.log.filter(row => row.kind === 'repair').length, toolCalls: run.toolEvents.filter(row => row.kind === 'call').length, inputTokensEstimated: run.prompts.map(row => row.snapshot?.budget?.inputTokens) } }
    evidence.executionEnvironment = executionEnvironment
    evidence.agentOperationsSettledAt = settledAt
    await writeFile(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
    return { caseName, passed: evidence.passed, status: evidence.status, checks, elapsedMs: evidence.elapsedMs, metrics: evidence.metrics, evidence: join(root, 'evidence.json') }
  } catch (error) {
    await writeFile(join(root, 'lifecycle-error.json'), JSON.stringify({ error: error.message, code: error.code ?? null, commands: workspace?.commands ?? [], executionRoot }, null, 2))
    throw error
  } finally {
    clearTimeout(timer); unsubscribe?.()
    let shutdownConfirmed = !companion
    try {
      try { workspace?.stop(); await workspace?.drain() } finally {
        try { hub?.stop() } finally {
          try { await execution?.dispose() } finally { await companion?.close(); shutdownConfirmed = true }
        }
      }
    } finally {
      // Unknown shutdown or failed archival retains temporary source for recovery.
      if (shutdownConfirmed) {
        await cp(executionRoot, project, { recursive: true })
        await rm(executionRoot, { recursive: true, force: true })
      }
    }
  }
}
if (import.meta.main) {
  if (!process.argv.includes('--run')) throw new Error('Explicit --run required; this evaluation lets the model write files and execute commands in its new project directory.')
  const option = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1] }
  const model = option('--model'), baseUrl = option('--base-url'), directory = option('--directory')
  if (!model || !baseUrl || !directory) throw new Error('Provide --model, --base-url and a new --directory path; optional --case script|project|repair.')
  console.log(JSON.stringify(await evaluateProjectLoop({ model, baseUrl, directory, commandTimeoutSeconds: Number(option('--command-timeout') ?? 30), checkTimeoutSeconds: Number(option('--check-timeout') ?? 10), completion: option('--completion') ? JSON.parse(await readFile(option('--completion'), 'utf8')) : undefined, instructions: option('--instructions') ? await readFile(option('--instructions'), 'utf8') : undefined, sampling: option('--sampling') ? JSON.parse(await readFile(option('--sampling'), 'utf8')) : undefined, caseName: option('--case') ?? 'script', contextLength: Number(option('--context-length') ?? 32768), jsonOutput: process.argv.includes('--json-output'), structuredOutput: process.argv.includes('--structured-output'), historyFormat: option('--history-format'), rejectedCompletionHistory: option('--rejected-completion-history'), responseProtocol: option('--response-protocol'), enableThinking: process.argv.includes('--thinking'), maxOutputTokens: Number(option('--max-output-tokens') ?? 2048), contractVersion: option('--contract-version') === undefined ? undefined : Number(option('--contract-version')) }), null, 2))
}
