import { expect, test, describe } from 'bun:test'
import { adapterFor, totalTokens, assemble, estimatePart, UNLIMITED_BUDGET, SLOT } from '@harness/context'
import { comp, source, soul, contract } from './paper.js'

/** @typedef {import('@harness/context').Part} Part */
/** @typedef {import('@harness/context').ProviderUsage} ProviderUsage */

/** The 1600x1200 JPEG, base64'd exactly as an adapter would put it on the wire. */
async function photo() {
  const bytes = await Bun.file(new URL('./fixtures/wide-1600.jpg', import.meta.url)).bytes()
  return /** @type {Part} */ ({ type: 'image', mediaType: 'image/jpeg', dataBase64: Buffer.from(bytes).toString('base64') })
}

/** @param {ProviderUsage|null} u @returns {ProviderUsage} */
function some(u) {
  if (u === null) throw new Error('the provider reported usage and it was read as none')
  return u
}

describe('reasoning tokens are DETAIL INSIDE the output count, never a term added to it', () => {
  test('OpenAI: the total is input + output, and the reasoning inside it is not charged twice', () => {
    const usage = some(adapterFor('openai').parseResponse({
      choices: [{ message: { content: 'done' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 40, completion_tokens_details: { reasoning_tokens: 30 } },
    }).usage)

    expect(usage.reasoningTokens).toBe(30)
    expect(totalTokens(usage)).toBe(140)
    // The over-report this rule exists to stop: 170 would trip compaction early.
    expect(totalTokens(usage)).not.toBe(usage.outputTokens + (usage.reasoningTokens ?? 0) + usage.inputTokens)
  })

  test('Gemini counts thoughts OUTSIDE its candidates, so its adapter folds them in', () => {
    const usage = some(adapterFor('gemini').parseResponse({
      candidates: [{ content: { parts: [{ text: 'done' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, thoughtsTokenCount: 30 },
    }).usage)

    // 10 + 30: one invariant across three providers, not two conventions.
    expect(usage.outputTokens).toBe(40)
    expect(usage.reasoningTokens).toBe(30)
    expect(totalTokens(usage)).toBe(140)
  })
})

describe('a provider that folds cache hits into its prompt total has them taken back out', () => {
  test('DeepSeek: prompt_tokens includes the cache hit, so the input is what was NOT cached', () => {
    const usage = some(adapterFor('openai').parseResponse({
      choices: [{ message: { content: 'done' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 10, prompt_cache_hit_tokens: 60 },
    }).usage)

    expect(usage).toMatchObject({ inputTokens: 40, cachedInputTokens: 60 })
    expect(totalTokens(usage)).toBe(110)
  })

  test('Anthropic reports them DISJOINT, so nothing is subtracted and the total is larger', () => {
    const usage = some(adapterFor('anthropic').parseResponse({
      content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 60 },
    }).usage)

    expect(usage).toMatchObject({ inputTokens: 100, cachedInputTokens: 60 })
    expect(totalTokens(usage)).toBe(170)
  })

  test('a provider that reported nothing is null and never a zero — a meter can say "unreported"', () => {
    expect(adapterFor('openai').parseResponse({ choices: [{ message: { content: 'hi' } }] }).usage).toBeNull()
    const partial = some(adapterFor('anthropic').parseResponse({
      content: [], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 1 },
    }).usage)
    expect(partial.reasoningTokens).toBeNull()
    expect(partial.cachedInputTokens).toBeNull()
  })
})

describe('an image is billed by the arithmetic of the provider it is going to', () => {
  test('the same photograph costs ~3x more at Anthropic than the tile rule charged it', async () => {
    const part = await photo()
    const openai = estimatePart(part, adapterFor('openai').images).tokens
    const anthropic = estimatePart(part, adapterFor('anthropic').images).tokens

    expect(openai).toBe(765)
    expect(anthropic).toBeGreaterThan(openai * 2.5)
    expect(estimatePart(part, adapterFor('gemini').images).tokens).not.toBe(openai)
  })

  test('and the paper is ASSEMBLED under that rule, so the budget bites at the right size', async () => {
    const part = await photo()
    const shot = comp({
      id: 'observations', slot: SLOT.OBSERVATIONS, stability: 'dynamic', priority: 8,
      render: () => [part],
    })
    const sources = [soul, shot, contract].map((c) => source(c))
    const paper = /** @param {import('@harness/context').ImageRule} r */ (r) =>
      assemble({ stage: 'work', sources }, UNLIMITED_BUDGET, r).report.spent

    expect(paper(adapterFor('anthropic').images)).toBeGreaterThan(paper(adapterFor('openai').images) * 2)
  })

  test('an unreadable header costs a ~1024x1024 image BY THAT PROVIDER, not four OpenAI tiles', () => {
    const broken = /** @type {Part} */ ({ type: 'image', mediaType: 'image/webp', dataBase64: 'UklGRhoAAABXRUJQVlA4TA0=' })
    const anthropic = estimatePart(broken, adapterFor('anthropic').images)
    expect(anthropic.tokens).toBe(adapterFor('anthropic').images.unknown)
    expect(anthropic.basis).toContain('anthropic')
    expect(anthropic.tokens).not.toBe(estimatePart(broken).tokens)
  })
})

/**
 * What `core` hands the loop is what an adapter returned. The type checker
 * proves it — a `ProviderReply` that stopped satisfying `ModelReply` would fail
 * the gate here rather than at the seam (I17).
 * @type {(r: import('@harness/context').ProviderReply) => import('@harness/kernel').ModelReply}
 */
const asModelReply = (r) => r

test('a reply this adapter read is a reply the same adapter can replay', () => {
  const openai = adapterFor('openai')
  const reply = openai.parseResponse({
    choices: [{ message: { content: '', reasoning_content: 'two options', tool_calls: [
      { id: 'call-1', type: 'function', function: { name: 'tools:consult_oracle', arguments: '{"q":1}' } },
    ] }, finish_reason: 'tool_calls' }],
  })

  expect(asModelReply(reply).finish).toBe('tool_calls')
  expect(reply.calls).toEqual([{ id: 'call-1', tool: 'consult_oracle', args: '{"q":1}' }])
  expect(reply.provider).toBe('openai')
  expect(reply.replayState).toEqual({ reasoning: 'two options' })
})
