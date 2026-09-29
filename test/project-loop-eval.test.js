import { expect, test } from 'bun:test'
import { repairCycle } from '../scripts/evals/project-loop.js'

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
