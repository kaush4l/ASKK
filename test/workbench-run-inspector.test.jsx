import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import RunInspector from '../src/workbench/RunInspector.jsx'
import ToolCard from '../src/workbench/ToolCard.jsx'

const base = {
  id: 'instance-one', agent: 'installed/example/observer', name: 'Observer', trace: 'task-one', parent: 'lead-instance',
  query: 'Check the recorded work', slot: { status: 'done' }, result: 'Checked.',
  toolEvents: [
    { kind: 'call', callId: 'read-one', name: 'read', args: { source: 'local' }, sequence: 1 },
    { kind: 'observation', callId: 'read-one', name: 'read', ok: true, value: 'Receipt result', sequence: 2 },
  ],
}

test('instance inspector shows actual tool result and identity with snapshot controls', () => {
  const html = renderToStaticMarkup(<RunInspector details={base} onRefresh={() => {}} onExport={() => {}} onInspectRun={() => {}} onClose={() => {}}/>)
  for (const value of ['Observer · Recorded run', 'instance-one', 'task-one', 'Parent run', 'lead-instance', 'Receipt result', 'Refresh snapshot', 'Export this trace']) expect(html).toContain(value)
  expect(html).toContain('not a message delivery acknowledgement')
  expect(html).not.toContain('chain of thought')
})

test('prompt, request, guidance and raw records do not mount their potentially large payload before expansion', () => {
  const details = { ...base, notes: [{ content: 'private-guidance-body' }], prompts: [{ snapshot: { messages: [{ content: 'large-prompt-body' }] } }], requests: [{ body: { messages: [{ content: 'large-request-body' }] } }], completions: [{ value: 'completion-body' }], package: { revisionDigest: 'package-body' } }
  const html = renderToStaticMarkup(<RunInspector details={details} onClose={() => {}}/>)
  for (const title of ['Recorded guidance', 'Historical prompts', 'Provider requests', 'Provider completions', 'Pinned agent package']) expect(html).toContain(title)
  for (const body of ['private-guidance-body', 'large-prompt-body', 'large-request-body', 'completion-body', 'package-body']) expect(html).not.toContain(body)
})

test('tool results preserve false, zero, null, and explicit empty string', () => {
  for (const [value, display] of [[false, 'false'], [0, '0'], [null, 'null'], ['', '(empty string)']]) {
    const html = renderToStaticMarkup(<ToolCard tool={{ id: 'call', name: 'read', status: 'done', summary: value, hasResult: true }}/>)
    expect(html).toContain('Recorded result'); expect(html).toContain(`<pre>${display}</pre>`)
    expect(html).not.toContain('No result was recorded')
  }
})

test('missing outcomes remain unresolved and unmatched records never become success cards', () => {
  const details = { ...base, toolEvents: [base.toolEvents[0], { kind: 'observation', callId: 'different-call', name: 'read', ok: true, value: 'unmatched-secret-result' }] }
  const html = renderToStaticMarkup(<RunInspector details={details} onClose={() => {}}/>)
  expect(html).toContain('Outcome not recorded'); expect(html).toContain('Unpaired tool records')
  expect(html).not.toContain('unmatched-secret-result')
  expect(html).not.toContain('Read · Completed')
})

test('initial historical prompt rendering is bounded with explicit access to further records', () => {
  const details = { ...base, prompts: Array.from({ length: 80 }, (_, step) => ({ step, attempt: 0 })) }
  const html = renderToStaticMarkup(<RunInspector details={details} onClose={() => {}}/>)
  expect(html).toContain('Prompt 12 · Step 11'); expect(html).not.toContain('Prompt 13 · Step 12')
  expect(html).toContain('Show more historical prompts')
})
