import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseFragment } from 'parse5'
import Dashboard, { WorkflowRequirements } from '../src/workbench/Dashboard.jsx'
import { PackageImportReview } from '../src/workbench/PackageImport.jsx'
import RunInspector from '../src/workbench/RunInspector.jsx'

const workflow = { id: 'deliver', label: 'Deliver', agent: 'lead', workspace: true, execution: { workspace: 'required' }, completion: { checks: [{ capability: 'workspace.artifact', options: { requireFresh: true, requireInteraction: true } }] } }
const all = (node, predicate) => [...(predicate(node) ? [node] : []), ...(node.childNodes || []).flatMap(child => all(child, predicate))]
const text = node => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(text).join('')
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value

test('requirements reflect explicit execution target and completion evidence before the goal, without starting work', () => {
  let operations = 0
  const markup = renderToStaticMarkup(<Dashboard state={{ ready: true, workflows: [workflow], selectedWorkflowId: workflow.id, runtime: { target: 'local', status: 'idle' } }} goal="Deliver it" onSubmit={() => operations++} onOpenSettings={() => operations++} onSelectWorkflow={() => operations++}/> )
  expect(markup.indexOf('aria-label="Workflow requirements"')).toBeLessThan(markup.indexOf('dashboard-composer'))
  const tree = parseFragment(markup)
  const notice = all(tree, node => attr(node, 'aria-label') === 'Workflow requirements')[0]
  expect(text(notice)).toContain('Requires workspace execution · Local Bun')
  expect(text(notice)).toContain('Starting prepares the selected Local Bun environment.')
  expect(text(notice)).toContain('new build from this task · interaction evidence required')
  expect(text(notice)).toContain('Requirements do not grant tool access')
  expect(operations).toBe(0)
})

test('requirements preserve legacy flows, no-workspace workflows and unknown targets without guessing a host', () => {
  expect(renderToStaticMarkup(<WorkflowRequirements workflow={{ workspace: true }}/>)).toBe('')
  expect(renderToStaticMarkup(<WorkflowRequirements workflow={{ execution: { workspace: 'none' } }}/>)).toContain('No workspace execution required')
  const unknown = renderToStaticMarkup(<WorkflowRequirements workflow={workflow}/> )
  expect(unknown).toContain('Choose an execution environment')
  expect(unknown).not.toContain('Browser Linux')
  expect(unknown).not.toContain('Local Bun')
  expect(renderToStaticMarkup(<WorkflowRequirements workflow={workflow} runtime={{ target: 'browser', status: 'ready' }}/>)).toContain('Browser Linux is ready')
})

test('package review presents declared workflows as additional choices and retains direct lead install selection', () => {
  const preview = { packageId: 'example', packageVersion: '1', agents: [{ id: 'lead' }], files: [], modelAliases: [], availableTools: [], workflows: [workflow] }
  const markup = renderToStaticMarkup(<PackageImportReview preview={preview} choices={{ leadAgentId: 'lead', models: {}, tools: [] }}/>)
  expect(markup).toContain('Installation selects the direct lead agent above.')
  expect(markup).toContain('additional choices on the dashboard')
  expect(markup).toContain('Completion check: Workspace artifact')
  expect(markup).toContain('Requirements do not grant tool access or select an execution environment.')
  const legacy = renderToStaticMarkup(<PackageImportReview preview={{ ...preview, workflows: undefined }} choices={{ leadAgentId: 'lead', models: {}, tools: [] }}/>)
  expect(legacy).not.toContain('Declared workflows')
  expect(legacy).toContain('Install saves this definition and selects its workflow.')
})

test('run verification language describes generic result checks', () => {
  const markup = renderToStaticMarkup(<RunInspector details={{ id: 'run', status: 'verifying' }}/>)
  expect(markup).toContain('Checking result')
  expect(markup).not.toContain('Verifying application')
})
