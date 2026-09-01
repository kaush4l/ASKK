import { describe, expect, test } from 'bun:test'
import { AgentSpec } from '../../../src/core/agent/AgentSpec.js'

/**
 * What an agent file is allowed to say about what a run of it may cost.
 *
 * The interesting case is `max_steps`. It was listed as retired, with a note
 * telling its author the loop has no ceiling — which was true of the mechanism
 * and wrong about the number: somebody wrote 8 because they meant 8. It is
 * honoured again, and the note that used to say it did nothing now says what it
 * does instead, because the word means something different from what it meant
 * when they wrote it.
 */

const spec = (metadata) =>
  AgentSpec.of({ metadata, body: 'do things', source: 'agents/x/agent.md' })

describe('AgentSpec budget', () => {
  test('nothing declared leaves the terms empty, so Budget applies its own', () => {
    expect(spec({ name: 'x' }).value.budget).toEqual({})
  })

  test('each of the three is separately optional', () => {
    expect(spec({ name: 'x', budget: { steps: 8 } }).value.budget).toEqual({ steps: 8 })
    expect(spec({ name: 'x', budget: { tokens: 40000, seconds: 90 } }).value.budget).toEqual({
      tokens: 40000,
      seconds: 90,
    })
  })

  test('a term that is not a limit costs that term and leaves a note', () => {
    const built = spec({ name: 'x', budget: { steps: 0, tokens: 5000 } })

    expect(built.value.budget).toEqual({ tokens: 5000 })
    expect(built.notes).toContain(
      'agents/x/agent.md: budget.steps 0 is not a positive number; ignored',
    )
  })

  test('max_steps is honoured as the step line, and its author is told what changed', () => {
    const built = spec({ name: 'x', max_steps: 8 })

    expect(built.value.budget).toEqual({ steps: 8 })
    expect(built.notes).toContain(
      "agents/x/agent.md: max_steps is this agent's budget.steps now — the agent is told the number, not stopped at it",
    )
  })

  test('an explicit budget wins over the older word for the same number', () => {
    expect(spec({ name: 'x', max_steps: 8, budget: { steps: 3 } }).value.budget).toEqual({
      steps: 3,
    })
  })
})

describe('AgentSpec prompt', () => {
  test('budget is a block an agent file may name, now that it is one', () => {
    // It was not, for the length of one review: the block rendered correctly and
    // was dropped from every prompt because the template did not list its id,
    // which also meant a file asking for it by name was told it is not a block.
    const built = spec({ name: 'x', prompt: ['identity', 'budget', 'cue'] })

    expect(built.value.prompt).toEqual(['identity', 'budget', 'cue'])
  })
})
