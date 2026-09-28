import { expect, test } from 'bun:test'
import { inspectArtifact, installArtifactLocationProfile, validateAssertions } from '../src/workspace/artifacts.js'
import { ARTIFACT_TIMING, artifactInspectionBudget, artifactSegmentMs, settleArtifactStorage } from '../src/workspace/artifact-timing.js'

test('reload requires a restored-state outcome and cannot replace a real interaction', () => {
  const click = { action: 'click', selector: '#add' }; const outcome = { action: 'assertText', selector: '#count', value: '1' }
  expect(() => validateAssertions([{ action: 'reload' }, outcome])).toThrow('interaction')
  expect(() => validateAssertions([click, outcome, { action: 'reload' }])).toThrow('after reload')
  expect(() => validateAssertions([click, { action: 'reload' }, click, outcome])).toThrow('restored state')
  expect(() => validateAssertions([click, { action: 'reload' }, { action: 'reload' }, outcome])).toThrow('restored state')
  expect(() => validateAssertions([click, { action: 'reload', selector: 'iframe' }, outcome])).toThrow('does not accept')
  const plan = validateAssertions([click, { action: 'reload' }, outcome])
  expect(plan[1]).toEqual({ action: 'reload' })
  expect(Object.isFrozen(plan[1])).toBe(true)
})

test('explicit blur requires a selector and a later outcome, and cannot replace a click or fill', () => {
  const fill = { action: 'fill', selector: '#title', value: 'Edited title' }; const blur = { action: 'blur', selector: '#title' }; const outcome = { action: 'assertText', selector: '#committed', value: 'Edited title' }
  expect(validateAssertions([fill, blur, outcome])[1]).toEqual(blur)
  expect(() => validateAssertions([fill, outcome, blur])).toThrow('followed by')
  expect(() => validateAssertions([blur, outcome])).toThrow('interaction')
  expect(() => validateAssertions([fill, { action: 'blur' }, outcome])).toThrow('selector')
})

test('observation-only plans still require an outcome after any supplied interaction', () => {
  const outcome = { action: 'assertText', selector: '#title', value: 'Title' }
  expect(validateAssertions([outcome], { requireInteraction: false })).toEqual([outcome])
  for (const action of ['click', 'fill', 'blur']) {
    const interaction = { action, selector: '#title', ...(action === 'fill' ? { value: 'Edited' } : {}) }
    expect(() => validateAssertions([outcome, interaction], { requireInteraction: false })).toThrow('followed by')
  }
})

test('single-page compatibility preserves normal URL behavior and native blob methods', () => {
  const calls = []; const location = { href: 'about:srcdoc', pathname: 'srcdoc', search: '', hash: '' }
  const realm = { URL, location, history: { pushState: (...args) => calls.push(args), replaceState: (...args) => calls.push(args) } }
  installArtifactLocationProfile(realm)
  expect(new realm.URL('srcdoc', location.href).href).toBe('https://artifact.invalid/')
  expect(new realm.URL(location.href).href).toBe('https://artifact.invalid/')
  expect(new realm.URL('../image.png', 'https://example.org/path/page').href).toBe('https://example.org/image.png')
  expect(new realm.URL('srcdoc', 'https://example.org/').href).toBe('https://example.org/srcdoc')
  expect(realm.URL.canParse('srcdoc', location.href)).toBe(true)
  expect(realm.URL.canParse('invalid without a base')).toBe(false)
  expect(realm.URL.parse('invalid without a base')).toBe(null)
  expect(realm.URL.createObjectURL).toBe(URL.createObjectURL)
  expect(realm.URL.revokeObjectURL).toBe(URL.revokeObjectURL)
  const blob = realm.URL.createObjectURL(new Blob(['fixture'])); expect(blob.startsWith('blob:')).toBe(true); realm.URL.revokeObjectURL(blob)
  realm.history.replaceState({ next: true }, '', 'srcdoc')
  expect(calls).toEqual([[{ next: true }, '']])
  expect(realm.location).toBe(location)
  expect(() => realm.history.pushState({}, '', '/another-route')).toThrow('single-page')
  expect(() => realm.history.replaceState({}, '', 'https://example.org/')).toThrow('single-page')
})

test('HTTP documents retain the native URL and history implementations', () => {
  const replaceState = () => {}; const pushState = () => {}
  const realm = { URL, location: { href: 'https://example.org/' }, history: { replaceState, pushState } }
  installArtifactLocationProfile(realm)
  expect(realm.URL).toBe(URL); expect(realm.history.replaceState).toBe(replaceState); expect(realm.history.pushState).toBe(pushState)
})

