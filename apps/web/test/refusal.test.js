import { expect, test } from 'bun:test'

import { StoreError, ok, problem } from '@harness/kernel'

import { openSession } from '../lib/session.js'
import { chat } from '../fixtures/transcript.js'
import { screen, wiring } from './doubles.js'

/**
 * A REFUSAL FROM THE SEAM REACHES THE PERSON WHO TYPED THE MESSAGE.
 *
 * `POST /chat` refuses a build never granted the right to record facts
 * (`packages/core/src/chat.js`), and a `send` that drops that answer is a dead
 * switch with a proof of life attached: `handle` appends `request_handled`, so
 * every reader re-renders and the screen comes back identical with nothing
 * said. The assertion is the SENTENCE, not a flag — a boolean nobody words is
 * how the composer came to sit disabled with no reason given.
 */
test('a message the core refuses puts the refusal on the screen', async () => {
  const refusal = 'This build did not grant the chat module the right to record facts.'
  const session = await openSession('', wiring({
    seam: (request) => (request.method === 'POST'
      ? problem(500, refusal, { id: 'main', kind: 'not_granted', repair: 'Nothing you can do from this page.' })
      : ok('chat', chat)),
    run: async () => {},
    subscribe: () => () => {},
  }))

  const refused = await session.send('main', 'Does Firecrawl still answer without a key?')
  expect(refused?.kind).toBe('not_granted')
  expect(screen({ status: 500, view: 'problem', data: { ...refused } })).toContain(refusal)
})

/**
 * …AND SO DOES A TURN THAT COULD NOT BE RUN. An unhandled rejection out of
 * `send` is the same silence by a different door: the message IS in the log,
 * nothing will ever answer it, and the page looks like it is thinking.
 */
test('a turn that rejects while running becomes a sentence, not an unhandled rejection', async () => {
  const session = await openSession('', wiring({
    seam: () => ok('chat', chat),
    run: async () => {
      throw new StoreError('io', 'This build could not write the turn down.', { detail: 'The segment put was refused.' })
    },
    subscribe: () => () => {},
  }))

  const stopped = await session.send('main', 'Anything.')
  const said = screen({ status: 500, view: 'problem', data: { ...stopped } })
  expect(said).toContain('could not write the turn down')
  expect(said).toContain('The segment put was refused.')
  expect(said).toContain('Saying it again will stop the same way')
})
