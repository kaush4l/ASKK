import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseFragment } from 'parse5'
import { Settings, Welcome } from '../src/workbench/Workbench.jsx'
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
  expect(all(tree, node => node.tagName === 'a').map(node => attr(node, 'href'))).toContain('https://github.com/kaush4l/ASKK/blob/cf6b594555c0fb73a9ef349663ca39b46e3faa27/scripts/companion/README.md#start-explicitly')
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
