import companionDistribution from '../public/companion-release.json'
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseFragment } from 'parse5'
import { Settings, Welcome, restoreModelSettingsDraft } from '../src/workbench/Workbench.jsx'
import Dashboard from '../src/workbench/Dashboard.jsx'
import { modelStatusLabel, modelDraftChanged, canCheckModel, modelCheckCancelled, modelRelayAvailable } from '../src/workbench/model-ui.js'

const saved = { id: 'fixture-model', baseUrl: 'http://127.0.0.1:8873/v1', via: 'direct', status: 'configured' }
const draft = { model: saved.id, baseUrl: saved.baseUrl, via: saved.via, key: '' }
const stateFor = (model = {}, extra = {}) => ({ ready: true, model: { ...saved, ...model }, runtime: { target: 'browser', status: 'idle' }, companion: { status: 'disconnected', url: 'https://127.0.0.1:7717', capabilities: [] }, files: [], commands: [], ...extra })
const render = state => parseFragment(renderToStaticMarkup(<Settings state={state} initialTab="model" perform={() => { throw new Error('SSR must never operate the runtime') }} onClose={() => {}}/>))
const all = (node, predicate) => [...(predicate(node) ? [node] : []), ...(node.childNodes || []).flatMap(child => all(child, predicate))]
const text = node => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(text).join('')
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value
const button = (tree, name) => all(tree, node => node.tagName === 'button' && text(node) === name)[0]
const disabled = node => attr(node, 'disabled') !== undefined

test('opening model settings during restoration cannot expose stale save or check controls', () => {
  // Even a partial profile notification is not the final saved configuration.
  const tree = render(stateFor({ id: 'temporary-shipped-model', via: 'bridge' }, { ready: false }))
  for (const label of ['Save model', 'List models', 'Test reply']) expect(disabled(button(tree, label))).toBe(true)
  expect(all(tree, node => node.tagName === 'input' || node.tagName === 'select').every(disabled)).toBe(true)
  expect(text(tree)).toContain('Restoring saved model settings')
  expect(all(tree, node => node.tagName === 'input' && attr(node, 'value') === 'temporary-shipped-model')).toHaveLength(0)
  const ready = render(stateFor({ id: 'restored-owner-model' }))
  expect(disabled(button(ready, 'Save model'))).toBe(false)
  expect(disabled(button(ready, 'List models'))).toBe(false)
  expect(all(ready, node => node.tagName === 'input' && attr(node, 'value') === 'restored-owner-model')).toHaveLength(1)
})

test('one initialization boundary replaces the startup placeholder with the complete restored profile', () => {
  let current = restoreModelSettingsDraft(null, stateFor({}, { ready: false }))
  expect(current).toMatchObject({ initialized: false, model: '', via: 'direct', key: '' })
  expect(restoreModelSettingsDraft(current, stateFor({ id: 'intermediate' }, { ready: false }))).toBe(current)
  const restored = stateFor({ id: 'restored-model', baseUrl: 'https://model.example/v1', via: 'bridge', apiKey: 'fixture-never-copy-saved-key' }, { companion: { url: 'https://relay.example:7717' } })
  current = restoreModelSettingsDraft(current, restored)
  expect(current).toEqual({ initialized: true, model: 'restored-model', baseUrl: 'https://model.example/v1', via: 'bridge', key: '', bridgeUrl: 'https://relay.example:7717', editedFields: [] })
  expect(canCheckModel({ draft: current, saved: restored.model })).toBe(true)
  expect(restoreModelSettingsDraft(current, restored)).toBe(current)
})

test('worker boot-ready does not admit model actions before final controller configuration is restored', () => {
  const partial = stateFor({ id: 'pre-final-config' }, { ready: true, configurationReady: false })
  const tree = render(partial)
  for (const label of ['Save model', 'List models', 'Test reply']) expect(disabled(button(tree, label))).toBe(true)
  const pending = restoreModelSettingsDraft(null, partial)
  expect(pending).toMatchObject({ initialized: false, model: '' })
  const final = stateFor({ id: 'final-owner-model', via: 'bridge' }, { ready: true, configurationReady: true })
  expect(restoreModelSettingsDraft(pending, final)).toMatchObject({ initialized: true, model: 'final-owner-model', via: 'bridge' })
  expect(disabled(button(render(final), 'Save model'))).toBe(false)
})

