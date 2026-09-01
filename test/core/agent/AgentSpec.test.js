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

  test('a limit that is not a number is REFUSED, not read off the front of a string', () => {
    // `Number.parseInt` was doing this, and every line below was silently
    // becoming a budget a thousandth of the size its author wrote — with no
    // note, so the run just looked like the model giving up early. Measured:
    // `tokens: "250k"` produced a 250-token budget that closed after the first
    // turn.
    const built = spec({
      name: 'x',
      budget: { tokens: '250k', seconds: '10m', steps: '2.5e5' },
    })

    expect(built.value.budget).toEqual({ steps: 250_000 })
    expect(built.notes).toContain(
      'agents/x/agent.md: budget.tokens "250k" is not a positive number; ignored',
    )
    expect(built.notes).toContain(
      'agents/x/agent.md: budget.seconds "10m" is not a positive number; ignored',
    )
  })

  test('a thousands separator and an overflow are refused too', () => {
    const built = spec({ name: 'x', budget: { tokens: '250,000', steps: '1e400' } })

    expect(built.value.budget).toEqual({})
    expect(built.notes).toHaveLength(2)
  })

  test('a key that is not a currency this loop spends costs a note', () => {
    // The code's own comment promised this and the code did not do it:
    // `budget: {minutes: 5}` produced no budget and no note, and left an author
    // certain they had set one.
    const built = spec({ name: 'x', budget: { minutes: 5 } })

    expect(built.value.budget).toEqual({})
    expect(built.notes).toContain(
      'agents/x/agent.md: budget.minutes is not a limit this loop spends; ignored',
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
    const built = spec({ name: 'x', prompt: ['instructions', 'budget', 'cue'] })

    expect(built.value.prompt).toEqual(['instructions', 'budget', 'cue'])
  })
})

/**
 * Whether this agent's model is allowed a scratchpad.
 *
 * Here at all because `OpenAICompatible` documented `thinking: false` as the
 * escape hatch from a false positive in its own classifier, and shipped with no
 * path from any file or setting to that constructor argument — a switch on the
 * inside of a locked door. These tests are the lock: every one of them fails if
 * the field stops being read.
 */
describe('AgentSpec thinking', () => {
  test('a file that says nothing has no opinion, so the app-wide setting decides', () => {
    // Null and not false. A boolean default here would override settings for
    // every agent file ever written, none of which mention the word.
    expect(spec({ name: 'x' }).value.thinking).toBe(null)
  })

  test('a file can turn it off, under either spelling', () => {
    expect(spec({ name: 'x', thinking: false }).value.thinking).toBe(false)
    expect(spec({ name: 'x', enable_thinking: false }).value.thinking).toBe(false)
    expect(spec({ name: 'x', thinking: true }).value.thinking).toBe(true)
  })

  test('YAML that reads a boolean as a word still means the boolean', () => {
    expect(spec({ name: 'x', thinking: 'false' }).value.thinking).toBe(false)
    expect(spec({ name: 'x', thinking: 'TRUE' }).value.thinking).toBe(true)
  })

  test('anything that is not true or false costs the line and leaves a note', () => {
    // `thinking: "no"` must not become true because a non-empty string is
    // truthy, which is the whole reason this is not a `Boolean()` call.
    const built = spec({ name: 'x', thinking: 'no' })

    expect(built.value.thinking).toBe(null)
    expect(built.notes).toContain('agents/x/agent.md: thinking "no" is not true or false; ignored')
  })
})

/**
 * A setting that is deleted has to be RETIRED and not merely gone.
 *
 * `format` chose between a TOON contract and a JSON one; no run ever chose the
 * JSON arm, so the enum went. Left out of `RETIRED`, the deletion would have
 * manufactured the very defect it removes: `format: json` would land in `raw`,
 * reach no reader, and leave its author believing they had asked for JSON —
 * silent, which is what this file's opening rule exists to forbid.
 */
describe('AgentSpec format, retired', () => {
  test('a file still asking for a format is told the setting is gone', () => {
    const built = spec({ name: 'x', format: 'json' })

    expect(built.notes.some((note) => note.startsWith('agents/x/agent.md: format'))).toBe(true)
    expect(built.value.format).toBeUndefined()
  })

  test('a file that never mentioned it is told nothing', () => {
    expect(spec({ name: 'x' }).notes.some((note) => note.includes('format'))).toBe(false)
  })
})
