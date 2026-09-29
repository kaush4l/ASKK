import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseFragment } from 'parse5'
import AgentTeam, { AgentInstance, projectAgentTeam } from '../src/workbench/AgentTeam.jsx'
import Dashboard from '../src/workbench/Dashboard.jsx'

const definitions = [{ path: 'installed/one/observer', name: 'Pond observer' }, { path: 'installed/two/observer', name: 'Pond observer' }, { path: 'guide', name: 'Pond guide' }]
const run = (id, extra = {}) => ({ id, agent: 'installed/one/observer', status: 'thinking', at: 10, ...extra })
const render = props => parseFragment(renderToStaticMarkup(<AgentTeam definitions={definitions} onInspectRun={() => {}} onInspectAgent={() => {}} onStopAgent={() => {}} {...props}/>))
const all = (node, predicate) => [...(predicate(node) ? [node] : []), ...(node.childNodes || []).flatMap(child => all(child, predicate))]
const text = node => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(text).join('')
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value
const cards = tree => all(tree, node => node.tagName === 'li' && attr(node, 'data-run-id'))
const disabled = node => attr(node, 'disabled') !== undefined || attr(node, 'aria-disabled') === 'true'
const buttons = element => !element || typeof element !== 'object' ? [] : [...(element.type === 'button' ? [element] : []), ...[element.props?.children].flat(Infinity).flatMap(buttons)]

test('every real run keeps its own card even when definition and display name repeat', () => {
  const runs = [run('first'), run('second'), run('other-package', { agent: 'installed/two/observer' }), run('coordinator', { kind: 'strategy' })]
  const tree = render({ runs })
  expect(cards(tree).map(card => attr(card, 'data-run-id'))).toEqual(['first', 'other-package', 'second'])
  expect(cards(tree).every(card => text(card).includes('Pond observer'))).toBe(true)
  expect(all(tree, node => node.tagName === 'button' && attr(node, 'aria-label')?.startsWith('Inspect Pond observer run')).map(node => attr(node, 'aria-label'))).toEqual(['Inspect Pond observer run first', 'Inspect Pond observer run other-package', 'Inspect Pond observer run second'])
})

test('authoritative agent identity never borrows instructions or display metadata from a matching legacy name', () => {
  const team = projectAgentTeam({ definitions, runs: [run('isolated', { agent: 'installed/missing/observer', name: 'Pond guide' })] })
  expect(team.live[0].identity).toBe('installed/missing/observer')
  const calls = []
  const element = AgentInstance({ item: team.live[0], onInspectRun: id => calls.push(['run', id]), onInspectAgent: id => calls.push(['agent', id]), onStopAgent: id => calls.push(['stop', id]) })
  for (const button of buttons(element)) button.props.onClick?.()
  expect(calls).toEqual([['run', 'isolated'], ['stop', 'isolated']])
  expect(team.live[0].definitionAvailable).toBe(false)
  expect(text(render({ runs: [run('isolated', { agent: 'installed/missing/observer', name: 'Pond guide' })] }))).toContain('Definition unavailable')
})

test('old identities keep exact run inspection without redirecting instructions to a newly bundled definition', () => {
  const definitions = [{ path: 'bundled/starter/assistant', name: 'assistant' }]
  const runs = [run('old', { agent: 'assistant', name: 'assistant', status: 'done' }), run('current', { agent: 'bundled/starter/assistant' })]
  const team = projectAgentTeam({ definitions, runs })
  const calls = []
  for (const item of [...team.live, ...team.recent]) {
    const element = AgentInstance({ item, onInspectRun: id => calls.push(['run', id]), onInspectAgent: path => calls.push(['agent', path]) })
    for (const button of buttons(element)) button.props.onClick?.()
  }
  expect(calls).toEqual([['run', 'current'], ['agent', 'bundled/starter/assistant'], ['run', 'old']])
  const tree = render({ definitions, runs })
  expect(all(tree, node => node.tagName === 'button' && text(node) === 'Instructions')).toHaveLength(1)
  expect(text(tree)).toContain('Definition unavailable')
})

test('owner approval is associated only by exact run id, never by a shared name or tool', () => {
  const runs = [run('one'), run('two')]
  const approvals = [{ run: 'unrelated', agent: 'Pond observer', tool: 'todo_read' }, { runId: 'two', tool: 'todo_read' }, { agent: 'installed/one/observer' }]
  const projected = projectAgentTeam({ runs, definitions, approvals })
  expect(projected.live.map(item => [item.run.id, item.status, item.pending])).toEqual([['one', 'Generating reply', 0], ['two', 'Needs your decision', 1]])
  const terminal = projectAgentTeam({ runs: [run('two', { status: 'failed' })], approvals })
  expect(terminal.recent[0].status).toBe('Failed')
  expect(terminal.recent[0].pending).toBe(0)
  const cancelling = projectAgentTeam({ runs: [run('two', { status: 'cancelling' })], approvals })
  expect(cancelling.live[0].status).toBe('Stopping')
})

