import { expect, test } from 'bun:test'
import { Engine } from '../src/core/engine.js'
import { inference } from '../src/core/inference.js'
import { Hub } from '../src/runtime/hub.js'
import { openStore } from '../src/runtime/store.js'

for (const repairs of [0, 1]) test(`exhausted validation records identify the final attempt with ${repairs} repairs`, async () => {
  const replies = repairs ? ['[]', '{"do":"done","act":""}'] : ['{"do":"done","act":""}']
  const llm = inference({ provider: 'scripted', replies, maxOutputTokens: 256 })
  const engine = new Engine({ name: 'validation', contractVersion: 2, repairs, llm: async () => llm })
  const events = []; engine.listen(event => events.push(event))
  await engine.invoke('Finish the fixture')
  const prompts = events.filter(event => event.kind === 'prompt')
  const repair = events.filter(event => event.kind === 'repair')
  const rejected = events.find(event => event.kind === 'rejected')
  expect(repair).toHaveLength(repairs)
  if (repairs) expect(repair[0]).toMatchObject({ attemptId: prompts[0].attemptId, faults: ['reply: expected a JSON object, received array'] })
  expect(rejected).toMatchObject({ attemptId: prompts.at(-1).attemptId, step: 1, value: replies.at(-1), faults: ['act: expected a non-empty final answer string'] })
  expect(engine.progress()).toMatchObject({ status: 'failed', terminationReason: 'invalid_response', attempts: repairs + 1 })
  expect(events.some(event => ['call', 'answer'].includes(event.kind))).toBe(false)
})

test('repair and rejection diagnostics survive stored reads without retaining reasoning or mutable event references', async () => {
  const hub = new Hub(); hub.store = await openStore(`validation-records-${crypto.randomUUID()}`)
  const run = { id: 'validation-run', trace: 'validation-run', agent: 'fixture', at: 1, children: [], slot: { status: 'thinking' }, turns: [], prompts: [], requests: [], completions: [], toolEvents: [], spans: [], log: [] }
  hub.runs.set(run.id, run)
  const writes = []; const persist = hub.persist.bind(hub)
  hub.persist = record => { const job = persist(record); writes.push(job); return job }
  const first = { kind: 'repair', attemptId: 'attempt-1', value: 'retrying rejected reply', faults: ['reply: expected a JSON object, received array'] }
  const last = { kind: 'rejected', attemptId: 'attempt-2', step: 1, value: '{"do":"done","act":""}', faults: ['act: expected a non-empty final answer string'] }
  hub.record(run, first)
  hub.record(run, last)
  hub.record(run, { kind: 'reasoning', value: 'Unretained reasoning' })
  first.faults.push('later mutation'); last.faults[0] = 'later mutation'
  expect(writes).toHaveLength(2)
  await Promise.all(writes)
  const reader = new Hub(); reader.store = hub.store
  const restored = await reader.runsApi.get(run.id)
  expect(restored.log.map(({ kind, attemptId, faults }) => ({ kind, attemptId, faults }))).toEqual([
    { kind: 'repair', attemptId: 'attempt-1', faults: ['reply: expected a JSON object, received array'] },
    { kind: 'rejected', attemptId: 'attempt-2', faults: ['act: expected a non-empty final answer string'] },
  ])
  expect(restored.log[1]).toMatchObject({ step: 1, value: last.value })
})
