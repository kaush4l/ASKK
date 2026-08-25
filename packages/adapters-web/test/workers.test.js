/**
 * THE LEAD'S HALF, COMPOSED: `agentsOver` over `browserWorkers` over a Worker.
 *
 * The Worker here is an object, and the sub-agent behind it is a REAL
 * application running a real turn — the same `errandTurn` the entry module
 * calls. So everything between a lead saying "delegate" and a sub-agent's
 * transcript holding the lead's name is executed on the host; the only line
 * this cannot reach is `new Worker` itself.
 */
import { expect, test, describe } from 'bun:test'
import { CAPABILITIES, DelegateError } from '@harness/kernel'
import { agentsOver, newAgentState, readMessage } from '@harness/agent'
import { bootFresh, errandTurn, handle } from '@harness/core'
import { get, withHeader } from '@harness/kernel'
import { fakeClock, testPorts } from '@harness/adapters-test'
import { browserWorkers } from '../src/workers.js'
import { rosterNames } from '../src/adopt.js'
import { memorySegments } from './doubles.js'

/** The card every sub-agent here is assembled against: without one a turn ends before the model call. @type {import('@harness/context').ModelCard} */
const CARD = { name: 'scripted', model: 'scripted', kind: 'openai', contextTokens: 128_000, maxOutputTokens: null, acceptsImages: false, reasons: false }

/**
 * ONE SUB-AGENT BEHIND A WORKER-SHAPED OBJECT. `boot` happens on the first
 * message, exactly as the entry module boots on its first `begin`.
 * @param {string} name @param {{says?: string, crash?: string}} [opts]
 */
function deskWorker(name, opts = {}) {
  /** @type {Record<string, (event: never) => void>} */
  const on = {}
  const app = bootFresh({
    // The same sentence three times: one desk answers more than one errand in
    // this suite, and a script that ran out would look like a model failure.
    ports: testPorts({ clock: fakeClock({ start: 1_000, step: 1 }), script: [0, 1, 2].map(() => ({ text: opts.says ?? `${name} answered` })) }),
    available: [...CAPABILITIES],
    segments: memorySegments(),
    me: name,
    agent: { ...newAgentState(), card: CARD },
  })
  const worker = {
    app,
    terminated: 0,
    postMessage: (/** @type {unknown} */ message) => {
      if (opts.crash) {
        on['error']?.(/** @type {never} */ ({ message: opts.crash, filename: '', lineno: 0 }))
        return
      }
      const said = readMessage(message)
      if ('unreadable' in said || said.type !== 'begin') throw new Error(`${name} could not read that`)
      void errandTurn(app, said, { timer: { wait: async () => {} } }).then((ended) => on['message']?.(/** @type {never} */ ({ data: ended })))
    },
    terminate: () => { worker.terminated += 1 },
    addEventListener: (/** @type {string} */ type, /** @type {(event: never) => void} */ handler) => { on[type] = handler },
  }
  return worker
}

/** The lead's port, over a roster that can change under it. @param {Record<string, ReturnType<typeof deskWorker>>} desks */
function leadOver(desks, me = 'main') {
  const names = Object.keys(desks)
  const started = /** @type {string[]} */ ([])
  const workers = browserWorkers({
    me,
    roster: () => [me, ...names],
    spawn: (agent) => {
      started.push(agent)
      const desk = desks[agent]
      if (!desk) throw new Error(`no desk for ${agent}`)
      return desk
    },
  })
  return { port: agentsOver(workers), started, names }
}

