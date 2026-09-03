import { Outcome, Reason } from '../Outcome.js'
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

  /**
   * A transport with nowhere to send is REFUSED, and this is the one place
   * that can see it.
   *
   * Measured against the built page: with nothing configured, pressing send
   * POSTed to the page's OWN ORIGIN — `${'' }/chat/completions` is a relative
   * url, and a relative url resolves against wherever the page came from — got
   * a 404 from the static host serving the app, and reported "the endpoint
   * answered, but not with a result". One screen earlier the same app had said
   * "no address to reach one". So it invented an endpoint and then blamed it,
   * and a person went looking for a server that was never named.
   *
   * Refused rather than corrected, which every other branch in this file does,
   * because there is no correct value to substitute: only the person knows
   * where their model is. The message says what is missing and where to put it.
   */
  const model = String(settings.model ?? '').trim()
  const baseUrl = String(settings.baseUrl ?? '').trim()
  const needsAddress = chosen !== Kind.TRANSFORMERS
  if (!model) {
    return Outcome.failed(Reason.BAD_REQUEST, 'no model is named, so there is nothing to ask', {
      hint: 'Open settings and name the model this app should use.',
      notes,
    })
  }
  if (needsAddress && !baseUrl) {
    return Outcome.failed(Reason.BAD_REQUEST, `no address is set for ${model}`, {
      hint: 'Open settings and name where that model runs — a base URL ending in /v1.',
      notes,
    })
  }

  return Outcome.ok(new KINDS[chosen]({ ...settings, model, baseUrl }), notes)
}

export { Modality, Multimodality } from './Multimodality.js'
export { AnthropicCompatible, Inference, OpenAICompatible, TransformersInference }
