import { expect, test } from 'bun:test'
import { watchPageLifecycle } from '../src/runtime/page-lifecycle.js'

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const transition = (page, type, persisted = true) => { const event = new Event(type); Object.defineProperty(event, 'persisted', { value: persisted }); page.dispatchEvent(event) }
function fixture(options = {}) {
  const page = new EventTarget(); const events = []; const reload = deferred(); const blocked = deferred()
  page.location = { reload() { events.push('reload'); reload.resolve() } }
  const lifecycle = watchPageLifecycle({ page, stop: () => events.push('stop'), checkpoint: async () => events.push('checkpoint'), notify(state) { events.push(state); if (state.status === 'blocked') blocked.resolve(state) }, ...options })
  return { page, events, reload: reload.promise, blocked: blocked.promise, lifecycle }
}

test('persisted pageshow checkpoints after stopping once, then reloads exactly once without resuming work', async () => {
  const barrier = deferred(); const f = fixture({ checkpoint: () => barrier.promise })
  f.page.addEventListener('askk:before-page-reload', () => f.events.push('drafts'))
  transition(f.page, 'pageshow', false)
  expect(f.events).toEqual([])
  transition(f.page, 'pagehide'); transition(f.page, 'pagehide')
  transition(f.page, 'pageshow'); transition(f.page, 'pageshow')
  await Promise.resolve(); await Promise.resolve()
  expect(f.events).toEqual(['stop', { status: 'restoring' }, 'drafts'])
  barrier.resolve(); await f.reload
  expect(f.events.at(-1)).toBe('reload')
  expect(f.events.filter(value => value === 'reload')).toHaveLength(1)
  f.lifecycle.dispose()
})

test('ordinary pageshow and visibility changes cannot trigger a reload', async () => {
  const f = fixture()
  transition(f.page, 'pageshow'); transition(f.page, 'visibilitychange'); transition(f.page, 'pagehide', false); transition(f.page, 'pageshow', false)
  await Promise.resolve()
  expect(f.events).toEqual(['stop'])
  f.lifecycle.dispose()
})

test('a cancelled draft save retains the cached document and never checkpoints or reloads', async () => {
  const f = fixture()
  f.page.addEventListener('askk:before-page-reload', event => event.preventDefault())
  transition(f.page, 'pagehide'); transition(f.page, 'pageshow')
  expect((await f.blocked).error).toContain('Draft recovery could not be saved')
  expect(f.events).not.toContain('checkpoint'); expect(f.events).not.toContain('reload')
  f.lifecycle.dispose()
})

test('failed and hung checkpoints stop recovery; a late save cannot cause a late reload', async () => {
  for (const hung of [false, true]) {
    const late = deferred()
    const f = fixture({ timeoutMs: 15, checkpoint: () => hung ? late.promise : Promise.reject(new Error('Quota exhausted')) })
    transition(f.page, 'pagehide'); transition(f.page, 'pageshow')
    const result = await f.blocked
    expect(result.error).toContain(hung ? 'could not confirm its saves' : 'Quota exhausted')
    late.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(f.events).not.toContain('reload')
    f.lifecycle.dispose()
  }
})

test('drafts edited during checkpoint are saved at the final synchronous reload boundary, which may still veto', async () => {
  for (const refuse of [false, true]) {
    const save = deferred(); let draft = 'first'; const saved = []
    const f = fixture({ checkpoint: () => save.promise })
    f.page.addEventListener('askk:before-page-reload', event => { saved.push(draft); if (refuse && draft === 'latest') event.preventDefault() })
    transition(f.page, 'pagehide'); transition(f.page, 'pageshow'); await Promise.resolve()
    draft = 'latest'; save.resolve()
    await (refuse ? f.blocked : f.reload)
    expect(saved).toEqual(['first', 'latest'])
    expect(f.events.includes('reload')).toBe(!refuse)
    f.lifecycle.dispose()
  }
})

test('manual disposal removes listeners and suppresses an already-pending reload', async () => {
  const save = deferred(); const f = fixture({ checkpoint: () => save.promise })
  transition(f.page, 'pagehide'); transition(f.page, 'pageshow'); await Promise.resolve()
  f.lifecycle.dispose(); save.resolve(); await Promise.resolve(); await Promise.resolve()
  const before = [...f.events]
  transition(f.page, 'pagehide'); transition(f.page, 'pageshow')
  expect(f.events).toEqual(before); expect(f.events).not.toContain('reload')
})
