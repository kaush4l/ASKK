/**
 * A STREAMED `generateContent`, FOLDED BACK INTO THE RESPONSE IT WOULD HAVE
 * BEEN.
 *
 * THIS ONE HAS TO MERGE, WHERE THE OTHER TWO ONLY APPEND. Gemini streams whole
 * PARTS rather than deltas — every chunk carries a `parts` array with a slice
 * of the text in it — so a fold that appended them would produce forty text
 * parts where the buffered reply has one, which reads back as the same words
 * and echoes back as a different message. Consecutive text parts of the same
 * kind are therefore concatenated, and the boundary that matters is `thought`:
 * a thinking part and a spoken part are two different things the reader
 * separates on, so they never merge across it.
 *
 * A `thoughtSignature` arrives on the LAST chunk of the run it covers, so it is
 * carried onto the merged part rather than dropped with the chunk it came on —
 * it is the token the next request has to echo.
 * @module
 */

import { at, copy, list, str } from '../read.js'

/**
 * The chunks as one `GenerateContentResponse`.
 * @param {unknown[]} events every streamed response object, in arrival order
 * @returns {Record<string, unknown>}
 */
export function foldStream(events) {
  /** @type {Record<string, unknown>[]} */
  const parts = []
  let finishReason = ''
  /** @type {Record<string, unknown>} */
  let usage = {}
  for (const event of events) {
    if (at(event, 'usageMetadata')) usage = copy(at(event, 'usageMetadata'))
    const candidate = list(at(event, 'candidates'))[0]
    if (!candidate) continue
    finishReason = str(at(candidate, 'finishReason')) || finishReason
    for (const part of list(at(at(candidate, 'content'), 'parts'))) merge(parts, part)
  }
  return {
    candidates: [{ content: { role: 'model', parts }, finishReason }],
    usageMetadata: usage,
  }
}

/**
 * One arrived part, joined to the run it continues or opened as its own.
 * A part carrying a `functionCall` is never merged into anything: two calls to
 * one tool are two calls, and concatenating them is how they become one call
 * with both sets of arguments.
 * @param {Record<string, unknown>[]} parts @param {unknown} part
 */
function merge(parts, part) {
  const last = parts[parts.length - 1]
  const joinable =
    last !== undefined &&
    at(part, 'functionCall') === undefined &&
    last['functionCall'] === undefined &&
    (last['thought'] === true) === (at(part, 'thought') === true)
  if (!joinable) {
    parts.push(copy(part))
    return
  }
  last['text'] = str(last['text']) + str(at(part, 'text'))
  const signature = at(part, 'thoughtSignature')
  if (signature !== undefined) last['thoughtSignature'] = signature
}
