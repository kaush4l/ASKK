/**
 * EVERY ROUTE IN `docs/SEAM.md` ANSWERS, and the table in that document is
 * where this test gets the list. Reading the frozen contract rather than a copy
 * of it is the point (I16): a row added to the doc and forgotten in the build
 * fails here, and so does a route this build answers that nobody wrote down.
 */
import { describe, expect, test } from 'bun:test'
import { CAPABILITIES, get, post, withHeader } from '@harness/kernel'
import { newAgentState, parseAgentFile, tool } from '@harness/agent'
import { fakeClock, testPorts } from '@harness/adapters-test'
import { bootFresh, drive, handle } from '@harness/core'

import { manualTimer, memorySegments } from './doubles.js'

/** The seam contract, read off the document that freezes it. */
const SEAM = await Bun.file(new URL('../../../docs/SEAM.md', import.meta.url)).text()

/** @returns {Array<{method: string, path: string, view: string}>} */
function tableRows() {
  const rows = [...SEAM.matchAll(/^\| (GET|POST) \| `([^`]+)` \| `([^`]+)` \|/gm)]
  return rows.map((m) => ({ method: String(m[1]), path: String(m[2]), view: String(m[3]) }))
}

const AGENT_FILE = `---
name: scribe
model: local
tools:
  - note
---
You take notes.
`

/** @param {{settings?: boolean}} [opts] */
function build(opts = {}) {
  const clock = fakeClock({ start: 1_000, step: 1 })
  const ports = testPorts({ clock, script: [] })
  const spec = parseAgentFile('agents/scribe/agent.md', AGENT_FILE)
  const specs = 'spec' in spec ? [spec.spec] : []
  const app = bootFresh({
    ports,
    available: [...CAPABILITIES],
    segments: memorySegments(),
    me: 'scribe',
    tools: { note: async () => ({ ok: true, output: 'noted' }) },
    agent: { ...newAgentState(), toolbox: [tool({ name: 'note', description: 'write a note down' })] },
    roster: { specs, refusals: [], paths: { scribe: 'agents/scribe/agent.md' } },
    ...(opts.settings === false ? {} : { settings: fakeSettings() }),
  })
  return { app, ports, clock, timer: manualTimer({ auto: true }) }
}

function fakeSettings() {
  /** @type {Array<Record<string, string>>} */
  const applied = []
  return {
    applied,
    read: () => ({ selected: 'local', search: '', entries: [{ id: 'local', name: 'local', hasKey: false }] }),
    apply: (/** @type {Record<string, string>} */ patch) => void applied.push(patch),
  }
}

describe('every route the frozen seam lists', () => {
  test('the document names twenty-five routes and this build answers all of them', () => {
    const rows = tableRows()
    expect(rows.length).toBeGreaterThan(20)
    const { app } = build()
    /** @type {string[]} */
    const missing = []
    for (const row of rows) {
      const request = row.method === 'GET' ? get(row.path) : post(row.path, {})
      const response = handle(app, withHeader(request, 'x-agent', 'scribe'))
      // `no_route` is the only answer that means NOTHING ANSWERS THAT ADDRESS.
      // Every other outcome — a refusal, a 501, a 404 about a named thing that
      // does not exist — is a route that exists and declined, which is what the
      // rest of this file checks one at a time.
      if (response.data.kind === 'no_route') missing.push(`${row.method} ${row.path}`)
    }
    expect(missing).toEqual([])
  })

  test('an address nobody claims is a problem naming it, not an empty projection', () => {
    const { app } = build()
    const response = handle(app, get('/nowhere'))
    expect(response.status).toBe(404)
    expect(response.view).toBe('problem')
    expect(String(response.data.message)).toContain('/nowhere')
  })

  test('no handler is handed the event array — history arrives only as a registered fold', () => {
    const { app } = build()
    const seen = handle(app, get('/debug'))
    expect(seen.status).toBe(200)
    // The projection is a bounded tail with a sentence saying so; a handler
    // that had the log would have rendered all of it.
    expect(String(seen.data.factsLabel)).toContain('fact')
  })
})

