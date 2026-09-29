import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import Dashboard from '../src/workbench/Dashboard.jsx'
import StrategyProgress from '../src/workbench/StrategyProgress.jsx'
import ToolCard, { toolPresentationStatus } from '../src/workbench/ToolCard.jsx'

const definition = { id: 'review', kind: 'graph', label: 'Compare perspectives', limits: { maxParallel: 2 }, output: 'summary', nodes: [{ id: 'approach', agent: 'planner', dependsOn: [] }, { id: 'summary', agent: 'synthesizer', dependsOn: ['approach'] }] }
test('role UI projects actual waits and outcomes without inventing result or verification success', () => {
  const task = { id: 'task', status: 'verifying', definition, nodes: [{ nodeId: 'approach', agent: 'planner', runId: 'child', status: 'done', result: { outputRef: { runId: 'child', field: 'result' } } }, { nodeId: 'summary', status: 'done', dependsOn: ['approach'] }] }
  const html = renderToStaticMarkup(<StrategyProgress task={task} onInspectRun={() => {}}/>)
  expect(html).toContain('Verifying application'); expect(html).toContain('verification is still in progress')
  expect(html).toContain('2/2 roles completed'); expect(html).toContain('After approach'); expect(html).toContain('Inspect result')
  const pending = renderToStaticMarkup(<StrategyProgress task={{ ...task, status: 'cancelling', nodes: [{ nodeId: 'approach', runId: 'child', status: 'cancelling', result: null }] }} onInspectRun={() => {}}/>)
  expect(pending).toContain('outcomes remain pending'); expect(pending).toContain('Inspect run'); expect(pending).not.toContain('Inspect result')
})
test('approval labels require exact run and call identities, preserving original tool receipt', () => {
  const tool = Object.freeze({ id: 'call1', runId: 'run1', name: 'workspace_write', status: 'running', args: { path: 'a.js' }, summary: 'Proposed write' })
  const approvals = [{ run: 'run2', callId: 'call1' }, { run: 'run1', callId: 'call2' }]
  expect(toolPresentationStatus(tool, approvals)).toBe('running')
  approvals.push({ run: 'run1', callId: 'call1' })
  expect(toolPresentationStatus(tool, approvals)).toBe('awaiting_approval')
  const html = renderToStaticMarkup(<ToolCard tool={tool} approvals={approvals}/>)
  expect(html).toContain('Awaiting approval'); expect(html).toContain('Current call'); expect(html).not.toContain('Recorded result')
  expect(tool.status).toBe('running')
  expect(toolPresentationStatus({ ...tool, status: 'failed' }, approvals)).toBe('failed')
})
test('dashboard retains an editable graph draft while steering is disabled during verification', () => {
  const html = renderToStaticMarkup(<Dashboard goal="next goal" state={{ ready: true, selectedWorkflowId: 'review', workflows: [{ id: 'review', label: 'Review', agent: 'synthesizer', workspace: false, strategy: definition }], task: { status: 'verifying', definition, nodes: [] }, run: { status: 'verifying' }, toolPolicy: { allowDelegation: true } }}/>)
  expect(html).toContain('Role inputs are fixed'); expect(html).toContain('next goal')
  expect(html).toMatch(/type="submit" disabled=""[^>]*>Run in progress/)
  expect(html).not.toMatch(/<textarea[^>]*disabled/)
})
