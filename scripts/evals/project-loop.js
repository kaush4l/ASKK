/** Opt-in real-model evaluation. Agents use the production folder, worker, desk broker,
 * workspace adapters and real Local Bun commands. Independent checks never use LLM judgments. */
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Hub } from '../../src/runtime/hub.js'
import { LocalExecution } from '../../src/execution/local.js'
import { createCompanion } from '../../host/companion.js'
import { listing } from '../listing.js'

const cases = {
  script: {
    goal: 'Create total.js in this workspace. It is a dependency-free CLI run with bun total.js followed by numeric arguments. Print their sum as one number and a newline; no arguments prints 0. Reject any nonnumeric argument with a nonzero exit code. Run concrete checks for positive and negative inputs, empty input, and invalid input. Do not create a web app.',
    checks: [['total.js', '19', '-7', '0.5'], ['total.js'], ['total.js', 'invalid']], expected: ['12.5', '0', null],
  },
  project: {
    goal: 'Scaffold a minimal dependency-free Bun JavaScript project. Export total(values) from src/total.js: sum finite numbers in an array, returning 0 for an empty array, throwing for nonnumeric or nonfinite entries. Include package.json with a test script and real bun:test tests. Run the test script and check its results. Do not create a web app.',
    checks: [['-e', "import {total} from './src/total.js'; if(total([19,-7,0.5])!==12.5||total([])!==0)process.exit(2); for(const v of [['x'],[NaN],[Infinity]]){let failed=false;try{total(v)}catch{failed=true}if(!failed)process.exit(3)} console.log('withheld passed')"]], expected: ['withheld passed'],
  },
  repair: {
    goal: 'Repair the existing total(values) implementation in src/total.js. It must sum finite numeric array entries, return 0 for an empty array, and throw on nonnumeric or nonfinite entries. Read the existing source and tests, run the tests, fix the cause, and run the tests again. Preserve the dependency-free Bun project.',
    seed: { 'src/total.js': 'export function total(values) { return 0 }\n', 'package.json': '{"type":"module","scripts":{"test":"bun test"}}\n', 'total.test.js': "import {test,expect} from 'bun:test';import {total} from './src/total.js';test('adds',()=>expect(total([2,3])).toBe(5));\n" },
    checks: [['-e', "import {total} from './src/total.js';if(total([19,-7,0.5])!==12.5||total([])!==0)process.exit(2);for(const v of [['x'],[NaN],[Infinity]]){let failed=false;try{total(v)}catch{failed=true}if(!failed)process.exit(3)}console.log('withheld passed')"]], expected: ['withheld passed'],
  },
}

/** Require an observed failure, an acknowledged edit, then a newly started check.
 * A repaired file alone does not establish a failure-driven agent loop. */
export function repairCycle(events, commands) {
  const uniqueCall = id => {
    const matches = events.filter(row => row.kind === 'call' && row.callId === id)
    return matches.length === 1 ? matches[0] : null
  }
  const outcomes = events.filter(row => row.kind === 'observation').map(row => {
    const call = uniqueCall(row.callId)
    const receipts = commands.filter(command => command.id === row.activity?.commandId)
    return { row, call, receipt: receipts.length === 1 ? receipts[0] : null }
  })
  for (const failed of outcomes) {
    if (failed.call?.name !== 'workspace_run' || failed.row.ok !== false || !Number.isInteger(failed.receipt?.code) || failed.receipt.code === 0 || failed.receipt.cancelled) continue
    for (const edit of outcomes) {
      if (edit.call?.name !== 'workspace_write' || edit.row.ok !== true || !edit.row.activity?.path || !(edit.call.sequence > failed.row.sequence)) continue
      const passed = outcomes.find(check => check.call?.name === 'workspace_run' && check.row.ok === true && check.receipt?.code === 0 && !check.receipt.cancelled && check.call.sequence > edit.row.sequence)
      if (passed) return { passed: true, failedCallId: failed.row.callId, editCallId: edit.row.callId, passedCallId: passed.row.callId }
    }
  }
  return { passed: false, reason: 'No ordered failed command → acknowledged edit → new successful command was observed.' }
}