describe('a delegation, from the lead down to the sub-agent`s own transcript', () => {
  test("comes back as the answer, and the sub-agent's turn is filed under the LEAD's name", async () => {
    const scout = deskWorker('scout', { says: 'three results, all from 2024' })
    const { port, started } = leadOver({ scout })

    expect(await port.delegate('scout', 'find the release date')).toBe('three results, all from 2024')
    expect(started).toEqual(['scout'])
    // `me` IS WHY THIS ROW DOES NOT READ "You". An empty `from` reads as a
    // person, and a lead's delegation filed under the person's name is a
    // transcript that lies about who asked.
    const rows = /** @type {Array<{speaker: string}>} */ (handle(scout.app, withHeader(get('/chat'), 'x-agent', 'scout')).data.messages)
    expect(rows[0]?.speaker).toBe('main asked scout')
    // …and the Worker is gone the moment the errand settled.
    expect(scout.terminated).toBe(1)
  })

  test('two agents run at the same time, in two workers, from one page', async () => {
    // The whole point of a Worker per agent: the lead is not the bottleneck.
    // Both errands are in flight before either answers, and each transcript
    // holds only its own conversation.
    const scout = deskWorker('scout', { says: 'the release was in March' })
    const critic = deskWorker('critic', { says: 'that claim needs a source' })
    const { port, started } = leadOver({ scout, critic })

    const both = await Promise.all([port.delegate('scout', 'look it up'), port.delegate('critic', 'check it')])
    expect(both).toEqual(['the release was in March', 'that claim needs a source'])
    expect(started.sort()).toEqual(['critic', 'scout'])
    const said = (/** @type {typeof scout} */ desk, /** @type {string} */ who) =>
      /** @type {Array<{said: string}>} */ (handle(desk.app, withHeader(get('/chat'), 'x-agent', who)).data.messages).map((r) => r.said)
    expect(said(scout, 'scout')).toEqual(['look it up', 'the release was in March'])
    expect(said(critic, 'critic')).toEqual(['check it', 'that claim needs a source'])
  })

  test('an agent authored a moment ago is delegable, because the roster is READ and not snapshotted', async () => {
    const scout = deskWorker('scout')
    const { port, names } = leadOver({ scout })
    names.length = 0
    await expect(port.delegate('scout', 'go')).rejects.toThrow(/no agent called "scout"/)
    names.push('scout')
    expect(await port.delegate('scout', 'go')).toBe('scout answered')
  })

  test('the page never delegates to ITSELF, whatever the roster says', async () => {
    // Two contexts appending to one agent's segment stream would interleave two
    // conversations into one history.
    const { port } = leadOver({ scout: deskWorker('scout') })
    expect(port.roster()).toEqual(['scout'])
    await expect(port.delegate('main', 'go')).rejects.toThrow(/no agent called "main"/)
  })
})

describe('the list a delegation is checked against', () => {
  test('holds the agents this build shipped AND the ones written into it', async () => {
    // The pair the shipped `main/agent.md` names: write one, then start it.
    // The Rust made that two turns because `reconcile` had to swap a running
    // agent's prompt; a sub-agent boots fresh in its own Worker, so the only
    // thing between the two calls is this list being READ rather than held.
    const app = bootFresh({
      ports: testPorts({ clock: fakeClock() }),
      available: [...CAPABILITIES],
      segments: memorySegments(),
      roster: { specs: [], refusals: [], paths: {} },
    })
    expect(rosterNames(app)).toEqual([])
    expect(rosterNames(null)).toEqual([])
    const runner = app.tools['write_agent']
    if (!runner) throw new Error('this build installs no write_agent')
    await runner(JSON.stringify({ name: 'haiku', description: 'writes haiku', prompt: 'Answer in haiku.' }), { signal: new AbortController().signal })
    expect(rosterNames(app)).toEqual(['haiku'])
  })
})

describe('the ways an errand does not answer', () => {
  test('a delegation already abandoned starts NO worker', async () => {
    const { port, started } = leadOver({ scout: deskWorker('scout') })
    const signal = AbortSignal.abort()
    await expect(port.delegate('scout', 'go', { signal })).rejects.toThrow(DelegateError)
    expect(started).toEqual([])
  })

  test('a second errand to one agent while the first is open is refused by name', async () => {
    // One Worker per errand, one segment stream per agent: the second would
    // boot on top of the first one's half-written turn.
    const scout = deskWorker('scout')
    const { port } = leadOver({ scout })
    const first = port.delegate('scout', 'the first goal')
    // A REJECTION AND NOT A THROW. `delegate` is declared as returning a
    // promise, and a caller that wrote `await` catches this while one that
    // wrote a bare call does not — so a synchronous throw would make whether
    // the refusal is reportable depend on how the call site was spelled.
    await expect(port.delegate('scout', 'the second goal')).rejects.toThrow(/already working on an errand/)
    await first
    // …and once it has settled, the next one runs.
    expect(await port.delegate('scout', 'the third goal')).toBe('scout answered')
  })

  test('a worker that will not START leaves the agent delegable, and says why', async () => {
    // `spawn` IS `new Worker`, WHICH THROWS — on a URL this origin refuses, or
    // a SecurityError. Claiming the name before it returned left that agent
    // refused for the life of the page with "already working on an errand",
    // which is a sentence about work that does not exist (I16).
    const scout = deskWorker('scout')
    let refuse = true
    const workers = browserWorkers({
      me: 'main',
      roster: () => ['main', 'scout'],
      spawn: () => { if (refuse) throw new Error('SecurityError'); return scout },
    })
    const port = agentsOver(workers)
    await expect(port.delegate('scout', 'go')).rejects.toThrow(/SecurityError/)
    refuse = false
    expect(await port.delegate('scout', 'go')).toBe('scout answered')
  })

  test('a worker that dies is an ENDING and not a wait for the driver`s deadline', async () => {
    const { port } = leadOver({ scout: deskWorker('scout', { crash: 'Cannot find module ./agent-entry.js' }) })
    await expect(port.delegate('scout', 'go')).rejects.toThrow(/Cannot find module/)
  })
})
