import { describe, expect, test } from 'bun:test'
import { Conversation } from '../../src/core/Conversation.js'
import { MAX_STEPS, Plan, StepState } from '../../src/core/Plan.js'

/**
 * The plan is the half of "take a goal and compose it into tasks" that the goal
 * block cannot do on its own, and the properties worth pinning are the ones a
 * long run depends on: that revising the list does not lose what is known about
 * the steps that survived, that the address the model READS is the address it
 * WRITES, and that the whole thing comes back after a reload.
 */

describe('composing a plan', () => {
  test('a list of lines becomes steps, in order, all pending', () => {
    const plan = new Plan()
    plan.compose(['read the spec', 'write the test', 'make it pass'])

    expect(plan.steps.map((step) => step.text)).toEqual([
      'read the spec',
      'write the test',
      'make it pass',
    ])
    expect(plan.steps.every((step) => step.state === StepState.PENDING)).toBe(true)
  })

  test('revising carries state across by text, not by position', () => {
    // The whole reason `compose` matches on words. A revision that inserts a
    // step at the front would otherwise hand every later step its predecessor's
    // state, and the plan would report finished work that never happened.
    const plan = new Plan()
    plan.compose(['write the test', 'make it pass'])
    plan.mark(1, StepState.DONE)

    plan.compose(['read the spec', 'write the test', 'make it pass'])

    expect(plan.steps.map((step) => step.state)).toEqual([
      StepState.PENDING,
      StepState.DONE,
      StepState.PENDING,
    ])
  })

  test('a step whose wording changed is a different step and starts again', () => {
    const plan = new Plan()
    plan.compose(['write the test'])
    plan.mark(1, StepState.DONE)

    plan.compose(['write the tests'])

    expect(plan.steps[0].state).toBe(StepState.PENDING)
  })

  test('the same step twice is kept once, and said so', () => {
    const plan = new Plan()
    const notes = plan.compose(['ship it', 'ship it'])

    expect(plan.steps.length).toBe(1)
    expect(notes.join(' ')).toContain('twice')
  })

  test('empty lines are not steps', () => {
    const plan = new Plan()
    plan.compose(['real', '', '   '])

    expect(plan.steps.length).toBe(1)
  })

  test('a runaway list is cut, and the cut says so', () => {
    // A truncation nobody is told about leaves the reader certain it has seen
    // everything — the rule the file listing in `ChatService` already follows.
    const plan = new Plan()
    const notes = plan.compose(Array.from({ length: MAX_STEPS + 5 }, (_, i) => `step ${i}`))

    expect(plan.steps.length).toBe(MAX_STEPS)
    expect(notes.join(' ')).toContain(String(MAX_STEPS))
  })
})

describe('marking a step', () => {
  test('ordinals are the numbers the rendered list shows', () => {
    const plan = new Plan()
    plan.compose(['first', 'second'])
    plan.mark(2, StepState.DONE)

    expect(plan.render()).toBe('1. [ ] first\n2. [x] second')
  })

  test('an ordinal nobody has answers null rather than throwing', () => {
    // The caller is a tool answering a model. An ordinal that does not exist is
    // something to say back, not an end to the turn.
    const plan = new Plan()
    plan.compose(['only'])

    expect(plan.mark(2, StepState.DONE)).toBe(null)
    expect(plan.mark(0, StepState.DONE)).toBe(null)
    expect(plan.mark('two', StepState.DONE)).toBe(null)
  })

  test('a state nobody has is refused rather than stored', () => {
    const plan = new Plan()
    plan.compose(['only'])

    expect(plan.mark(1, 'finished-ish')).toBe(null)
    expect(plan.steps[0].state).toBe(StepState.PENDING)
  })

  test('outstanding counts what is left, and dropped is not left', () => {
    const plan = new Plan()
    plan.compose(['a', 'b', 'c', 'd'])
    plan.mark(1, StepState.DONE)
    plan.mark(2, StepState.DROPPED)
    plan.mark(3, StepState.ACTIVE)

    expect(plan.outstanding.map((step) => step.text)).toEqual(['c', 'd'])
  })
})

describe('what the model reads', () => {
  test('an empty plan renders nothing, so the block is dropped', () => {
    expect(new Plan().render()).toBe('')
    expect(new Plan().isEmpty).toBe(true)
  })

  test('every state has its own mark', () => {
    const plan = new Plan()
    plan.compose(['p', 'a', 'd', 'x'])
    plan.mark(2, StepState.ACTIVE)
    plan.mark(3, StepState.DONE)
    plan.mark(4, StepState.DROPPED)

    expect(plan.render()).toBe('1. [ ] p\n2. [>] a\n3. [x] d\n4. [-] x')
  })
})

describe('a plan survives being written down', () => {
  test('the record round trips through JSON', () => {
    const plan = new Plan()
    plan.compose(['one', 'two'], 1000)
    plan.mark(1, StepState.DONE, 2000)

    const again = Plan.fromJSON(JSON.parse(JSON.stringify(plan.toJSON())))

    expect(again.render()).toBe(plan.render())
    expect(again.revisedAt).toBe(2000)
  })

  test('a record this module did not write is repaired, not refused', () => {
    // The doctrine `Message` and `Conversation` already follow: the store hands
    // back whatever was written, including by a version that had never heard of
    // a field.
    expect(Plan.fromJSON(undefined).isEmpty).toBe(true)
    expect(Plan.fromJSON({ steps: 'not a list' }).isEmpty).toBe(true)
    expect(Plan.fromJSON({ steps: [{ text: 'ok', state: 'nonsense' }] }).steps[0].state).toBe(
      StepState.PENDING,
    )
  })

  test('the conversation carries it, so a reload does not lose it', () => {
    const conversation = new Conversation({ id: 'c-1', goal: 'ship the thing' })
    conversation.plan.compose(['one', 'two'])
    conversation.plan.mark(1, StepState.DONE)

    const again = Conversation.fromJSON(JSON.parse(JSON.stringify(conversation.toJSON())))

    expect(again.plan.render()).toBe('1. [x] one\n2. [ ] two')
  })

  test('a conversation written before plans existed still loads', () => {
    const again = Conversation.fromJSON({ id: 'c-old', title: 'before', messages: [] })

    expect(again.plan.isEmpty).toBe(true)
    expect(again.toJSON().plan).toEqual({ steps: [], revisedAt: 0 })
  })

  test('compose takes a record as readily as a plan', () => {
    const conversation = new Conversation({ id: 'c-2' })
    conversation.compose({ steps: [{ text: 'from a record', state: StepState.ACTIVE }] })

    expect(conversation.plan.render()).toBe('1. [>] from a record')
  })
})
