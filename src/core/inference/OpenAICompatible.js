import { Outcome, Reason } from '../Outcome.js'
import { Inference } from './Inference.js'
import { Modality, Multimodality } from './Multimodality.js'

/**
 * The OpenAI wire protocol — /v1/chat/completions.
 *
 * There is no provider table here on purpose. omlx, LM Studio, vLLM, Ollama and
 * api.openai.com are all this one class and differ only in `baseUrl`, so a new
 * server is a new setting rather than a new subclass.
 */
export class OpenAICompatible extends Inference {
  static LABEL = 'openai-compatible'

  async invoke(prompt, multimodal = [], { onUsage, signal } = {}) {
    const posted = await this._postJson(
      `${this.baseUrl}/chat/completions`,
      // Local servers ignore the key; sending an empty bearer would be rejected
      // by a real one with a confusing 401, so the header is omitted instead.
      this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {},
      {
        model: this.model,
        messages: [{ role: 'user', content: this._content(prompt, multimodal) }],
        temperature: this.temperature,
        max_tokens: this.maxTokens,
      },
      signal,
    )
    if (!posted.ok) return posted

    const usage = OpenAICompatible._usage(posted.value?.usage)
    if (usage) onUsage?.(usage)

    const text = posted.value?.choices?.[0]?.message?.content
    if (typeof text !== 'string') {
      // A well-formed JSON body in an unexpected shape usually means the URL
      // points at something that is not this API. Say that, rather than
      // returning an empty string that looks like a silent model.
      return Outcome.failed(
        Reason.UNAVAILABLE,
        'openai-compatible: no message content in the reply',
        {
          hint: 'The endpoint answered, but not in the OpenAI chat-completions shape. Check the base URL ends in /v1.',
        },
      )
    }
    return Outcome.ok(text)
  }

  async stream(prompt, multimodal = [], { onDelta, onUsage, signal } = {}) {
    const read = await this._postStream(
      `${this.baseUrl}/chat/completions`,
      this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {},
      {
        model: this.model,
        messages: [{ role: 'user', content: this._content(prompt, multimodal) }],
        temperature: this.temperature,
        max_tokens: this.maxTokens,
        stream: true,
        // A streamed reply carries no usage unless this is asked for, and
        // without it the token count would have to be guessed for exactly the
        // calls this app makes.
        stream_options: { include_usage: true },
      },
      (frame) => {
        // The usage frame arrives last and carries no choices.
        const usage = OpenAICompatible._usage(frame?.usage)
        if (usage?.prompt) onUsage?.(usage)

        // Everything else in a chunk — role, index, finish_reason — is
        // bookkeeping the loop does not read. Only the text matters.
        const delta = frame?.choices?.[0]?.delta

        // Reasoning models send their scratchpad on a separate field, and it
        // can run for a long time before a single character of the answer
        // appears. It is shown, because silence is indistinguishable from a
        // hung request — but it is NOT returned, so it never becomes part of
        // the text the response contract is parsed from.
        const thought = delta?.reasoning_content ?? delta?.reasoning
        if (typeof thought === 'string' && thought) onDelta?.(thought, 'reasoning')

        const piece = delta?.content
        if (typeof piece !== 'string' || !piece) return ''
        onDelta?.(piece, 'text')
        return piece
      },
      signal,
    )
    // A broken stream still carries whatever arrived. Below a threshold it is
    // not worth showing as an answer, but a long partial reply is, so it is
    // returned with a note saying it is incomplete rather than discarded.
    const text = read.value?.text ?? ''
    if (!read.ok) {
      return text
        ? Outcome.ok(text, [`${read.failure.message} — showing the part that arrived`])
        : read.asFailure(read.failure.code, read.failure.message, read.failure.hint)
    }
    if (!text) {
      return Outcome.failed(Reason.UNAVAILABLE, 'openai-compatible: the stream carried no text', {
        hint: 'The endpoint streamed frames in an unexpected shape. Check the base URL ends in /v1.',
      })
    }
    return Outcome.ok(text)
  }

  /** A bare string when nothing is attached, else the multipart content array. */
  _content(prompt, multimodal) {
    if (!multimodal?.length) return prompt

    const parts = [{ type: 'text', text: prompt }]
    for (const item of multimodal) {
      for (const url of item.urls) {
        if (item.type === Modality.IMAGE) {
          parts.push({ type: 'image_url', image_url: { url } })
        } else if (item.type === Modality.AUDIO) {
          const [mime, payload] = Multimodality.split(url)
          parts.push({
            type: 'input_audio',
            input_audio: { data: payload, format: mime.split('/').pop() },
          })
        } else {
          // Some OpenAI-compatible servers accept video, most ignore it.
          parts.push({ type: 'video_url', video_url: { url } })
        }
      }
    }
    return parts
  }
}
