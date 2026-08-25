import { expect, test, describe } from 'bun:test'
import { assemble, adapterFor, ADAPTERS, replayable, UNLIMITED_BUDGET } from '@harness/context'
import { HarnessError, ModelError } from '@harness/kernel'
import { state } from './paper.js'

/** @typedef {import('@harness/context').ModelCard} ModelCard */
/** @typedef {import('@harness/context').Exchange} Exchange */
/** @typedef {import('@harness/context').ProviderAdapter} ProviderAdapter */

const DOC = assemble(state(), UNLIMITED_BUDGET)
const EVERY = /** @type {ProviderAdapter[]} */ (Object.values(ADAPTERS))

/** @param {ProviderAdapter} a @returns {ModelCard} */
function card(a) {
  return {
    name: a.provider, model: `${a.provider}-model`, kind: a.provider, contextTokens: 128000,
    maxOutputTokens: null, acceptsImages: false, reasons: false,
  }
}

/** A turn that produced ONLY reasoning: no words, no calls. The session-bricking shape. @param {string} provider @returns {Exchange} */
function reasoningOnly(provider) {
  return { provider, model: 'm', text: '', calls: [], results: [], replayState: { reasoning: 'weighing two options' } }
}

/**
 * A built body, read as a plain tree.
 *
 * `any` with its reason, which is the whole point of these tests: what is being
 * asserted is each PROVIDER'S OWN shape — `messages[1].reasoning_content`,
 * `contents[0].parts` — and a typed reader covering three wire formats would be
 * a fourth format nobody sends. One cast, here, named.
 * @param {Record<string, unknown>|undefined} body @returns {any}
 */
function tree(body) {
  return body
}

/** Where each protocol puts the assistant turn's content. @type {Record<string, (b: ReturnType<typeof tree>) => unknown>} */
const ASSISTANT_CONTENT = {
  openai: (b) => b.messages[1].content,
  anthropic: (b) => b.messages[0].content,
  gemini: (b) => b.contents[0].parts[0].text,
}

const TOOL = { name: 'consult_oracle', description: 'ask the oracle', parameters: { type: 'object', properties: {} } }

describe('a reasoning-only assistant turn serialises content as "" and NEVER null', () => {
  for (const adapter of EVERY) {
    test(`${adapter.provider}: one null here bricks every later turn of the session`, () => {
      const body = adapter.buildRequest(DOC, card(adapter), [], { replay: [reasoningOnly(adapter.provider)] })
      expect(ASSISTANT_CONTENT[adapter.provider]?.(tree(body))).toBe('')
      expect(JSON.stringify(body)).not.toContain('null')
    })
  }
})

describe('every adapter says the same things about the same document', () => {
  for (const adapter of EVERY) {
    test(`${adapter.provider}: it names the model, carries the paper, and declares the tools it was given`, () => {
      const body = adapter.buildRequest(DOC, card(adapter), [TOOL])
      const wire = JSON.stringify(body)
      expect(body['model']).toBe(`${adapter.provider}-model`)
      expect(wire).toContain('## soul')
      expect(wire).toContain('consult_oracle')
      expect(JSON.stringify(adapter.buildRequest(DOC, card(adapter), []))).not.toContain('consult_oracle')
    })
  }
})

