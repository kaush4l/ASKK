import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseFragment } from 'parse5'
import Dashboard, { matchesAgentDefinition } from '../src/workbench/Dashboard.jsx'
import { PackageImportFeedback, PackageImportReview } from '../src/workbench/PackageImport.jsx'
import { packageFileSelection, readPackageFiles, createImportSelection, defaultPackageChoices, packageInstallBindings, unsupportedPackageTools } from '../src/workbench/package-import.js'

const all = (node, predicate) => [...(predicate(node) ? [node] : []), ...(node.childNodes || []).flatMap(child => all(child, predicate))]
const text = node => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(text).join('')
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value
const render = element => parseFragment(renderToStaticMarkup(element))
const button = (tree, label) => all(tree, node => node.tagName === 'button' && text(node) === label)[0]
const workflowButtons = tree => all(all(tree, node => attr(node, 'role') === 'group' && attr(node, 'aria-label') === 'Workflow')[0], node => node.tagName === 'button')
const isDisabled = node => attr(node, 'disabled') !== undefined
const encoder = new TextEncoder()
const file = (path, body = 'text', read = () => {}) => ({ name: path.split('/').at(-1), webkitRelativePath: path, size: encoder.encode(body).length, async arrayBuffer() { read(); return encoder.encode(body).buffer } })
const preview = { stageId: 'local-preview', packageId: 'sample.agent', packageVersion: '1.0.0', revisionDigest: 'a'.repeat(64), entryAgentId: 'lead', agents: [{ id: 'lead', name: 'A <script> lead', description: 'A portable definition', tools: ['web'], modelAlias: '$default', delegates: { examine: 'critic' }, notes: [] }, { id: 'critic', name: 'Critic', tools: ['board'], modelAlias: 'reasoner', notes: [] }], files: [{ path: 'agent.md', bytes: 30 }, { path: 'roles/critic/agent.md', bytes: 40 }], modelAliases: ['$default', 'reasoner'], availableModels: [{ id: 'workbench', label: 'Desk default' }, { id: 'reasoner', label: 'Reasoning profile' }], availableTools: ['web', 'board'], notes: ['Unknown metadata is retained as notes.'] }
const state = { ready: true, model: { status: 'verified', id: 'default-provider' }, runtime: { status: 'idle' }, companion: {}, workflows: [{ id: 'pkg-one', label: 'Imported lead', agent: 'installed/one/lead', package: { installationId: 'one' }, leadModel: 'reasoner', workspace: false }], selectedWorkflowId: 'pkg-one', agentDefinitions: [], agents: [] }

test('folder selection strips exactly one selected root and preserves nested source paths and bytes', async () => {
  const files = [file('selected/agent.md', 'α\r\n'), file('selected/roles/selected/agent.md', 'nested'), file('selected/templates/prompt.md', 'template')]
  const selection = packageFileSelection(files, { directory: true })
  expect(selection.entries.map(entry => entry.path)).toEqual(['agent.md', 'roles/selected/agent.md', 'templates/prompt.md'])
  expect(selection.name).toBe('selected')
  const records = await readPackageFiles(files, { directory: true })
  expect([...records[0].content]).toEqual([...encoder.encode('α\r\n')])
  expect(records[1].path).toBe('roles/selected/agent.md')
})

test('all file counts, sizes and aggregate sizes are checked before reading even the first file', async () => {
  let reads = 0
  const source = file('selected/agent.md', 'a', () => reads++)
  const limits = { maxFiles: 2, maxFileBytes: 8, maxExpandedBytes: 10 }
  for (const files of [
    [source, file('selected/a.md'), file('selected/b.md')],
    [source, { ...file('selected/a.md'), size: 9 }],
    [source, { ...file('selected/a.md'), size: 8 }, file('selected/askk.lock.json', 'aa')],
    [source, { ...file('selected/a.md'), size: NaN }],
  ]) await expect(readPackageFiles(files, { directory: true, limits })).rejects.toThrow()
  expect(reads).toBe(0)
  expect(packageFileSelection([source, file('selected/a.md'), file('selected/askk.lock.json')], { directory: true, limits }).entries).toHaveLength(3)
})

test('unsafe, colliding, multi-root and missing-entry paths fail before bytes are read', async () => {
  let reads = 0
  const source = file('selected/agent.md', 'a', () => reads++)
  for (const paths of [['selected/../escape.md'], ['other/child.md'], ['selected/AGENT.md'], ['selected/café.md', 'selected/café.md'], ['selected/a%2fb.md'], ['selected/a\\b.md'], ['selected/trailing./x.md']]) {
    await expect(readPackageFiles([source, ...paths.map(path => file(path))], { directory: true })).rejects.toThrow()
  }
  await expect(readPackageFiles([file('selected/nested/agent.md')], { directory: true })).rejects.toThrow('top level')
  await expect(readPackageFiles([file('agent.md')], { directory: true })).rejects.toThrow('folder paths')
  expect(reads).toBe(0)
})

