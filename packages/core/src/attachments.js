/**
 * A DROPPED FILE, ON ITS WAY INTO A TURN.
 *
 * IT GOES THROUGH THE ONE DOOR. The bytes ride in the `POST /chat` body, become
 * a FACT carrying a `Part`, and are written to the workspace by the same
 * `write_file` the agent uses — so an attachment is durable for the same reason
 * anything else is, and there is no second path into storage to keep honest
 * (I4). The alternative was a `keepAttachment()` beside `saveEndpoint`, and one
 * documented exception to the seam is the most this tree gets.
 *
 * A TEXT-ONLY CARD IS TOLD, NOT DISCOVERED. `acceptsImages` is on the resolved
 * card, so an image aimed at a model that cannot read one is refused HERE, by
 * name, rather than becoming a 400 in the middle of the turn it was meant to
 * start. That is the whole reason the check is not left to the provider.
 * @module
 */

import { invokeTool } from '@harness/agent'

/** @typedef {import('@harness/kernel').Fact} Fact */
/** @typedef {import('./ctx.js').Ctx} Ctx */

/** One attachment, as a fact. Payload is a `Part` plus where it was kept. */
export const ATTACHED = 'core.attached'

/** Where an attachment lives in the workspace. A prefix, so a listing finds them together. */
export const ATTACHMENT_DIR = 'attachments'

/** @typedef {{type: string, name: string, mediaType: string, dataBase64: string}} Dropped */

/**
 * Read what the composer sent. A body is `Record<string,string>`, so the parts
 * arrive as one JSON field — and a field that will not parse is REFUSED rather
 * than silently ignored, because a person who dropped a file and saw nothing
 * has no way to tell "not supported" from "lost".
 * @param {string} raw
 * @returns {{parts: Dropped[]} | {problem: string}}
 */
export function readAttachments(raw) {
  if (raw.trim() === '') return { parts: [] }
  /** @type {unknown} */
  let said
  try {
    said = JSON.parse(raw)
  } catch {
    return { problem: 'the attachments field was not JSON, so nothing was attached' }
  }
  if (!Array.isArray(said)) return { problem: 'the attachments field was not a list of files' }
  /** @type {Dropped[]} */
  const parts = []
  for (const one of said) {
    const part = readOne(one)
    if ('problem' in part) return part
    parts.push(part.part)
  }
  return { parts }
}

/** @param {unknown} value @returns {{part: Dropped} | {problem: string}} */
function readOne(value) {
  if (!value || typeof value !== 'object') return { problem: 'one attachment was not an object' }
  const said = /** @type {Record<string, unknown>} */ (value)
  const name = typeof said.name === 'string' ? said.name.trim() : ''
  const mediaType = typeof said.mediaType === 'string' ? said.mediaType.trim() : ''
  const dataBase64 = typeof said.dataBase64 === 'string' ? said.dataBase64 : ''
  if (name === '' || dataBase64 === '') return { problem: 'an attachment arrived with no name or no bytes' }
  // The KIND is decided from the media type and never from the extension: a
  // `.png` a person renamed is still a PNG, and a `.txt` holding base64 is not
  // an image however it is spelled.
  return { part: { type: mediaType.startsWith('image/') ? 'image' : 'file', name, mediaType, dataBase64 } }
}

/**
 * WHY THIS CARD CANNOT TAKE IT, or '' when it can. An unresolved card answers
 * '' on purpose: the turn is already going to end saying the model key resolved
 * to nothing, and a second sentence about images would bury it.
 * @param {Ctx} ctx @param {Dropped} part
 */
export function refusedBy(ctx, part) {
  const card = ctx.agent.card
  if (part.type !== 'image' || !card || card.acceptsImages) return ''
  return `${part.name} is an image and ${card.name} cannot read one, so it was not attached. Pick a model whose card says it accepts images.`
}

/**
 * The fact and the chore for one attachment. The fact is what reaches the turn;
 * the chore is what makes it survive a refresh, and a build with no workspace
 * simply does not get the second half (I15) — which the note says out loud.
 * @param {Ctx} ctx @param {Dropped} part @returns {{fact: Fact, note: string}}
 */
export function attach(ctx, part) {
  const path = `${ATTACHMENT_DIR}/${part.name}`
  if (ctx.chore) ctx.chore(invokeTool('', '', 'write_file', JSON.stringify({ path, contents: part.dataBase64 })))
  return {
    fact: { type: 'custom', kind: ATTACHED, payload: { ...part, path } },
    note: ctx.chore
      ? `${part.name} attached, and kept at ${path}.`
      : `${part.name} attached to this turn only — this build has nowhere to keep it, so a refresh loses it.`,
  }
}

/** One attachment fact as the `Part` the paper wants. Null for anything else. */
export function partOf(/** @type {Fact} */ fact) {
  if (fact.type !== 'custom' || fact.kind !== ATTACHED) return null
  const said = /** @type {Partial<Dropped>} */ (fact.payload ?? {})
  if (typeof said.dataBase64 !== 'string' || said.dataBase64 === '') return null
  return said.type === 'image'
    ? { type: 'image', mediaType: said.mediaType ?? '', dataBase64: said.dataBase64 }
    : { type: 'file', name: said.name ?? '', mediaType: said.mediaType ?? '', dataBase64: said.dataBase64 }
}