export async function evaluateProjectLoop({ baseUrl, model, directory, caseName = 'script', timeoutMs = 240000, contextLength = 32768, jsonOutput = false, enableThinking = false, maxOutputTokens = 2048, contractVersion }) {
  if (!Number.isSafeInteger(contextLength) || contextLength < 4096) throw new Error('Evaluation context length must be an integer of at least 4096 tokens')
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens >= contextLength) throw new Error('maxOutputTokens must be a positive integer smaller than contextLength')
  if (typeof enableThinking !== 'boolean') throw new Error('enableThinking must be a boolean')
  if (contractVersion !== undefined && ![2, 3].includes(contractVersion)) throw new Error('Evaluation contractVersion must be 2 or 3')
  if (!cases[caseName]) throw new Error(`Choose one of ${Object.keys(cases).join(', ')}`)
  const definition = cases[caseName], root = resolve(directory), site = join(root, 'site'), project = join(root, 'project')
  // Refuse overwrite so every attempt retains its own source and evidence.
  await mkdir(root, { recursive: false }); await mkdir(project); await mkdir(site)
  for (const name of ['packages', 'tools']) await cp(new URL(`../../public/${name}`, import.meta.url), join(site, name), { recursive: true })
  if (contractVersion !== undefined) {
    const path = join(site, 'packages/starter/agents/builder/agent.md')
    await writeFile(path, (await readFile(path, 'utf8')).replace(/^contract_version: .*$/m, `contract_version: ${contractVersion}`))
  }
  await cp(new URL('../../public/desk.json', import.meta.url), join(site, 'desk.json'))
  await mkdir(join(site, 'agents'))
  await writeFile(join(site, 'models.json'), JSON.stringify({ default: 'evaluation', models: { evaluation: { provider: 'openai', model, base_url: baseUrl, context_length: contextLength, max_output_tokens: maxOutputTokens, temperature: 0, request_params: { chat_template_kwargs: { enable_thinking: enableThinking }, ...(jsonOutput ? { response_format: { type: 'json_object' } } : {}) } } } }))
  await writeFile(join(site, 'agents/index.json'), JSON.stringify(await listing(site)))
  const companion = await createCompanion({ root: project, port: 0, capabilities: ['fs', 'exec'] })
  const execution = new LocalExecution({ url: companion.url, token: companion.token })
  let hub, timer, unsubscribe
  const commands = [], responses = [], attempts = new Map(); const startedAt = Date.now()
  try {
    await execution.prepare()
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
      'workspace.write': async ({ path, content, expect }) => { const result = await execution.write({ path, content, expectedRevision: expect }); return result.conflict ? result : { ...result, ok: true, rev: result.rev ?? result.revision } },
      'workspace.run': async ({ command }, run) => {
        const id = crypto.randomUUID(); let output = ''
        const result = await execution.startJob({ id, program: '/bin/sh', args: ['-c', command], timeout: 30000, onOutput: event => { output += event.data ?? event.text ?? '' } })
        const receipt = { ...result, id, output, runId: run.id }; commands.push(receipt); return receipt
      },
    }
    hub.completionAdapters = { 'workspace.command': async () => {
      const command = commands.at(-1)
      if (!command) return { ok: false, reason: 'No command has run. Run the written script or project tests with workspace_run, inspect the output, and repair failures before finishing.' }
      if (command.cancelled || command.code !== 0) return { ok: false, reason: `The last command ${command.cancelled ? 'was cancelled' : `exited with code ${command.code}`}. Inspect its output, fix the cause and run the check again.`, commandId: command.id }
      return { ok: true, commandId: command.id, reason: 'A successful command was recorded. Independent withheld-input checks follow the run.' }
    } }
    await hub.start()
    await hub.settings.set({ policy: { defaults: { read: 'allow', net: 'deny', write: 'allow', exec: 'allow' } } })
    const run = hub.startRun('bundled/starter/builder', definition.goal, { context: { workflow: { completion: { checks: [{ capability: 'workspace.command', options: { requireFresh: true } }] } } } })
    timer = setTimeout(() => hub.abort(run), timeoutMs)
    await run.answer
    clearTimeout(timer)
    const checks = []
    for (const [index, args] of definition.checks.entries()) {
      let output = ''
      const result = await execution.startJob({ program: process.execPath, args, timeout: 10000, onOutput: event => { if (event.stream !== 'stderr') output += event.data ?? event.text ?? '' } })
      checks.push({ args, code: result.code, output: output.trim(), passed: definition.expected[index] === null ? result.code !== 0 : result.code === 0 && output.trim() === definition.expected[index] })
    }
    if (caseName === 'project') {
      let valid = false
      try { const pkg = JSON.parse((await execution.read('package.json')).content); valid = typeof pkg.scripts?.test === 'string' && commands.some(row => row.code === 0 && row.output.includes('pass')) } catch {}
      checks.push({ name: 'declared and executed test suite', passed: valid })
    }
    if (caseName === 'repair') checks.push({ name: 'observed failure-driven repair cycle', ...repairCycle(run.toolEvents, commands) })
    const evidence = { version: 1, caseName, model, baseUrl, contextLength, jsonOutput, enableThinking, maxOutputTokens, contractVersion: hub.specs.get('bundled/starter/builder')?.engine.contractVersion, responses, events: run.log, runtime: 'Local Bun (not Browser Linux)', startedAt, elapsedMs: Date.now() - startedAt, result: run.result, status: run.slot.status, passed: run.slot.status === 'done' && checks.every(row => row.passed), checks, commands, prompts: run.prompts, requests: run.requests, completions: run.completions, tools: run.toolEvents, files: await execution.list(), metrics: { promptCount: run.prompts.length, repairs: run.log.filter(row => row.kind === 'repair').length, toolCalls: run.toolEvents.filter(row => row.kind === 'call').length, inputTokensEstimated: run.prompts.map(row => row.snapshot?.budget?.inputTokens) } }
    await writeFile(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
    return { caseName, passed: evidence.passed, status: evidence.status, checks, elapsedMs: evidence.elapsedMs, metrics: evidence.metrics, evidence: join(root, 'evidence.json') }
  } finally { clearTimeout(timer); unsubscribe?.(); hub?.stop(); await execution.dispose(); await companion.close() }
}
if (import.meta.main) {
  if (!process.argv.includes('--run')) throw new Error('Explicit --run required; this evaluation lets the model write files and execute commands in its new project directory.')
  const option = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1] }
  const model = option('--model'), baseUrl = option('--base-url'), directory = option('--directory')
  if (!model || !baseUrl || !directory) throw new Error('Provide --model, --base-url and a new --directory path; optional --case script|project|repair.')
  console.log(JSON.stringify(await evaluateProjectLoop({ model, baseUrl, directory, caseName: option('--case') ?? 'script', contextLength: Number(option('--context-length') ?? 32768), jsonOutput: process.argv.includes('--json-output'), enableThinking: process.argv.includes('--thinking'), maxOutputTokens: Number(option('--max-output-tokens') ?? 2048), contractVersion: option('--contract-version') === undefined ? undefined : Number(option('--contract-version')) }), null, 2))
}
