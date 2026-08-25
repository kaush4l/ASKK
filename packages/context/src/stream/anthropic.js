/**
 * A STREAMED MESSAGE, FOLDED BACK INTO THE MESSAGE IT WOULD HAVE BEEN.
 *
 * THE CONTENT ARRAY IS THE POINT. Anthropic's thinking blocks are
 * signature-verified and the next request echoes the array back verbatim
 * (`anthropic.js`), so a streamed turn that reassembled the array even slightly
 * differently — a dropped `signature_delta`, a `redacted_thinking` block left
 * out because it looked like noise — is a 400 on the FOLLOWING turn, which is
 * the worst place to learn it. Rebuilding the whole body and handing it to the
 * one reader is what makes the streamed array and the buffered array the same
 * object by construction.
 *
 * A tool call's arguments arrive as JSON TEXT in fragments, so `input` cannot
 * exist until the block ends: it is accumulated as a string and parsed once, at
 * the end, and a fragmentary or malformed accumulation becomes `{}` rather than
 * throwing halfway through a reply that otherwise arrived intact.
 * @module
 */

import { at, copy, count, str } from '../read.js'

/**
 * The events as one `/v1/messages` body.
 * @param {unknown[]} events every SSE frame's JSON, in arrival order
 * @returns {Record<string, unknown>}
 */
export function foldStream(events) {
  /** @type {Record<string, unknown>} */
  let message = {}
  /** @type {Record<string, unknown>[]} */
  const content = []
  /** @type {string[]} */
  const json = []
  /** @type {unknown} */
  let stopReason = null
  /** @type {Record<string, unknown>} */
  let usage = {}
  for (const event of events) {
    const type = str(at(event, 'type'))
    const index = count(at(event, 'index')) ?? content.length
    if (type === 'message_start') {
      message = copy(at(event, 'message'))
      usage = copy(at(message, 'usage'))
    } else if (type === 'content_block_start') {
      content[index] = copy(at(event, 'content_block'))
    } else if (type === 'content_block_delta') {
      applyDelta(content[index], json, index, at(event, 'delta'))
    } else if (type === 'message_delta') {
      stopReason = at(at(event, 'delta'), 'stop_reason') ?? stopReason
      usage = { ...usage, ...copy(at(event, 'usage')) }
    }
  }
  return { ...message, content: content.map((b, i) => withInput(b, json[i])), stop_reason: stopReason, usage }
}

/**
 * One delta into the block it belongs to. Every arm APPENDS: a signature
 * arrives in pieces like everything else here, and assigning it would keep only
 * the last piece of the one field the provider verifies.
 * @param {Record<string, unknown>|undefined} block
 * @param {string[]} json @param {number} index @param {unknown} delta
 */
function applyDelta(block, json, index, delta) {
  if (!block) return
  const kind = str(at(delta, 'type'))
  if (kind === 'text_delta') block['text'] = str(block['text']) + str(at(delta, 'text'))
  else if (kind === 'thinking_delta') block['thinking'] = str(block['thinking']) + str(at(delta, 'thinking'))
  else if (kind === 'signature_delta') block['signature'] = str(block['signature']) + str(at(delta, 'signature'))
  else if (kind === 'input_json_delta') json[index] = (json[index] ?? '') + str(at(delta, 'partial_json'))
}

/**
 * A tool block's accumulated argument text, parsed. The block opens with
 * `input: {}` and the object is only knowable once the last fragment is in, so
 * a block with no fragments keeps the empty object it opened with.
 * @param {Record<string, unknown>} block @param {string|undefined} accumulated
 */
function withInput(block, accumulated) {
  if (block['type'] !== 'tool_use' || !accumulated) return block
  try {
    return { ...block, input: JSON.parse(accumulated) }
  } catch {
    return { ...block, input: {} }
  }
}
