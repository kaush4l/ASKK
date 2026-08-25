/**
 * THE SUB-AGENT'S OWN MAIN, EXECUTED. Everything the entry module does between
 * a `begin` arriving and an ending going home runs here on the host: it reads
 * its desk out of the worker's name, boots, runs the turn, WRITES THE TURN
 * DOWN, and answers. The only line this cannot reach is the `new Worker` that
 * would have started it.
 *
 * The name is built by `deskName` and never hand-written, because these two
 * files are the one producer/consumer pair in the delegation path that must
 * agree about a format — and a JSON literal in each is two spellings that drift
 * apart in silence.
 */
import { expect, test, describe } from 'bun:test'
import { CAPABILITIES, get, withHeader } from '@harness/kernel'
import { beginMessage, newAgentState } from '@harness/agent'
import { boot, handle, segStream } from '@harness/core'
import { fakeClock, testPorts } from '@harness/adapters-test'
import { deskName } from '../src/workers.js'
import { memorySegments } from './doubles.js'

/** The worker globals, cast for the reason `agent-entry.js` casts them: `self` is typed as a Window and this is not one. */
const scope = /** @type {{name: string, postMessage: (message: unknown) => void, dispatchEvent: (event: Event) => boolean}} */ (
  /** @type {unknown} */ (globalThis)
)

/** @type {unknown[]} */
const posted = []
scope.postMessage = (message) => { posted.push(message) }
scope.name = deskName('scout', './')

const { ran } = await import('../src/agent-entry.js')

/** Without a card a turn ends before the model call, and this suite would be measuring that instead. @type {import('@harness/context').ModelCard} */
const CARD = { name: 'scripted', model: 'scripted', kind: 'openai', contextTokens: 128_000, maxOutputTokens: null, acceptsImages: false, reasons: false }

/** One real application over a store this test can boot twice. @param {import('@harness/core').SegmentStore} segments @param {string} says */
function appOver(segments, says) {
  return boot({
    ports: testPorts({ clock: fakeClock({ start: 1_000, step: 1 }), script: [{ text: says }] }),
    available: [...CAPABILITIES],
    segments,
    me: 'scout',
    agent: { ...newAgentState(), card: CARD },
  })
}

/** @param {import('@harness/core').App} app */
const said = (app) => /** @type {Array<{said: string}>} */ (handle(app, withHeader(get('/chat'), 'x-agent', 'scout')).data.messages).map((r) => r.said)

/** Wait for the listener's own promise to settle, without a real clock (I7). @param {() => boolean} done */
async function until(done) {
  for (let i = 0; i < 200 && !done(); i += 1) await Promise.resolve()
  if (!done()) throw new Error('the entry module posted nothing')
}

describe('one errand, end to end, inside the worker', () => {
  test('is WRITTEN DOWN before the answer goes home, so the next boot still has it', async () => {
    // THE DEFECT THIS IS ABOUT: posting the ending is what makes the caller
    // close the channel, and closing it terminates the Worker. A turn flushed
    // after that line — or not at all — evaporates with the thread, and the
    // sub-agent's whole conversation with it. Two boots over one store, and
    // nothing here calls `persist`: the entry module's own line is what does.
    const segments = memorySegments()
    const app = await appOver(segments, 'three results, all from 2024')
    const ended = await ran(beginMessage('e-1', 'find the release date', 'main'), async () => app)

    expect(ended).toMatchObject({ errandId: 'e-1', ok: true, text: 'three results, all from 2024' })
    const again = await boot({ ports: testPorts({ clock: fakeClock() }), available: [...CAPABILITIES], segments, me: 'scout' })
    expect(said(again)).toEqual(['find the release date', 'three results, all from 2024'])
    // …and under ITS name: a stream per agent is what lets two conversations
    // share one browser without crossing.
    expect(await segments.range(segStream('scout'))).not.toEqual([])
    expect(await segments.range(segStream('main'))).toEqual([])
  })

  test('a name it cannot read is an ENDING that says so, and no agent is booted', async () => {
    // `{agent: ''}` was the old answer, and it boots a nameless agent with a
    // blank prompt against the wrong segment stream, then answers the errand as
    // though nothing were wrong — the one failure nobody can see (I16).
    scope.name = 'not json'
    let booted = 0
    const ended = await ran(beginMessage('e-2', 'go', 'main'), async () => { booted += 1; throw new Error('unreachable') })
    expect(booted).toBe(0)
    expect(ended).toMatchObject({ errandId: 'e-2', ok: false, text: '' })
    expect(ended.why).toMatch(/cannot read its own desk/)
    expect(ended.why).toContain('not json')
    scope.name = deskName('scout', './')
  })
})

describe('the messages the worker answers', () => {
  test('a begin runs the errand as the agent the DESK names', async () => {
    // The handshake, read back. `bootBrowser` is the boot here and this host has
    // no IndexedDB, so the ending is the boot-failure branch — which is the
    // claim: the agent it names is the one `deskName` wrote.
    scope.dispatchEvent(new MessageEvent('message', { data: beginMessage('e-3', 'go and look', 'main') }))
    await until(() => posted.length > 0)
    expect(posted[0]).toMatchObject({ type: 'ended', errandId: 'e-3', ok: false })
    expect(/** @type {{why: string}} */ (posted[0]).why).toMatch(/^scout could not start: /)
  })

  test('a SECOND begin is answered in words, not queued behind a turn nobody is waiting on', async () => {
    scope.dispatchEvent(new MessageEvent('message', { data: beginMessage('e-4', 'and another', 'main') }))
    await until(() => posted.length > 1)
    expect(posted[1]).toMatchObject({ type: 'ended', errandId: 'e-4', ok: false, why: 'this worker is already running an errand' })
  })

  test('anything that is not a begin is ignored rather than answered', async () => {
    scope.dispatchEvent(new MessageEvent('message', { data: { v: 1, type: 'ended', errandId: 'e-5', ok: true, text: '', why: 'answered' } }))
    await until(() => true)
    expect(posted).toHaveLength(2)
  })
})
