/**
 * TWO CONVERSATIONS ON ONE PAGE. A message addressed to another agent is an
 * ERRAND: it never enters this agent's loop, and what comes back — an answer, a
 * refusal, or a deadline — belongs in the transcript the person is watching.
 */
import { expect, test, describe } from 'bun:test'
import { get, post, withHeader } from '@harness/kernel'
import { drive, handle } from '@harness/core'
import { harness, rows, until } from './harness.js'

describe('two conversations on one page', () => {
  test("a second agent's turn never appears in the first agent's transcript", async () => {
    const { app, timer } = harness({
      script: [{ text: "main's own answer" }],
      agents: { scout: 'scout looked and found three results' },
    })
    handle(app, post('/chat', { message: 'main, hello' }))
    handle(app, withHeader(post('/chat', { message: 'scout, go and look' }), 'x-agent', 'scout'))
    await drive(app, { timer })

    const mine = rows(app).map((r) => r.said)
    expect(mine).toEqual(['main, hello', "main's own answer"])
    expect(rows(app, 'scout').map((r) => [r.kind, r.said])).toEqual([
      ['user', 'scout, go and look'],
      ['assistant', 'scout looked and found three results'],
    ])
    // AND THAT CONVERSATION IS CLOSED. No ending fact carries an agent name, so
    // scout's turn stayed open beside its own answer and the pane told the
    // person their page had been reloaded — for ever, not for a moment.
    expect(handle(app, withHeader(get('/chat'), 'x-agent', 'scout')).data.waitingLabel).toBe('')
  })

  test('a delegation the roster cannot answer says so IN THAT AGENT\'S TRANSCRIPT', async () => {
    const { app, timer } = harness({ agents: {} })
    handle(app, withHeader(post('/chat', { message: 'ghost, are you there?' }), 'x-agent', 'ghost'))
    await drive(app, { timer })

    const said = rows(app, 'ghost').map((r) => r.said)
    expect(said).toHaveLength(2)
    expect(said[1]).toContain('there is no agent called "ghost"')
    // and never in this agent's, which is the bucket a stamp-less result lands in
    expect(rows(app).map((r) => r.said)).toEqual([])
  })

  test('a delegation that never answers is ended by the deadline, and the queue behind it runs', async () => {
    const { app, timer } = harness({
      script: [{ text: 'main got its own turn' }],
      agents: { wedged: () => new Promise(() => {}) },
    })
    handle(app, withHeader(post('/chat', { message: 'wedged, go' }), 'x-agent', 'wedged'))
    handle(app, post('/chat', { message: 'main, hello' }))
    const running = drive(app, { timer, deadlineMs: 5_000 })
    await until(() => timer.pending() > 0)
    // WHILE IT IS IN FLIGHT the pane must not claim the page was reloaded: the
    // message was shifted off the queue before the await, so the queue alone
    // reads false for exactly the call it is meant to cover.
    expect(String(handle(app, withHeader(get('/chat'), 'x-agent', 'wedged')).data.waitingLabel)).not.toContain('reloaded')
    timer.fire()
    await running

    expect(rows(app, 'wedged').map((r) => r.said).join(' ')).toContain('did not answer within 5 seconds')
    expect(rows(app).map((r) => r.said)).toEqual(['main, hello', 'main got its own turn'])
  })
})
