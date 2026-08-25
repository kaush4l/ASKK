/**
 * THE SPACE MODULE — the shared shelf: every result too big to say, kept whole
 * and reachable by handle.
 *
 * This is what `/space` projects because it is what the space actually HOLDS in
 * this build. The Rust's space had three writing tools and an artifact shelf
 * beneath them; the shelf is the half that earns itself immediately — a 200KB
 * tool result has to go somewhere, and the alternative was the conversation.
 * The writing tools arrive with the agent that uses them, and until then a pane
 * listing an empty set of notes would be a pane describing a machine that is
 * not here (I16).
 * @module
 */

import { ok } from '@harness/kernel'

import { SHELF } from './shelf.js'
import { plural } from './dashboard.js'

/** @typedef {import('@harness/kernel').Manifest} Manifest */
/** @typedef {import('@harness/kernel').Request} Request */
/** @typedef {import('@harness/kernel').Response} Response */
/** @typedef {import('./ctx.js').Ctx} Ctx */
/** @typedef {import('./shelf.js').Kept} Kept */

/** @type {Manifest} */
export const spaceManifest = {
  id: 'space',
  version: '1',
  title: 'Space',
  summary: 'The shared shelf: results kept whole rather than quoted into a conversation.',
  capabilities: [],
  view: 'space',
  routes: [{ method: 'GET', path: '/space' }],
}

/** @param {Request} _request @param {Ctx} ctx @returns {Response} */
export function space(_request, ctx) {
  const kept = /** @type {Kept[]} */ (ctx.project(SHELF))
  const bytes = kept.reduce((sum, k) => sum + k.bytes, 0)
  return ok('space', {
    name: ctx.agent.space?.name ?? '',
    nameLabel: ctx.agent.space ? `Shared with everything in ${ctx.agent.space.name}.` : 'This agent works alone, so nothing here is shared.',
    rows: kept.map((k) => ({
      id: k.handle,
      handle: k.handle,
      tool: k.tool,
      at: k.at,
      summary: k.summary,
      sizeLabel: `${plural(k.bytes, 'character')} kept whole`,
    })),
    totalLabel: kept.length === 0 ? '' : `${plural(kept.length, 'result')}, ${plural(bytes, 'character')} in all, none of it re-sent to the model.`,
    emptyNote: 'Nothing has been shelved yet. A tool result too long to quote is kept here and read back by handle.',
  })
}
