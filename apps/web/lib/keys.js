/**
 * THE CREDENTIAL BROKER'S DOOR, FROM THE INTERFACE SIDE — and it is one
 * function because `docs/SEAM.md` allows exactly one.
 *
 * `handle` records a fact for every request and the request's body rides into
 * the projection the interface then renders, so a key must never cross the
 * seam. `saveEndpoint` is the other door; this is the only thing in `apps/web`
 * that reaches for it, so "how many ways can a secret leave this page" is a
 * question answered by reading one file.
 *
 * THE IMPORT IS DYNAMIC FOR THE SAME REASON `lib/session.js`'s IS: a static
 * export evaluates every static import at build time, where there is no
 * IndexedDB to write to.
 */

import { HarnessError } from '@harness/kernel'

/** @typedef {import('@/components/views/problem').ProblemData} ProblemData */

/**
 * Save a key against one catalogue entry. NEVER REJECTS: every way this can
 * fail is a sentence on the screen, in the one failure shape the interface
 * already renders.
 * @param {string} entry which catalogue entry — never a URL
 * @param {string} apiKey `''` clears the stored one, which is how turning a
 *   credential off stays as available as turning it on (I10)
 * @returns {Promise<ProblemData|null>}
 */
export async function saveKey(entry, apiKey) {
  try {
    const broker = await import('@harness/adapters-web')
    await broker.saveEndpoint(entry, { apiKey })
    return null
  } catch (failure) {
    return failed(entry, failure)
  }
}

/** @param {string} entry @param {unknown} failure @returns {ProblemData} */
function failed(entry, failure) {
  const typed = failure instanceof HarnessError
  return {
    id: entry,
    kind: typed ? failure.kind : 'key_not_saved',
    message: 'That key was not saved, so calls to this endpoint will still go without one.',
    detail: typed ? failure.detail : String(failure),
    repair: 'This browser refused to write it. A private window is the usual reason; nothing else on this page is affected.',
  }
}
