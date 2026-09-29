import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import AnswerOutcome from '../src/workbench/AnswerOutcome.jsx'
import RunInspector from '../src/workbench/RunInspector.jsx'

const render = props => renderToStaticMarkup(<AnswerOutcome {...props}/> )

test('step exhaustion visibly qualifies model claims without a live region', () => {
  const html = render({ status: 'incomplete', terminationReason: 'step_budget', completionEvidence: { outcome: 'failed', label: 'Latest recorded check: did not pass' } })
  expect(html).toContain('Incomplete · Unverified step-limit summary')
  expect(html).toContain('The task did not complete')
  expect(html).toContain('dashboard-answer-status is-problem')
  expect(html).toContain('dashboard-answer-evidence is-failed')
  expect(html).not.toContain('role=')
  expect(html).not.toContain('aria-live')
})

test('terminal problem statuses keep explicit qualifiers', () => {
  for (const [status, phrase] of [['incomplete', 'The task did not complete'], ['failed', 'The run failed'], ['error', 'The run failed'], ['cancelled', 'The run was cancelled'], ['stopped', 'The run was cancelled'], ['interrupted', 'The run was interrupted'], ['unresponsive', 'outcome is unresolved']]) {
    const html = render({ status })
    expect(html).toContain(phrase)
    expect(html).toContain('does not establish success')
    expect(html).not.toContain('step-limit')
  }
})

test('finished and unknown statuses never imply checks passed', () => {
  for (const status of ['done', 'completed', 'verified', 'running', 'unknown', undefined]) {
    const html = render({ status, terminationReason: 'step_budget' })
    expect(html).toContain('Recorded model answer')
    expect(html).toContain('does not establish that the task passed its checks')
    expect(html).not.toContain('is-problem')
    expect(html).not.toContain('Unverified step-limit')
    expect(html).not.toContain('Latest recorded')
  }
})

test('evidence stays separate and escaped even when it records a scoped pass', () => {
  const html = render({ status: 'incomplete', completionEvidence: { outcome: 'passed', label: 'Scoped checks passed <script>alert(1)</script>' } })
  expect(html).toContain('</p><p class="dashboard-answer-evidence">')
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  expect(html).not.toContain('<script>')
  expect(html).not.toContain('is-failed')
})

test('inspector qualifies false success summary before displaying it', () => {
  const html = renderToStaticMarkup(<RunInspector details={{ id: 'limited', slot: { status: 'incomplete', terminationReason: 'step_budget' }, result: 'All checks passed.', completion: { checks: [] }, completionReceipts: [{ ok: false, reason: 'Tests missing', checks: [] }] }}/>)
  expect(html.indexOf('Unverified step-limit summary')).toBeLessThan(html.indexOf('All checks passed.'))
  expect(html).toContain('Latest recorded checks: did not pass')
})