describe('reasoning passback is provider-conditional, and the polarities are opposite', () => {
  test('DeepSeek/OpenAI: with tools, the reasoning comes back on a turn that called nothing', () => {
    const withTools = openaiBody([TOOL])
    expect(withTools.messages[1].reasoning_content).toBe('weighing two options')
  })

  test('…and with no tools it is not sent at all, because that turn is this turn’s scratch', () => {
    expect(openaiBody([]).messages[1].reasoning_content).toBeUndefined()
  })

  test('Anthropic: the content array is echoed EXACTLY, redacted blocks and all', () => {
    const received = [
      { type: 'thinking', thinking: 'step one', signature: 'sig-abc' },
      { type: 'redacted_thinking', data: 'opaque-bytes' },
      { type: 'text', text: 'here it is' },
    ]
    /** @type {Exchange} */
    const turn = { provider: 'anthropic', model: 'm', text: 'here it is', calls: [], results: [], replayState: { content: received } }
    const body = tree(ADAPTERS['anthropic']?.buildRequest(DOC, card(anthropic()), [TOOL], { replay: [turn] }))
    // Rebuilding it, or filtering the block we cannot read, is a 400.
    expect(body.messages[0].content).toEqual(received)
  })

  test('Gemini: the parts come back with their thought signatures on them', () => {
    const received = [{ text: 'step one', thought: true, thoughtSignature: 'sig-xyz' }, { text: 'here it is' }]
    /** @type {Exchange} */
    const turn = { provider: 'gemini', model: 'm', text: 'here it is', calls: [], results: [], replayState: { parts: received } }
    const body = tree(ADAPTERS['gemini']?.buildRequest(DOC, card(gemini()), [], { replay: [turn] }))
    expect(body.contents[0].parts).toEqual(received)
  })
})

describe('one vendor’s opaque state never reaches another vendor', () => {
  test('the adapter refuses it BY NAME, both providers named', () => {
    const foreign = reasoningOnly('openai')
    let thrown = /** @type {unknown} */ (null)
    try {
      ADAPTERS['anthropic']?.buildRequest(DOC, card(anthropic()), [], { replay: [foreign] })
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(ModelError)
    const err = /** @type {ModelError} */ (thrown)
    expect(err.message).toContain('anthropic')
    expect(err.message).toContain('openai')
    expect(err.detail).toContain('replayable')
  })

  test('and a mixed history is sieved before it is built, keeping only this provider’s turns', () => {
    const mixed = [reasoningOnly('openai'), reasoningOnly('anthropic'), reasoningOnly('gemini')]
    expect(replayable(mixed, 'anthropic')).toHaveLength(1)
    expect(() => ADAPTERS['anthropic']?.buildRequest(DOC, card(anthropic()), [], { replay: replayable(mixed, 'anthropic') }))
      .not.toThrow()
  })
})

describe('the catalogue entry’s kind picks the adapter, and an unknown one is refused', () => {
  test('an entry with no kind is the OpenAI protocol, which is what most servers answer', () => {
    expect(adapterFor('openai').provider).toBe('openai')
    expect(adapterFor('anthropic').images.provider).toBe('anthropic')
  })

  test('a kind nobody implements refuses by name and lists the ones that exist', () => {
    let thrown = /** @type {unknown} */ (null)
    try {
      adapterFor('bedrock')
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(HarnessError)
    expect(/** @type {HarnessError} */ (thrown).message).toContain('"bedrock"')
    expect(/** @type {HarnessError} */ (thrown).detail).toContain('anthropic')
  })
})

describe('a body that is not a reply is a typed refusal, never a fake reply', () => {
  for (const adapter of EVERY) {
    test(`${adapter.provider}: it says what arrived instead`, () => {
      expect(() => adapter.parseResponse('not json at all')).toThrow(ModelError)
      expect(() => adapter.parseResponse(42)).toThrow(/not a reply object/)
    })
  }

  test('an unmapped stop word ends the turn as "unknown", which is not a synonym for "stop"', () => {
    expect(adapterFor('openai').parseResponse({ choices: [{ message: { content: 'hi' }, finish_reason: 'wat' }] }).finish)
      .toBe('unknown')
  })
})

/** @param {Array<typeof TOOL>} tools */
function openaiBody(tools) {
  const a = adapterFor('openai')
  return tree(a.buildRequest(DOC, card(a), tools, { replay: [reasoningOnly('openai')] }))
}

function anthropic() {
  return adapterFor('anthropic')
}

function gemini() {
  return adapterFor('gemini')
}