test('single-file fallback admits only agent.md and detects a changed byte length', async () => {
  expect((await readPackageFiles([file('agent.md', 'single')]))[0].path).toBe('agent.md')
  await expect(readPackageFiles([file('custom.md')])).rejects.toThrow('agent.md')
  await expect(readPackageFiles([file('agent.md'), file('support.md')])).rejects.toThrow('single-file')
  await expect(readPackageFiles([{ ...file('agent.md'), size: 1 }])).rejects.toThrow('changed while reading')
})

test('superseded and closed selections cannot deliver a late byte read or preview', async () => {
  const sequence = createImportSelection()
  const ticket = sequence.begin()
  let finish
  const held = { ...file('agent.md'), arrayBuffer: () => new Promise(resolve => { finish = resolve }) }
  const pending = readPackageFiles([held], { isCurrent: () => sequence.current(ticket) })
  const newer = sequence.begin()
  finish(encoder.encode('text').buffer)
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  expect(sequence.current(ticket)).toBe(false)
  expect(sequence.current(newer)).toBe(true)
  sequence.cancel()
  expect(sequence.current(newer)).toBe(false)
})

test('model bindings default only to advertised profiles and no tools receive an automatic grant', () => {
  const choices = defaultPackageChoices(preview)
  expect(choices).toEqual({ leadAgentId: 'lead', models: { $default: 'workbench', reasoner: 'reasoner' }, tools: [] })
  expect(packageInstallBindings(preview, choices)).toEqual(choices)
  expect(packageInstallBindings(preview, { ...choices, tools: ['web', 'web'] }).tools).toEqual(['web'])
  for (const patch of [{ leadAgentId: 'missing' }, { tools: ['unknown'] }, { tools: ['host'] }, { models: { $default: 'raw-provider-id', reasoner: 'reasoner' } }]) expect(packageInstallBindings(preview, { ...choices, ...patch })).toBeNull()
  expect(packageInstallBindings(preview, null)).toBeNull()
  expect(defaultPackageChoices({ ...preview, availableModels: [] }).models).toEqual({ $default: '', reasoner: '' })
})

test('review renders exact inventory and lead with unchecked supported groups, escaping authored labels', () => {
  const tree = render(<PackageImportReview preview={preview} choices={defaultPackageChoices(preview)} onChoices={() => {}} onInstall={() => {}}/>)
  expect(all(tree, node => node.tagName === 'form')).toHaveLength(1)
  expect(all(tree, node => node.tagName === 'script')).toHaveLength(0)
  expect(text(tree)).toContain('A <script> lead')
  expect(text(tree)).toContain('roles/critic/agent.md')
  expect(text(tree)).toContain('examine → critic')
  const checkboxes = all(tree, node => node.tagName === 'input' && attr(node, 'type') === 'checkbox')
  expect(checkboxes).toHaveLength(2)
  expect(checkboxes.map(node => attr(node, 'checked'))).toEqual([undefined, undefined])
  expect(checkboxes.map(isDisabled)).toEqual([false, false])
  expect(isDisabled(button(tree, 'Install agent'))).toBe(false)
})

test('actual review form submits exact reviewed bindings once; busy and invalid models prevent dispatch', () => {
  const choices = { ...defaultPackageChoices(preview), leadAgentId: 'critic', tools: ['board'] }
  const calls = []
  const props = { preview, choices, onChoices() {}, onInstall: value => calls.push(value) }
  let prevented = 0
  const event = { preventDefault() { prevented++ } }
  PackageImportReview(props).props.onSubmit(event)
  PackageImportReview({ ...props, busy: 'installing' }).props.onSubmit(event)
  PackageImportReview({ ...props, disabled: true }).props.onSubmit(event)
  PackageImportReview({ ...props, choices: { ...choices, models: {} } }).props.onSubmit(event)
  expect(prevented).toBe(4)
  expect(calls).toEqual([{ leadAgentId: 'critic', models: { $default: 'workbench', reasoner: 'reasoner' }, tools: ['board'] }])
})

test('visible import failures are escaped alerts and status is separate from an install outcome', () => {
  const tree = render(<PackageImportFeedback message="Validating package…" error="Unrecognized <script> tool"/>)
  expect(all(tree, node => attr(node, 'role') === 'status').map(text)).toEqual(['Validating package…'])
  expect(all(tree, node => attr(node, 'role') === 'alert').map(text)).toEqual(['Unrecognized <script> tool'])
  expect(all(tree, node => node.tagName === 'script')).toHaveLength(0)
})

