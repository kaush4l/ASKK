import { describe, expect, test } from 'bun:test'
import { Plan, StepState } from '../../../src/core/Plan.js'
import { PlanTool } from '../../../src/core/tools/PlanTool.js'

/**
 * The tool that writes the decomposition. Everything here is about what the
 * AGENT reads back, because that text is the only thing the next step of the
 * turn has to go on: a call that renumbers the list and answers "ok" has left
 * the agent addressing steps that have moved.
 */

/** A port over a real plan, recording whether a write was attempted. */
const portFor = (plan, { stores = true } = {}) => {
  const writes = []
  return {
    writes,
    port: {
      read: () => plan,
      write: async (revised) => {
        writes.push(revised)
        return stores
      },
    },
  }
}

describe('writing the list', () => {
  test('steps become the plan, and the answer is the new numbering', async () => {
    const plan = new Plan()
    const { port, writes } = portFor(plan)
    const tool = new PlanTool({ plan: port })

    const said = await tool.call({ steps: ['read the spec', 'write the test'] })

    expect(said.ok).toBe(true)
    expect(said.value).toContain('1. [ ] read the spec')
    expect(said.value).toContain('2. [ ] write the test')
    expect(said.value).toContain('2 steps left of 2')
    expect(writes.length).toBe(1)
  })

  test('the plan the prompt renders is the one the tool changed', async () => {
    // The live object and not a copy. A copy would leave the rest of the turn
    // reading the list the agent had already replaced.
    const plan = new Plan()
    const { port } = portFor(plan)

    await new PlanTool({ plan: port }).call({ steps: ['only'] })

    expect(plan.render()).toBe('1. [ ] only')
  })

  test('steps that are not a list are said back, and change nothing', async () => {
    const plan = new Plan()
    plan.compose(['keep me'])
    const { port, writes } = portFor(plan)

    const said = await new PlanTool({ plan: port }).call({ steps: 'read the spec' })

    expect(said.ok).toBe(true)
    expect(said.value).toContain('list')
    expect(plan.render()).toBe('1. [ ] keep me')
    expect(writes.length).toBe(0)
  })
})

describe('saying where the work has got to', () => {
  test('done, doing and drop move the step they name', async () => {
    const plan = new Plan()
    plan.compose(['a', 'b', 'c'])
    const { port } = portFor(plan)
    const tool = new PlanTool({ plan: port })

    await tool.call({ done: 1 })
    await tool.call({ doing: 2 })
    await tool.call({ drop: 3 })

    expect(plan.render()).toBe('1. [x] a\n2. [>] b\n3. [-] c')
  })

  test('composing and marking in one call number against the NEW list', async () => {
    // "Here is the new list, and I have finished the first of it." Numbering
    // against the old one would tick off whatever used to be there.
    const plan = new Plan()
    plan.compose(['old'])
    const { port } = portFor(plan)

    await new PlanTool({ plan: port }).call({ steps: ['new first', 'new second'], done: 1 })

    expect(plan.steps[0].state).toBe(StepState.DONE)
    expect(plan.steps[0].text).toBe('new first')
  })

  test('a step nobody has is said back rather than failed', async () => {
    const plan = new Plan()
    plan.compose(['only'])
    const { port } = portFor(plan)

    const said = await new PlanTool({ plan: port }).call({ done: 4 })

    expect(said.ok).toBe(true)
    expect(said.value).toContain('no step 4')
    expect(said.value).toContain('has 1')
  })

  test('marking against an empty plan says to write one', async () => {
    const { port } = portFor(new Plan())

    const said = await new PlanTool({ plan: port }).call({ done: 1 })

    expect(said.value).toContain('the plan is empty')
  })

  test('a call with no arguments changes nothing and says so', async () => {
    const plan = new Plan()
    plan.compose(['a'])
    const { port, writes } = portFor(plan)

    const said = await new PlanTool({ plan: port }).call({})

    expect(said.value).toContain('Nothing was changed')
    expect(writes.length).toBe(0)
  })
})

describe('when the plan cannot be stored', () => {
  test('the agent is told it will not survive a reload', async () => {
    const { port } = portFor(new Plan(), { stores: false })

    const said = await new PlanTool({ plan: port }).call({ steps: ['one'] })

    expect(said.ok).toBe(true)
    expect(said.value).toContain('not stored')
  })

  test('with no port at all the plan still works for the turn', async () => {
    // `NO_PLAN`, like `NO_TASKS` and `NO_FILES`: a tool built without its
    // collaborator says what it cannot do rather than throwing on a user's
    // machine.
    const said = await new PlanTool().call({ steps: ['one', 'two'] })

    expect(said.ok).toBe(true)
    expect(said.value).toContain('1. [ ] one')
    expect(said.value).toContain('not stored')
  })
})
