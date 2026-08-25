import { expect, test, describe } from 'bun:test'
import { ERRAND_PROTOCOL, arg, readMessage, tool } from '@harness/agent'
import { DelegateError } from '@harness/kernel'
import { portOver, workerFor } from './worker.js'

describe('a sub-agent is the same loop in its own Worker, reachable only by message', () => {
  test('two errands run at once and the second finishes first: nothing serialises them through the lead', async () => {
    const scout = workerFor('scout')
    const critic = workerFor('critic')
    const { port } = portOver({ scout, critic })

    const finding = port.delegate('scout', 'find the failing test')
    const judging = port.delegate('critic', 'judge the plan')
    // Both turns are open, in two states, at the same moment.
    expect(scout.state().turnId).toBe('scout-t1')
    expect(critic.state().turnId).toBe('critic-t1')

    critic.answer('the plan is fine')
    expect(await judging).toBe('the plan is fine')
    // The one that was asked FIRST is still going, and the lead is holding
    // nothing that could have been blocked by it.
    expect(scout.state().turnId).toBe('scout-t1')

    scout.answer('', 'stop')
    expect(scout.state().attempts).toBe(1)
    scout.answer('test/round.test.js is red')
    expect(await finding).toBe('test/round.test.js is red')
  })

  test('the goal opens the turn as the fact a PERSON\'s message makes, naming the lead that asked', async () => {
    const scout = workerFor('scout')
    const { port } = portOver({ scout })
    const finding = port.delegate('scout', 'find it')
    // Not a name minted at this end: `from` is what `core`'s transcript reads
    // as "who asked", and 'person' there would invent an agent nobody runs.
    expect(scout.opened()?.fact).toEqual({ type: 'user_message', text: 'find it', agent: '', from: 'main' })
    scout.answer('found it')
    await finding
  })

  test('an ending that arrives after a carrying reply sends the sentence home, not the silence', async () => {
    const grep = tool({ name: 'grep', description: 'Search.', args: [arg('pattern', 'string', 'what to find')] })
    const scout = workerFor('scout', { toolbox: [grep], maxRounds: 1 })
    const { port, crossed } = portOver({ scout })
    const finding = port.delegate('scout', 'find it')
    scout.works('checking the test file now', 'grep')
    // The ceiling ends the turn on a TOOL RESULT, whose fact carries no words.
    scout.ranTool('grep', 'round.test.js:12')
    await expect(finding).rejects.toThrow(/its turn ended "round ceiling"/)
    expect(crossed).toEqual([
      { v: ERRAND_PROTOCOL, type: 'ended', errandId: 'e-1', ok: false, text: 'checking the test file now', why: 'round ceiling' },
    ])
  })

  test('nothing but the two protocol records crosses: no state, no step, no port', async () => {
    const scout = workerFor('scout')
    const { port, crossed } = portOver({ scout })
    const finding = port.delegate('scout', 'find it')
    scout.answer('found it')
    await finding
    expect(crossed).toEqual([
      { v: ERRAND_PROTOCOL, type: 'ended', errandId: 'e-1', ok: true, text: 'found it', why: 'answered' },
    ])
  })

  test('the errand records its OWN ending, so a turn that was truncated is not read as an answer', async () => {
    const scout = workerFor('scout')
    const { port } = portOver({ scout })
    const finding = port.delegate('scout', 'find it')
    scout.answer('I was half way through when', 'length')
    const cause = await finding.catch((thrown) => thrown)
    expect(cause).toBeInstanceOf(DelegateError)
    if (!(cause instanceof DelegateError)) throw cause
    expect(cause.kind).toBe('failed')
    expect(cause.message).toContain('its turn ended "truncated"')
    // What it managed to say is carried, and it is NOT the answer.
    expect(cause.detail).toBe('I was half way through when')
  })

  test('the channel closes however the errand ends, so no Worker is left spending tokens', async () => {
    const scout = workerFor('scout')
    const { port } = portOver({ scout })
    const finding = port.delegate('scout', 'find it')
    expect(scout.closed()).toBe(0)
    scout.answer('found it')
    await finding
    expect(scout.closed()).toBe(1)

    const stop = new AbortController()
    const abandoned = port.delegate('scout', 'find another', { signal: stop.signal })
    stop.abort()
    await expect(abandoned).rejects.toThrow(/stopped before it finished/)
    expect(scout.closed()).toBe(2)
  })

  test('an agent this build does not have is refused BY NAME, and no channel is opened', async () => {
    const scout = workerFor('scout')
    const { port } = portOver({ scout })
    await expect(port.delegate('archivist', 'do it')).rejects.toThrow(/no agent called "archivist"/)
    expect(port.roster()).toEqual(['scout'])
    expect(scout.state().turnId).toBe('')
  })

  test('a message from a build speaking another protocol is refused rather than half-read (I18)', () => {
    expect(readMessage({ v: 99, type: 'ended', errandId: 'e-1', ok: true, text: 'hi', why: 'answered' }))
      .toEqual({ unreadable: `this errand speaks protocol ${ERRAND_PROTOCOL} and the message says 99` })
    expect(readMessage({ v: ERRAND_PROTOCOL, type: 'shrug', errandId: 'e-1' }))
      .toEqual({ unreadable: 'an errand message of type "shrug" is not one this build sends' })
    expect(readMessage(null)).toEqual({ unreadable: 'an errand message arrived as null' })
  })
})
