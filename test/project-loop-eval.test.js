import { expect, test } from 'bun:test'
import { evaluateProjectLoop, repairCycle } from '../scripts/evals/project-loop.js'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
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

test('an absent project manifest never runs an ancestor package test script', async () => {
  const root = await mkdtemp(join(tmpdir(), 'askk-eval-ancestor-'))
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { content: 'invalid response' }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
    { headers: { 'content-type': 'text/event-stream' } },
  ) })
  try {
    const marker = join(root, 'ancestor-ran')
    await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { test: `touch '${marker}'` } }))
    const result = await evaluateProjectLoop({ baseUrl: `http://127.0.0.1:${server.port}/v1`, model: 'fixture', directory: join(root, 'attempt'), caseName: 'project' })
    const evidence = JSON.parse(await readFile(result.evidence, 'utf8'))
    const checks = evidence.checks.filter(check => ['independent package test script', 'independent Bun test discovery'].includes(check.name))
    expect(result.passed).toBe(false)
    expect(checks).toHaveLength(2)
    expect(await Bun.file(marker).exists()).toBe(false)
    for (const check of checks) {
      expect(check.passed).toBe(false)
      expect(check.reason).toContain('command not started')
      expect(check.output).toBeUndefined()
    }
  } finally { server.stop(true); await rm(root, { recursive: true, force: true }) }
}, 15000)