// This is a parent-protocol unit fixture, not a substitute for actual opaque-frame browser QA.
async function frameHarness(run, { denyStorage = false, malformed = false, persist = true, clock, actionDelayMs = 0, beforeReply = () => {}, beforeConnected = () => {} } = {}) {
  const artifact = { id: 'fixture-artifact', nonce: 'fixture-nonce', revision: 8, buildId: 'fixture-build', html: '<p>fixture</p>' }
  const originals = Object.fromEntries(['window', 'document', 'localStorage', ...(clock ? ['MessageChannel'] : [])].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
  const listeners = new Set(); const storage = new Map(); const frames = []; const steps = []; const ports = []
  const request = (frame, method, params) => new Promise((resolve, reject) => { const requestId = crypto.randomUUID(); frame.waiting.set(requestId, { resolve, reject }); frame.port.postMessage({ method, params, requestId }) })
  const receive = async (frame, data) => {
    if (data.replyTo) { const waiter = frame.waiting.get(data.replyTo); frame.waiting.delete(data.replyTo); if (waiter) data.error ? waiter.reject(new Error(data.error)) : waiter.resolve(data.value); return }
    if (data.method === 'drain') {
      steps.push(`drain:${frame.id}`); await Promise.all(frame.writes)
      frame.port.postMessage({ replyTo: data.requestId, result: { ok: frame.errors.length === 0, errors: frame.errors } }); return
    }
    if (data.method !== 'inspect') return
    const results = []
    for (const [index, assertion] of data.assertions.entries()) {
      if (assertion.action === 'click') {
        frame.value++; frame.clicks++; if (persist) frame.writes.push(request(frame, 'storage.set', { key: 'count', value: frame.value }).catch(error => frame.errors.push(error.message)))
      } else if (assertion.action === 'assertText' && !String(frame.value).includes(assertion.value)) { frame.errors.push('Restored value did not match'); break }
      if (actionDelayMs) await new Promise(resolve => clock.setTimeout(resolve, actionDelayMs))
      results.push({ index, ok: true })
    }
    beforeReply({ frame, data, clock })
    frame.port.postMessage({ replyTo: data.requestId, result: malformed ? { ok: true, results: [{ index: 99, ok: true }], errors: [] } : { ok: frame.errors.length === 0, results, errors: frame.errors } })
  }
  const window = { addEventListener: (_, listener) => listeners.add(listener), removeEventListener: (_, listener) => listeners.delete(listener) }
  const document = { createElement() {
    const frame = { id: frames.length, style: {}, attributes: {}, waiting: new Map(), writes: [], errors: [], value: 0, clicks: 0,
      setAttribute(key, value) { this.attributes[key] = value }, removeAttribute(key) { delete this.attributes[key] },
      remove() { steps.push(`remove:${this.id}`); this.removed = true },
    }
    frame.contentWindow = { postMessage(data, _, transfer) {
      if (data.type !== 'askk.connect') return
      frame.port = transfer[0]; ports.push(frame.port); frame.port.onmessage = event => receive(frame, event.data); frame.port.start()
      request(frame, 'storage.get', { key: 'count' }).then(value => { frame.value = value ?? 0; beforeConnected({ frame, clock }); frame.port.postMessage({ type: 'connected' }) }).catch(error => { frame.errors.push(error.message); frame.port.postMessage({ type: 'connected' }) })
    } }
    frames.push(frame); return frame
  }, body: { append(frame) { steps.push(`append:${frame.id}`); queueMicrotask(() => { for (const listener of listeners) listener({ isTrusted: true, source: frame.contentWindow, data: { type: 'askk.artifact.ready', id: artifact.id, nonce: artifact.nonce } }) }) } } }
  const localStorage = { get length() { return storage.size }, key: index => [...storage.keys()][index], getItem: key => storage.get(key) ?? null, setItem(key, value) { if (denyStorage) throw new Error('Durable storage denied'); storage.set(key, value) }, removeItem: key => storage.delete(key) }
  for (const [name, value] of Object.entries({ window, document, localStorage, ...(clock ? { MessageChannel: ControlledChannel } : {}) })) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  try { return await run({ artifact, frames, steps, storage }) } finally { for (const port of ports) port.close(); for (const [name, descriptor] of Object.entries(originals)) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name] }
}

