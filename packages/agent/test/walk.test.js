import { expect, test, describe } from 'bun:test'
import { ANSWERED, ENDED, endedWhy } from '@harness/agent'
import { CATALOGUE, VOTE, agent, body, drive, payloadOf, walked } from './drive.js'

describe('the vote replaces the declared list, and the turn walks what it chose', () => {
  test('a greeting is billed for the vote and ONE stage — no brief, no check', () => {
    const { state, facts, papers } = drive(agent(), 'hi', [VOTE('answer'), { text: 'Hello.' }])
    expect(walked(facts)).toEqual(['strategy', 'answer'])
    expect(papers).toHaveLength(2)
    expect(payloadOf(facts, 'core.route_chosen')).toMatchObject({ route: 'answer', how: 'voted' })
    expect(endedWhy(payloadOf(facts, ENDED))).toBe(ANSWERED)
    // The vote rewrote what this turn walked and never what the file declares.
    expect(state.declared).toEqual(['strategy'])
  })

  test('a hard task gets plan, work, verify and critique, each entered under its own brief', () => {
    const { facts, papers } = drive(agent(), 'build me a script that sorts a CSV', [
      VOTE('project'), { text: 'The plan.' }, { text: 'Done the work.' }, { text: 'It ran.' }, { text: 'Reads fine.' },
    ])
    expect(walked(facts)).toEqual(['strategy', 'plan', 'work', 'verify', 'critique'])
    expect(papers).toHaveLength(5)
    // Each stage entered under its OWN file's words.
    expect(body(papers[0] ?? { sections: [] }, 'directive')).toContain('Three routes')
    expect(body(papers[1] ?? { sections: [] }, 'directive')).toContain('list_skills')
    // `work` is briefed by the person's own request, so its directive block has nothing to say and elides.
    expect(body(papers[2] ?? { sections: [] }, 'directive')).toContain('nothing this turn')
    expect(body(papers[4] ?? { sections: [] }, 'directive')).not.toContain('Three routes')
  })

  test('and the NEXT message starts from the file again: a greeting after a project does not plan', () => {
    const first = drive(agent(), 'build me a script', [VOTE('project'), {}, {}, {}, {}])
    const second = drive(first.state, 'thanks!', [VOTE('answer'), { text: 'Any time.' }])
    expect(walked(second.facts)).toEqual(['strategy', 'answer'])
  })

  test('an unreadable vote still walks a route rather than stranding the turn', () => {
    const { facts } = drive(agent(), 'what is in the folder?', [{ text: 'I think we should look.' }, { text: 'Two files.' }])
    expect(walked(facts)).toEqual(['strategy', 'work'])
    expect(payloadOf(facts, 'core.route_chosen')).toMatchObject({ route: 'react', how: 'fallback' })
  })
})

describe('a stage that may not act cannot NAME a tool to the model', () => {
  test('the voting call carries a full toolbox on the state and shows the model none of it', () => {
    const state = agent()
    expect(state.toolbox.length).toBeGreaterThan(0)
    const { papers } = drive(state, 'hi', [VOTE('answer'), { text: 'Hello.' }])
    const vote = papers[0] ?? { sections: [] }
    for (const t of CATALOGUE) expect(body(vote, 'affordances')).not.toContain(t.name)
    expect(body(vote, 'affordances')).toBe('No tools are installed; answer from what you know.')
    // …and the contract it is held to is the vote's shape, not the tool envelope.
    expect(body(vote, 'response_contract')).toContain('ROUTE')
    expect(body(vote, 'response_contract')).not.toContain('call tools')
  })
})
