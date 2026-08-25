/**
 * The OpenAI chat-completions protocol — and therefore nearly the whole
 * catalogue, since llama.cpp, LM Studio, vLLM, OpenRouter and DeepSeek all
 * answer on it.
 *
 * THE ONE LINE THAT BRICKS A SESSION. An assistant turn carrying only
 * reasoning, or only tool calls, must serialise `content` as `""` and NEVER
 * `null`. The message sits durably in the session log, so a single null is not
 * one bad turn — it is every later turn of that session, refused by an API
 * that will not say which message it choked on.
 *
 * REASONING PASSBACK IS CONDITIONAL ON `tools`. With tools present, DeepSeek
 * requires the intermediate `reasoning_content` back on every subsequent turn,
 * INCLUDING turns where the model called nothing, or answers 400. With no
 * tools it wants none of it — and `ports.js` keeps reasoning out of history by
 * default for exactly that case. Both polarities are here, and the condition
 * is the tool list this request carries.
 * @module
 */

import { messagesOf } from './wire.js'
import { finishFrom, ownReplay } from './provider.js'
import { at, count, list, readBody, str } from './read.js'
import { IMAGE_RULES } from './image.js'

/** @typedef {import('./provider.js').ProviderAdapter} ProviderAdapter */
/** @typedef {import('./provider.js').ProviderReply} ProviderReply */
/** @typedef {import('./provider.js').Exchange} Exchange */
/** @typedef {import('./provider.js').ToolSpec} ToolSpec */
/** @typedef {import('./wire.js').Message} Message */
/** @typedef {import('./types.js').Part} Part */

const PROVIDER = 'openai'

/** @type {Record<string, import('@harness/kernel/ports.js').FinishReason>} */
const FINISH = {
  stop: 'stop',
  tool_calls: 'tool_calls',
  length: 'length',
  content_filter: 'content_filter',
}

/** @type {ProviderAdapter} */
export const openaiAdapter = {
  provider: PROVIDER,
  images: IMAGE_RULES.openai,
  buildRequest,
  parseResponse,
}

/**
 * The `/v1/chat/completions` body: the paper's system message, every
 * replayable assistant turn with its results, then the paper's user message.
 * `temperature` is OMITTED when the agent file named none — an absent key means
 * the endpoint's own default, and a number we invented would override a server
 * setting nobody asked us to touch.
 * @param {import('./types.js').Document} doc
 * @param {import('./card.js').ModelCard} card
 * @param {ToolSpec[]} tools
 * @param {import('./provider.js').RequestOpts} [opts]
 * @returns {Record<string, unknown>}
 */
function buildRequest(doc, card, tools, opts = {}) {
  const paper = messagesOf(doc, card).map(wireMessage)
  const replayed = (opts.replay ?? []).flatMap((t) => replayMessages(t, tools.length > 0))
  /** @type {Record<string, unknown>} */
  const body = {
    model: card.model,
    stream: opts.stream === true,
    messages: [paper[0], ...replayed, paper[1]],
  }
  if (tools.length > 0) {
    body['tools'] = tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }))
  }
  if (typeof opts.temperature === 'number') body['temperature'] = opts.temperature
  return body
}

/**
 * One earlier assistant turn, plus one message per tool result. The result
 * messages are not optional: an assistant message carrying `tool_calls` whose
 * results never arrive is refused.
 * @param {Exchange} turn @param {boolean} withTools
 * @returns {Array<Record<string, unknown>>}
 */
function replayMessages(turn, withTools) {
  const state = ownReplay(turn, PROVIDER)
  // `str` and not `turn.text`: the turn came back out of the session log, and
  // a null that got in there once must not be written back to the wire.
  /** @type {Record<string, unknown>} */
  const message = { role: 'assistant', content: str(turn.text) }
  if (turn.calls.length > 0) {
    message['tool_calls'] = turn.calls.map((c) => ({
      id: c.id,
      type: 'function',
      function: { name: c.tool, arguments: c.args },
    }))
  }
  const reasoning = str(at(state, 'reasoning'))
  if (withTools && reasoning) message['reasoning_content'] = reasoning
  return [message, ...turn.results.map((r) => ({ role: 'tool', tool_call_id: r.id, content: r.output }))]
}

