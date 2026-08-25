import { expect, test, describe } from 'bun:test'
import { ROUTES, STAGES_OF, labelled, routeChosen, routeOf, voteIn } from '@harness/agent'

describe('the vote, read out of one cheap reply', () => {
  test('a bare vote is read, and so is the reason beside it', () => {
    expect(voteIn('ROUTE: project\nWHY: it asks for a script')).toBe('project')
    expect(labelled('ROUTE: project\nWHY: it asks for a script', 'WHY')).toBe('it asks for a script')
  })

  test('every markdown block prefix a small model reaches for still opens a vote', () => {
    for (const line of ['**ROUTE:** answer', '- ROUTE: answer', '## ROUTE: answer', '> ROUTE: answer', '1. ROUTE: answer', '> - `ROUTE`: answer.']) {
      expect(voteIn(line)).toBe('answer')
    }
  })

  test('a label mid-sentence is NOT a vote: the model is asked to explain itself, and prose about routing is not a decision', () => {
    expect(voteIn('I considered whether ROUTE: project was right')).toBe('')
    expect(voteIn('the ROUTE is project')).toBe('')
  })

  test('a word this build does not know is no vote at all, rather than the nearest one', () => {
    expect(voteIn('ROUTE: quest')).toBe('')
  })
})

describe('an unreadable vote fails towards the middle, and SAYS that is what happened', () => {
  test('react is what a missing vote becomes, because it is the only route that can still reach either outcome', () => {
    expect(routeOf('I think we should just get started')).toBe('react')
    expect(STAGES_OF['react']).toEqual(['work'])
  })

  test('a fallback is distinguishable from a vote FOR react, which is the whole reason the fact carries how', () => {
    const voted = routeChosen('ROUTE: react\nWHY: one lookup')
    const fell = routeChosen('sure, let me help with that')
    expect(voted).toEqual({ type: 'custom', kind: 'core.route_chosen', payload: { route: 'react', why: 'one lookup', how: 'voted' } })
    expect(fell.type === 'custom' && fell.payload).toEqual({ route: 'react', why: '', how: 'fallback' })
  })
})

describe('what each route COSTS, which is the half of the decision that is not prose', () => {
  test('answer is one call with no tools; project is four stages ending in a critique', () => {
    expect(STAGES_OF['answer']).toEqual(['answer'])
    expect(STAGES_OF['project']).toEqual(['plan', 'work', 'verify', 'critique'])
  })

  test('every route has a stage list, so no vote can name a route the loop cannot walk', () => {
    for (const route of ROUTES) expect(STAGES_OF[route].length).toBeGreaterThan(0)
  })
})
