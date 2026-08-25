/**
 * THE OPENAI WIRE, READ. Server-sent frames out of a byte stream, a streamed
 * reply folded as it arrives, and a whole one read in one go — the two halves
 * producing the identical `ModelReply`, because the loop must not be able to
 * tell how the bytes showed up.
 *
 * `finish` COMES OFF THE WIRE and is never inferred (I15's other half). A
 * truncation at the output ceiling, a content filter and a finished sentence
 * all arrive as a completion with text in it; only `finish_reason` separates
 * them, and a provider that does not say gets `'unknown'` — which is a value,
 * not a synonym for `'stop'`.
 *
 * Pure: no fetch, no browser. The whole protocol is host-tested here, and
 * `model.js` only carries bytes into it.
 * @module
 */

/** @typedef {import('@harness/kernel').ModelReply} ModelReply */
/** @typedef {import('@harness/kernel').FinishReason} FinishReason */
/** @typedef {import('@harness/kernel').Usage} Usage */
/** @typedef {{id: string, tool: string, args: string}} Call */

/** What a streamed reply has accumulated so far. */
/** @typedef {{text: string, reasoning: string, calls: Call[], finish: FinishReason, usage: Usage|null, raw: unknown[]}} Accumulator */

/** The frame a provider sends to say the stream is over. It is not JSON. */
const DONE = '[DONE]'

/** @returns {Accumulator} */
export function accumulate() {
  return { text: '', reasoning: '', calls: [], finish: 'unknown', usage: null, raw: [] }
}

/**
 * The `data:` payloads complete in `text`, and whatever is left dangling. A
 * chunk boundary falls wherever the network put it — mid-frame, mid-UTF-8, mid
 * word — so the tail is CARRIED rather than parsed, which is the bug that makes
 * a stream drop one token in fifty when it is written the obvious way.
 * @param {string} text @param {string} carry
 * @returns {{frames: string[], carry: string}}
 */
export function frames(text, carry) {
  const whole = carry + text
  const parts = whole.split('\n')
  const tail = parts.pop() ?? ''
  /** @type {string[]} */
  const found = []
  for (const line of parts) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice(5).trim()
    if (payload !== '' && payload !== DONE) found.push(payload)
  }
  return { frames: found, carry: tail }
}

/**
 * Fold one streamed chunk in, and say what NEW text it carried — that return
 * value is what reaches `onDelta`, so the port streams without the core ever
 * learning what a stream is.
 * @param {Accumulator} acc @param {string} payload one `data:` frame's JSON
 * @returns {{text?: string, reasoning?: string}|null}
 */
export function foldFrame(acc, payload) {
  const chunk = parse(payload)
  if (!chunk) return null
  acc.raw.push(chunk)
  usageInto(acc, chunk)
  const choice = firstChoice(chunk)
  if (!choice) return null
  const reason = finishOf(choice)
  if (reason) acc.finish = reason
  const delta = record(choice['delta'])
  const text = str(delta['content'])
  const reasoning = str(delta['reasoning_content']) || str(delta['reasoning'])
  acc.text += text
  acc.reasoning += reasoning
  callsInto(acc, delta['tool_calls'])
  if (text === '' && reasoning === '') return null
  return { ...(text ? { text } : {}), ...(reasoning ? { reasoning } : {}) }
}

/**
 * The reply a folded stream became. `finish` stays whatever the wire said —
 * including `'unknown'`, so a turn ends naming the string it could not read
 * rather than claiming it was answered.
 * @param {Accumulator} acc @returns {ModelReply}
 */
export function streamed(acc) {
  return { text: acc.text, reasoning: acc.reasoning, calls: acc.calls, finish: acc.finish, usage: acc.usage, raw: acc.raw }
}

/**
 * A whole, unstreamed completion. Same shape, same rules — a port that cannot
 * stream simply never called `onDelta` on the way here (I15).
 * @param {unknown} body @returns {ModelReply}
 */
export function completion(body) {
  const acc = accumulate()
  const chunk = record(body)
  acc.raw.push(chunk)
  usageInto(acc, chunk)
  const choice = firstChoice(chunk)
  if (choice) {
    acc.finish = finishOf(choice) ?? 'unknown'
    const message = record(choice['message'])
    acc.text = str(message['content'])
    acc.reasoning = str(message['reasoning_content']) || str(message['reasoning'])
    callsInto(acc, message['tool_calls'])
  }
  return streamed(acc)
}

/**
 * Tool calls, whether they arrived whole or a character at a time. A streamed
 * call is INDEXED and its `arguments` come in fragments, so the index is what
 * says which call a fragment belongs to — matching on the name instead is how
 * two calls to one tool become one call with both their arguments concatenated.
 * @param {Accumulator} acc @param {unknown} value
 */
function callsInto(acc, value) {
  if (!Array.isArray(value)) return
  for (let i = 0; i < value.length; i++) {
    const call = record(value[i])
    const at = typeof call['index'] === 'number' ? call['index'] : i
    const fn = record(call['function'])
    const held = acc.calls[at] ?? { id: '', tool: '', args: '' }
    acc.calls[at] = {
      id: str(call['id']) || held.id,
      tool: str(fn['name']) || held.tool,
      args: held.args + str(fn['arguments']),
    }
  }
}

/** @param {Accumulator} acc @param {Record<string, unknown>} chunk */
function usageInto(acc, chunk) {
  const usage = record(chunk['usage'])
  const input = num(usage['prompt_tokens'])
  const output = num(usage['completion_tokens'])
  if (input === null && output === null) return
  const cached = num(record(usage['prompt_tokens_details'])['cached_tokens'])
  acc.usage = { inputTokens: input ?? 0, outputTokens: output ?? 0, cachedInputTokens: cached }
}

/** @param {Record<string, unknown>} choice @returns {FinishReason|null} */
function finishOf(choice) {
  const said = str(choice['finish_reason'])
  if (said === '') return null
  if (said === 'function_call') return 'tool_calls'
  const known = ['stop', 'tool_calls', 'length', 'content_filter', 'refusal', 'error']
  return known.includes(said) ? /** @type {FinishReason} */ (said) : 'unknown'
}

/** @param {Record<string, unknown>} chunk @returns {Record<string, unknown>|null} */
function firstChoice(chunk) {
  const choices = chunk['choices']
  return Array.isArray(choices) && choices.length > 0 ? record(choices[0]) : null
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : {}
}

const str = (/** @type {unknown} */ value) => (typeof value === 'string' ? value : '')
const num = (/** @type {unknown} */ value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

/** @param {string} raw @returns {Record<string, unknown>|null} */
function parse(raw) {
  try {
    const value = /** @type {unknown} */ (JSON.parse(raw))
    return value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : null
  } catch {
    return null
  }
}
