/**
 * A STREAMED CHAT COMPLETION, FOLDED BACK INTO THE BODY IT WOULD HAVE BEEN.
 *
 * WHY A FOLD AND NOT A SECOND PARSER. A stream is the same reply delivered in
 * pieces, so the honest way to guarantee that a streamed turn and a buffered
 * one produce the identical `ProviderReply` is to have ONE reader and give it
 * one shape. `adapters-web/src/stream.js` is the alternative written out — a
 * whole second accumulator, OpenAI-only, that reads `finish_reason` and
 * `usage` again in its own words — and a second reader is where the two
 * quietly diverge on the field neither test covers.
 *
 * FRAMING IS NOT HERE. `data:` lines, `[DONE]`, and a chunk boundary landing
 * mid-UTF-8 belong to whatever carries the bytes; this takes the frames already
 * parsed, so it stays host-testable with no stream at all (I3).
 * @module
 */

import { at, copy, count, list, str } from '../read.js'

/** @typedef {{id: string, type: string, function: {name: string, arguments: string}}} CallFragment */

/**
 * The chunks as one completion body. Only the fields the reader reads are
 * rebuilt: the envelope (`id`, `object`, `created`) says nothing about the
 * reply and inventing a matching one would be this file claiming to know what
 * the server would have sent.
 * @param {unknown[]} events every `data:` frame's JSON, in arrival order
 * @returns {Record<string, unknown>}
 */
export function foldStream(events) {
  let content = ''
  let reasoning = ''
  let finish = ''
  /** @type {Record<string, unknown>} */
  let usage = {}
  /** @type {CallFragment[]} */
  const calls = []
  for (const event of events) {
    // The usage frame arrives LAST and alone, with an empty `choices` — which is
    // why it is read before the choice is looked for rather than inside it.
    if (at(event, 'usage')) usage = copy(at(event, 'usage'))
    const choice = list(at(event, 'choices'))[0]
    if (!choice) continue
    finish = str(at(choice, 'finish_reason')) || finish
    const delta = at(choice, 'delta')
    content += str(at(delta, 'content'))
    reasoning += str(at(delta, 'reasoning_content')) || str(at(delta, 'reasoning'))
    foldCalls(calls, list(at(delta, 'tool_calls')))
  }
  const message = { role: 'assistant', content, reasoning_content: reasoning, tool_calls: calls }
  return { choices: [{ message, finish_reason: finish }], usage }
}

/**
 * Tool calls, a character at a time. The fragment's INDEX is what says which
 * call it belongs to — matching on the name instead is how two calls to one
 * tool become one call with both their arguments concatenated.
 * @param {CallFragment[]} calls @param {unknown[]} fragments
 */
function foldCalls(calls, fragments) {
  fragments.forEach((fragment, i) => {
    const index = count(at(fragment, 'index')) ?? i
    const fn = at(fragment, 'function')
    const held = calls[index] ?? { id: '', type: 'function', function: { name: '', arguments: '' } }
    calls[index] = {
      id: str(at(fragment, 'id')) || held.id,
      type: 'function',
      function: {
        name: str(at(fn, 'name')) || held.function.name,
        arguments: held.function.arguments + str(at(fn, 'arguments')),
      },
    }
  })
}
