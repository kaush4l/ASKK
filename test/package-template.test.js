import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { renderPackageTemplate } from '../src/core/package-template.js'
import { compileAgentPackage } from '../src/core/package-spec.js'
import { buildAgentPrompt } from '../src/core/agent-prompt.js'
import { nativeDecision } from '../src/core/native-protocol.js'
import { importAgentPackage } from '../src/core/agent-package.js'

const template = JSON.parse(await readFile(new URL('../public/package-templates/basic.json', import.meta.url), 'utf8'))
test('configured starter escapes visual fields and retains instructions verbatim', async () => {
  const label = 'Reader "lead"\ntools: ["exec"]'
  const instructions = 'Keep {{name}} and $& literally.\nUse evidence.'
  const files = renderPackageTemplate(template, { label, description: 'A: B', instructions })
  const pkg = await importAgentPackage(files)
  expect(pkg.data.agents[0].settings.name).toBe(label)
  expect(pkg.data.agents[0].settings.tools).toEqual([])
  expect(await pkg.source.read('soul.md')).toBe(`${instructions}\n`)
})
test('invalid starter fields and unknown substitutions fail explicitly', () => {
  expect(() => renderPackageTemplate(template, { label: '' })).toThrow('name')
  expect(() => renderPackageTemplate(template, { instructions: {} })).toThrow('instructions')
  expect(() => renderPackageTemplate({version:1,files:[{path:'agent.md',content:'{{unknown}}'}]})).toThrow('Unknown')
})

test('default starter keeps the existing envelope contract and empty tool grants', async () => {
  const files = renderPackageTemplate(template, { description: 'Help with tasks' })
  expect(files).toEqual(renderPackageTemplate(template, { responseProtocol: 'envelope', description: 'Help with tasks' }))
  const pkg = await importAgentPackage(files)
  const settings = pkg.data.agents[0].settings
  expect(settings.contract_version).toBe(2)
  expect(settings.response_format).toBe('json')
  expect(settings.response_protocol).toBeUndefined()
  expect(settings.history_format).toBeUndefined()
  expect(settings.tools).toEqual([])
})

test('native starter authors a valid protocol and message history together without JSON mode', async () => {
  const files = renderPackageTemplate(template, { label: 'Native agent', description: 'Help with tasks', responseProtocol: 'native', instructions: 'Keep {{protocol}} literal.' })
  const pkg = await importAgentPackage(files)
  const settings = pkg.data.agents[0].settings
  expect(settings.response_protocol).toBe('native')
  expect(settings.contract_version).toBe(3)
  expect(settings.history_format).toBe('messages')
  expect(settings.response_format).toBeUndefined()
  expect(settings.tools).toEqual([])
  expect(settings.model).toBeUndefined()
  expect(await pkg.source.read('soul.md')).toBe('Keep {{protocol}} literal.\n')
})

test('starter rejects an unknown protocol rather than silently choosing envelope', () => {
  expect(() => renderPackageTemplate(template, { responseProtocol: 'unknown' })).toThrow('Unsupported starter response protocol')
  expect(() => renderPackageTemplate({ version: 1, files: template.files }, { responseProtocol: 'native' })).toThrow('Unsupported starter response protocol')
})

test('optional blank purpose produces an installable starter for either protocol', async () => {
  for (const responseProtocol of ['envelope', 'native']) {
    for (const description of ['', '   ']) {
      const pkg = await importAgentPackage(renderPackageTemplate(template, { responseProtocol, description }))
      expect(pkg.data.agents[0].settings.description).toBe(template.defaultDescription)
    }
  }
})


test('native starter compiles its default prompt with no tools and accepts a plain final', async () => {
  const pkg = await importAgentPackage(renderPackageTemplate(template, { responseProtocol: 'native' }))
  const [spec] = await compileAgentPackage(pkg, { installationId: 'starter-native', bindings: { models: { $default: 'test' }, tools: [] }, catalogue: { models: { test: { provider: 'openai', model: 'test' } } } })
  const prompt = buildAgentPrompt({ ...spec.engine, template: spec.engine.promptTemplate, soul: spec.soul, job: spec.body, history: [{ role: 'user', content: 'Say hello.' }], tools: [], window: 32768, outputReserve: 512 })
  expect(prompt.responseProtocol).toBe('native')
  expect(prompt.historyFormat).toBe('messages')
  expect(prompt.nativeTools).toEqual([])
  expect(prompt.responseSchema).toBeUndefined()
  expect(prompt.messages.some(message => message.content.includes('Reply in plain text'))).toBe(true)
  expect(nativeDecision({ text: 'Hello.' }, { names: [] })).toEqual({ do: 'done', act: 'Hello.' })
})
