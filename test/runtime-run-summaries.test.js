import { expect, test } from 'bun:test'
import { Hub } from '../src/runtime/hub.js'

test('restored roster reads retained metadata without loading tool archives and includes the coordinator identity', async () => {
  const hub = new Hub({ base: 'https://desk.invalid/' })
  const root = { id: 'root', trace: 'root', taskId: 'root', agent: 'lead', kind: 'strategy', at: 1, slot: { status: 'done' }, prompts: [{ secret: 'not a roster field' }] }
  const child = { id: 'child', trace: 'root', parent: 'root', agent: 'observer', kind: 'strategy-role', stageId: 'observe', at: 2, query: 'Inspect the evidence', slot: { status: 'interrupted' }, toolEventCount: 999, toolEvents: [{ large: true }], requests: [{ large: true }] }
  let reads = 0
  hub.store = { all: async name => { expect(name).toBe('runs'); return [child, root] }, readToolEvents() { reads++; throw new Error('Roster must not load full evidence') } }
  const rows = await hub.runsApi.summaries()
  expect(rows.map(row => row.id)).toEqual(['root', 'child'])
  expect(rows[1]).toMatchObject({ parent: 'root', stageId: 'observe', slot: { status: 'interrupted' } })
  expect(rows.every(row => !('prompts' in row) && !('toolEvents' in row) && !('requests' in row))).toBe(true)
  expect(reads).toBe(0)
  expect(Object.isFrozen(rows[1].slot)).toBe(true)
  child.slot.status = 'done'
  expect(rows[1].slot.status).toBe('interrupted')
})

test('live metadata overrides the same retained identity without merging different runs of one agent', async () => {
  const hub = new Hub({ base: 'https://desk.invalid/' })
  hub.store = { all: async () => [{ id: 'one', agent: 'observer', at: 1, slot: { status: 'waiting' } }, { id: 'two', agent: 'observer', at: 2, slot: { status: 'done' } }] }
  hub.runs.set('one', { id: 'one', agent: 'observer', at: 1, ended: false, slot: { status: 'thinking', current: 'Current work' } })
  const rows = await hub.runsApi.summaries()
  expect(rows).toHaveLength(2)
  expect(rows[0]).toMatchObject({ id: 'one', ended: false, slot: { status: 'thinking', current: 'Current work' } })
  expect(rows[1]).toMatchObject({ id: 'two', trace: 'two', slot: { status: 'done' } })
})