test('parent links come only from receipts and strategy roles use a neutral parent label', () => {
  const runs = [run('root', { agent: 'guide' }), run('child', { parent: 'root', description: 'Check the plan' }), run('missing', { parent: 'not-retained' }), run('role', { parent: 'root', kind: 'strategy-role', stageId: 'approach' })]
  const tree = render({ runs })
  const map = new Map(cards(tree).map(card => [attr(card, 'data-run-id'), card]))
  expect(text(map.get('child'))).toContain('Delegated by Pond guide')
  expect(text(map.get('role'))).toContain('Parent run Pond guide')
  expect(text(map.get('role'))).not.toContain('Delegated by')
  expect(text(map.get('missing'))).toContain('parent record unavailable')
  expect(all(map.get('missing'), node => node.tagName === 'button' && attr(node, 'aria-label')?.startsWith('Inspect parent'))).toHaveLength(0)
  expect(text(map.get('root'))).toContain('No parent recorded')
  const item = projectAgentTeam({ runs, definitions }).live.find(row => row.run.id === 'child')
  let opened
  const parentButton = buttons(AgentInstance({ item, onInspectRun: value => { opened = value } })).find(button => button.props['aria-label'] === 'Inspect parent Pond guide run root')
  parentButton.props.onClick()
  expect(opened).toBe('root')
})

test('selected task membership uses explicit trace, task or parent lineage and tolerates missing/cyclic ancestry', () => {
  const runs = [run('root', { taskId: 'task', trace: 'trace' }), run('child', { parent: 'root' }), run('grandchild', { parent: 'child' }), run('same-task', { taskId: 'task' }), run('same-trace', { trace: 'trace' }), run('unrelated'), run('cycle-a', { parent: 'cycle-b' }), run('cycle-b', { parent: 'cycle-a' })]
  const selected = projectAgentTeam({ runs, activeRunId: 'root' })
  expect(selected.selectedCount).toBe(5)
  expect(selected.live.filter(item => item.selected).map(item => item.run.id).sort()).toEqual(['child', 'grandchild', 'root', 'same-task', 'same-trace'])
  const missingCoordinator = projectAgentTeam({ runs: [run('role', { taskId: 'graph', parent: 'graph', stageId: 'review' })], activeRunId: 'graph' })
  expect(missingCoordinator.selectedCount).toBe(1)
  expect(missingCoordinator.live[0].parentAvailable).toBe(false)
  expect(projectAgentTeam({ runs, activeRunId: 'unknown' }).selectedCount).toBe(0)
})

test('all terminal outcomes remain explicit history and cannot expose a Stop control', () => {
  const statuses = ['done', 'completed', 'verified', 'failed', 'incomplete', 'cancelled', 'interrupted', 'skipped']
  for (const status of statuses) {
    const tree = render({ runs: [run(status, { status, result: '<script>recorded result</script>' })] })
    expect(text(tree)).toContain('Recent runs')
    expect(text(tree)).not.toContain('Live instances')
    expect(all(tree, node => node.tagName === 'button' && attr(node, 'aria-label')?.startsWith('Stop '))).toHaveLength(0)
    expect(all(tree, node => node.tagName === 'script')).toHaveLength(0)
    expect(text(tree)).toContain('Result recorded')
  }
  const tree = render({ runs: [run('stopping', { status: 'cancelling' }), run('delayed', { status: 'unresponsive' })] })
  expect(text(tree)).toContain('Stopping')
  expect(text(tree)).toContain('Response delayed')
  expect(all(tree, node => node.tagName === 'button' && attr(node, 'aria-label') === 'Stop Pond observer run stopping').every(disabled)).toBe(true)
})

test('bounded sections reveal the exact hidden count and never add idle catalogue definitions', () => {
  const runs = [...Array.from({ length: 12 }, (_, i) => run(`live-${i}`, { at: i })), ...Array.from({ length: 10 }, (_, i) => run(`past-${i}`, { status: 'done', at: i }))]
  const tree = render({ runs })
  expect(cards(tree)).toHaveLength(12)
  expect(text(tree)).toContain('6 of 12')
  expect(text(tree)).toContain('6 of 10')
  expect(text(tree)).toContain('Show 6 more task runs')
  expect(text(tree)).toContain('Show 4 more recent runs')
  expect(cards(tree).slice(-6).map(card => attr(card, 'data-run-id'))).toEqual(['past-9', 'past-8', 'past-7', 'past-6', 'past-5', 'past-4'])
  const empty = render({ runs: [] })
  expect(cards(empty)).toHaveLength(0)
  expect(text(empty)).toContain('Your team will appear here.')
  expect(text(empty)).not.toContain('Pond guide')
})

