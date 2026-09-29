import { expect, spyOn, test } from 'bun:test'
import { evaluateProjectLoop, repairCycle, evaluationSampling } from '../scripts/evals/project-loop.js'
import { LocalExecution } from '../src/execution/local.js'
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const trace = () => ({
  events: [
    { kind: 'call', name: 'workspace_read', callId: 'source', sequence: 1 },
    { kind: 'observation', callId: 'source', sequence: 2, ok: true, activity: { path: 'src/total.js' } },
    { kind: 'call', name: 'workspace_read', callId: 'tests', sequence: 3 },
    { kind: 'observation', callId: 'tests', sequence: 4, ok: true, activity: { path: 'total.test.js' } },
    { kind: 'call', name: 'workspace_run', callId: 'fail', sequence: 5 },
    { kind: 'observation', callId: 'fail', sequence: 6, ok: false, activity: { commandId: 'c1' } },
    { kind: 'call', name: 'workspace_write', callId: 'edit', sequence: 7 },
    { kind: 'observation', callId: 'edit', sequence: 8, ok: true, activity: { path: 'src/total.js' } },
    { kind: 'call', name: 'workspace_run', callId: 'pass', sequence: 9 },
    { kind: 'observation', callId: 'pass', sequence: 10, ok: true, activity: { commandId: 'c2' } },
  ],
  commands: [{ id: 'c1', command: 'bun test', code: 1, stage: 'complete' }, { id: 'c2', command: 'bun test', code: 0, stage: 'complete', sourceUnchanged: true, completedRevision: 'delivered' }],
})
test('repair evaluation requires read, relevant failure, source edit and same fresh test', () => {
  const { events, commands } = trace()
  expect(repairCycle(events, commands, 'delivered')).toEqual({ passed: true, failedCallId: 'fail', editCallId: 'edit', passedCallId: 'pass' })
  commands.forEach(command => { command.command = '  bun run test  ' })
  expect(repairCycle(events, commands, 'delivered').passed).toBe(true)
})
test('repair evaluation rejects unrelated, missing, ambiguous, stale or unacknowledged evidence', () => {
  for (const mutate of [
    f => { f.commands[0].command = 'false'; f.commands[1].command = 'true'; f.events[7].activity.path = 'unrelated.txt' },
    f => { f.events[1].ok = false },
    f => { f.events[3].activity = {} },
    f => { f.events[3].sequence = 6 },
    f => { f.events[5].activity = {} },
    f => { f.commands[0].cancelled = true },
    f => { f.commands[0].timedOut = true },
    f => { f.commands[0].code = -1; f.commands[0].signal = 'SIGTERM' },
    f => { f.events.push({ ...f.events[4] }) },
    f => { f.events[7].ok = false },
    f => { f.events[7].activity.path = 'total.test.js' },
    f => { f.events[8].sequence = 7 },
    f => { f.commands[1].command = 'bun run test' },
    f => { f.commands[1].completedRevision = 'old-source' },
    f => { f.commands[1].sourceUnchanged = false },
    f => { f.commands[1].timedOut = true },
    f => { f.commands[1].signal = 'SIGTERM' },
    f => { f.commands[1].stage = 'running' },
  ]) {
    const fixture = trace(); mutate(fixture)
    expect(repairCycle(fixture.events, fixture.commands, 'delivered').passed).toBe(false)
  }
})

