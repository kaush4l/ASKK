/**
 * `ModelPort` OVER FETCH, AND THE CREDENTIAL BROKER. The configured endpoint
 * lives HERE and nowhere upstream: the core, the agent, the assembled document
 * and the event log all speak the symbolic name `model`, and this is the one
 * file that knows a base URL, attaches an `Authorization` header, and touches
 * the network (I6). A key cannot reach a module, a fact or a prompt — there is
 * no code path, and the test that proves it drives a whole turn and then reads
 * every persisted byte back looking for the key.
 * @module
 */

import { MODEL_ENDPOINT, ModelError, isLoopback } from '@harness/kernel'

import { chatUrl } from './catalogue.js'
import { accumulate, completion, foldFrame, frames, streamed } from './stream.js'
import { callFailed, globalFetch, providerError } from './wire.js'

/** @typedef {import('@harness/kernel').ModelPort} ModelPort */
/** @typedef {import('@harness/kernel').ModelReply} ModelReply */
/** @typedef {import('./endpoint.js').Endpoint} Endpoint */

/**
 * How long one turn may take. Five minutes and not thirty seconds: thirty was
 * chosen when a turn was one short completion, and a local 12B asked for a plan
 * runs longer than that — aborting mid-generation looks exactly like an
 * unreachable endpoint while being the opposite. Public because the page has to
 * say the number it is counting towards while it waits (I16).
 */
export const TIMEOUT_SECS = 300

/**
 * @param {Endpoint} endpoint
 * @param {{fetch?: typeof fetch, timeoutMs?: number}} [opts] the fetch is
 *   injectable for ONE reason: the credential rules are the part worth testing
 *   and a network is not required to test them.
 * @returns {ModelPort}
 */
export function fetchModel(endpoint, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_SECS * 1000
  return {
    resolves(asked) {
      const entry = endpoint.resolve(asked)
      return entry ? { endpoint: entry.name, model: entry.model } : null
    },
    async call(name, body, callOpts) {
      if (name !== MODEL_ENDPOINT) {
        throw new ModelError('refused', `Nothing here answers the endpoint called "${name}".`, {
          detail: `this build brokers one model endpoint, named "${MODEL_ENDPOINT}"`,
        })
      }
      const asked = typeof body['model'] === 'string' ? body['model'] : ''
      const entry = endpoint.resolve(asked)
      if (!entry) {
        throw new ModelError('refused', `No catalogue entry answers "${asked || 'the default model'}".`, {
          detail: 'this browser has read no model catalogue, or the entry that was asked for is not in it',
        })
      }
      const url = chatUrl(entry)
      const key = endpoint.apiKeyFor(entry.name)
      const streaming = typeof callOpts?.onDelta === 'function'
      const request = { ...body, model: entry.model, ...(streaming ? STREAMING : {}) }
      const response = await postJson(opts.fetch ?? globalFetch(), url, request, {
        key,
        timeoutMs,
        ...(callOpts?.signal ? { signal: callOpts.signal } : {}),
      })
      if (!response.ok) throw providerError(response.status, await response.text(), entry.model, key !== '')
      return streaming ? await readStream(response, callOpts?.onDelta) : completion(await response.json())
    },
  }
}

/**
 * `include_usage` is asked for explicitly: without it a streamed reply carries
 * no token counts at all, and the cost fact the log records would be missing
 * for exactly the calls a person watches happen.
 */
const STREAMING = { stream: true, stream_options: { include_usage: true } }

/**
 * ONE REQUEST, WITH THAT ENTRY'S CREDENTIAL ON IT — the last stop before the
 * wire.
 * @param {typeof fetch} send @param {string} url @param {Record<string, unknown>} body
 * @param {{key: string, timeoutMs: number, signal?: AbortSignal}} opts
 * @returns {Promise<Response>}
 */
async function postJson(send, url, body, opts) {
  const deadline = AbortSignal.timeout(opts.timeoutMs)
  /** @type {Record<string, string>} */
  const headers = { 'content-type': 'application/json' }
  if (opts.key !== '') headers['authorization'] = `Bearer ${opts.key}`
  const init = {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: opts.signal ? AbortSignal.any([opts.signal, deadline]) : deadline,
  }
  // DECLARE THE ADDRESS SPACE SO CHROME ASKS INSTEAD OF FAILING. Only ever for
  // a loopback target: declaring it over a public endpoint makes the browser
  // fail the fetch when the answer comes back from a different space, which
  // would break every hosted entry in the catalogue. A browser that does not
  // know the member ignores it, and no typing knows it yet either.
  if (isLoopback(url)) /** @type {Record<string, unknown>} */ (init)['targetAddressSpace'] = 'loopback'
  try {
    return await send(url, init)
  } catch (cause) {
    throw callFailed(url, cause, Math.round(opts.timeoutMs / 1000))
  }
}

/**
 * Read the stream, REPORTING AS IT ARRIVES. `onDelta` is called with each
 * fragment before this resolves, which is what puts a reply on the screen while
 * the model is still writing it — and the call still resolves with the whole
 * reply, so nothing upstream knows a stream happened (I15).
 * @param {Response} response @param {((delta: {text?: string, reasoning?: string}) => void)|undefined} onDelta
 * @returns {Promise<ModelReply>}
 */
async function readStream(response, onDelta) {
  const acc = accumulate()
  const decoder = new TextDecoder()
  let carry = ''
  const take = (/** @type {string} */ text) => {
    const found = frames(text, carry)
    carry = found.carry
    for (const frame of found.frames) {
      const delta = foldFrame(acc, frame)
      if (delta && onDelta) onDelta(delta)
    }
  }
  const body = response.body
  if (!body) take(await response.text())
  else {
    const reader = body.getReader()
    for (;;) {
      const step = await reader.read()
      if (step.done) break
      take(decoder.decode(step.value, { stream: true }))
    }
  }
  // The last frame of a stream often arrives with no closing newline, and a
  // frame that is never closed is a reply missing its final token.
  take('\n')
  return streamed(acc)
}
