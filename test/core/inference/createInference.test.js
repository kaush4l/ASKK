import { describe, expect, test } from 'bun:test'
import { createInference, Kind } from '../../../src/core/inference/index.js'
import { Reason } from '../../../src/core/Outcome.js'

/**
 * The door a turn goes through, and the one request it must never make.
 *
 * Measured by a black-box reviewer against the built page: with nothing
 * configured, pressing send POSTed to `http://<the page's own origin>/chat/completions`,
 * got a 404 from the static host serving the app, and reported *"the endpoint
 * answered, but not with a result"* — an app blaming an external party for its
 * own missing configuration, one screen after saying "no address to reach one".
 *
 * The cause is one line of string arithmetic: `${this.baseUrl}/chat/completions`
 * with an empty base URL is a RELATIVE url, and a relative url resolves against
 * whatever origin the page came from. Nothing about that is a fault of the
 * transport's; the transport should never have been built.
 */
describe('a transport that has nowhere to send', () => {
  test('is refused, rather than built to fetch the page it is running on', () => {
    const made = createInference({ kind: Kind.OPENAI, model: 'anything', baseUrl: '' })

    expect(made.ok).toBe(false)
    expect(made.failure.code).toBe(Reason.BAD_REQUEST)
    // The message names the missing thing and where to put it, and does not
    // mention an endpoint — there is no endpoint, and saying one answered
    // badly is the lie this closes.
    expect(made.failure.message).toContain('no address')
    expect(made.failure.message.toLowerCase()).not.toContain('endpoint answered')
  })

  test('the same is true of the Anthropic protocol, which also needs an address', () => {
    expect(createInference({ kind: Kind.ANTHROPIC, model: 'x', baseUrl: '   ' }).ok).toBe(false)
  })

  test('a model with no name is refused too, because a request would name nothing', () => {
    expect(createInference({ kind: Kind.OPENAI, model: '', baseUrl: 'http://h/v1' }).ok).toBe(false)
  })

  test('a model that runs in this tab needs no address and is built', () => {
    // There is nothing to reach. Refusing this one would make the only setup
    // that needs no server the one setup that cannot start.
    const made = createInference({ kind: Kind.TRANSFORMERS, model: 'onnx-community/x' })
    expect(made.ok).toBe(true)
  })

  test('a model that runs in this tab still needs a model id', () => {
    expect(createInference({ kind: Kind.TRANSFORMERS, model: '' }).ok).toBe(false)
  })

  test('an address and a model together are built, and an unknown kind is still corrected', () => {
    const made = createInference({ kind: 'nonsense', model: 'm', baseUrl: 'http://h/v1' })
    expect(made.ok).toBe(true)
    expect(made.notes.join(' ')).toContain('nonsense')
  })
})
