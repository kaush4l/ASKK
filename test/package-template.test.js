import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { renderPackageTemplate } from '../src/core/package-template.js'
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
