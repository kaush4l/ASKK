/**
 * THE FILES MODULE — one directory of the workspace, as the log knows it.
 *
 * A LISTING REPORTS WHAT IT SAW. This pane is a projection of past facts (I8):
 * it knows what its last `list_files` printed and no more, so every sentence
 * here is past tense on purpose. The predecessor asserted the present tense of a
 * disk it had not looked at since, and said *"there is nothing in the workspace
 * folder yet"* four hundred pixels below a command that had just written a file
 * into it.
 *
 * The empty note is `folder.js`'s, because which of the four things an empty
 * folder means is a question only the log can answer — and the interface may
 * compose none of them (I5).
 * @module
 */

import { ok } from '@harness/kernel'

import { FOLDER, folderNote, named } from './folder.js'

/** @typedef {import('@harness/kernel').Manifest} Manifest */
/** @typedef {import('@harness/kernel').Request} Request */
/** @typedef {import('@harness/kernel').Response} Response */
/** @typedef {import('./ctx.js').Ctx} Ctx */
/** @typedef {import('./folder.js').Folder} Folder */

/**
 * NO CAPABILITY OF ITS OWN. The listing is `list_files` going through the tool
 * gate under the AGENT's grant; this module only reads what that left behind,
 * and a module that asked for `workspace` to render a projection would be a
 * second path to the same substrate.
 * @type {Manifest}
 */
export const filesManifest = {
  id: 'files',
  version: '1',
  title: 'Files',
  summary: 'One directory of the workspace, as the last listing saw it.',
  capabilities: [],
  view: 'files',
  routes: [{ method: 'GET', path: '/files' }],
}

/** Which folder the pane is asking about. A header, like `x-agent`: `/files` is one route. */
const AT = 'x-at'

/** @param {Request} request @param {Ctx} ctx @returns {Response} */
export function files(request, ctx) {
  const at = (request.headers[AT] ?? '.').replace(/\/+$/, '') || '.'
  const folder = /** @type {Folder} */ (ctx.project(FOLDER))
  const listing = folder.listing && folder.listing.at === at && folder.listing.ok ? folder.listing.output : ''
  return ok('files', {
    atLabel: named(at),
    entries: entries(listing),
    emptyNote: folderNote(folder, { at, durable: ctx.durable, bootedAt: ctx.bootedAt }),
    open: null,
  })
}

/**
 * One listing's lines as rows. `ls -1Ap` marks a directory with a trailing
 * slash, which is why the KIND comes off the listing and is never guessed from
 * the name: `ls` on a file succeeds and prints it, which is how "list, and read
 * if the listing failed" opened nothing and re-listed everything.
 *
 * `kind` is the machine field the pane keys its styling off and `meta` is the
 * same fact in words (I5) — they read alike today because a `-1Ap` listing
 * carries nothing else; a listing that carries a size fills `meta` with it and
 * `kind` does not change.
 * @param {string} output @returns {Array<{name: string, kind: string, meta: string}>}
 */
function entries(output) {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => ({
      name: line.replace(/\/$/, ''),
      kind: line.endsWith('/') ? 'folder' : 'file',
      meta: line.endsWith('/') ? 'folder' : 'file',
    }))
}