const reloadPlan = [{ action: 'click', selector: '#add' }, { action: 'reload' }, { action: 'assertText', selector: '#count', value: '1' }]
test('reload drains writes, replaces the opaque frame, preserves scope, and yields an immutable ordered receipt', async () => frameHarness(async ({ artifact, frames, steps, storage }) => {
  const receipt = await inspectArtifact(artifact, reloadPlan)
  expect(receipt.ok).toBe(true)
  expect(receipt.results).toEqual([{ index: 0, action: 'click', ok: true, frame: 0 }, { index: 1, action: 'reload', ok: true, frame: 1 }, { index: 2, action: 'assertText', ok: true, frame: 1 }])
  expect(receipt).toMatchObject({ artifactId: artifact.id, revision: 8, buildId: 'fixture-build' })
  expect(Object.isFrozen(receipt)).toBe(true); expect(Object.isFrozen(receipt.results[1])).toBe(true)
  expect(steps.indexOf('drain:0')).toBeLessThan(steps.indexOf('remove:0'))
  expect(frames).toHaveLength(2)
  expect(frames.every(frame => frame.attributes.sandbox === 'allow-scripts allow-forms' && frame.removed)).toBe(true)
  expect(storage.size).toBe(0)
  expect((await inspectArtifact(artifact, reloadPlan)).ok).toBe(true) // Fresh scope for a new check, no previous test contamination.
}))

test('a storage failure cannot produce a successful reload or persistence receipt', async () => frameHarness(async ({ artifact, frames }) => {
  const receipt = await inspectArtifact(artifact, reloadPlan)
  expect(receipt.ok).toBe(false); expect(receipt.errors.join(' ')).toContain('Durable storage denied')
  expect(receipt.results.some(result => result.action === 'reload')).toBe(false)
  expect(frames).toHaveLength(1)
}, { denyStorage: true }))

test('an app that only changes in-memory state fails its post-reload outcome', async () => frameHarness(async ({ artifact }) => {
  const receipt = await inspectArtifact(artifact, reloadPlan)
  expect(receipt.ok).toBe(false); expect(receipt.errors).toContain('Restored value did not match')
  expect(receipt.results.map(result => result.action)).toEqual(['click', 'reload'])
}, { persist: false }))

test('a malformed out-of-order frame receipt cannot be promoted to passing evidence', async () => frameHarness(async ({ artifact }) => {
  const receipt = await inspectArtifact(artifact, reloadPlan)
  expect(receipt.ok).toBe(false); expect(receipt.errors).toContain('Malformed artifact check receipt')
  expect(receipt.results).toEqual([])
}, { malformed: true }))


// Timers can be clamped without waiting in real time. jump() deliberately moves
// the clock without delivering timers, reproducing a late callback beating its
// timeout callback in the browser's task queues.
function controlledClock({ minimumDelay = 0, settleDelay = 0 } = {}) {
  let time = 0; let serial = 0; let fired = 0; const timers = new Map()
  const clock = {
    now: () => time,
    setTimeout(callback, ms) { const id = ++serial; timers.set(id, { at: time + Math.max(minimumDelay, ms, ms === ARTIFACT_TIMING.settleDelayMs ? settleDelay : 0), callback }); return id },
    clearTimeout: id => timers.delete(id),
    jump: ms => { time += ms },
    get fired() { return fired },
    get pending() { return timers.size },
    async run(promise) {
      let settled = false; let value; let error
      promise.then(result => { settled = true; value = result }, failure => { settled = true; error = failure })
      for (let iteration = 0; iteration < 10000; iteration++) {
        // Drain promise/message-port work before moving to the next timer task.
        for (let turn = 0; turn < 30; turn++) await Promise.resolve()
        if (settled) { if (error) throw error; return value }
        const [id, next] = [...timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0] ?? []
        if (!next) throw new Error('Controlled check stalled with no pending timer')
        timers.delete(id); time = Math.max(time, next.at); fired++; next.callback()
      }
      throw new Error('Controlled timer task limit exceeded')
    },
  }
  return clock
}

class ControlledChannel {
  constructor() {
    const port = () => ({ closed: false, start() {}, close() { this.closed = true } })
    this.port1 = port(); this.port2 = port()
    for (const [sender, receiver] of [[this.port1, this.port2], [this.port2, this.port1]]) sender.postMessage = data => {
      const copy = structuredClone(data)
      queueMicrotask(() => { if (!sender.closed && !receiver.closed) receiver.onmessage?.({ data: copy }) })
    }
  }
}

const longPlan = count => [...Array.from({ length: count - 1 }, () => ({ action: 'click', selector: '#add' })), { action: 'assertText', selector: '#count', value: String(count - 1) }]

