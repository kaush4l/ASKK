import { expect, test } from 'bun:test'
import { Engine } from '../src/core/engine.js'
import { LOOP_BUDGET } from '../src/core/loop-budget.js'
import { importAgentPackage, restoreAgentPackage } from '../src/core/agent-package.js'
import { readSpec } from '../src/core/folder.js'

const authored = extra => `---\npackage_id: tests.budgets\npackage_version: 1.0.0\nid: main\n${extra}---\nUse evidence.\n`
const imported = extra => importAgentPackage([{ path: 'agent.md', content: authored(extra) }])
const legacy = extra => readSpec('main', {
  index: { files: { 'agents/main/agent.md': 'fixture' } },
  load: async () => authored(extra),
})

test('omitted loop budgets use the documented defaults and zero repairs stays zero', () => {
  expect(new Engine({})).toMatchObject({ maxSteps: 10, repairs: 2, keep: 4 })
  expect(new Engine({ repairs: 0 }).repairs).toBe(0)
})

test('package, legacy folder and engine agree at supported bounds', async () => {
  for (const [key, rule] of Object.entries(LOOP_BUDGET)) {
    for (const value of [rule.min, rule.max]) {
      const text = `${rule.field}: ${value}\n`
      const pkg = await imported(text)
      expect(pkg.data.agents[0].settings[rule.field]).toBe(value)
      const restored = await restoreAgentPackage(JSON.parse(JSON.stringify(pkg.data)))
      expect(restored.data.agents[0].settings[rule.field]).toBe(value)
      const spec = await legacy(text)
      expect(new Engine(spec.engine)[key]).toBe(value)
    }
  }
})

test('invalid budgets fail at each entry point instead of coercing or silently clamping', async () => {
  for (const [key, rule] of Object.entries(LOOP_BUDGET)) {
    for (const value of [rule.min - 1, rule.max + 1, 1.5, null, true, '2']) {
      const text = `${rule.field}: ${JSON.stringify(value)}\n`
      expect(() => new Engine({ [key]: value })).toThrow(`${rule.field} must be an integer`)
      await expect(imported(text)).rejects.toMatchObject({ code: 'PACKAGE_SCHEMA' })
      await expect(legacy(text)).rejects.toThrow(`${key} must be an integer`)
    }
    for (const value of [NaN, Infinity, -Infinity]) expect(() => new Engine({ [key]: value })).toThrow()
  }
})

test('configured repairs govern actual provider attempts without changing failure to success', async () => {
  let attempts = 0
  const engine = new Engine({ contractVersion: 2, repairs: 3, llm: async () => ({
    context: async () => 32768,
    settings: { maxOutputTokens: 256 },
    async *stream() { attempts++; yield { kind: 'text', text: 'invalid' } },
  }) })
  await engine.invoke('work')
  expect(attempts).toBe(4)
  expect(engine.progress()).toMatchObject({ status: 'failed', terminationReason: 'invalid_response' })
})