test('streaming activity and status updates do not reorder live cards; unrelated terminal runs become history', () => {
  const runs = [run('first', { at: 1 }), run('second', { at: 2 })]
  const before = projectAgentTeam({ runs }).live.map(item => item.run.id)
  const update = runs.map(item => ({ ...item, current: 'a'.repeat(500), status: item.id === 'first' ? 'waiting' : 'calling' }))
  expect(projectAgentTeam({ runs: update }).live.map(item => item.run.id)).toEqual(before)
  const ended = projectAgentTeam({ runs: [{ ...update[0], status: 'done' }, update[1]] })
  expect(ended.live.map(item => item.run.id)).toEqual(['second'])
  expect(ended.recent.map(item => item.run.id)).toEqual(['first'])
})

test('selected task retains creation slots after terminal receipts and releases them when selection changes', () => {
  const runs = [run('root', { at: 1, taskId: 'task-one' }), run('child', { at: 2, parent: 'root' }), run('other', { at: 3, taskId: 'task-two' })]
  const before = projectAgentTeam({ runs, activeRunId: 'root' })
  const endedRuns = runs.map(item => item.id === 'root' ? { ...item, status: 'done', result: 'Recorded answer' } : item)
  const after = projectAgentTeam({ runs: endedRuns, activeRunId: 'root' })
  expect(after.current.map(item => item.run.id)).toEqual(before.current.map(item => item.run.id))
  expect(after.live.map(item => item.run.id)).toEqual(['child', 'other'])
  expect(after.recent).toHaveLength(0)
  const left = projectAgentTeam({ runs: endedRuns, activeRunId: 'other' })
  expect(left.current.map(item => item.run.id)).toEqual(['child', 'other'])
  expect(left.recent.map(item => item.run.id)).toEqual(['root'])
  expect(projectAgentTeam({ runs: [runs[2]], activeRunId: 'other' }).current.map(item => item.run.id)).toEqual(['other'])
})

test('selected terminal and stopping controls remain focusable but cannot dispatch another stop', () => {
  const calls = []
  for (const status of ['thinking', 'cancelling', 'done', 'failed', 'interrupted']) {
    const item = projectAgentTeam({ runs: [run('selected', { status })], activeRunId: 'selected' }).current[0]
    const element = AgentInstance({ item, detailsOpen: true, onStopAgent: id => calls.push(id) })
    const control = buttons(element).find(button => button.props.className === 'agent-instance-stop')
    expect(control).toBeDefined()
    expect(control.props.disabled).toBeUndefined()
    expect(control.props['aria-disabled']).toBe(status !== 'thinking')
    control.props.onClick()
    const tree = parseFragment(renderToStaticMarkup(element))
    expect(attr(all(tree, node => attr(node, 'class') === 'agent-instance-details')[0], 'open')).toBeDefined()
    expect(text(tree)).toContain(status === 'thinking' ? 'Stop run' : status === 'cancelling' ? 'Stopping…' : 'Run ended')
  }
  expect(calls).toEqual(['selected'])
})

test('goal view starts compact while evidence and actions stay in explicit disclosures', () => {
  const tree = render({ runs: [run('exact-long-run-12345678', { parent: 'exact-parent-id' }), run('history', { status: 'done' })] })
  expect(all(tree, node => node.tagName === 'button' && text(node) === 'Goal').map(node => attr(node, 'aria-pressed'))).toEqual(['true'])
  expect(all(tree, node => node.tagName === 'button' && text(node) === 'Evidence').map(node => attr(node, 'aria-pressed'))).toEqual(['false'])
  const disclosures = all(tree, node => attr(node, 'class') === 'agent-instance-details')
  expect(disclosures.every(node => attr(node, 'open') === undefined)).toBe(true)
  expect(text(disclosures[0])).toContain('Run exact-long-run-12345678')
  expect(text(disclosures[0])).toContain('exact-parent-id')
  expect(text(disclosures[0])).toContain('Instructions')
  expect(attr(all(tree, node => attr(node, 'class') === 'agent-team-recent')[0], 'open')).toBeUndefined()
  const first = cards(tree)[0]
  expect(text(first)).toContain('#12345678')
  expect(attr(all(first, node => attr(node, 'class') === 'agent-instance-open')[0], 'aria-label')).toBe('Inspect Pond observer run exact-long-run-12345678')
})

