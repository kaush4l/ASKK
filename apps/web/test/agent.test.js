import { expect, test } from 'bun:test'

import { DEFAULT_AGENT, agentFrom, searchFor } from '../lib/agent.js'

test('who the address says the screen is about', () => {
  expect(agentFrom('?agent=scout')).toBe('scout')
  expect(agentFrom('agent=scout')).toBe('scout')
  expect(agentFrom('?agent=scout&misrouted=wharrgarbl')).toBe('scout')
})

/** Absent means the entry agent, and so does anything that could not be a name. */
test('an address that does not say, or says something impossible, means the entry agent', () => {
  expect(agentFrom('')).toBe(DEFAULT_AGENT)
  expect(agentFrom('?agent=')).toBe(DEFAULT_AGENT)
  expect(agentFrom('?agent=../../etc/passwd')).toBe(DEFAULT_AGENT)
  expect(agentFrom('?agent=<script>')).toBe(DEFAULT_AGENT)
})

/**
 * THE DEFAULT IS WRITTEN AS ABSENCE. `?agent=main` and no query at all are the
 * same screen, and two addresses for one screen is what makes a Back press
 * ambiguous — which is the bug the predecessor spent its longest comment on.
 */
test('a link to the entry agent carries no query at all', () => {
  expect(searchFor(DEFAULT_AGENT)).toBe('')
  expect(searchFor('scout')).toBe('?agent=scout')
})

/** A round trip is what a reload is: the address is the only place this lives. */
test('a name written into a link reads back out of it', () => {
  for (const name of ['scout', 'main', 'critic-2', 'a.b_c']) {
    expect(agentFrom(searchFor(name))).toBe(name)
  }
})
