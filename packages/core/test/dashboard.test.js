import { expect, test, describe } from 'bun:test'
import { STATUSES, get, post } from '@harness/kernel'
import { handle } from '@harness/core'
import { GROUPED_STATUSES } from '../src/dashboard.js'
import { harness } from './harness.js'

/** @typedef {Record<string, unknown>} Data */

/** @param {import('@harness/core').App} app @returns {Data} */
function screen(app) {
  return handle(app, get('/')).data
}

/** @param {Data} data @returns {Array<Record<string, unknown>>} */
function groups(data) {
  return /** @type {Array<Record<string, unknown>>} */ (data.groups)
}

describe('the fleet, grouped by the core', () => {
  test('every status the kernel has belongs to exactly one group', () => {
    // A status added to the vocabulary and to no group is an agent that VANISHES
    // off the roster — the pane renders the groups it was handed and cannot know
    // one is missing. This is the only place the two lists meet (I16).
    expect([...GROUPED_STATUSES].sort()).toEqual([...STATUSES].sort())
    expect(new Set(GROUPED_STATUSES).size).toBe(GROUPED_STATUSES.length)
  })

  test('the group that needs a person is FIRST, and it is the group only a waiting agent joins', () => {
    const { app } = harness()
    app.log.append({ type: 'agent_status', agent: 'main', status: 'waiting', detail: 'asked you something' }, 1)
    const first = groups(screen(app))[0]
    expect(first?.id).toBe('waiting')
    expect(first?.label).toBe('Needs you — 1 agent')
    expect(/** @type {Array<Record<string, unknown>>} */ (first?.rows)[0]?.name).toBe('main')
  })

  test('a group with nobody in it is not sent at all', () => {
    const { app } = harness()
    // One idle agent and nothing else: three of the four groups are empty, and a
    // heading over no rows is furniture between a person and their work.
    expect(groups(screen(app)).map((g) => g.id)).toEqual(['resting'])
  })

  test('a row never renders blank — an agent with nothing to say falls back to its turn history', () => {
    const { app } = harness()
    const row = /** @type {Array<Record<string, unknown>>} */ (groups(screen(app))[0]?.rows)[0]
    expect(row?.detail).not.toBe('')
    expect(row?.statusLabel).not.toBe('')
  })
})

describe('the shape the Work screen declares', () => {
  test('GET / answers the exact shape apps/web/fixtures/run.js declares, key for key', async () => {
    // READ OFF DISK, not copied. The fixture is the FACE lane's declaration of
    // what its screen renders, and it lives in a package this one may not edit;
    // a copy of it here would drift the first time either side moved, which is
    // the drift `lib/roster.js` exists to catch at runtime today.
    // `any`: a dynamic import across the workspace has no static type here.
    const fixture = /** @type {any} */ (await import(`${import.meta.dir}/../../../apps/web/fixtures/run.js`))
    const { app } = harness()
    expect(disagreement(fixture.dashboard, screen(app), 'dashboard')).toEqual([])
  })

  test('and the mismatch check would actually catch one', () => {
    expect(disagreement({ a: 1 }, { a: 1, b: 2 }, 'x')).toEqual([])
    expect(disagreement({ a: 1, b: 2 }, { a: 1 }, 'x')).toEqual(['x.b is missing'])
    expect(disagreement({ a: 1 }, { a: 'one' }, 'x')).toEqual(['x.a is a string, and the fixture declares a number'])
  })
})

/**
 * Where `real` fails to answer what `declared` says the screen renders: a key
 * the fixture has and the projection does not, or a key whose type differs.
 * Extra keys are allowed — a projection may carry more than one screen draws.
 * Arrays are compared on their FIRST element, which is what declares the row.
 * @param {unknown} declared @param {unknown} real @param {string} at
 * @returns {string[]}
 */
function disagreement(declared, real, at) {
  if (Array.isArray(declared)) {
    if (!Array.isArray(real)) return [`${at} is not a list`]
    const one = declared[0]
    return one === undefined || real[0] === undefined ? [] : disagreement(one, real[0], `${at}[]`)
  }
  if (declared !== null && typeof declared === 'object') {
    if (real === null || typeof real !== 'object' || Array.isArray(real)) return [`${at} is not an object`]
    return Object.entries(declared).flatMap(([key, value]) => {
      const held = /** @type {Record<string, unknown>} */ (real)[key]
      return held === undefined ? [`${at}.${key} is missing`] : disagreement(value, held, `${at}.${key}`)
    })
  }
  return typeof declared === typeof real ? [] : [`${at} is a ${typeof real}, and the fixture declares a ${typeof declared}`]
}

describe('the health line', () => {
  test('a build that withheld a capability SAYS which, and is still healthy', () => {
    const { app } = harness()
    app.available = app.available.filter((id) => id !== 'net')
    const data = handle(app, get('/panels/status')).data
    expect(data.status).toBe('ok')
    // The test build's workspace is in memory, which outranks a capability
    // nobody granted — so the sentence is in `detail`, and it is still SAID.
    expect(`${data.headline} ${data.detail}`).toContain('fetch from an allowlisted endpoint')
  })

  test('a storage failure outranks it, because the first is losing work', () => {
    const { app } = harness()
    app.log.append({ type: 'store_failed', key: 'config/keys/model', message: 'quota exceeded' }, 1)
    const data = handle(app, get('/panels/status')).data
    expect(data.status).toBe('failed')
    expect(String(data.headline)).toContain('quota exceeded')
  })
})

describe('the tiles', () => {
  test('a message sent from this page is counted once, worded once', () => {
    const { app } = harness()
    handle(app, post('/chat', { message: 'hello' }))
    const tiles = /** @type {Array<Record<string, unknown>>} */ (handle(app, get('/tiles')).data.tiles)
    expect(tiles.find((t) => t.id === 'messages')?.value).toBe('1 message')
  })
})
