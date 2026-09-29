import { expect, test } from 'bun:test'
import { readSpec } from '../src/core/folder.js'
import { importAgentPackage, restoreAgentPackage } from '../src/core/agent-package.js'
import { compileAgentPackage } from '../src/core/package-spec.js'

const content = extra => `---\npackage_id: test.native\npackage_version: 1.0.0\nid: main\n${extra}---\nUse evidence.\n`
const files = extra => [{ path: 'agent.md', content: content(extra) }]
const folder = extra => readSpec('main', { index: { files: { 'agents/main/agent.md': 'hash' } }, load: async () => content(extra) })
const options = { installationId: 'native-test', bindings: { models: { $default: 'test' }, tools: [] }, catalogue: { models: { test: { provider: 'openai', model: 'test' } } } }

test('native protocol survives import, restore, compilation and legacy folder loading', async () => {
  const settings = 'response_protocol: native\ncontract_version: 3\nhistory_format: messages\n'
  const imported = await importAgentPackage(files(settings))
  const restored = await restoreAgentPackage(JSON.parse(JSON.stringify(imported.data)))
  expect(restored.data).toEqual(imported.data)
  expect(imported.data.agents[0].notes).toEqual([])
  const [spec] = await compileAgentPackage(restored, options)
  expect(spec.engine).toMatchObject({ responseProtocol: 'native', contractVersion: 3, historyFormat: 'messages' })
  expect((await folder(settings)).engine).toMatchObject({ responseProtocol: 'native', contractVersion: 3, historyFormat: 'messages' })
})

test('omitted response protocol retains envelope behavior', async () => {
  expect((await folder('')).engine.responseProtocol).toBe('envelope')
  expect((await compileAgentPackage(await importAgentPackage(files('')), options))[0].engine.responseProtocol).toBe('envelope')
})

test('incompatible native settings fail folder loading and package admission', async () => {
  for (const settings of [
    'response_protocol: automatic\n',
    'response_protocol: native\n',
    'response_protocol: native\ncontract_version: 2\nhistory_format: messages\n',
    'response_protocol: native\ncontract_version: 3\n',
    'response_protocol: native\ncontract_version: 3\nhistory_format: transcript\n',
  ]) {
    await expect(folder(settings)).rejects.toThrow()
    await expect(importAgentPackage(files(settings))).rejects.toMatchObject({ code: 'PACKAGE_SCHEMA' })
  }
})

test('restore revalidates authored native requirements before accepting saved metadata', async () => {
  const imported = await importAgentPackage(files('response_protocol: native\ncontract_version: 3\nhistory_format: messages\n'))
  const saved = JSON.parse(JSON.stringify(imported.data))
  const definition = saved.files.find(file => file.path === 'agent.md')
  definition.content = Buffer.from(content('response_protocol: native\ncontract_version: 2\nhistory_format: messages\n')).toString('base64')
  await expect(restoreAgentPackage(saved)).rejects.toMatchObject({ code: 'PACKAGE_SCHEMA' })
})
