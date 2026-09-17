import { describe, expect, test } from 'bun:test'
import { AgentService } from '../../src/backend/services/AgentService.js'
import { Outcome } from '../../src/core/Outcome.js'

describe('ending a handed-over task', () => {
  test('passes the id to the pool and reports whether anything stopped', async () => {
    const asked = []
    const service = new AgentService(
      { all: async () => Outcome.ok([]), spec: async () => Outcome.ok({}) },
      {
        stop(id) {
          asked.push(id)
          return id === 't1'
        },
      },
    )

    expect((await service.stop({ id: 't1' })).value).toBe(true)
    expect((await service.stop({ id: 't9' })).value).toBe(false)
    expect(asked).toEqual(['t1', 't9'])
  })

  test('a build with no pool answers false rather than throwing', async () => {
    const service = new AgentService({ all: async () => Outcome.ok([]) }, null)
    const answered = await service.stop({ id: 't1' })
    expect(answered.ok).toBe(true)
    expect(answered.value).toBe(false)
  })
})
