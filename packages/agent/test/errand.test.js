import { expect, test, describe } from 'bun:test'
import {
  ERRAND_PROTOCOL, agentsOver, errandBegun, errandHeard, newAgentState, readMessage, step,
} from '@harness/agent'
import { DelegateError } from '@harness/kernel'
import { CARD } from './card.js'

/** @typedef {import('@harness/agent').AgentState} AgentState */
/** @typedef {import('@harness/agent').Errand} Errand */
/** @typedef {import('@harness/agent').Incoming} Incoming */

const AT = 1_700_000_000_000

/**
 * ONE SUB-AGENT'S DESK: its own `AgentState`, its own open errand, and the way
 * home. The lead has no path to any of it — the test reads it directly, which
 * is the point: if the port could reach a sub-agent's loop, this is the object
 * it would have to reach through.
 * @typedef {{name: string, state: AgentState, errand: Errand | null, home: (message: unknown) => void, closed: number}} Desk
 */

/** @param {string} name @returns {Desk} */
function deskFor(name) {
  return {
    name,
    state: { ...newAgentState(), card: CARD, model: 'local', prompt: `You are ${name}.` },
    errand: null,
    home: () => { throw new Error(`${name} answered before anyone was listening`) },
    closed: 0,
  }
}

/** One turn of the sub-agent's OWN loop, and the ending it posts home if this fact ended it. @param {Desk} desk @param {Incoming} incoming */
function ran(desk, incoming) {
  const stepped = step(desk.state, incoming)
  desk.state = stepped.state
  if (!desk.errand) throw new Error(`${desk.name} took a turn with no errand open`)
  const heard = errandHeard(desk.errand, incoming, stepped.effects)
  desk.errand = heard.errand
  if (heard.ended) desk.home(heard.ended)
}

/** @param {Desk} desk @param {unknown} message */
function began(desk, message) {
  const said = readMessage(message)
  if ('unreadable' in said || said.type !== 'begin') throw new Error(`${desk.name} could not read that`)
  const begun = errandBegun(said, `${desk.name}-t1`, AT)
  desk.errand = begun.errand
  ran(desk, begun.incoming)
}

/** @param {Desk} desk @param {string} text @param {string} finish @returns {Incoming} */
const replied = (desk, text, finish) => ({
  at: AT,
  turnId: `${desk.name}-t1`,
  fact: { type: 'model_replied', agent: desk.name, text, reasoning: '', finish },
  reply: { calls: [], finish: /** @type {import('@harness/agent').FinishReason} */ (finish) },
})

/** A sub-agent in its own Worker, reachable only through `channel`. @param {string} name */
function workerFor(name) {
  const desk = deskFor(name)
  return {
    channel: {
      /** @param {unknown} message */
      post: (message) => began(desk, message),
      /** @param {(message: unknown) => void} handler */
      onMessage: (handler) => { desk.home = handler },
      close: () => { desk.closed += 1 },
    },
    state: () => desk.state,
    closed: () => desk.closed,
    /** @param {string} text @param {string} [finish] */
    answer: (text, finish = 'stop') => ran(desk, replied(desk, text, finish)),
  }
}

/** @param {Record<string, ReturnType<typeof workerFor>>} workers */
function portOver(workers) {
  /** @type {unknown[]} */
  const crossed = []
  const port = agentsOver({
    names: Object.keys(workers),
    open: (agent) => {
      const worker = workers[agent]
      if (!worker) throw new Error(`no worker for ${agent}`)
      return {
        ...worker.channel,
        onMessage: (handler) => worker.channel.onMessage((message) => { crossed.push(message); handler(message) }),
      }
    },
  })
  return { port, crossed }
}

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