/**
 * A rendered message on the wire. Text-only content collapses to a plain
 * string — the widest local-server compatibility; mixed content uses the array
 * form. `content` is `''` and never null in both branches.
 * @param {Message|undefined} m @returns {Record<string, unknown>}
 */
function wireMessage(m) {
  const parts = m?.content ?? []
  const text = parts.every((p) => p.type === 'text')
  return {
    role: m?.role ?? 'user',
    content: text ? parts.map((p) => (p.type === 'text' ? p.text : '')).join('') : parts.map(partJson),
  }
}

/** One neutral part as the OpenAI content-part union. @param {Part} p */
function partJson(p) {
  switch (p.type) {
    case 'text':
      return { type: 'text', text: p.text }
    case 'image':
      return { type: 'image_url', image_url: { url: `data:${p.mediaType};base64,${p.dataBase64}` } }
    case 'audio':
      return { type: 'input_audio', input_audio: { data: p.dataBase64, format: p.mediaType.split('/').pop() ?? 'wav' } }
    case 'file':
      return { type: 'file', file: { filename: p.name, file_data: `data:${p.mediaType};base64,${p.dataBase64}` } }
  }
}

/** @param {unknown} body @returns {ProviderReply} */
function parseResponse(body) {
  const raw = readBody(body, PROVIDER)
  const message = at(list(at(raw, 'choices'))[0], 'message')
  const reasoning = str(at(message, 'reasoning_content')) || str(at(message, 'reasoning'))
  return {
    text: textOf(at(message, 'content')),
    reasoning,
    calls: callsOf(list(at(message, 'tool_calls'))),
    finish: finishFrom(FINISH, at(list(at(raw, 'choices'))[0], 'finish_reason')),
    usage: usageOf(at(raw, 'usage')),
    raw,
    provider: PROVIDER,
    replayState: { reasoning },
  }
}

/** Content as text, whichever of the two shapes the server used. @param {unknown} content */
function textOf(content) {
  if (typeof content === 'string') return content
  return list(content)
    .map((p) => str(at(p, 'text')))
    .join('')
}

/**
 * Native tool calls. The name is taken BARE: providers namespace it
 * (`tools:list_agents`) and the toolbox knows only the last segment.
 * @param {unknown[]} calls
 */
function callsOf(calls) {
  return calls.flatMap((c) => {
    const fn = at(c, 'function')
    const name = str(at(fn, 'name')).split(':').pop() ?? ''
    if (!name) return []
    const args = at(fn, 'arguments')
    return [{ id: str(at(c, 'id')), tool: name, args: typeof args === 'string' ? args : JSON.stringify(args ?? {}) }]
  })
}

/**
 * The accounting block, normalised. `cached_tokens` is a SUBSET of
 * `prompt_tokens` here, and DeepSeek folds its cache hits into that same
 * total, so the cached count is subtracted back out of the input rather than
 * counted twice. `reasoning_tokens` is carried and never added: it is already
 * inside `completion_tokens`.
 * @param {unknown} usage @returns {import('./provider.js').ProviderUsage|null}
 */
function usageOf(usage) {
  const input = count(at(usage, 'prompt_tokens'))
  const output = count(at(usage, 'completion_tokens'))
  if (input === null && output === null) return null
  const cached =
    count(at(at(usage, 'prompt_tokens_details'), 'cached_tokens')) ?? count(at(usage, 'prompt_cache_hit_tokens'))
  return {
    inputTokens: Math.max(0, (input ?? 0) - (cached ?? 0)),
    outputTokens: output ?? 0,
    cachedInputTokens: cached,
    reasoningTokens: count(at(at(usage, 'completion_tokens_details'), 'reasoning_tokens')),
  }
}
