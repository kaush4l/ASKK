import { expect, test } from 'bun:test'
import { Engine } from '../src/core/engine.js'
import { reportedInputTokens } from '../src/core/token-budget.js'
import { ModelBroker } from '../src/runtime/model-broker.js'
import { buildAgentPrompt } from '../src/core/agent-prompt.js'

function fixture(usage = { prompt_tokens: 2000 }) {
  let sent = 0
  let profile = { provider: 'openai', baseUrl: 'https://one.test', model: 'same' }
  const engine = new Engine({ name: 'budget', repairs: 0, llm: async () => ({
    model: profile.model, settings: { ...profile, maxOutputTokens: 128 }, context: async () => 1500,
    async *stream(messages, { onFinish }) {
      sent++
      yield { kind: 'text', text: 'do: done\nact: finished' }
      onFinish({ usage, finishReason: 'stop' })
    },
  }) })
  return { engine, sent: () => sent, switchModel: value => { profile = { ...profile, ...value } } }
}

test('reported undercount raises the next request budget and blocks dispatch', async () => {
  const f = fixture()
  expect((await f.engine.step()).do).toBe('done')
  const initial = f.engine.promptBudget
  expect(initial.calibration).toBeNull()
  expect(initial.inputTokens).toBe(initial.baseInputTokens)
  expect(await f.engine.step()).toEqual({ failed: true, reason: 'context_budget' })
  expect(f.sent()).toBe(1)
  expect(f.engine.promptBudget.inputTokens).toBeGreaterThanOrEqual(2000)
  expect(f.engine.promptBudget).toMatchObject({ estimated: true, calibration: { samples: 1 } })
})

test('missing, invalid and cached-only usage do not change fallback budgeting', async () => {
  for (const usage of [null, {}, { prompt_tokens: -1 }, { prompt_tokens: '2000' }, { input_tokens: NaN }, { cache_read_input_tokens: 2000 }, { prompt_tokens_details: { cached_tokens: 2000 } }]) {
    const f = fixture(usage)
    await f.engine.step()
    await f.engine.step()
    expect(f.sent()).toBe(2)
    expect(f.engine.promptBudget.calibration).toBeNull()
    expect(f.engine.promptBudget.inputTokens).toBe(f.engine.promptBudget.baseInputTokens)
  }
})

test('calibration never lowers the fallback and includes Anthropic cache input', async () => {
  const f = fixture({ prompt_tokens: 1 })
  await f.engine.step()
  await f.engine.step()
  expect(f.engine.promptBudget.inputTokens).toBe(f.engine.promptBudget.baseInputTokens)
  expect(reportedInputTokens({ input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 })).toBe(130)
  expect(reportedInputTokens({ prompt_tokens: 130, prompt_tokens_details: { cached_tokens: 100 } })).toBe(130)
  expect(reportedInputTokens({ input_tokens: 10, cache_read_input_tokens: -1 })).toBeNull()
})

test('model or endpoint changes isolate calibration despite fresh wrappers each step', async () => {
  for (const change of [{ model: 'different' }, { baseUrl: 'https://two.test' }, { provider: 'anthropic' }]) {
    const f = fixture()
    await f.engine.step()
    f.switchModel(change)
    expect((await f.engine.step()).do).toBe('done')
    expect(f.sent()).toBe(2)
    expect(f.engine.promptBudget.calibration).toBeNull()
  }
})

test('calibrated request cost also triggers compaction', async () => {
  const f = fixture()
  await f.engine.step()
  let compacted = false
  f.engine.keep = 1
  f.engine.history = Array.from({ length: 4 }, () => ({ role: 'user', content: 'older history '.repeat(10) }))
  f.engine.summarise = async () => { compacted = true; return 'brief' }
  await f.engine.compress()
  expect(compacted).toBe(true)
  expect(f.engine.history[0]).toMatchObject({ role: 'summary', content: 'brief' })
})

test('broker calibration identity survives handles, isolates configuration, and cleans up', async () => {
  const broker = new ModelBroker()
  const settings = { provider: 'scripted', model: 'same', contextLength: 1500 }
  const open = (overrides = {}) => broker.open({ owner: 'owner', binding: 'main', settings: { ...settings, ...overrides } })
  const first = await open()
  const second = await open()
  const other = await open({ model: 'other' })
  expect(first.handle).not.toBe(second.handle)
  expect(first.calibrationKey).toBe(second.calibrationKey)
  expect(first.calibrationKey).not.toBe(other.calibrationKey)
  broker.closeOwner('owner')
  expect(broker.calibrationKeys.size).toBe(0)
  const reopened = await open()
  expect(reopened.calibrationKey).not.toBe(first.calibrationKey)
  broker.closeAll()
  expect(broker.calibrationKeys.size).toBe(0)
})

test('public prompt compiler rejects non-finite or reducing calibration factors', () => {
  for (const factor of [NaN, Infinity, -1, 0, 0.5]) {
    expect(() => buildAgentPrompt({ window: 1500, outputReserve: 128, calibration: { factor } })).toThrow('calibration factor')
  }
})

test('lower later receipts never erase an observed undercount', async () => {
  const usage = { prompt_tokens: 600 }
  const f = fixture(usage)
  await f.engine.step()
  const high = (await f.engine.render()).budget.calibration.factor
  usage.prompt_tokens = 1
  await f.engine.step()
  expect((await f.engine.render()).budget.calibration).toEqual({ factor: high, samples: 2 })
})