test('decisions and delayed work remain reachable beyond the visible card limit with exact ownership', () => {
  const runs = Array.from({ length: 8 }, (_, i) => run(`instance-${i}`, { at: i, ...(i === 7 ? { status: 'unresponsive' } : {}) }))
  const approvals = [{ id: 'unrelated-decision', runId: 'other-run' }, { id: 'right-decision', runId: 'instance-6' }]
  const tree = render({ runs, approvals, onReviewApproval: () => {} })
  expect(cards(tree)).toHaveLength(6)
  expect(text(tree)).toContain('2 runs need attention')
  const attention = all(tree, node => attr(node, 'class') === 'agent-team-attention has-attention')[0]
  expect(text(attention)).toContain('Needs your decision')
  expect(text(attention)).toContain('Response delayed')
  expect(all(attention, node => node.tagName === 'button').map(node => attr(node, 'aria-label'))).toEqual(['Review Pond observer run instance-6', 'Review Pond observer run instance-7'])
  const calls = []
  const item = projectAgentTeam({ runs, approvals }).current.find(row => row.run.id === 'instance-6')
  const element = AgentInstance({ item, onReviewApproval: id => calls.push(id) })
  buttons(element).find(button => button.props['aria-label']?.startsWith('Review 1 pending decision')).props.onClick()
  expect(calls).toEqual(['right-decision'])
  expect(item.tone).toBe('decision')
  expect(projectAgentTeam({ runs, approvals }).current[7].tone).toBe('problem')
})

test('dashboard provides a focusable heading for each exact approval without autofocus on approval buttons', () => {
  const tree = parseFragment(renderToStaticMarkup(<Dashboard state={{ approvals: [{ id: 'decision-a', run: 'run-a', tool: 'write_file' }, { id: 'decision-b', run: 'run-b', tool: 'write_file' }] }}/>))
  const headings = all(tree, node => node.tagName === 'h3' && attr(node, 'id')?.includes('-approval-'))
  expect(headings.map(node => attr(node, 'id').split('-approval-')[1])).toEqual(['decision-a', 'decision-b'])
  expect(headings.every(node => attr(node, 'tabindex') === '-1')).toBe(true)
  expect(all(tree, node => attr(node, 'autofocus') !== undefined)).toHaveLength(0)
})


test('strategy coordinators remain inspectable parents and grouping anchors without becoming agent cards', () => {
  const runs = [run('graph-root', { kind: 'strategy', agent: 'strategy/compare', name: 'Compare perspectives', trace: 'graph-trace', taskId: 'graph-task', status: 'running' }), run('role', { kind: 'strategy-role', stageId: 'approach', parent: 'graph-root', trace: 'graph-trace', taskId: 'graph-task' })]
  const team = projectAgentTeam({ runs, definitions, activeRunId: 'graph-root' })
  expect(team.total).toBe(1)
  expect(team.selectedCount).toBe(1)
  expect(team.live[0].parentAvailable).toBe(true)
  expect(team.live[0].parentLabel).toBe('Parent run')
  expect(team.live[0].parentName).toBe('Compare perspectives')
  const tree = render({ runs, activeRunId: 'graph-root' })
  expect(cards(tree).map(card => attr(card, 'data-run-id'))).toEqual(['role'])
  expect(text(tree)).toContain('Parent run Compare perspectives')
  expect(text(tree)).not.toContain('parent record unavailable')
  const calls = []
  const parent = buttons(AgentInstance({ item: team.live[0], onInspectRun: id => calls.push(id) })).find(button => button.props['aria-label'] === 'Inspect parent Compare perspectives run graph-root')
  parent.props.onClick()
  expect(calls).toEqual(['graph-root'])
})

test('queued admitted runs count as live before their worker starts thinking', () => {
  const runs = [run('queued', { status: 'queued', current: '' })]
  const team = projectAgentTeam({ runs })
  expect(team.live).toHaveLength(1)
  expect(team.recent).toHaveLength(0)
  expect(team.live[0].status).toBe('Queued')
  const tree = render({ runs })
  expect(text(tree)).toContain('1 active')
  expect(text(tree)).toContain('Live instances')
  expect(text(tree)).not.toContain('Recent runs')
})


test('large streamed activity and task descriptions are bounded in the actual DOM, with full data left for run inspection', () => {
  const hiddenTail = 'EXACT_LONG_TAIL_ONLY_FOR_INSPECTION'
  for (const field of ['current', 'description']) {
    const record = run(`large-${field}`, { [field]: 'A'.repeat(280) + 'B'.repeat(40000) + hiddenTail })
    const tree = render({ runs: [record] })
    const excerpt = all(tree, node => attr(node, 'class') === 'agent-instance-task').map(text)
    expect(excerpt).toEqual(['A'.repeat(280) + '…'])
    expect(text(tree)).not.toContain(hiddenTail)
    expect(text(tree)).not.toContain('B'.repeat(10))
    expect(record[field]).toEndWith(hiddenTail)
  }
  const tree = render({ runs: [run('unicode', { current: 'A'.repeat(279) + '🌱' + 'B'.repeat(20) })] })
  expect(all(tree, node => attr(node, 'class') === 'agent-instance-task').map(text)).toEqual(['A'.repeat(279) + '…'])
})
