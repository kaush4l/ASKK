// Token metrics for one LLM call: generation speed and how much of the
// context window the call fills.
//
//   const meter = new TokenMeter({ prompt, contextWindow })
//   meter.add(text)         per streamed chunk (content + reasoning)
//   meter.snapshot()        live estimate while streaming
//   meter.finish(usage)     exact figures when the server reports usage
//
// Without server usage, tokens are estimated at ~4 characters per token
// (no tokenizer to load); such stats carry `estimated: true`.

export const estimateTokens = (text) => Math.ceil(String(text ?? "").length / 4)

export class TokenMeter {
  #start = performance.now()
  #first = null // time of the first streamed chunk
  #last = null
  #chars = 0

  constructor({ prompt = "", contextWindow = null } = {}) {
    this.promptTokens = estimateTokens(prompt)
    this.contextWindow = contextWindow
  }

  add(text) {
    if (!text) return
    const now = performance.now()
    this.#first ??= now
    this.#last = now
    this.#chars += text.length
  }

  #stats(outputTokens, promptTokens, tokensPerSecond, estimated, live) {
    return {
      promptTokens,
      outputTokens,
      contextUsed: promptTokens + outputTokens,
      contextWindow: this.contextWindow,
      tokensPerSecond,
      timeToFirstTokenMs: this.#first === null ? null : Math.round(this.#first - this.#start),
      estimated,
      live,
    }
  }

  // Speed over the generation phase (first chunk → last chunk).
  #speed(tokens) {
    const seconds = this.#first === null ? 0 : (this.#last - this.#first) / 1000
    return seconds > 0.25 ? tokens / seconds : null
  }

  snapshot() {
    const outputTokens = Math.ceil(this.#chars / 4)
    return this.#stats(outputTokens, this.promptTokens, this.#speed(outputTokens), true, true)
  }

  finish(usage = null) {
    const outputTokens = usage?.outputTokens ?? Math.ceil(this.#chars / 4)
    const promptTokens = usage?.inputTokens ?? this.promptTokens
    const tokensPerSecond = usage?.tokensPerSecond ?? this.#speed(outputTokens)
    return this.#stats(outputTokens, promptTokens, tokensPerSecond, !usage, false)
  }
}

// 1234 -> "1.2k", 262144 -> "262k"
export function formatTokens(n) {
  if (n == null) return "—"
  if (n < 1000) return String(n)
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`
  return `${Math.round(n / 1000)}k`
}
