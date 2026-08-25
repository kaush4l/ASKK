/**
 * Which adapter a catalogue entry gets, by the `kind` it wrote.
 *
 * A table and not a factory: three providers exist, they are all here, and a
 * kind nobody implements is refused BY NAME at the moment a person selects it
 * — never a fallback to the OpenAI shape, which would send one protocol's
 * bytes to another protocol's endpoint and read the 400 as the model's fault.
 * @module
 */

import { HarnessError } from '@harness/kernel'
import { openaiAdapter } from './openai.js'
import { anthropicAdapter } from './anthropic.js'
import { geminiAdapter } from './gemini.js'

/** @typedef {import('./provider.js').ProviderAdapter} ProviderAdapter */

/** @type {Record<string, ProviderAdapter>} */
export const ADAPTERS = Object.freeze({
  openai: openaiAdapter,
  anthropic: anthropicAdapter,
  gemini: geminiAdapter,
})

/**
 * @param {string} kind the entry's `kind`; `modelCard` reads an absent one as `openai`
 * @returns {ProviderAdapter}
 * @throws {HarnessError} `unknown_provider`
 */
export function adapterFor(kind) {
  const adapter = ADAPTERS[kind]
  if (adapter) return adapter
  throw new HarnessError('unknown_provider', `no adapter speaks "${kind}"`, {
    detail:
      `models.json entries may set "kind" to one of: ${Object.keys(ADAPTERS).join(', ')}. ` +
      'An entry with no "kind" is read as the OpenAI chat-completions protocol, which is what ' +
      'nearly every server — llama.cpp, LM Studio, vLLM, OpenRouter, DeepSeek — answers on.',
  })
}
