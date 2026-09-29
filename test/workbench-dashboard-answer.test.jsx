import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseFragment } from 'parse5'
import Dashboard from '../src/workbench/Dashboard.jsx'

const all = (node, predicate) => [...(predicate(node) ? [node] : []), ...(node.childNodes || []).flatMap(child => all(child, predicate))]
const text = node => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(text).join('')
const answerText = state => {
  const tree = parseFragment(renderToStaticMarkup(<Dashboard state={state}/>))
  const section = all(tree, node => node.attrs?.some(attr => attr.name === 'aria-label' && attr.value === 'Current task model answer'))[0]
  return section ? text(section) : ''
}
const oldAnswer = { role: 'assistant', runId: 'old', content: 'Old task succeeded.' }

test('a new task never inherits the previous task answer before admission or while retrying verification', () => {
  for (const run of [{ status: 'starting' }, { status: 'failed' }, { run: 'current', status: 'verifying' }]) {
    const output = answerText({ run, messages: [oldAnswer], agents: [{ id: 'current', status: 'verifying', completionEvidence: { outcome: 'failed', label: 'Latest recorded check: did not pass' } }] })
    expect(output).toContain('No model answer recorded for the current task yet.')
    expect(output).not.toContain(oldAnswer.content)
    if (run.run) expect(output).toContain('Latest recorded check: did not pass')
  }
})

test('current terminal model text is displayed with the actual failed check, regardless of its success claim', () => {
  const output = answerText({ run: { run: 'current', status: 'incomplete' }, messages: [
    { role: 'assistant', runId: 'current', content: 'Everything is finished successfully.' },
    oldAnswer,
    { role: 'assistant', content: 'Unattributed legacy answer.' },
  ], agents: [{ id: 'current', status: 'incomplete', completionEvidence: { outcome: 'failed', label: 'Latest recorded check: did not pass' } }] })
  expect(output).toContain('Everything is finished successfully.')
  expect(output).toContain('Model answerIncomplete')
  expect(output).toContain('Run current')
  expect(output).toContain('Latest recorded check: did not pass')
  expect(output).toContain('does not establish that the task passed its checks')
  expect(output).not.toContain(oldAnswer.content)
  expect(output).not.toContain('Unattributed legacy answer.')
})

test('strategy fallback uses coordinator identity, excluding child output and unrelated tasks', () => {
  const output = answerText({ task: { id: 'coordinator', status: 'done' }, agents: [{ id: 'coordinator', kind: 'strategy', status: 'done', completionEvidence: { outcome: 'passed', label: 'Latest recorded: Required commands passed · only configured checks covered' } }], messages: [
    { role: 'assistant', runId: 'coordinator', content: 'Combined model answer.' },
    { role: 'assistant', runId: 'child', content: 'Child answer.' }, oldAnswer,
  ] })
  expect(output).toContain('Combined model answer.')
  expect(output).toContain('Run finished')
  expect(output).toContain('Required commands passed · only configured checks covered')
  expect(output).not.toContain('Child answer.')
  expect(output).not.toContain(oldAnswer.content)
})

test('missing run evidence stays unknown even when the UI status says verified', () => {
  const output = answerText({ run: { run: 'current', status: 'verified' }, messages: [{ role: 'assistant', runId: 'current', content: 'Model result.' }] })
  expect(output).toContain('Run finished')
  expect(output).toContain('Completion configuration not recorded')
  expect(output).not.toContain('Verified')
})

test('without a selected task historical answers are not presented as current work', () => {
  expect(answerText({ messages: [oldAnswer] })).toBe('')
})

test('incomplete status and failed verification have explicit accessible severity alongside the model answer', () => {
  const tree = parseFragment(renderToStaticMarkup(<Dashboard state={{ run: { run: 'current', status: 'incomplete' }, agents: [{ id: 'current', status: 'incomplete', completionEvidence: { outcome: 'failed', label: 'Latest recorded check: did not pass' } }], messages: [{ role: 'assistant', runId: 'current', content: 'Success claimed by model.' }] }}/>))
  const hasClass = (node, value) => node.attrs?.some(attr => attr.name === 'class' && attr.value.split(' ').includes(value))
  const status = all(tree, node => hasClass(node, 'dashboard-answer-status'))[0]
  expect(hasClass(status, 'is-problem')).toBe(true)
  expect(text(status)).toBe('Incomplete')
  const evidence = all(tree, node => hasClass(node, 'dashboard-answer-evidence'))[0]
  expect(hasClass(evidence, 'is-failed')).toBe(true)
  expect(evidence.attrs.find(attr => attr.name === 'role')?.value).toBe('status')
  expect(text(evidence)).toBe('Latest recorded check: did not pass')
})

test('unknown evidence and a finished run do not acquire failure severity', () => {
  const markup = renderToStaticMarkup(<Dashboard state={{ run: { run: 'current', status: 'done' } }}/>)
  expect(markup).toContain('class="dashboard-answer-status"')
  expect(markup).toContain('class="dashboard-answer-evidence" role="status"')
  expect(markup).not.toContain('dashboard-answer-status is-problem')
  expect(markup).not.toContain('dashboard-answer-evidence is-failed')
})
