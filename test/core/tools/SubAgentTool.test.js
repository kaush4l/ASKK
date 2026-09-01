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