test('companion edits made on the execution tab during opening survive model restoration', () => {
  const pending = restoreModelSettingsDraft(null, stateFor({}, { ready: false }))
  const edited = { ...pending, bridgeUrl: 'https://owner-relay.example', editedFields: ['bridgeUrl'] }
  const restored = restoreModelSettingsDraft(edited, stateFor({ id: 'restored-model', via: 'bridge' }))
  expect(restored).toMatchObject({ initialized: true, model: 'restored-model', via: 'bridge', bridgeUrl: 'https://owner-relay.example' })
  expect(edited.initialized).toBe(false)
})

test('probe updates and saved route changes preserve every edited field after initialization', () => {
  const initialized = restoreModelSettingsDraft(null, stateFor())
  const edited = { ...initialized, model: 'draft-model', baseUrl: 'https://draft.example/v1', via: 'bridge', bridgeUrl: 'https://draft-relay.example', key: 'unsaved-fixture-key' }
  for (const update of [
    stateFor({ status: 'checking', check: { kind: 'reply' } }),
    stateFor({ status: 'verified', probe: { text: 'Reply received' } }),
    stateFor({ id: 'other-saved-model', via: 'bridge', baseUrl: 'https://saved.example/v1' }),
    stateFor({}, { ready: false }),
    stateFor(),
  ]) {
    expect(restoreModelSettingsDraft(edited, update)).toBe(edited)
    expect(canCheckModel({ draft: edited, saved: update.model })).toBe(false)
  }
  // Closing/reopening is a new form and intentionally loads the current profile.
  expect(restoreModelSettingsDraft(null, stateFor({ id: 'other-saved-model', via: 'bridge' }))).toMatchObject({ model: 'other-saved-model', via: 'bridge', key: '' })
})

test('model checks require the saved draft and idle task, independent of successful discovery', () => {
  expect(canCheckModel({ draft, saved })).toBe(true)
  expect(canCheckModel({ draft, saved: { ...saved, status: 'failed', errorCode: 'HTTP_404' } })).toBe(true)
  for (const patch of [{ model: 'other' }, { baseUrl: 'https://provider.example/v1' }, { via: 'bridge' }, { key: 'new-key' }]) {
    expect(modelDraftChanged({ ...draft, ...patch }, saved)).toBe(true)
    expect(canCheckModel({ draft: { ...draft, ...patch }, saved })).toBe(false)
  }
  expect(canCheckModel({ draft, saved, active: true })).toBe(false)
  expect(canCheckModel({ draft, saved, busy: true })).toBe(false)
  expect(canCheckModel({ draft, saved: { ...saved, status: 'checking' } })).toBe(false)
})

test('listing, inference and legacy connected state have distinct honest labels on both entry surfaces', () => {
  for (const [status, label] of [['listed', 'Model listed'], ['verified', 'Reply verified'], ['connected', 'Model configured']]) {
    const state = stateFor({ status })
    expect(modelStatusLabel(state.model)).toBe(label)
    expect(renderToStaticMarkup(<Dashboard state={state}/>)).toContain(label)
    expect(renderToStaticMarkup(<Welcome state={state}/>)).toContain(label)
  }
  const tree = render(stateFor({ status: 'listed' }))
  expect(text(tree)).toContain('A reply has not been verified by this listing.')
  expect(disabled(button(tree, 'Test reply'))).toBe(false)
})

