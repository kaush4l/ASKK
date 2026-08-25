/**
 * The four readers every provider body is picked apart with. A reply is DATA
 * THAT ARRIVED — from a llama.cpp build, a vendor's beta field, a proxy that
 * rewrote half of it — so nothing here trusts a shape, and every miss answers
 * with the empty value of its type rather than throwing halfway through a
 * parse. The one thing that DOES throw is a body that is not a reply at all,
 * because the Rust answered `None` there and left the caller to invent the
 * sentence a person would read.
 * @module
 */

import { ModelError } from '@harness/kernel'

/**
 * The body as a readable object, or the typed refusal. Never a fake reply: the
 * Rust returned `None` here and the caller had to invent the sentence.
 * @param {unknown} body @param {string} provider
 * @returns {Record<string, unknown>}
 * @throws {ModelError} `malformed`
 */
export function readBody(body, provider) {
  const parsed = typeof body === 'string' ? tryParse(body, provider) : body
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ModelError('malformed', `the ${provider} endpoint answered with something that is not a reply object`, {
      detail: `it answered ${parsed === null ? 'null' : typeof parsed}`,
    })
  }
  return /** @type {Record<string, unknown>} */ (parsed)
}

/** @param {string} body @param {string} provider @returns {unknown} */
function tryParse(body, provider) {
  try {
    return JSON.parse(body)
  } catch (cause) {
    throw new ModelError('malformed', `the ${provider} endpoint answered with something that is not JSON`, {
      cause,
      detail: body.slice(0, 200),
    })
  }
}

/** A number a provider reported, or null. Absent is NEVER zero: a meter must be able to say "unreported". @param {unknown} v */
export function count(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null
}

/** One object field, or undefined — the shape every provider body is read through. @param {unknown} v @param {string} key */
export function at(v, key) {
  return v && typeof v === 'object' ? /** @type {Record<string, unknown>} */ (v)[key] : undefined
}

/** An array field, or an empty one. @param {unknown} v @returns {unknown[]} */
export function list(v) {
  return Array.isArray(v) ? v : []
}

/** A string field, or `''`. @param {unknown} v */
export function str(v) {
  return typeof v === 'string' ? v : ''
}
