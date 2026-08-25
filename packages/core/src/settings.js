/**
 * THE SETTINGS MODULE — the endpoint catalogue and what it resolves to.
 *
 * NO KEY CROSSES THIS ROUTE, IN EITHER DIRECTION. `handle` records a
 * `request_handled` fact for every request and the body rides into the
 * projection the interface renders, so a credential in either would be a
 * credential in the log. `GET` projects WHETHER an entry holds a key and never
 * the key; `POST` carries every setting except it; and `saveEndpoint` in
 * `adapters-web` is the one door a secret goes through. That is the single
 * documented exception to I4 and it stays single (docs/SEAM.md).
 *
 * A BUILD THAT SHIPPED NO CATALOGUE READER SAYS SO. The alternative — an empty
 * list — reads as "you have no endpoints", which is a different and false
 * statement about this person's configuration (I15, I16).
 * @module
 */

import { ok, problem } from '@harness/kernel'

import { ACTIVITY } from './panels.js'

/** @typedef {import('@harness/kernel').Manifest} Manifest */
/** @typedef {import('@harness/kernel').Request} Request */
/** @typedef {import('@harness/kernel').Response} Response */
/** @typedef {import('./ctx.js').Ctx} Ctx */
/** @typedef {import('./panels.js').Activity} Activity */

/** The one body field this route refuses, by name, so the refusal is readable. */
const SECRET = 'apiKey'

/** @type {Manifest} */
export const settingsManifest = {
  id: 'settings',
  version: '1',
  title: 'Setup',
  summary: 'The endpoint catalogue, what each entry resolves to, and which hold a key.',
  capabilities: [],
  view: 'settings',
  routes: [
    { method: 'GET', path: '/settings' },
    { method: 'POST', path: '/settings' },
  ],
}

/** @param {Request} request @param {Ctx} ctx @returns {Response} */
export function settings(request, ctx) {
  const face = ctx.settings
  if (!face) {
    return problem(501, 'This build shipped no endpoint catalogue, so there is nothing to configure here.', {
      kind: 'no_catalogue',
      detail: 'the composition root passed no settings face, which a browser build always does and a host test need not',
      repair: 'Nothing you did caused this. A deployed build reads `models.json` at boot.',
    })
  }
  if (request.method === 'POST') {
    if (SECRET in request.body) return refused()
    face.apply({
      ...(request.body.entry === undefined ? {} : { entry: request.body.entry }),
      ...(request.body.baseUrl === undefined ? {} : { baseUrl: request.body.baseUrl }),
      ...(request.body.model === undefined ? {} : { model: request.body.model }),
      ...(request.body.search === undefined ? {} : { search: request.body.search }),
    })
  }
  return ok('settings', projected(ctx, face))
}

/**
 * THE REFUSAL THAT KEEPS I6 STRUCTURAL. A key arriving here is a caller using
 * the wrong door, and answering it with a 400 that NAMES the right one is what
 * stops the next person routing it through the seam because it was easier.
 * @returns {Response}
 */
function refused() {
  return problem(400, 'A key may not be sent through the seam, so nothing was saved.', {
    id: SECRET, kind: 'secret_in_request',
    detail: 'every request is recorded as a fact and its body rides into the projection, so a credential in one would be a credential in the log',
    repair: 'Save it with `saveEndpoint(entry, {apiKey})`, which is the only door a credential goes through.',
  })
}

/** @param {Ctx} ctx @param {NonNullable<Ctx['settings']>} face @returns {Record<string, unknown>} */
function projected(ctx, face) {
  const read = face.read()
  const activity = /** @type {Activity} */ (ctx.project(ACTIVITY))
  return {
    selected: read.selected,
    entries: read.entries,
    search: read.search,
    searchLabel: read.search === ''
      ? 'Search runs against the built-in ladder, which needs no configuration and no key.'
      : `Search goes to ${read.search}.`,
    modelLabel: read.selected === ''
      ? "No entry is picked, so each agent's own `model:` key decides where its calls go."
      : `Every call goes to ${read.selected}, whatever an agent file asks for.`,
    storeLabel: activity.storeFailures === 0
      ? 'Storage is working.'
      : `Storage failed ${activity.storeFailures === 1 ? 'once' : `${activity.storeFailures} times`}; the last was ${activity.lastStoreFailure}.`,
    keyNote: 'A key is written straight into this browser\'s storage, unencrypted. Nothing here can read one back.',
  }
}
