import { expect, test } from 'bun:test'
import { runInNewContext } from 'node:vm'
import { BOOT_WATCHDOG_SCRIPT } from '../app/boot-watchdog.js'

function documentFixture(ready = false) {
  const document = { documentElement: { dataset: ready ? { askkBoot: 'ready' } : {} } }
  const window = new EventTarget()
  const timers = new Map()
  runInNewContext(BOOT_WATCHDOG_SCRIPT, {
    document, window,
    setTimeout(callback, ms) { timers.set(1, { callback, ms }); return 1 },
    clearTimeout(id) { timers.delete(id) },
  })
  return { document, window, timers }
}

test('exported inline watchdog reports missing application bundles without React', () => {
  const { document, timers } = documentFixture()
  expect(document.documentElement.dataset.askkBoot).toBe('pending')
  expect(timers.get(1).ms).toBe(8000)
  timers.get(1).callback()
  expect(document.documentElement.dataset.askkBoot).toBe('stalled')
})

test('application hydration cancels its deadline and a late mount can dismiss the notice', () => {
  const { document, window, timers } = documentFixture()
  window.dispatchEvent(new Event('askk:hydrated'))
  expect(document.documentElement.dataset.askkBoot).toBe('ready')
  expect(timers.size).toBe(0)
  expect(documentFixture(true).timers.size).toBe(0)
  const late = documentFixture()
  late.timers.get(1).callback()
  late.document.documentElement.dataset.askkBoot = 'ready'
  late.window.dispatchEvent(new Event('askk:hydrated'))
  expect(late.document.documentElement.dataset.askkBoot).toBe('ready')
})
