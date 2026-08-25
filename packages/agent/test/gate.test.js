import { expect, test, describe } from 'bun:test'
import { ANSWERED, CRITIC_FAULTED, ENDED, PASS_CEILING, PASS_SPENT, UNCHECKED, endedWhy } from '@harness/agent'
import { VOTE, agent, body, drive, payloadOf, walked } from './drive.js'

/** @typedef {import('./drive.js').Said} Said */

describe('the critic gates the turn, and cannot be summarised past', () => {
  /** @param {string} verdict @param {Said[]} [tail] */
  const reviewed = (verdict, tail = [{ text: 'All done, and the critic was happy.' }]) => drive(
    agent(), 'check my work', [
      VOTE('react'),
      { calls: [{ id: 'c1', tool: 'critic', args: '{"query":"I wrote index.md"}' }] },
      ...tail,
    ],
    () => ({ ok: true, output: verdict }),
  )

  test('a non-pass ends the turn as faulted, however the caller words its own answer', () => {
    const { state, facts } = reviewed('FAULT\nThe report does not say what the test printed.')
    expect(state.reviewed).toBe(false)
    expect(endedWhy(payloadOf(facts, ENDED))).toBe(CRITIC_FAULTED)
  })

  test('only the bare word clears it: a verdict that merely contains PASS is not a pass', () => {
    expect(endedWhy(payloadOf(reviewed('The work looks fine to me, so PASS.').facts, ENDED))).toBe(CRITIC_FAULTED)
    expect(endedWhy(payloadOf(reviewed('PASS\nThe output is quoted back.').facts, ENDED))).toBe(ANSWERED)
  })

  test('a write after a verdict makes it stale rather than cleared — the fault cannot be edited away', () => {
    const { state, facts } = reviewed('FAULT\nindex.md was never written.', [
      { calls: [{ id: 'c2', tool: 'write_file', args: '{"path":"index.md","text":"hi"}' }] },
      { text: 'I wrote it, so we are fine.' },
    ])
    expect(state.reviewed).toBe(null)
    expect(endedWhy(payloadOf(facts, ENDED))).toBe(UNCHECKED)
  })
})

describe('a lap is earned mechanically, and the budget is what stops it', () => {
  const EXEC = { calls: [{ id: 'c1', tool: 'exec', args: '{"command":"make"}' }] }
  /** @param {number} passes @param {Said[]} script */
  const looping = (passes, script) => drive({ ...agent(), passes }, 'keep at it', [VOTE('react'), ...script])

  test('a lap that ran nothing does not buy another, whatever the reply says about carrying on', () => {
    const { facts } = looping(3, [EXEC, { text: 'Done one thing.' }, { text: 'I will keep going!' }])
    expect(walked(facts)).toEqual(['strategy', 'work', 'work'])
    expect(payloadOf(facts, PASS_SPENT)).toEqual({ pass: 2, of: 3 })
    expect(endedWhy(payloadOf(facts, ENDED))).toBe(ANSWERED)
  })

  test('a turn the budget cut off says so, rather than reporting the answer it never reached', () => {
    const { facts } = looping(2, [EXEC, { text: 'One.' }, EXEC, { text: 'Two.' }])
    expect(walked(facts)).toEqual(['strategy', 'work', 'work'])
    expect(endedWhy(payloadOf(facts, ENDED))).toBe(PASS_CEILING)
  })
})

describe('a skill enters the window when it is READ, and nowhere else', () => {
  const BODY = 'Write the frontmatter first, then the body.'

  test('the catalogue costs a line and the instruction arrives in the next paper only', () => {
    const { papers } = drive(agent(), 'author an agent file', [
      VOTE('project'),
      { calls: [{ id: 'c1', tool: 'read_skill', args: '{"name":"agent-file"}' }] },
      { text: 'Now I know how.' }, {}, {},
    ], () => ({ ok: true, output: `SKILL agent-file — how to write one\n\n${BODY}` }))
    // The plan stage's own call named the skill and did not carry it.
    const asked = papers[1] ?? { sections: [] }
    expect(body(asked, 'affordances')).toContain('read_skill')
    expect(asked.sections.every((s) => !body(asked, s.id).includes(BODY))).toBe(true)
    // The next call carries it — in observations, and in nothing else.
    const after = papers[2] ?? { sections: [] }
    expect(body(after, 'observations')).toContain(BODY)
    expect(after.sections.filter((s) => body(after, s.id).includes(BODY)).map((s) => s.id)).toEqual(['observations'])
  })
})