test('identical display names remain separate when an authoritative installed-agent identity is present', () => {
  const one = { path: 'installed/one/lead', name: 'Writer' }, two = { path: 'installed/two/lead', name: 'Writer' }
  const run = { id: 'actual', agent: two.path, name: 'Writer', status: 'thinking' }
  expect(matchesAgentDefinition(one, run)).toBe(false)
  expect(matchesAgentDefinition(two, run)).toBe(true)
  expect(matchesAgentDefinition(one, { name: 'Writer' })).toBe(true)
  const tree = render(<Dashboard state={{ ...state, agentDefinitions: [one, two], agents: [run] }}/>)
  const cards = all(tree, node => node.tagName === 'article' && attr(node, 'class')?.includes('dashboard-agent'))
  expect(text(cards[0])).toContain('Available')
  expect(text(cards[0])).not.toContain('Generating reply')
  expect(text(cards[1])).toContain('Available')
  expect(text(cards[1])).not.toContain('Generating reply')
  const instance = all(tree, node => node.tagName === 'li' && attr(node, 'data-run-id') === 'actual')[0]
  expect(text(instance)).toContain('Generating reply')
  expect(text(tree)).toContain('Agent library')
})

test('disabled imported selection remains visible, preserves the goal, and never advertises the default-model proof as its own', () => {
  const tree = render(<Dashboard state={{ ...state, workflows: [{ ...state.workflows[0], disabled: true, unavailableReason: 'Bound reasoner profile was removed.' }] }} goal="Keep my goal" onImportAgent={() => {}}/>)
  expect(text(tree)).toContain('Bound reasoner profile was removed.')
  expect(text(tree)).toContain('Agent model: reasoner')
  expect(text(tree)).toContain('Desk default model')
  expect(text(tree)).toContain('Connection checks below apply to the desk default profile.')
  expect(isDisabled(button(tree, 'Start task'))).toBe(true)
  expect(all(tree, node => node.tagName === 'textarea').map(text)).toEqual(['Keep my goal'])
  const selected = workflowButtons(tree).filter(node => attr(node, 'aria-pressed') === 'true')
  expect(selected).toHaveLength(1)
  expect(isDisabled(selected[0])).toBe(true)
})

test('import entry is unavailable during model checking or active work without disabling goal editing', () => {
  for (const extra of [{ model: { status: 'checking' } }, { run: { status: 'thinking' } }, { ready: false }]) {
    const tree = render(<Dashboard state={{ ...state, ...extra }} goal="Draft" onImportAgent={() => {}}/>)
    expect(isDisabled(button(tree, 'Import agent'))).toBe(true)
    expect(all(tree, node => node.tagName === 'textarea').every(node => !isDisabled(node))).toBe(true)
  }
})


test('a missing saved workflow explains the unavailable selection and keeps Start disabled', () => {
  const tree = render(<Dashboard state={{ ...state, selectedWorkflowId: 'removed-package' }} goal="Keep my original goal"/>)
  expect(text(tree)).toContain('The saved workflow is unavailable. Choose a workflow explicitly; your goal has been kept.')
  expect(isDisabled(button(tree, 'Start task'))).toBe(true)
  expect(workflowButtons(tree).filter(node => attr(node, 'aria-pressed') === 'true')).toHaveLength(0)
  expect(all(tree, node => node.tagName === 'textarea').map(text)).toEqual(['Keep my original goal'])
})


test('unsupported requested groups block installation even unchecked and explain the required source change', () => {
  for (const tool of ['unknown', 'schedule']) {
    const invalid = { ...preview, agents: [{ ...preview.agents[0], tools: ['web', tool] }, preview.agents[1]] }
    const choices = defaultPackageChoices(invalid)
    expect(unsupportedPackageTools(invalid)).toEqual([tool])
    expect(packageInstallBindings(invalid, choices)).toBeNull()
    const tree = render(<PackageImportReview preview={invalid} choices={choices} onChoices={() => {}} onInstall={() => { throw new Error('No install is allowed') }}/>)
    expect(isDisabled(button(tree, 'Install agent'))).toBe(true)
    expect(all(tree, node => attr(node, 'role') === 'alert').map(text).join('')).toContain(`Unsupported tool groups: ${tool}. Remove these requests from agent.md`)
    expect(text(tree)).toContain('Leaving them unchecked does not make this package installable.')
    expect(text(tree)).not.toContain('Choose an available model for every profile')
    let called = false
    PackageImportReview({ preview: invalid, choices, onChoices() {}, onInstall() { called = true } }).props.onSubmit({ preventDefault() {} })
    expect(called).toBe(false)
  }
})

test('installing state survives a closed dialog and locks dashboard task, workflow and import admission', () => {
  const tree = render(<Dashboard state={{ ...state, packageInstalling: true }} goal="Keep this draft" onImportAgent={() => {}}/>)
  expect(isDisabled(button(tree, 'Installing agent…'))).toBe(true)
  expect(isDisabled(button(tree, 'Import agent'))).toBe(true)
  expect(workflowButtons(tree)).toHaveLength(1)
  expect(workflowButtons(tree).every(isDisabled)).toBe(true)
  expect(all(tree, node => attr(node, 'role') === 'status').map(text).join('')).toContain('Starting tasks, changing workflows and importing another package are paused')
  expect(all(tree, node => node.tagName === 'textarea').map(text)).toEqual(['Keep this draft'])
  expect(all(tree, node => node.tagName === 'textarea').every(node => !isDisabled(node))).toBe(true)
})
