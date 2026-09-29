import { expect, test } from 'bun:test'
import { readSpec } from '../src/core/folder.js'
import { importAgentPackage, restoreAgentPackage } from '../src/core/agent-package.js'
import { compileAgentPackage } from '../src/core/package-spec.js'

const content = extra => `---\npackage_id: test.completion-history\npackage_version: 1.0.0\nid: main\n${extra}---\nUse evidence.\n`
const files = extra => [{ path: 'agent.md', content: content(extra) }]
const folder = extra => readSpec('main', { index: { files: { 'agents/main/agent.md': 'hash' } }, load: async () => content(extra) })
const options = { installationId: 'completion-history-test', bindings: { models: { $default: 'test' }, tools: [] }, catalogue: { models: { test: { provider: 'openai', model: 'test' } } } }

test('completion history policy survives import, restore, compilation and folder loading', async () => {
  for (const policy of ['retain', 'omit']) {
    const settings = `rejected_completion_history: ${policy}\n`
    const imported = await importAgentPackage(files(settings))
    const restored = await restoreAgentPackage(JSON.parse(JSON.stringify(imported.data)))
    expect(restored.data).toEqual(imported.data)
    expect(imported.data.agents[0].notes).toEqual([])
    const [spec] = await compileAgentPackage(restored, options)
    expect(spec.engine.rejectedCompletionHistory).toBe(policy)
    expect((await folder(settings)).engine.rejectedCompletionHistory).toBe(policy)
  }
})

test('omitted completion history policy leaves the engine default intact', async () => {
  expect((await folder('')).engine.rejectedCompletionHistory).toBeUndefined()
  const [spec] = await compileAgentPackage(await importAgentPackage(files('')), options)
  expect(spec.engine.rejectedCompletionHistory).toBeUndefined()
})

test('invalid completion history policy fails package and folder admission', async () => {
  for (const value of ['automatic', 'false', '42', 'null', '[omit]']) {
    const settings = `rejected_completion_history: ${value}\n`
    await expect(importAgentPackage(files(settings))).rejects.toMatchObject({ code: 'PACKAGE_SCHEMA' })
    await expect(folder(settings)).rejects.toThrow()
  }
})

test('restore revalidates completion history policy from authored bytes', async () => {
  const imported = await importAgentPackage(files('rejected_completion_history: omit\n'))
  const saved = JSON.parse(JSON.stringify(imported.data))
  saved.files.find(file => file.path === 'agent.md').content = Buffer.from(content('rejected_completion_history: automatic\n')).toString('base64')
  await expect(restoreAgentPackage(saved)).rejects.toMatchObject({ code: 'PACKAGE_SCHEMA' })
})