test('the plan ledger reserves every action and each reload while rejecting oversized checks before a frame exists', async () => {
  expect(artifactInspectionBudget(longPlan(36))).toEqual({ totalMs: 81000, frames: 1, segments: [49000] })
  expect(artifactInspectionBudget(longPlan(100)).totalMs).toBe(161000)
  expect(artifactInspectionBudget(reloadPlan)).toEqual({ totalMs: 86000, frames: 2, segments: [12000, 12000] })
  const plan = [{ action: 'click', selector: '#add' }, ...Array.from({ length: 8 }, () => [{ action: 'reload' }, { action: 'assertText', selector: '#count', value: '1' }]).flat()]
  await frameHarness(async ({ artifact, frames }) => {
    await expect(inspectArtifact(artifact, plan)).rejects.toThrow('240-second time budget')
    expect(frames).toHaveLength(0)
  })
})

test('37 actions tolerate one-second background timer clamping without replaying any action', async () => {
  const clock = controlledClock({ minimumDelay: 1000 }); const plan = longPlan(37)
  await frameHarness(async ({ artifact, frames }) => {
    const receipt = await clock.run(inspectArtifact(artifact, plan, { clock }))
    expect(receipt.ok).toBe(true)
    expect(receipt.results).toHaveLength(37)
    expect(receipt.results.map(row => row.index)).toEqual(Array.from({ length: 37 }, (_, index) => index))
    expect(frames[0].clicks).toBe(36)
    expect(receipt.timing).toEqual({ elapsedMs: 38000, budgetMs: artifactInspectionBudget(plan).totalMs })
    expect(clock.pending).toBe(0)
  }, { clock, actionDelayMs: 80 })
})

test('a passing segment receipt arriving after its deadline fails even before the timeout callback runs', async () => {
  const clock = controlledClock(); const plan = longPlan(2)
  await frameHarness(async ({ artifact, frames }) => {
    const receipt = await clock.run(inspectArtifact(artifact, plan, { clock }))
    expect(receipt.ok).toBe(false)
    expect(receipt.errors).toContain('Artifact inspection timed out')
    expect(receipt.results).toEqual([])
    expect(frames[0].clicks).toBe(1)
    expect(clock.fired).toBe(1) // Only the initial settle timer; timeout was withheld.
    expect(clock.pending).toBe(0)
  }, { clock, beforeReply: ({ data }) => clock.jump(artifactSegmentMs(data.assertions.length) + 1) })
})

test('a late connected callback cannot evade its boot deadline or start actions', async () => {
  const clock = controlledClock()
  await frameHarness(async ({ artifact, frames }) => {
    const receipt = await clock.run(inspectArtifact(artifact, longPlan(2), { clock }))
    expect(receipt.ok).toBe(false)
    expect(receipt.errors).toContain('Artifact did not become inspectable within 15 seconds')
    expect(frames[0].clicks).toBe(0)
    expect(clock.fired).toBe(0)
    expect(clock.pending).toBe(0)
  }, { clock, beforeConnected: () => clock.jump(15001) })
})

test('the total plan deadline rejects late success before a delayed global timeout callback', async () => {
  const clock = controlledClock(); const plan = longPlan(2)
  await frameHarness(async ({ artifact, frames }) => {
    const receipt = await clock.run(inspectArtifact(artifact, plan, { clock }))
    expect(receipt.ok).toBe(false)
    expect(receipt.errors).toContain('Artifact inspection exceeded its plan time budget')
    expect(frames[0].clicks).toBe(1)
    expect(clock.fired).toBe(1)
    expect(clock.pending).toBe(0)
  }, { clock, beforeReply: () => clock.jump(artifactInspectionBudget(plan).totalMs) })
})

test('storage drain counts elapsed time under clamping and refuses a late quiet result', async () => {
  for (const [pending, advance, expected, calls] of [[true, 1000, false, 10], [false, 1000, true, 2], [false, 11000, false, 1]]) {
    let time = 0; let sleeps = 0
    const settled = await settleArtifactStorage({ hasPending: () => pending, now: () => time, timeoutMs: ARTIFACT_TIMING.storageMs, sleep: async () => { time += advance; sleeps++ } })
    expect(settled).toBe(expected)
    expect(sleeps).toBe(calls)
  }
})


test('a background-aligned initial settle timer can wake at1500ms without exhausting the plan', async () => {
  const clock = controlledClock({ minimumDelay: 1000, settleDelay: 1500 }); const plan = longPlan(37)
  await frameHarness(async ({ artifact, frames }) => {
    const receipt = await clock.run(inspectArtifact(artifact, plan, { clock }))
    expect(receipt.ok).toBe(true)
    expect(receipt.results).toHaveLength(37)
    expect(frames[0].clicks).toBe(36)
    expect(receipt.timing).toEqual({ elapsedMs: 38500, budgetMs: artifactInspectionBudget(plan).totalMs })
    expect(clock.pending).toBe(0)
  }, { clock, actionDelayMs: 80 })
})