test('in-flight reply check retains selected config, disables conflicting actions and exposes cancellation', () => {
  const tree = render(stateFor({ status: 'checking', check: { kind: 'reply', status: 'checking', startedAt: 1 } }))
  expect(text(tree)).toContain('Testing reply…')
  expect(disabled(button(tree, 'List models'))).toBe(true)
  expect(disabled(button(tree, 'Test reply'))).toBe(true)
  expect(disabled(button(tree, 'Save model'))).toBe(true)
  expect(disabled(button(tree, 'Cancel check'))).toBe(false)
  expect(all(tree, node => node.tagName === 'input' && attr(node, 'value') === saved.baseUrl).map(disabled)).toEqual([true])
  expect(all(tree, node => attr(node, 'aria-label') === 'Model check result').map(node => attr(node, 'aria-busy'))).toEqual(['true'])
})

test('cancellation is neutral, while actual error and code remain visible and allow a reply retry', () => {
  const cancelled = render(stateFor({ check: { kind: 'reply', status: 'cancelled', cancelled: true }, error: '' }))
  expect(text(cancelled)).toContain('Connection check cancelled.')
  expect(all(cancelled, node => attr(node, 'role') === 'alert')).toHaveLength(0)
  expect(disabled(button(cancelled, 'Test reply'))).toBe(false)
  expect(modelCheckCancelled(new DOMException('Connection check cancelled.', 'AbortError'))).toBe(true)
  expect(modelCheckCancelled(new Error('Provider unavailable'))).toBe(false)
  const failed = render(stateFor({ status: 'failed', error: 'Provider rejected the request', errorCode: 'MODEL_HTTP_401' }))
  expect(all(failed, node => attr(node, 'role') === 'alert').map(text)).toEqual(['Provider rejected the requestMODEL_HTTP_401'])
  expect(disabled(button(failed, 'Test reply'))).toBe(false)
})

test('verified reply renders escaped actual text and receipt, with no nested forms or runtime startup control', () => {
  const reply = '<script>not executable</script>'
  const tree = render(stateFor({ status: 'verified', probe: { text: reply, at: 1, elapsedMs: 1234, receipt: { model: saved.id, complete: true } } }))
  expect(all(tree, node => attr(node, 'aria-label') === 'Model test reply').map(text)).toEqual([reply])
  expect(all(tree, node => node.tagName === 'script')).toHaveLength(0)
  expect(text(tree)).toContain('1.2s')
  expect(text(tree)).toContain('Recorded reply check')
  expect(all(tree, node => node.tagName === 'form')).toHaveLength(1)
  expect(text(tree)).not.toContain('Start environment')
})

test('inline relay onboarding advertises only model-relay and never equates certificate validity with trust', () => {
  const tree = render(stateFor({ via: 'bridge' }))
  expect(text(tree)).toContain('--capabilities model-relay')
  expect(text(tree)).toContain('--model-endpoint http://127.0.0.1:8873/v1')
  expect(text(tree)).toContain('./askk-companion')
  expect(text(tree)).not.toContain('bun host/companion.js')
  expect(all(tree, node => node.tagName === 'a' && attr(node, 'download') !== undefined)).toHaveLength(1)
  expect(text(tree)).not.toContain('--capabilities fs')
  expect(text(tree)).toContain('Certificate validity alone does not establish trust.')
  expect(text(tree)).toContain('Browser trust remains unconfirmed until this browser can pair.')
  expect(all(tree, node => node.tagName === 'form')).toHaveLength(1)
  expect(disabled(button(tree, 'Pair model relay'))).toBe(true)
  expect(all(tree, node => node.tagName === 'input' && attr(node, 'type') === 'password').every(node => attr(node, 'value') === '')).toBe(true)
  for (const release of companionDistribution.releases) expect(all(tree, node => node.tagName === 'a').map(node => attr(node, 'href'))).toContain(release.instructions)
})

test('an existing native binding blocks inline re-pairing while allowing checks through its granted relay', () => {
  const tree = render(stateFor({ via: 'bridge' }, { runtime: { target: 'local', status: 'ready' }, companion: { status: 'connected', url: 'https://127.0.0.1:7717', capabilities: ['model-relay'] } }))
  expect(text(tree)).toContain('Change its companion in Execution settings')
  expect(text(tree)).toContain('Model relay paired')
  expect(disabled(button(tree, 'Pair model relay'))).toBe(true)
  expect(disabled(button(tree, 'Test reply'))).toBe(false)
  const active = render(stateFor({}, { run: { status: 'thinking' } }))
  expect(disabled(button(active, 'Test reply'))).toBe(true)
  expect(text(active)).toContain('unavailable while an agent task is active')
})

