import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import CommandEvidence, { commandStatusLabel } from '../src/workbench/CommandEvidence.jsx'

test('an interrupted stream presents an unknown exit rather than a stopped or failed process', () => {
  const command = { status: 'failed', stage: 'outcome-unknown', error: 'The operation was aborted.' }
  expect(commandStatusLabel(command)).toBe('Outcome unknown · exit unconfirmed')
  const markup = renderToStaticMarkup(<CommandEvidence command={command}/>)
  expect(markup).toContain('role="status"')
  expect(markup).toContain('Outcome unknown · exit unconfirmed')
  expect(markup).toContain('The operation was aborted.')
  expect(markup).not.toContain('Stopped')
})

test('workspace synchronization failure retains the actual exit evidence, including cancellation', () => {
  for (const [status, exitCode] of [['failed', 0], ['cancelled', 143]]) {
    const command = { status, stage: 'reconciliation-failed', exitCode, error: 'Snapshot unavailable' }
    expect(commandStatusLabel(command)).toBe(`Exited with code ${exitCode} · workspace sync failed`)
    const markup = renderToStaticMarkup(<CommandEvidence command={command}/>)
    expect(markup).toContain(`Exited with code ${exitCode} · workspace sync failed`)
    expect(markup).toContain('Snapshot unavailable')
    expect(markup).not.toContain('exit unconfirmed')
  }
})

test('selected command error text is escaped and bounded without changing ordinary receipts', () => {
  const markup = renderToStaticMarkup(<CommandEvidence command={{ stage: 'outcome-unknown', error: '<script>' + 'x'.repeat(1000) }}/>)
  expect(markup).toContain('&lt;script&gt;')
  expect(markup).not.toContain('<script>')
  expect(markup).not.toContain('x'.repeat(501))
  expect(markup).toContain('…')
  expect(commandStatusLabel({ status: 'cancelled', stage: 'complete', exitCode: 143 })).toBe('cancelled (143)')
  expect(commandStatusLabel({ status: 'done', stage: 'complete', exitCode: 0 })).toBe('done (0)')
  expect(renderToStaticMarkup(<CommandEvidence command={{ status: 'done', stage: 'complete', exitCode: 0 }}/>)).toBe('')
  expect(renderToStaticMarkup(<CommandEvidence/>)).toBe('')
})
