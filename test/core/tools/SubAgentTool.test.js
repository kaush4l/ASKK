import { describe, expect, test } from 'bun:test'
import { Outcome } from '../../../src/core/Outcome.js'
import { SubAgentTool } from '../../../src/core/tools/SubAgentTool.js'
import { Toolbox } from '../../../src/core/tools/Toolbox.js'

/**
 * The one tool that has something to abort, and the chain that reaches it.
 *
 * A delegated call is not a function call: it is a second agent, on a second
 * thread, spending a second budget. Before the signal was threaded, pressing
 * stop ended the parent run and left that agent generating to completion for a
 * caller that had already gone — up to a full 24-step default, capped only by
 * the pool's own five-minute wait on a worker it was no longer listening to.
 *
 * The link asserted here is the one in `core/`: loop -> toolbox -> tool ->
 * dispatch. The far end, where the id becomes a second postMessage naming the
 * first, is `AgentWorkerPool`'s and is the same shape as `CANCEL`.
 */

describe('SubAgentTool', () => {
  test('the stop travels with the task', async () => {
    const seen = []
    const tool = new SubAgentTool({
      spec: { name: 'researcher', description: 'looks things up' },
      dispatch: (name, task, signal) => {
        seen.push({ name, task, signal })
        return Promise.resolve(Outcome.ok('found it'))
      },
    })
    const stop = new AbortController()

    await tool.call({ task: 'find the kernel version' }, stop.signal)

    expect(seen).toHaveLength(1)
    expect(seen[0].signal).toBe(stop.signal)
  })

  test('the toolbox carries it the whole way from the loop', async () => {
    // The seam that mattered: `Toolbox.run` took no signal at all, so a tool
    // that accepted one could never be handed the user's.
    let handed = null
    const tool = new SubAgentTool({
      spec: { name: 'researcher', description: 'looks things up' },
      dispatch: (_name, _task, signal) => {
        handed = signal
        return Promise.resolve(Outcome.ok('found it'))
      },
    })
    const stop = new AbortController()

    await new Toolbox([tool]).run('researcher({"task": "go"})', stop.signal)

    expect(handed).toBe(stop.signal)
  })

  test('a tool asked for nothing does not start a thread to say so', async () => {
    let called = false
    const tool = new SubAgentTool({
      spec: { name: 'researcher', description: '' },
      dispatch: () => {
        called = true
        return Promise.resolve(Outcome.ok(''))
      },
    })

    const answered = await tool.call({ task: '   ' }, null)

    expect(called).toBe(false)
    expect(answered.value).toContain('was given no task')
  })
})

/**
 * Handing work over instead of waiting for it.
 *
 * The difference between a sub-agent that costs the parent the child's whole
 * runtime and one that costs a round trip. What comes back is a receipt, and
 * the id in it is what the context block and `check_task` both use.
 */
describe('a task handed over rather than awaited', () => {
  const spec = { name: 'researcher', description: 'reads pages' }

  test('wait: false returns a receipt at once and never touches the dispatcher', async () => {
    const started = []
    const tool = new SubAgentTool({
      spec,
      dispatch: async () => {
        throw new Error('the dispatcher must not be called for a handed-over task')
      },
      start: (name, task) => {
        started.push({ name, task })
        return { id: 't7', agent: name }
      },
    })

    const said = await tool.call({ task: 'read the release notes', wait: false })

    expect(started).toEqual([{ name: 'researcher', task: 'read the release notes' }])
    expect(said.value).toContain('t7')
    expect(said.value).toContain('check_task')
  })

  /**
   * A model writes what it writes. `"false"` out of a JSON-ish argument string
   * has to mean the same thing as `false`, and everything else — including
   * nothing at all — has to keep the waiting behaviour nobody asked to change.
   */
  test('the spellings a model actually writes all hand over; anything else waits', async () => {
    const waited = []
    const tool = new SubAgentTool({
      spec,
      dispatch: async (_name, task) => {
        waited.push(task)
        return Outcome.ok('answered')
      },
      start: () => ({ id: 't1', agent: 'researcher' }),
    })

    // Every one of these is something a model writes for "do not wait", and
    // each used to wait in silence except the first two.
    for (const written of [false, 'false', 'no', 0, '0', 'async', 'background']) {
      expect((await tool.call({ task: 'x', wait: written })).value).toContain('t1')
    }
    expect((await tool.call({ task: 'b' })).value).toBe('answered')
    expect((await tool.call({ task: 'c', wait: true })).value).toBe('answered')
    expect((await tool.call({ task: 'd', wait: 'yes' })).value).toBe('answered')
    expect(waited).toEqual(['b', 'c', 'd'])
  })

  test('a realm that cannot hold a task says so instead of waiting anyway', async () => {
    const tool = new SubAgentTool({ spec, dispatch: async () => Outcome.ok('answered') })

    const said = await tool.call({ task: 'go', wait: false })

    expect(said.value).toContain('cannot be handed work here')
    expect(said.value).toContain('without wait: false')
  })
})
