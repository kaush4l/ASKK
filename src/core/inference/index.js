import { Outcome } from '../Outcome.js'
import { AnthropicCompatible } from './AnthropicCompatible.js'
import { Inference } from './Inference.js'
import { OpenAICompatible } from './OpenAICompatible.js'
import { TransformersInference } from './TransformersInference.js'

/**
 * The wire protocols. Not a provider list — every OpenAI-compatible server is
 * one entry here and differs only by `baseUrl`.
 */
export const Kind = Object.freeze({
  OPENAI: 'openai',
  ANTHROPIC: 'anthropic',
  TRANSFORMERS: 'transformers',
})

const KINDS = {
  [Kind.OPENAI]: OpenAICompatible,
  [Kind.ANTHROPIC]: AnthropicCompatible,
  [Kind.TRANSFORMERS]: TransformersInference,
}

/**
 * Build a transport, correcting an unrecognised kind instead of refusing.
 *
 * A stored setting can name a kind that a later build no longer has. Falling
 * back to the default keeps the app usable and reports the substitution through
 * `notes`, which is strictly better than a dead app with an accurate complaint.
 *
 * @returns {import('../Outcome.js').Outcome} value is an Inference
 */
export function createInference({ kind = Kind.OPENAI, ...settings }) {
  const notes = []
  let chosen = kind
  if (!KINDS[chosen]) {
    notes.push(`model kind ${JSON.stringify(kind)} is not available; used ${Kind.OPENAI} instead`)
    chosen = Kind.OPENAI
  }
  return Outcome.ok(new KINDS[chosen](settings), notes)
}

export { Modality, Multimodality } from './Multimodality.js'
export { AnthropicCompatible, Inference, OpenAICompatible, TransformersInference }
