import { Outcome, Reason } from '../Outcome.js'
import { estimateTokens } from '../prompt/tokens.js'
import { Inference } from './Inference.js'
import { Modality, Multimodality } from './Multimodality.js'

/**
 * The Anthropic Messages wire protocol — /v1/messages.
 *
 * Calling this straight from a browser needs `anthropic-dangerous-direct-
 * browser-access`, because the API otherwise refuses cross-origin calls to stop
 * keys being shipped inside web pages. That refusal is well founded: a key held
 * in this app is a key the user pasted for their own use on their own machine.
 * Anyone deploying this page for other people must not put their key in it.
 */
/**
 * Anthropic will not cache a prefix shorter than this, so a breakpoint below it
 * is silently ignored. Measured in the provider's tokens, not ours — the
 * estimate is deliberately the conservative side of the real count.
 */
const MIN_CACHEABLE_TOKENS = 1024

export class AnthropicCompatible extends Inference {
  static LABEL = 'anthropic'

  constructor(settings) {
    super({ baseUrl: 'https://api.anthropic.com/v1', ...settings })
    this.anthropicVersion = settings.anthropicVersion ?? '2023-06-01'
  }

  async invoke(prompt, multimodal = [], { onUsage, cacheAt = 0 } = {}) {
    const posted = await this._postJson(`${this.baseUrl}/messages`, this._headers(), {
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      messages: [{ role: 'user', content: this._content(prompt, multimodal, cacheAt) }],
    })
    if (!posted.ok) return posted

    const usage = AnthropicCompatible._usage(posted.value?.usage)
    if (usage) onUsage?.(usage)

    const blocks = posted.value?.content
    if (!Array.isArray(blocks)) {
      return Outcome.failed(Reason.UNAVAILABLE, 'anthropic: no content blocks in the reply', {
        hint: 'The endpoint answered, but not in the Messages API shape.',
      })
    }
    return Outcome.ok(
      blocks
        .filter((block) => block?.type === 'text')
        .map((block) => block.text)
        .join(''),
    )
  }

  async stream(prompt, multimodal = [], { onDelta, onUsage, cacheAt = 0 } = {}) {
    const read = await this._postStream(
      `${this.baseUrl}/messages`,
      this._headers(),
      {
        model: this.model,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        messages: [{ role: 'user', content: this._content(prompt, multimodal, cacheAt) }],
        stream: true,
      },
      (frame) => {
        // Usage arrives twice: an opening estimate on message_start and the
        // final count on message_delta. Both are reported; the later one wins.
        const usage = AnthropicCompatible._usage(frame?.message?.usage ?? frame?.usage)
        if (usage?.prompt || usage?.cached) onUsage?.(usage)

        // The Messages stream interleaves block starts, stops and pings. Only a
        // delta carries anything to show.
        if (frame?.type !== 'content_block_delta') return ''

        // Extended thinking arrives as its own delta type. Shown, so a long
        // think is not silence, but not returned — the answer is the text
        // blocks alone, which is what `invoke` also keeps.
        const thought = frame?.delta?.thinking
        if (typeof thought === 'string' && thought) onDelta?.(thought, 'reasoning')

        const piece = frame?.delta?.text
        if (typeof piece !== 'string' || !piece) return ''
        onDelta?.(piece, 'text')
        return piece
      },
    )
    const text = read.value?.text ?? ''
    if (!read.ok) {
      return text
        ? Outcome.ok(text, [`${read.failure.message} — showing the part that arrived`])
        : read.asFailure(read.failure.code, read.failure.message, read.failure.hint)
    }
    if (!text) {
      return Outcome.failed(Reason.UNAVAILABLE, 'anthropic: the stream carried no text', {
        hint: 'The endpoint streamed frames in an unexpected shape.',
      })
    }
    return Outcome.ok(text)
  }

  _headers() {
    return {
      'x-api-key': this.apiKey,
      'anthropic-version': this.anthropicVersion,
      'anthropic-dangerous-direct-browser-access': 'true',
    }
  }

  /**
   * The prompt as content blocks, with the cache breakpoint where the template
   * put it.
   *
   * This is the one transport that is TOLD where its prefix ends rather than
   * left to match one: `cache_control` marks the last block that repeats
   * exactly, and everything up to it is reused on the next call. Splitting the
   * text in two is the whole mechanism — the two halves concatenate to the same
   * prompt, so nothing about the model's input changes.
   */
  _content(prompt, multimodal, cacheAt = 0) {
    const head = cacheAt > 0 ? prompt.slice(0, cacheAt) : ''
    // Below the minimum a breakpoint is ignored, so splitting for it would add
    // a block and buy nothing.
    const worthCaching = head && estimateTokens(head) >= MIN_CACHEABLE_TOKENS
    const text = worthCaching
      ? [
          { type: 'text', text: head, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: prompt.slice(cacheAt) },
        ]
      : [{ type: 'text', text: prompt }]

    if (!multimodal?.length) return text

    const parts = [...text]
    for (const item of multimodal) {
      // Anthropic messages take images only; anything else would be rejected.
      if (item.type !== Modality.IMAGE) continue
      for (const url of item.urls) {
        if (!url.startsWith('data:')) {
          parts.push({ type: 'image', source: { type: 'url', url } })
          continue
        }
        const [mime, payload] = Multimodality.split(url)
        parts.push({ type: 'image', source: { type: 'base64', media_type: mime, data: payload } })
      }
    }
    return parts
  }
}
