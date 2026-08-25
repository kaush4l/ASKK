/**
 * The Anthropic Messages protocol.
 *
 * THE OPPOSITE POLARITY TO OPENAI'S, and this is the whole reason an adapter
 * is one object per provider rather than one shared serialiser with flags.
 * OpenAI wants reasoning passed back as a FIELD we assemble; Anthropic wants
 * the assistant content array echoed back EXACTLY AS RECEIVED — its thinking
 * blocks are signature-verified, so rebuilding the message from its parts, or
 * filtering out a `redacted_thinking` block because it looks like noise, is a
 * 400. So the echo here is an identity: the array parsed out of the reply is
 * the array written back, untouched, unread.
 *
 * The system prompt is its own top-level field rather than a message, which is
 * the one structural difference from the chat-completions shape.
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
/** @typedef {import('./types.js').Part} Part */

const PROVIDER = 'anthropic'

/** @type {Record<string, import('@harness/kernel/ports.js').FinishReason>} */
const FINISH = {
  end_turn: 'stop',
  stop_sequence: 'stop',
  tool_use: 'tool_calls',
  max_tokens: 'length',
  refusal: 'refusal',
}

/** What the reply asks for when the turn states nothing. Anthropic REQUIRES the field. */
const DEFAULT_MAX_TOKENS = 4096

/** @type {ProviderAdapter} */
export const anthropicAdapter = {
  provider: PROVIDER,
  images: IMAGE_RULES.anthropic,
  buildRequest,
  parseResponse,
}

/**
 * The `/v1/messages` body. `max_tokens` is mandatory on this API, so the card
 * answers it and a stated default stands in when the catalogue entry does not.
 * @param {import('./types.js').Document} doc
 * @param {import('./card.js').ModelCard} card
 * @param {ToolSpec[]} tools
 * @param {import('./provider.js').RequestOpts} [opts]
 * @returns {Record<string, unknown>}
 */
function buildRequest(doc, card, tools, opts = {}) {
  const [system, user] = messagesOf(doc, card)
  /** @type {Record<string, unknown>} */
  const body = {
    model: card.model,
    stream: opts.stream === true,
    max_tokens: card.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
    system: breakpointed((system?.content ?? []).map(partJson), system?.cacheUntil ?? -1),
    messages: [...(opts.replay ?? []).flatMap(replayMessages), { role: 'user', content: (user?.content ?? []).map(partJson) }],
  }
  if (tools.length > 0) {
    body['tools'] = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }))
  }
  if (typeof opts.temperature === 'number') body['temperature'] = opts.temperature
  return body
}

/**
 * One earlier assistant turn, echoed, plus one user message carrying its tool
 * results — which is where this API expects them.
 *
 * THE ECHO IS VERBATIM. `content` is whatever array came back, handed on
 * without being read, and only a turn whose state carries no array at all
 * falls through to the text. That fallback is where the `""` rule lands here:
 * a reasoning-only turn serialises an empty string and never a null.
 * @param {Exchange} turn
 * @returns {Array<Record<string, unknown>>}
 */
function replayMessages(turn) {
  const echoed = at(ownReplay(turn, PROVIDER), 'content')
  const content = Array.isArray(echoed) ? echoed : str(turn.text)
  const results = turn.results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.output }))
  const messages = [{ role: 'assistant', content }]
  if (results.length > 0) messages.push({ role: 'user', content: results })
  return messages
}

/**
 * THE CACHE BREAKPOINT, STAMPED. This is the only API of the three that takes
 * one explicitly: a block carrying `cache_control` tells Anthropic to keep
 * everything up to and including it and to re-read only what follows.
 *
 * It goes on the LAST block of the byte-stable prefix and nowhere else, which
 * `wire.js` computed. One breakpoint and not four: each is a separate cache
 * entry with its own write cost, and stamping every stable block would pay to
 * store four prefixes of one prompt. The claim this stamp finally makes
 * executable is `Stability`'s — the Rust asserted the breakpoints were applied
 * "when the body is written" and `grep -rn cache_control crates/context` was
 * empty (`docs/RULINGS.md` Attack 4, item 7).
 * @param {Array<Record<string, unknown>>} blocks @param {number} until
 */
function breakpointed(blocks, until) {
  if (until < 0 || until >= blocks.length) return blocks
  return blocks.map((b, i) => (i === until ? { ...b, cache_control: { type: 'ephemeral' } } : b))
}

/** One neutral part as an Anthropic content block. @param {Part} p */
function partJson(p) {
  switch (p.type) {
    case 'text':
      return { type: 'text', text: p.text }
    case 'image':
      return { type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.dataBase64 } }
    case 'file':
      return { type: 'document', source: { type: 'base64', media_type: p.mediaType, data: p.dataBase64 } }
    case 'audio':
      // No audio block exists on this API. `wire.js` has already replaced the
      // part with a named placeholder for every card in this catalogue; this
      // arm is the one that would otherwise send a block the API rejects.
      return { type: 'text', text: `[audio (${p.mediaType}) withheld: this API has no audio block]` }
  }
}

/** @param {unknown} body @returns {ProviderReply} */
function parseResponse(body) {
  const raw = readBody(body, PROVIDER)
  const content = list(at(raw, 'content'))
  return {
    text: content.filter((b) => at(b, 'type') === 'text').map((b) => str(at(b, 'text'))).join(''),
    reasoning: content.filter((b) => at(b, 'type') === 'thinking').map((b) => str(at(b, 'thinking'))).join(''),
    calls: callsOf(content),
    finish: finishFrom(FINISH, at(raw, 'stop_reason')),
    usage: usageOf(at(raw, 'usage')),
    raw,
    provider: PROVIDER,
    // The array, as it arrived. Not a copy of the blocks we understood: the
    // ones we do NOT understand are exactly the ones the signature covers.
    replayState: { content },
  }
}

/** @param {unknown[]} content */
function callsOf(content) {
  return content
    .filter((b) => at(b, 'type') === 'tool_use')
    .map((b) => ({ id: str(at(b, 'id')), tool: str(at(b, 'name')), args: JSON.stringify(at(b, 'input') ?? {}) }))
}

/**
 * The accounting block. BOTH of Anthropic's cache fields are DISJOINT from
 * `input_tokens` — nothing is subtracted back out here, unlike the OpenAI
 * shape — so a cache WRITE is counted nowhere unless it is folded in, and a
 * priming turn that put 100k tokens into the cache would otherwise report the
 * five it was not able to reuse. It is folded into the input term and not into
 * `cachedInputTokens`, because this package's word for cached is "already paid
 * for" and a write is what pays.
 *
 * It reports no reasoning count at all, which is `null` and not a zero: a
 * meter must be able to say "unreported".
 * @param {unknown} usage @returns {import('./provider.js').ProviderUsage|null}
 */
function usageOf(usage) {
  const input = count(at(usage, 'input_tokens'))
  const output = count(at(usage, 'output_tokens'))
  const created = count(at(usage, 'cache_creation_input_tokens'))
  if (input === null && output === null) return null
  return {
    inputTokens: (input ?? 0) + (created ?? 0),
    outputTokens: output ?? 0,
    cachedInputTokens: count(at(usage, 'cache_read_input_tokens')),
    reasoningTokens: null,
  }
}
