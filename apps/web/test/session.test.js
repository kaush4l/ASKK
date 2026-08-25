import { expect, test } from 'bun:test'

import { StoreError, get, ok, problem } from '@harness/kernel'

import { openSession } from '../lib/session.js'
import { screen, wiring } from './doubles.js'

/** One block of text, the shape `ui/markdown.jsx` renders. */
function para(/** @type {string} */ text) {
  return { kind: 'paragraph', spans: [{ kind: 'text', text }] }
}

/**
 * A CORE, IN MEMORY, BEHIND THE FROZEN PAIR (`test/doubles.js`). It is not a
 * mock of the interface: it records a fact, projects what the log holds, and
 * notifies, and those three are the whole contract the interface is written
 * against.
 *
 * `log` is passed in so two sessions can share one, which is what a reload is.
 * @param {Array<Record<string, unknown>>} log
 */
function core(log) {
  /** @type {Set<() => void>} */
  const watchers = new Set()
  let queued = ''
  const notify = () => { for (const watcher of watchers) watcher() }
  const seam = (/** @type {import('@harness/kernel').Request} */ request) => {
    if (request.path === '/chat' && request.method === 'POST') {
      log.push({ id: `m${log.length}`, row: 'said', kind: 'user', speaker: 'You', blocks: [para(request.body.message ?? '')] })
      queued = request.body.message ?? ''
      notify()
    }
    if (request.path === '/chat') return ok('chat', transcript(log, queued))
    return problem(404, 'Nothing here answers that.', { kind: 'no_route', id: request.path })
  }
  const run = async () => {
    if (queued === '') return
    // A model call is not synchronous, and the point of the increment is what
    // the screen shows WHILE it is outstanding: without this yield the reply
    // lands before `send` has returned and the in-flight row never exists.
    await Promise.resolve()
    log.push({ id: `m${log.length}`, row: 'said', kind: 'assistant', speaker: 'main', blocks: [para(`main answers: ${queued}`)] })
    queued = ''
    notify()
  }
  return wiring({ seam, run, subscribe: (fn) => { watchers.add(fn); return () => watchers.delete(fn) } })
}

/** @param {Array<Record<string, unknown>>} rows @param {string} queued */
function transcript(rows, queued) {
  return {
    agent: 'main', stageLabel: 'main · work stage', rows,
    emptyNote: 'Nothing has been said to main yet.',
    waitingLabel: queued === '' ? '' : 'Working — this turn is running',
    waitingStatus: queued === '' ? 'idle' : 'thinking',
    composer: { promptLabel: 'Say the next thing to main', placeholder: '…', sendLabel: 'Send', refusedLabel: '', sentWith: [], cost: { label: '', headroomLabel: '', parts: [] } },
  }
}

/**
 * THE IN-FLIGHT ROW IS A PROJECTED FACT AND NOT COMPONENT STATE.
 *
 * The message is on the screen before anything has been driven, and it is there
 * because the seam already holds it — the assertion is a SECOND, INDEPENDENT
 * read, which is what navigating away and back does. A component that had
 * appended the row to its own list would pass a test that reads the response of
 * the send; nothing but a re-read catches it.
 */
test('a sent message is in the next projection, and in one nobody was holding', async () => {
  const session = await openSession('', core([]))
  expect(session.problem).toBeNull()
  const settled = session.send('main', 'Does Firecrawl still answer without a key?')

  expect(screen(session.read(get('/chat')))).toContain('Does Firecrawl still answer without a key?')
  expect(screen(session.read(get('/chat')))).toContain('Working — this turn is running')

  await settled
  const after = screen(session.read(get('/chat')))
  expect(after).toContain('main answers: Does Firecrawl still answer without a key?')
  expect(after).not.toContain('Working — this turn is running')
})

/**
 * …AND THE REPLY ARRIVES WITHOUT A RELOAD, which means one thing mechanically:
 * `subscribe` fired, twice, and each time the counter moved. That counter is
 * the only thing `useSyncExternalStore` compares, so a notification that did not
 * move it is a reply that sits in the log with the screen still showing the
 * question.
 */
test('every append moves the counter the interface is watching', async () => {
  const session = await openSession('', core([]))
  /** @type {number[]} */
  const seen = []
  const stop = session.subscribe(() => seen.push(session.version()))
  await session.send('main', 'Anything.')
  expect(seen).toEqual([1, 2])
  stop()
  await session.send('main', 'Again.')
  expect(seen).toEqual([1, 2])
})

/**
 * A RELOAD RESTORES THE TRANSCRIPT FROM THE LOG. Two sessions over one log, and
 * the second one was never told what the first one did: it reads.
 */
test('a second session over the same log opens on the transcript the first one wrote', async () => {
  /** @type {Array<Record<string, unknown>>} */
  const log = []
  const first = await openSession('', core(log))
  await first.send('main', 'Remember this.')

  const reloaded = await openSession('', core(log))
  expect(screen(reloaded.read(get('/chat')))).toContain('Remember this.')
})

/**
 * A BOOT THAT DID NOT COME UP IS ON THE SCREEN IN WORDS.
 *
 * The failure is the real one a person meets: a browser that will not open
 * IndexedDB, which is a private window on several of them. It becomes the ONE
 * failure shape, so the same component renders it as renders a 404 from the
 * seam — and the session it returns has no seam at all, because a `read` that
 * answered with an empty projection is how a dead page looks healthy.
 */
test('a boot that throws becomes the one failure projection, with a repair in it', async () => {
  const refused = new StoreError('unavailable', 'This browser would not open the store this page keeps its history in.', {
    detail: 'indexedDB.open("harness") was refused.',
  })
  const session = await openSession('/ASKK/', {
    bootBrowser: async () => { throw refused },
    attach: () => { throw new Error('nothing to attach to') },
  })
  expect(session.problem?.kind).toBe('unavailable')
  const said = screen({ status: 500, view: 'problem', data: { ...session.problem } })
  expect(said).toContain('would not open the store')
  expect(said).toContain('a private window is the usual reason')
  expect(said).toContain('indexedDB.open')
  expect(() => session.read(get('/chat'))).toThrow()
})

/**
 * …AND A FAILURE THAT IS NOT ONE OF OURS STILL SAYS SOMETHING. A `TypeError`
 * out of a browser API carries no `repair` and no `detail`, and returning it
 * raw would put a stack trace where a sentence belongs.
 */
test('a failure that is not a typed one is still a sentence and a repair', async () => {
  const session = await openSession('/', {
    bootBrowser: async () => { throw new TypeError('undefined is not a function') },
    attach: () => { throw new Error('nothing to attach to') },
  })
  const said = screen({ status: 500, view: 'problem', data: { ...session.problem } })
  expect(said).toContain('could not start its core')
  expect(said).toContain('undefined is not a function')
})
