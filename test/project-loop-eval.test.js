import { expect, spyOn, test } from 'bun:test'
import { evaluateProjectLoop, repairCycle, evaluationSampling } from '../scripts/evals/project-loop.js'
import { LocalExecution } from '../src/execution/local.js'
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const trace = () => ({
  events: [
    { kind: 'call', name: 'workspace_run', callId: 'fail', sequence: 1 },
    { kind: 'observation', callId: 'fail', sequence: 2, ok: false, activity: { commandId: 'c1' } },
    { kind: 'call', name: 'workspace_write', callId: 'edit', sequence: 3 },
    { kind: 'observation', callId: 'edit', sequence: 4, ok: true, activity: { path: 'src/total.js' } },
    { kind: 'call', name: 'workspace_run', callId: 'pass', sequence: 5 },
    { kind: 'observation', callId: 'pass', sequence: 6, ok: true, activity: { commandId: 'c2' } },
  ],
  commands: [{ id: 'c1', code: 1 }, { id: 'c2', code: 0 }],
})
test('repair evaluation needs an observed command failure before editing and a new successful check', () => {
  const { events, commands } = trace()
  expect(repairCycle(events, commands)).toEqual({ passed: true, failedCallId: 'fail', editCallId: 'edit', passedCallId: 'pass' })
  expect(repairCycle(events.slice(2), commands).passed).toBe(false)
  events[4].sequence = 3 // Check started while the edit was still unacknowledged.
  expect(repairCycle(events, commands).passed).toBe(false)
})
test('a rejected proposal, cancelled command or ambiguous call is not a reproduced failure', () => {
  for (const mutate of [
    fixture => { fixture.events[1].activity = {} },
    fixture => { fixture.commands[0].cancelled = true },
    fixture => { fixture.events.push({ ...fixture.events[0] }) },
    fixture => { fixture.events[3].ok = false },
  ]) {
    const fixture = trace(); mutate(fixture)
    expect(repairCycle(fixture.events, fixture.commands).passed).toBe(false)
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
