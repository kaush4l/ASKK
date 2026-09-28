import { test, expect } from 'bun:test'
import { contexts } from '../src/core/context.js'

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
