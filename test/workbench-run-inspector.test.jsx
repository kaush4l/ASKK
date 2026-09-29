import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import RunInspector from '../src/workbench/RunInspector.jsx'
import ToolCard from '../src/workbench/ToolCard.jsx'
import { evaluateCompletion, normalizeCompletion } from '../src/core/completion.js'

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

test('inspector pending approvals use captured exact identities and snapshot wording', () => {
  const details = { ...base, slot: { status: 'calling' }, result: null, toolEvents: [base.toolEvents[0]], approvals: [{ run: base.id, callId: 'read-one' }] }
  const render = patch => renderToStaticMarkup(<RunInspector details={{ ...details, ...patch }} onClose={() => {}}/>)
  const html = render({})
  expect(html).toContain('Awaiting approval')
  expect(html).toContain('Approval was pending when this snapshot was captured.')
  expect(html).toContain('No tool result was recorded in this snapshot.')
  expect(html).not.toContain('Waiting for the tool to return')
  expect(html).not.toContain('waiting for your decision')
  expect(html).not.toContain('Current call')
  const noApproval = render({ approvals: [] })
  expect(noApproval).toContain('Outcome pending')
  expect(noApproval).not.toContain('Awaiting approval')
  for (const toolEvents of [base.toolEvents, [base.toolEvents[0], { ...base.toolEvents[1], ok: false }]]) {
    expect(render({ toolEvents })).not.toContain('Awaiting approval')
  }
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

test('completion verification displays stored adapter outcomes separately from the agent answer', async () => {
  const completion = normalizeCompletion({ checks: [{ capability: 'workspace.command' }] })
  // Same receipt and persistence envelope as Hub.verifyCompletion/runRecord.
  const completionReceipts = []
  for (const evidence of [{ ok: false, reason: 'Command checked an older source revision.' }, { ok: true, commandId: 'retained-command-secret', revision: 3 }]) {
    completionReceipts.push({ ...await evaluateCompletion(completion, { 'workspace.command': () => evidence }), runId: base.id, at: 100 })
  }
  const html = renderToStaticMarkup(<RunInspector details={{ ...base, completion, completionReceipts }} onClose={() => {}}/>)
  for (const value of ['Completion verification', 'current source checked in this task', 'functional correctness needs task-specific checks', 'Verification attempt 1 · Did not pass', 'Command checked an older source revision.', 'Verification attempt 2 · Passed', 'Exact completion configuration', 'Exact verification receipt 1', 'Exact verification receipt 2']) expect(html).toContain(value)
  expect(html).not.toContain('retained-command-secret')
})

test('completion configuration absence and unperformed verification never imply passed checks', async () => {
  const render = details => renderToStaticMarkup(<RunInspector details={{ ...base, ...details }} onClose={() => {}}/>)
  const missing = render({})
  expect(missing).toContain('No completion configuration was recorded.')
  expect(missing).toContain('No completion verification receipts were recorded.')
  const completion = normalizeCompletion({ checks: [] })
  const unchecked = render({ completion, completionReceipts: [{ ...await evaluateCompletion(completion), runId: base.id, at: 100 }] })
  expect(unchecked).toContain('No independent completion checks were configured.')
  expect(unchecked).toContain('Verification attempt 1 · No checks performed')
  expect(unchecked).not.toContain('· Passed')
  const configured = render({ completion: normalizeCompletion({ checks: [{ capability: 'workspace.command' }] }) })
  expect(configured).toContain('No completion verification receipts were recorded.')
  expect(configured).not.toContain('· Passed')
  const unknown = render({ completion, completionReceipts: [{ reason: 'Legacy receipt with no explicit outcome' }] })
  expect(unknown).toContain('Verification attempt 1 · Outcome not recorded')
})

test('verification receipt rendering stays bounded without discarding later attempts', () => {
  const html = renderToStaticMarkup(<RunInspector details={{ ...base, completionReceipts: Array.from({ length: 14 }, () => ({ ok: false, checks: [], reason: 'No checks' })) }} onClose={() => {}}/>)
  expect(html).toContain('Verification attempt 12')
  expect(html).not.toContain('Verification attempt 13')
  expect(html).toContain('Show more verification receipts')
})

test('inspector shares result renderer with captured approvals and current-file semantics', () => {
  let captured
  const details = { ...base, approvals: [{ run: base.id, callId: 'read-one' }] }
  const html = renderToStaticMarkup(<RunInspector details={details} onClose={() => {}} renderTool={(tool, options) => {
    captured = options
    return <ToolCard tool={{ ...tool, path: 'src/a.js', commandId: 'gone', artifactId: 'gone' }} {...options} fileAvailable commandAvailable={false} artifactAvailable={false} onFile={() => {}}/>
  }}/>)
  expect(captured).toEqual({ recorded: true, approvals: details.approvals })
  expect(html).toContain('Open current file')
  expect(html).toContain('may differ from this run')
  expect(html).toContain('Command output no longer available')
  expect(html).toContain('Recorded preview no longer available')
  expect(html).not.toContain('View command</button>')
})

test('tool card makes rejected inputs visibly distinct from failed execution in live and recorded views', () => {
  for (const recorded of [false, true]) {
    const tool = { id: 'call', name: 'workspace_run', status: 'rejected', summary: 'args.command is required', hasResult: true }
    const rejected = renderToStaticMarkup(<ToolCard tool={tool} recorded={recorded}/>)
    expect(rejected).toContain('Run command · Not run')
    expect(rejected).toContain('Input rejected before execution.')
    expect(rejected).toContain('Validation result')
    expect(rejected).not.toContain('View command')
    const failed = renderToStaticMarkup(<ToolCard tool={{ ...tool, status: 'failed' }} recorded={recorded}/>)
    expect(failed).toContain('Run command · Failed')
    expect(failed).toContain('Recorded result')
    expect(failed).not.toContain('Input rejected before execution.')
  }
})