test('agent commands without a manifest cannot run the archive ancestor test script', async () => {
  const root = await mkdtemp(join(tmpdir(), 'askk-eval-ancestor-'))
  const jobs = [], startJob = LocalExecution.prototype.startJob
  const jobSpy = spyOn(LocalExecution.prototype, 'startJob').mockImplementation(function (options) { jobs.push(options); return startJob.call(this, options) })
  const requests = []
  const sampling = { temperature: 0.6, top_p: 0.95, top_k: 20, min_p: 0, seed: 42 }
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: async request => {
    requests.push(await request.json())
    const call = requests.length === 1 ? { id: 'write', name: 'workspace_write', args: { path: 'retained.txt', content: 'saved by the agent', expect: 0 } }
      : requests.length === 2 ? { id: 'test', name: 'workspace_run', args: { command: 'bun run test' } }
      : requests.length === 3 ? { id: 'pwd', name: 'workspace_run', args: { command: 'pwd' } } : null
    const delta = call ? { tool_calls: [{ index: 0, id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] } : { content: 'The project test failed.' }
    return new Response(
    `data: ${JSON.stringify({ choices: [{ delta, finish_reason: call ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
    { headers: { 'content-type': 'text/event-stream' } },
  ) } })
  try {
    const marker = join(root, 'ancestor-ran')
    await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { test: `touch '${marker}'` } }))
    const result = await evaluateProjectLoop({ baseUrl: `http://127.0.0.1:${server.port}/v1`, model: 'fixture', directory: join(root, 'attempt'), caseName: 'project', sampling, responseProtocol: 'native', contractVersion: 3, historyFormat: 'messages' })
    const evidence = JSON.parse(await readFile(result.evidence, 'utf8'))
    const checks = evidence.checks.filter(check => ['independent package test script', 'independent Bun test discovery'].includes(check.name))
    expect(evidence.sampling).toEqual(sampling)
    expect(requests.length).toBeGreaterThan(0)
    for (const request of requests) for (const [key, value] of Object.entries(sampling)) expect(request[key]).toBe(value)
    expect(result.passed).toBe(false)
    const withheld = evidence.checks.find(check => check.args?.[0] === '-e')
    expect(withheld.passed).toBe(false)
    expect(withheld.code).not.toBe(0)
    expect(withheld.output).toBe('')
    expect(withheld.stderr).toContain('Cannot find module')
    expect(withheld.stderr).toContain('./src/total.js')
    expect(evidence.checks.find(check => check.name === 'agent ran the declared test script against delivered source')?.passed).toBe(false)
    expect(checks).toHaveLength(2)
    expect(evidence.commands.map(command => command.command)).toEqual(['bun run test', 'pwd'])
    expect(jobs.filter(job => job.program === '/bin/sh').map(job => job.timeout)).toEqual([30, 30])
    const independentJobs = jobs.filter(job => job.program === process.execPath)
    expect(independentJobs.length).toBeGreaterThan(0)
    expect(independentJobs.every(job => job.timeout === 10)).toBe(true)
    expect(evidence.commands[0].code).not.toBe(0)
    const environment = evidence.executionEnvironment
    for (const key of ['token', 'url', 'authorization', 'headers']) expect(environment).not.toHaveProperty(key)
    expect(evidence.commands[0].runtimeId).toBe(environment.runtimeId)
    expect(evidence.commands[1].output.trim()).toBe(environment.root)
    expect(environment.root.startsWith(root + '/')).toBe(false)
    expect(environment.archiveRoot).toBe(join(root, 'attempt/project'))
    expect(JSON.parse(await readFile(join(root, 'attempt/execution-environment.json'), 'utf8'))).toEqual(environment)
    expect(await stat(environment.root).catch(error => error.code)).toBe('ENOENT')
    expect(await readFile(join(root, 'attempt/project/retained.txt'), 'utf8')).toBe('saved by the agent')
    expect(await Bun.file(join(root, 'attempt/project/package.json')).exists()).toBe(false)
    expect(await Bun.file(marker).exists()).toBe(false)
    for (const check of checks) {
      expect(check.passed).toBe(false)
      expect(check.reason).toContain('command not started')
      expect(check.output).toBeUndefined()
    }
  } finally { jobSpy.mockRestore(); server.stop(true); await rm(root, { recursive: true, force: true }) }
}, 15000)

test('a cancelled agent command archives saved source and removes its execution root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'askk-eval-cancel-'))
  let requests = 0, exitReceipt, independentStarts = 0
  const startJob = LocalExecution.prototype.startJob
  const jobSpy = spyOn(LocalExecution.prototype, 'startJob').mockImplementation(async function (options) {
    if (options.program === process.execPath) {
      independentStarts++
      expect(exitReceipt?.cancelled).toBe(true)
      expect(Number.isInteger(exitReceipt?.code)).toBe(true)
    }
    const result = await startJob.call(this, options)
    if (options.program === '/bin/sh') exitReceipt = result
    return result
  })
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: async request => {
    await request.json()
    const call = ++requests === 1
      ? { id: 'write', name: 'workspace_write', args: { path: 'retained.txt', content: 'saved before cancellation', expect: 0 } }
      : { id: 'sleep', name: 'workspace_run', args: { command: "trap 'printf settled > stopped.txt; exit 143' TERM; sleep 30 & wait" } }
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
  } })
  try {
    const result = await evaluateProjectLoop({ baseUrl: `http://127.0.0.1:${server.port}/v1`, model: 'fixture', directory: join(root, 'attempt'), timeoutMs: 1000, responseProtocol: 'native', contractVersion: 3, historyFormat: 'messages' })
    const evidence = JSON.parse(await readFile(result.evidence, 'utf8'))
    expect(result.passed).toBe(false)
    expect(independentStarts).toBeGreaterThan(0)
    expect(evidence.commands[0].cancelled).toBe(true)
    expect(evidence.commands[0].stage).toBe('complete')
    expect(evidence.agentOperationsSettledAt).toBeGreaterThanOrEqual(evidence.commands[0].finishedAt)
    expect(await readFile(join(root, 'attempt/project/stopped.txt'), 'utf8')).toBe('settled')
    expect(evidence.tools.some(event => event.kind === 'call' && event.name === 'workspace_run')).toBe(true)
    expect(await readFile(join(root, 'attempt/project/retained.txt'), 'utf8')).toBe('saved before cancellation')
    expect(await stat(evidence.executionEnvironment.root).catch(error => error.code)).toBe('ENOENT')
  } finally { jobSpy.mockRestore(); server.stop(true); await rm(root, { recursive: true, force: true }) }
}, 15000)

