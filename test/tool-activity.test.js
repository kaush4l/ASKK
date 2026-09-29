import { expect, test } from 'bun:test'
import { tool, runToolResult } from '../src/core/tools.js'
import { normalizeToolActivity, toolActivity } from '../src/core/tool-activity.js'
import { workspace_write, workspace_run } from '../src/builtin/workspace.js'
import { projectRunTools } from '../src/workbench/run-evidence.js'

async function execute(spec, receipt, args = {}) {
  const item = tool(spec, { name: 'custom_action' })
  const result = await runToolResult(item, args, { request: async () => receipt })
  return { result, activity: toolActivity(item, result, args) }
}

test('tool-owned receipt projection works independently of the callable name', async () => {
  const written = await execute(workspace_write, { ok: true, rev: 'r2' }, { path: 'src/app.js', content: 'fixture', expect: 0 })
  expect(written.result.ok).toBe(true)
  expect(written.activity).toEqual({ path: 'src/app.js' })
  const command = await execute(workspace_run, { id: 'command-1', code: 0 }, { command: 'fixture' })
  expect(command.activity).toEqual({ commandId: 'command-1' })
  const failed = await execute(workspace_run, { id: 'command-2', code: 2 }, { command: 'fixture' })
  expect(failed.result.ok).toBe(false)
  expect(failed.activity).toEqual({ commandId: 'command-2' })
})

test('invalid workspace receipts and failed writes cannot claim effects', async () => {
  const invalid = await execute(workspace_run, { id: 'forged' }, { command: 'fixture' })
  expect(invalid.result.ok).toBe(false)
  expect(invalid.activity).toEqual({})
  const conflict = await execute(workspace_write, { conflict: true, rev: 'r3' }, { path: 'app.js', content: 'fixture', expect: 0 })
  expect(conflict.result.ok).toBe(false)
  expect(conflict.activity).toEqual({})
})

test('arbitrary custom returned values do not acquire workspace semantics', async () => {
  const item = tool({ name: 'read_data', run: () => ({ ok: false, id: 'ordinary-data', code: 12 }) })
  const result = await runToolResult(item, {}, {})
  expect(result.ok).toBe(true)
  expect(toolActivity(item, result, {})).toEqual({})
})

test('malformed projectors cannot alter typed outcome or expose unsafe resource paths', () => {
  const result = { text: 'failed', ok: false }
  const item = { name: 'custom', projectActivity: () => ({ ok: true, status: 'done', path: 'app.js', artifactId: 'preview', commandId: 'command' }) }
  expect(toolActivity(item, result, {})).toEqual({ commandId: 'command' })
  expect(result).toEqual({ text: 'failed', ok: false })
  expect(toolActivity({ projectActivity: () => { throw new Error('adapter failure') } }, result, {})).toEqual({})
  expect(toolActivity({ projectActivity: async () => { throw new Error('async adapter') } }, result, {})).toEqual({})
  for (const path of ['../secret', '/absolute', 'https://evil.test', 'x\\y', 'a/../b', 'x\ny']) expect(normalizeToolActivity({ path }, { ok: true })).toEqual({})
  expect(normalizeToolActivity({ get path() { throw new Error('getter') } }, { ok: true })).toEqual({})
  expect(normalizeToolActivity({ artifactId: 'preview' }, {})).toEqual({})
})

test('historical projection carries typed links and rejects cross-run or ambiguous receipts', () => {
  const call = { kind: 'call', callId: 'one', name: 'custom_action', args: {} }
  const result = { kind: 'observation', callId: 'one', name: 'custom_action', ok: true, value: 'result', activity: { artifactId: 'artifact-1', status: 'failed' } }
  const projected = projectRunTools({ id: 'run-1', toolEvents: [call, result] })
  expect(projected.tools[0].artifactId).toBe('artifact-1')
  expect(projected.tools[0].status).toBe('done')
  expect(projectRunTools({ id: 'run-1', toolEvents: [call, { ...result, run: 'other' }] }).tools).toEqual([])
  expect(projectRunTools({ id: 'run-1', toolEvents: [call, result, result] }).tools).toEqual([])
  const failure = projectRunTools({ id: 'run-1', toolEvents: [call, { ...result, ok: false, activity: { path: 'forged.js', commandId: 'actual-command', artifactId: 'forged' } }] }).tools[0]
  expect(failure.status).toBe('failed')
  expect(failure.commandId).toBe('actual-command')
  expect(failure.artifactId).toBeUndefined()
  expect(failure.path).toBeUndefined()
})
