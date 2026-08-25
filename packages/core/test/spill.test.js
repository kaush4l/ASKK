/**
 * A 200KB TOOL RESULT CROSSES THE BOUNDARY ONCE.
 *
 * The claim these tests execute is not "the spill works" — it is that THE MODEL
 * NEVER SAW THE BYTES. So they measure what the model was handed, what the log
 * holds, and how many copies the store has, rather than asserting a handle came
 * back with the right shape.
 */
import { describe, expect, test } from 'bun:test'
import { CAPABILITIES, get, post } from '@harness/kernel'
import { newAgentState, tool } from '@harness/agent'
import { fakeClock, testPorts } from '@harness/adapters-test'
import { SPILL_CHARS, artifactPath, artifactTools, bootFresh, drive, handle } from '@harness/core'

import { manualTimer, memorySegments } from './doubles.js'

/** A listing no conversation should ever hold. 200KB, and every line distinct. */
const HUGE = Array.from({ length: 4000 }, (_, i) => `line ${i} ${'x'.repeat(40)}`).join('\n')

function build(/** @type {string} */ output) {
  const clock = fakeClock({ start: 1_000, step: 1 })
  const ports = testPorts({ clock, script: [] })
  const app = bootFresh({
    ports,
    available: [...CAPABILITIES],
    segments: memorySegments(),
    tools: { exec: async () => ({ ok: true, output }) },
    agent: { ...newAgentState(), toolbox: [tool({ name: 'exec', description: 'run a command' })] },
  })
  return { app, ports, timer: manualTimer({ auto: true }) }
}

/**
 * THE RESULT AS THE FACT HOLDS IT. The terminal fold keeps a command's output
 * verbatim, so this reads exactly what a `tool_invoked` fact carries — which is
 * what an assembled document would put in front of the model.
 */
function resultSaid(/** @type {import('@harness/core').App} */ app) {
  const rows = /** @type {Array<{output: string}>} */ (handle(app, get('/terminal')).data.rows)
  return rows[0]?.output ?? ''
}

describe('a tool result too big to say', () => {
  test('reaches the model as a receipt, and the bytes are stored exactly once', async () => {
    const { app, ports, timer } = build(HUGE)
    expect(HUGE.length).toBeGreaterThan(200_000)

    handle(app, post('/terminal', { command: 'ls -R' }))
    await drive(app, { timer })

    // WHAT THE MODEL WAS HANDED. The loop files the result against the call it
    // minted; the shelf pane is what says a copy exists.
    const shelf = /** @type {Array<Record<string, unknown>>} */ (handle(app, get('/space')).data.rows)
    expect(shelf).toHaveLength(1)
    const handle_ = String(shelf[0]?.handle)
    expect(handle_).not.toBe('')

    // ONE copy, in the blob store, under the handle the receipt named.
    const kept = await ports.store.blob.read(artifactPath(handle_))
    expect(kept).not.toBeNull()
    expect(new TextDecoder().decode(kept ?? new Uint8Array())).toBe(HUGE)
    expect(await ports.store.blob.listPrefix('artifacts/')).toHaveLength(1)

    // AND THE MODEL NEVER SAW THE MIDDLE. Line 2000 is in the bytes and in
    // nothing the loop was handed — this is the assertion the whole mechanism
    // exists for, and it fails the moment a result is quoted whole again.
    const said = resultSaid(app)
    expect(said).toContain(handle_)
    expect(said.length).toBeLessThan(SPILL_CHARS)
    expect(said).not.toContain('line 2000 ')
  })

  test('a result under the threshold is said in full, with no artifact at all', async () => {
    const { app, ports, timer } = build('a.txt\nb.txt\n')
    handle(app, post('/terminal', { command: 'ls' }))
    await drive(app, { timer })

    expect(resultSaid(app)).toContain('a.txt')
    expect(await ports.store.blob.listPrefix('artifacts/')).toHaveLength(0)
    expect(/** @type {unknown[]} */ (handle(app, get('/space')).data.rows)).toHaveLength(0)
  })

  test('read_artifact hands back the slice that was asked for, and says what is left', async () => {
    const { app, timer } = build(HUGE)
    handle(app, post('/terminal', { command: 'ls -R' }))
    await drive(app, { timer })
    const shelf = /** @type {Array<Record<string, unknown>>} */ (handle(app, get('/space')).data.rows)

    const read = artifactTools(app.ports).read_artifact
    const slice = await read(JSON.stringify({ handle: shelf[0]?.handle, offset: 100, limit: 50 }), { signal: new AbortController().signal })
    expect(slice.ok).toBe(true)
    expect(slice.output.startsWith(HUGE.slice(100, 150))).toBe(true)
    expect(slice.output).toContain('characters remain')
  })

  test('a handle nothing was ever kept under is a named failure, not an empty string', async () => {
    const { app } = build(HUGE)
    const read = artifactTools(app.ports).read_artifact
    const answer = await read('{"handle":"deadbeef"}', { signal: new AbortController().signal }).catch((/** @type {Error} */ e) => e)
    expect(answer).toBeInstanceOf(Error)
    expect(String(answer)).toContain('deadbeef')
  })

  test('a shelf that cannot be written says so instead of naming a handle nothing answers', async () => {
    const { app, ports, timer } = build(HUGE)
    ports.store.blob.write = async () => {
      throw new Error('the store is full')
    }
    handle(app, post('/terminal', { command: 'ls -R' }))
    await drive(app, { timer })

    const observed = resultSaid(app)
    expect(observed).toContain('could not be kept whole')
    expect(observed).toContain('the store is full')
    // NO HANDLE IS OFFERED, because none would answer — the model must not
    // spend a round discovering that.
    expect(observed).not.toContain('read_artifact({')
  })
})
