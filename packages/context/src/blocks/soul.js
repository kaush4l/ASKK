/**
 * The pinned head: who this agent is, before it is told anything else.
 *
 * The body is the agent file's own markdown, verbatim. There is no second
 * place an agent's character is written down, which is why this block takes a
 * string rather than a set of fields — the moment it took fields, half the
 * character would live in a schema and half in prose.
 *
 * AN EMPTY FILE IS THE HOUSE DEFAULT, NOT AN EMPTY BLOCK, and the reason is
 * structural rather than editorial. `isHead` requires a soul or an identity to
 * survive assembly; a blank body renders no parts, elides, and takes a paper
 * with no identity block down with `no_head` — so an agent whose file a person
 * has just cleared cannot take a turn. The other wording of this block, in the
 * loop's own file, rendered whatever it was handed and pushed that hazard onto
 * every call site: the loop was written to say `soul(prompt.trim() || undefined)`
 * to dodge it. A default that only fires on `undefined` is a default that does
 * not fire on the case that occurs.
 * @module
 */

import { text } from '../component.js'
import { SLOT } from '../slot.js'

/** @typedef {import('../component.js').Component} Component */

/** What an agent that declared nothing about itself is. */
export const DEFAULT_SOUL =
  'You are HARNESS, a personal agent living in this browser. Values: honesty over ' +
  'comfort, the smallest correct step, legibility over cleverness. Voice: plain, ' +
  'direct, unhurried.'

/**
 * @param {string} [body] the agent file's markdown
 * @returns {Component}
 */
export function soul(body = DEFAULT_SOUL) {
  const written = body.trim() === '' ? DEFAULT_SOUL : body
  return {
    id: 'soul',
    slot: SLOT.SOUL,
    intent: 'Who this agent is; values and voice.',
    stability: 'static',
    priority: 0,
    floor: 'summarized',
    render: () => text(nested(written.trim())),
  }
}

/**
 * Push every markdown heading in an agent file down one level.
 *
 * An `agent.md` is written as a document, so it uses `##` for its own sections
 * — "## Tools", "## The shared space". The paper uses `##` for the blocks it
 * assembles. Rendered as-is the two are indistinguishable, and the model reads
 * one flat list in which the agent's prose about tools sits at the same level
 * as the actual list of tools it may call. Demoting the file's headings makes
 * the frame outrank the content, which is what it is.
 *
 * Fenced code is left alone: a `#` at the start of a line inside a fence is a
 * shell comment, and rewriting it would corrupt an example the agent meant to
 * give.
 * @param {string} body
 */
function nested(body) {
  let fenced = false
  return body
    .split('\n')
    .map((line) => {
      if (line.trimStart().startsWith('```')) fenced = !fenced
      return !fenced && line.startsWith('#') ? `#${line}` : line
    })
    .join('\n')
}
