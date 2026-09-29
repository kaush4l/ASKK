import { test, expect } from 'bun:test'
import { contexts } from '../src/core/context.js'
import { normalizeCompletion } from '../src/core/completion.js'
import { resolveCommandReference } from '../src/core/command-reference.js'

test('configured goal context reads the latest owner record every attempt and omits cleared goals', async () => {
  let current = { text: '', revision: 0 }
  const seen = []
  const engine = { ctx: { request: async op => { seen.push(op); return current } } }
  const [piece] = contexts(['goal'])
  expect(await piece.render(engine)).toBe('')
  current = { text: 'Preserve keyboard access', revision: 1 }
  expect(await piece.render(engine)).toContain('Preserve keyboard access')
  current = { text: 'Verify real persistence', revision: 2 }
  expect(await piece.render(engine)).toContain('revision 2')
  expect(await piece.render(engine)).not.toContain('keyboard')
  current = { text: '', revision: 3 }
  expect(await piece.render(engine)).toBe('')
  expect(seen).toEqual(Array(5).fill('workspace.goal'))
  expect(contexts([])).toHaveLength(0)
})

test('workspace context bounds the configured file listing and reports omissions', async () => {
  const [piece] = contexts({ workspace: { fileLimit: 2 } })
  const rendered = await piece.render({ ctx: { runContext: { sourceFingerprint: 'sha256:fixture' }, request: async () => ({ files: ['a.js', 'b.js', 'c.js'], status: 'ready' }) } })
  expect(rendered).toContain('"files":["a.js","b.js"]')
  expect(rendered).toContain('"fileCount":3')
  expect(rendered).toContain('"filesOmitted":1')
  expect(rendered).not.toContain('c.js')
})

test('workspace reference availability follows own completion rather than inherited task requirements', async () => {
  const [piece] = contexts(['workspace'])
  const command = '  npm test\n'
  const parentCompletion = normalizeCompletion({ checks: [{ capability: 'workspace.commands', options: { commands: [command] } }] })
  const runContext = { workflow: { completion: parentCompletion } }
  const request = async () => ({ files: [], status: 'ready' })
  for (const completion of [parentCompletion, normalizeCompletion({ checks: [] })]) {
    const rendered = await piece.render({ ctx: { runContext, completion, request } })
    const advertised = JSON.parse(rendered.split('\n')[1])
    expect(advertised.run.workflow.completion).toBeUndefined()
    expect(advertised.referenceCompletion).toEqual(completion)
    expect(rendered).toContain('use only the workspace.commands list in referenceCompletion')
    if (completion === parentCompletion) {
      expect(advertised.overallTaskCompletion).toBeUndefined()
      expect(rendered.split(JSON.stringify(command))).toHaveLength(2)
      expect(resolveCommandReference({ requiredCheck: 0 }, advertised.referenceCompletion)).toEqual({ command, requiredCheck: 0 })
    } else {
      expect(advertised.overallTaskCompletion).toEqual(parentCompletion)
      expect(rendered).toContain("overall task requirements, not this run's reference availability")
      expect(() => resolveCommandReference({ requiredCheck: 0 }, advertised.referenceCompletion)).toThrow()
    }
  }
  const missing = JSON.parse((await piece.render({ ctx: { runContext, request } })).split('\n')[1])
  expect(missing.referenceCompletion).toEqual({ checks: [] })
  expect(runContext.workflow.completion).toBe(parentCompletion)
  expect(Object.isFrozen(parentCompletion.checks[0].options.commands)).toBe(true)
})

test('workspace context deduplicates normalized defaults without granting malformed inherited requirements authority', async () => {
  const [piece] = contexts(['workspace'])
  const command = 'npm run exact-test'
  const raw = { checks: [{ capability: 'workspace.commands', options: { commands: [command] } }] }
  const completion = normalizeCompletion(raw)
  const request = async () => ({ files: [], status: 'ready' })
  const rendered = await piece.render({ ctx: { runContext: { workflow: { completion: raw } }, completion, request } })
  const advertised = JSON.parse(rendered.split('\n')[1])
  expect(advertised.overallTaskCompletion).toBeUndefined()
  expect(advertised.referenceCompletion).toEqual(completion)
  expect(rendered.split(JSON.stringify(command))).toHaveLength(2)
  expect(raw.checks[0].options.requireFresh).toBeUndefined()
  const malformed = { checks: [{ capability: 'workspace.commands', options: { commands: [command], requireFresh: false } }] }
  const child = JSON.parse((await piece.render({ ctx: { runContext: { workflow: { completion: malformed } }, completion: normalizeCompletion({ checks: [] }), request } })).split('\n')[1])
  expect(child.overallTaskCompletion).toEqual(malformed)
  expect(child.referenceCompletion).toEqual({ checks: [] })
  expect(() => resolveCommandReference({ requiredCheck: 0 }, child.referenceCompletion)).toThrow()
})

test('runtime context distinguishes general host tools from separately bound workspace execution', async () => {
  const [runtime, workspace] = contexts(['runtime', 'workspace'])
  const engine = { ctx: { request: async () => ({ target: 'local', status: 'ready', toolchain: { kind: 'bun' }, capabilities: ['fs', 'exec'] }) } }
  const text = await runtime.render(engine)
  expect(text).toContain('own worker')
  expect(text).toContain('separately selected execution binding')
  expect(text).not.toContain('No host companion is paired')
  expect(text).not.toContain('inside a browser tab')
  expect(await workspace.render(engine)).toContain('"target":"local"')
  engine.ctx.host = { capabilities: ['model-relay'] }
  expect(await runtime.render(engine)).toContain('only these capabilities: model-relay')
  expect(await runtime.render(engine)).toContain('does not grant native execution')
})