test('legacy fetch grants can relay models, while guest networking alone never implies that capability', () => {
  for (const capability of ['fetch', 'model-relay']) {
    const companion = { status: 'connected', capabilities: [capability], url: 'https://127.0.0.1:7717' }
    const state = stateFor({ via: 'bridge' }, { companion })
    expect(modelRelayAvailable(companion)).toBe(true)
    expect(text(render(state))).toContain('Model relay paired')
    expect(renderToStaticMarkup(<Dashboard state={state}/>)).not.toContain('relay unavailable')
    expect(modelRelayAvailable({ ...companion, status: 'down' })).toBe(false)
  }
  expect(modelRelayAvailable({ status: 'connected', capabilities: ['network-relay'] })).toBe(false)
  const tree = render(stateFor({ via: 'bridge' }, { runtime: { target: 'browser', networkRelay: true } }))
  expect(text(tree)).toContain('guest network relay is selected')
  expect(disabled(button(tree, 'Pair model relay'))).toBe(true)
  expect(disabled(button(tree, 'Test reply'))).toBe(false)
})

test('closing model settings cannot expose an enabled task submit while its check remains active', () => {
  const state = stateFor({ status: 'checking', check: { kind: 'reply', status: 'checking' } }, { selectedWorkflowId: 'assistant', workflows: [{ id: 'assistant', label: 'Assistant', agent: 'assistant', workspace: false }] })
  const tree = parseFragment(renderToStaticMarkup(<Dashboard state={state} goal="Preserve this draft"/>))
  expect(disabled(button(tree, 'Checking model…'))).toBe(true)
  expect(text(tree)).toContain('Finish or cancel it in Model settings')
  const inputs = all(tree, node => node.tagName === 'textarea')
  expect(inputs).toHaveLength(1)
  expect(disabled(inputs[0])).toBe(false)
  expect(text(inputs[0])).toBe('Preserve this draft')
})

test('scoped relay availability needs an explicit endpoint grant and never falls back to generic fetch', () => {
  const companion = { status: 'connected', capabilities: ['model-relay', 'fetch'], modelRelay: { version: 1, endpoint: '/model/fetch', status: 'scope-required', endpoints: [] } }
  expect(modelRelayAvailable(companion)).toBe(false)
  expect(modelRelayAvailable({ ...companion, modelRelay: { ...companion.modelRelay, status: 'configured', endpoints: ['http://127.0.0.1:8873/v1'] } })).toBe(true)
  expect(modelRelayAvailable({ ...companion, capabilities: ['fetch'], modelRelay: { ...companion.modelRelay, status: 'configured', endpoints: ['http://127.0.0.1:8873/v1'] } })).toBe(false)
})

test('model discovery exposes explicit draft choices even when the saved model is missing', () => {
  const discovery = { ids: ['small-model', 'another-model'], baseUrl: saved.baseUrl, via: saved.via, truncated: false }
  const tree = render(stateFor({ status: 'failed', errorCode: 'MODEL_NOT_LISTED', discovery }))
  const choices = all(tree, node => node.tagName === 'select' && attr(node, 'aria-label') === 'Discovered models')
  expect(choices).toHaveLength(1)
  expect(all(choices[0], node => node.tagName === 'option').map(text)).toEqual(['Choose a model for your draft…', 'small-model', 'another-model'])
  expect(text(tree)).toContain('Listing does not verify replies or tool use.')
  expect(text(tree)).toContain('Model check failed')
  const stale = render(stateFor({ discovery: { ...discovery, baseUrl: 'https://old-provider.invalid/v1' } }))
  expect(all(stale, node => attr(node, 'aria-label') === 'Discovered models')).toHaveLength(0)
  const locked = render(stateFor({ discovery }, { run: { status: 'running' } }))
  expect(disabled(all(locked, node => attr(node, 'aria-label') === 'Discovered models')[0])).toBe(true)
})
