/**
 * The Gemini `generateContent` protocol.
 *
 * THREE THINGS ARE SPELLED DIFFERENTLY HERE and none of them is cosmetic. The
 * assistant role is `model`. Content is `parts` under `contents`, and the
 * system prompt is `systemInstruction` beside them. And thoughts carry a
 * `thoughtSignature` that must come back on the parts it arrived on — the same
 * argument as Anthropic's signed blocks, so the echo is the same identity:
 * the parts array is written back untouched.
 *
 * ITS ACCOUNTING IS THE ODD ONE OUT. `thoughtsTokenCount` sits OUTSIDE
 * `candidatesTokenCount`, where every other provider folds reasoning into its
 * output count. This adapter folds it in, so the one invariant the budget is
 * written against — reasoning is already inside output, never added again —
 * holds across all three providers rather than in two of them.
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

const PROVIDER = 'gemini'

/** @type {Record<string, import('@harness/kernel/ports.js').FinishReason>} */
const FINISH = {
  STOP: 'stop',
  MAX_TOKENS: 'length',
  SAFETY: 'content_filter',
  PROHIBITED_CONTENT: 'content_filter',
  BLOCKLIST: 'content_filter',
  RECITATION: 'refusal',
}

/** @type {ProviderAdapter} */
export const geminiAdapter = {
  provider: PROVIDER,
  images: IMAGE_RULES.gemini,
  buildRequest,
  parseResponse,
}

/**
 * The `:generateContent` body. The model id and the stream flag are both
 * URL-level on this API (`:generateContent` vs `:streamGenerateContent`); they
 * are carried in the body for the port to lift out, because a body that
 * dropped them would make the request unaddressable from the bytes alone.
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
    systemInstruction: { parts: (system?.content ?? []).map(partJson) },
    contents: [
      ...(opts.replay ?? []).flatMap(replayContents),
      { role: 'user', parts: (user?.content ?? []).map(partJson) },
    ],
  }
  if (tools.length > 0) {
    body['tools'] = [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }]
  }
  if (typeof opts.temperature === 'number') body['generationConfig'] = { temperature: opts.temperature }
  return body
}

/**
 * One earlier model turn, echoed with its thought signatures intact, then its
 * function responses as a user turn.
 *
 * The `""` rule lands on the fallback: a turn whose state carries no parts
 * array serialises one text part holding an empty string, never a null and
 * never an empty `parts: []`, which this API refuses.
 * @param {Exchange} turn
 * @returns {Array<Record<string, unknown>>}
 */
function replayContents(turn) {
  const echoed = at(ownReplay(turn, PROVIDER), 'parts')
  const parts = Array.isArray(echoed) ? echoed : [{ text: str(turn.text) }]
  const results = turn.results.map((r) => ({
    functionResponse: { name: nameOf(turn, r.id), response: { output: r.output } },
  }))
  const contents = [{ role: 'model', parts }]
  if (results.length > 0) contents.push({ role: 'user', parts: results })
  return contents
}

/**
 * The tool a result belongs to. This API correlates a response to a call by
 * NAME and carries no call id, so the id we correlate by internally is
 * translated here rather than sent — a `functionResponse` naming nothing is
 * one this API cannot match to the call it answers.
 * @param {Exchange} turn @param {string} callId
 */
function nameOf(turn, callId) {
  return turn.calls.find((c) => c.id === callId)?.tool ?? ''
}

/** One neutral part as a Gemini part. @param {Part} p */
function partJson(p) {
  switch (p.type) {
    case 'text':
      return { text: p.text }
    case 'image':
    case 'audio':
    case 'file':
      return { inlineData: { mimeType: p.mediaType, data: p.dataBase64 } }
  }
}

/** @param {unknown} body @returns {ProviderReply} */
function parseResponse(body) {
  const raw = readBody(body, PROVIDER)
  const candidate = list(at(raw, 'candidates'))[0]
  const parts = list(at(at(candidate, 'content'), 'parts'))
  const said = (thought = false) =>
    parts.filter((p) => (at(p, 'thought') === true) === thought).map((p) => str(at(p, 'text'))).join('')
  return {
    text: said(false),
    reasoning: said(true),
    calls: callsOf(parts),
    finish: finishFrom(FINISH, at(candidate, 'finishReason')),
    usage: usageOf(at(raw, 'usageMetadata')),
    raw,
    provider: PROVIDER,
    // The parts as they arrived, thought signatures and all.
    replayState: { parts },
  }
}

/**
 * Function calls. This API mints no call id, so the call is keyed by its own
 * NAME and its index — the id has to exist for a result to correlate to a
 * call, and inventing one from randomness would make the request
 * non-deterministic.
 * @param {unknown[]} parts
 */
function callsOf(parts) {
  return parts.flatMap((p, i) => {
    const call = at(p, 'functionCall')
    if (!call) return []
    const name = str(at(call, 'name'))
    return [{ id: `${name}-${i}`, tool: name, args: JSON.stringify(at(call, 'args') ?? {}) }]
  })
}

/**
 * The accounting block. `promptTokenCount` INCLUDES the cached count, so the
 * cache is subtracted back out; `thoughtsTokenCount` sits outside the
 * candidate count, so it is folded IN. Both corrections exist to make one
 * invariant true everywhere: reasoning is already inside output.
 * @param {unknown} usage @returns {import('./provider.js').ProviderUsage|null}
 */
function usageOf(usage) {
  const input = count(at(usage, 'promptTokenCount'))
  const output = count(at(usage, 'candidatesTokenCount'))
  if (input === null && output === null) return null
  const cached = count(at(usage, 'cachedContentTokenCount'))
  const thoughts = count(at(usage, 'thoughtsTokenCount'))
  return {
    inputTokens: Math.max(0, (input ?? 0) - (cached ?? 0)),
    outputTokens: (output ?? 0) + (thoughts ?? 0),
    cachedInputTokens: cached,
    reasoningTokens: thoughts,
  }
}