test('evaluation sampling is explicit, validated, detached and defaults remain stable', () => {
  expect(evaluationSampling()).toEqual({ temperature: 0 })
  const input = { temperature: 0.6, top_p: 0.95, seed: 42 }
  const copy = evaluationSampling(input)
  input.temperature = 0
  expect(copy.temperature).toBe(0.6)
  for (const input of [null, [], { temperature: '0.6' }, { temperature: NaN }, { temperature: 3 }, { top_p: 0 }, { top_k: 1.5 }, { min_p: -1 }, { seed: -1 }, { messages: [] }, { max_tokens: 10 }]) expect(() => evaluationSampling(input)).toThrow()
})

for (const testMode of ['real', 'skipped', 'empty']) test(`repair fixture independently verifies ${testMode} tests`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'askk-eval-repair-'))
  let step = 0, sourceRevision, testRevision
  const source = "export function total(values) { let sum = 0; for (const value of values) { if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid number'); sum += value } return sum }\n"
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: async request => {
    const body = await request.json()
    const last = body.messages.filter(message => message.role === 'tool').at(-1)
    if (step === 1) sourceRevision = JSON.parse(last.content).stages[0][0].result.rev
    if (step === 2) testRevision = JSON.parse(last.content).stages[0][0].result.rev
    const calls = [
      { name: 'workspace_read', args: { path: 'src/total.js' } },
      { name: 'workspace_read', args: { path: 'total.test.js' } },
      { name: 'workspace_run', args: { command: 'bun test' } },
      { name: 'workspace_write', args: { path: 'src/total.js', content: source, expect: sourceRevision } },
      ...(testMode === 'real' ? [] : [{ name: 'workspace_write', args: { path: 'total.test.js', content: testMode === 'empty' ? '' : "import {test} from 'bun:test'; test.skip('skipped', () => {});\n", expect: testRevision } }]),
      { name: 'workspace_run', args: { command: 'bun test' } },
    ]
    const call = calls[step++]
    const delta = call ? { tool_calls: [{ index: 0, id: `call${step}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] } : { content: 'Finished fixture.' }
    return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: call ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
  } })
  try {
    const result = await evaluateProjectLoop({ baseUrl: `http://127.0.0.1:${server.port}/v1`, model: 'fixture', directory: join(root, 'attempt'), caseName: 'repair', responseProtocol: 'native', contractVersion: 3, historyFormat: 'messages' })
    const evidence = JSON.parse(await readFile(result.evidence, 'utf8'))
    expect(evidence.checks.find(check => check.name === 'declared test script')?.passed).toBe(true)
    expect(evidence.checks.some(check => check.name === 'agent ran the declared test script against delivered source')).toBe(false)
    expect(evidence.checks.find(check => check.name === 'independent Bun test discovery')?.passed).toBe(testMode === 'real')
    expect(evidence.checks.find(check => check.name === 'observed failure-driven repair cycle')?.passed).toBe(true)
    expect(result.passed).toBe(testMode === 'real')
  } finally { server.stop(true); await rm(root, { recursive: true, force: true }) }
}, 15000)

for (const variant of ['valid', 'numeric-prefix', 'numeric-prefix-signal', 'missing-newline', 'missing-assertion']) test(`script completion and withheld assertions: ${variant}`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'askk-eval-script-'))
  let step = 0, required = []
  const conversion = variant === 'numeric-prefix' ? 'parseFloat(arg)' : 'Number(arg)'
  const print = variant === 'missing-newline' ? 'process.stdout.write(String(sum))' : 'console.log(sum)'
  const signalPrefix = variant === 'numeric-prefix-signal' ? 'if(process.argv.includes("12oops"))process.kill(process.pid,"SIGTERM");' : ''
  const source = `${signalPrefix}let sum=0;for(const arg of process.argv.slice(2)){const n=${conversion};if(!Number.isFinite(n))process.exit(1);sum+=n}${print}\n`
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: async request => {
    const body = await request.json()
    if (!step) {
      const context = body.messages.find(message => message.content?.includes('Workspace environment:\n')).content
      const environment = JSON.parse(context.split('Workspace environment:\n')[1].split('\n')[0])
      required = environment.referenceCompletion.checks[0].options.commands
    }
    const calls = [
      { name: 'workspace_write', args: { path: 'total.js', content: source, expect: 0 } },
      ...required.slice(0, variant === 'missing-assertion' ? -1 : undefined).map(command => ({ name: 'workspace_run', args: { command } })),
      // A legitimate expected failure can be the last command; completion must
      // use all configured assertions rather than the last command's exit code.
      { name: 'workspace_run', args: { command: 'bun total.js invalid' } },
    ]
    const call = calls[step++]
    const delta = call ? { tool_calls: [{ index: 0, id: `script${step}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] } : { content: 'Finished fixture.' }
    return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: call ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
  } })
  try {
    const result = await evaluateProjectLoop({ baseUrl: `http://127.0.0.1:${server.port}/v1`, model: 'fixture', directory: join(root, 'attempt'), responseProtocol: 'native', contractVersion: 3, historyFormat: 'messages' })
    const evidence = JSON.parse(await readFile(result.evidence, 'utf8'))
    expect(required).toHaveLength(4)
    expect(evidence.completion.checks[0].capability).toBe('workspace.commands')
    expect(evidence.commands.at(-1).code).toBe(1)
    expect(evidence.commands.at(-1).sourceUnchanged).toBe(true)
    expect(result.passed).toBe(variant === 'valid')
    expect(evidence.agentCompleted).toBe(['valid', 'numeric-prefix', 'numeric-prefix-signal'].includes(variant))
    expect(evidence.independentChecksPassed).toBe(['valid', 'missing-assertion'].includes(variant))
    if (variant === 'numeric-prefix') {
      for (const args of [['total.js', '12oops'], ['total.js', '3.5junk'], ['total.js', '1e'], ['total.js', '2', '1oops', '3']]) {
        const check = evidence.checks.find(check => JSON.stringify(check.args) === JSON.stringify(args))
        expect(check.code).toBe(0)
        expect(check.passed).toBe(false)
      }
    }
    if (variant === 'numeric-prefix-signal') {
      const check = evidence.checks.find(check => check.args?.[1] === '12oops')
      expect(check.code).toBe(-1)
      expect(check.signal).toBe('SIGTERM')
      expect(check.cancelled).toBe(false)
      expect(check.timedOut).toBe(false)
      expect(check.passed).toBe(false)
    }
    if (variant === 'missing-newline') {
      expect(evidence.checks[0].output).toBe('12.5')
      expect(evidence.checks[0].passed).toBe(false)
    }
    if (variant === 'valid') expect(evidence.checks[0].output).toBe('12.5\n')
  } finally { server.stop(true); await rm(root, { recursive: true, force: true }) }
}, 15000)