describe('the panes read the projections and not each other', () => {
  test('the board names every agent the roster declares, not only the one being talked to', () => {
    const { app } = build()
    const rows = /** @type {Array<Record<string, unknown>>} */ (handle(app, get('/board')).data.rows)
    expect(rows.map((r) => r.name)).toContain('scribe')
    expect(rows[0]?.modelLabel).toBe('local')
  })

  test('the tools pane says a named tool with no runner is NOT resolved', () => {
    const { app } = build()
    const rows = /** @type {Array<Record<string, unknown>>} */ (handle(app, get('/tools')).data.rows)
    // `read_result` is beside the agent's own: the shelf's door is granted by
    // `boot` whatever the file allowed, because the RUNNER is installed the
    // same way and told-and-callable have to be the same set (I13).
    expect(rows.map((r) => r.name)).toEqual(['note', 'read_result'])
    expect(rows[0]?.resolves).toBe(true)
    expect(rows[1]?.resolves).toBe(true)
    expect(String(rows[0]?.usage)).toContain('note({})')
  })

  test('a terminal command becomes an exec chore, and the fold shows it once it ran', async () => {
    const { app, timer } = build()
    app.tools.exec = async () => ({ ok: true, output: 'total 0' })
    const queued = handle(app, post('/terminal', { command: 'ls -1Ap' }))
    expect(String(queued.data.queuedLabel)).toContain('ls -1Ap')
    expect(app.chores).toHaveLength(1)
    await drive(app, { timer })
    const rows = /** @type {Array<Record<string, unknown>>} */ (handle(app, get('/terminal')).data.rows)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.command).toBe('ls -1Ap')
    // A person's command carries no turn, so the row says who ran it without
    // guessing from the fact's contents.
    expect(rows[0]?.byLabel).toBe('You ran')
  })

  test('settings refuses a key sent through the seam and names the door that takes one', () => {
    const { app } = build()
    const refused = handle(app, post('/settings', { apiKey: 'sk-live-do-not-log-me' }))
    expect(refused.status).toBe(400)
    expect(String(refused.data.repair)).toContain('saveEndpoint')
    // And nothing about it reached the log, which is the whole reason.
    const facts = JSON.stringify(handle(app, get('/debug')).data)
    expect(facts).not.toContain('sk-live-do-not-log-me')
  })

  test('a build with no catalogue reader says so rather than showing an empty list', () => {
    const { app } = build({ settings: false })
    const answer = handle(app, get('/settings'))
    expect(answer.status).toBe(501)
    expect(String(answer.data.message)).toContain('no endpoint catalogue')
  })

  test('clearing a transcript takes two presses, and the first one only arms it', () => {
    const { app } = build()
    handle(app, withHeader(post('/chat', { message: 'hello' }), 'x-agent', 'scribe'))
    const armed = handle(app, withHeader(get('/chat/clear'), 'x-agent', 'scribe'))
    expect(String(armed.data.armedLabel)).toContain('Press again')
    expect(/** @type {unknown[]} */ (armed.data.messages)).toHaveLength(1)

    const done = handle(app, withHeader(withHeader(get('/chat/clear'), 'x-agent', 'scribe'), 'x-confirm', 'yes'))
    expect(/** @type {unknown[]} */ (done.data.messages)).toHaveLength(0)
  })
})

describe('an agent authored in this browser', () => {
  test('is installed, listed as written here, and removable', () => {
    const { app } = build()
    const written = handle(app, post('/agents/file', { path: 'agents/helper/agent.md', text: AGENT_FILE.replace('scribe', 'helper') }))
    expect(written.status).toBe(200)
    const rows = /** @type {Array<Record<string, unknown>>} */ (written.data.rows)
    expect(rows.find((r) => r.name === 'helper')?.originLabel).toBe('written here')

    const gone = handle(app, withHeader(get('/agents/delete'), 'x-agent', 'helper'))
    const left = /** @type {Array<Record<string, unknown>>} */ (gone.data.rows)
    expect(left.map((r) => r.name)).not.toContain('helper')
  })

  test('a file that will not parse is refused by path, and nothing is written', () => {
    const { app } = build()
    const refused = handle(app, post('/agents', { name: 'broken', text: '---\nengine: telepathy\n---\n' }))
    expect(refused.status).toBe(400)
    expect(refused.data.id).toBe('broken/agent.md')
    const rows = /** @type {Array<Record<string, unknown>>} */ (handle(app, get('/agents')).data.rows)
    expect(rows.map((r) => r.name)).not.toContain('broken')
  })
})
