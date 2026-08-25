/**
 * THE SEGMENT STORE, OVER INDEXEDDB — the substrate I20 is really about.
 *
 * The predecessor wrote one IndexedDB record per fact and booted by issuing one
 * read-only transaction per record, against a real browser holding 39,237 of
 * them. `core/log/` fixed the FORMAT — ~512 facts per record as NDJSON — and
 * this is the half that has to hold up its end: `range` is ONE transaction
 * however many records it returns, so a cold boot costs two transactions
 * whatever the history weighs.
 *
 * The key is compound and NUMERIC — `[stream, index]`, never a concatenated
 * zero-padded string. IndexedDB compares arrays element by element and numbers
 * numerically, so segment 2 comes back before segment 10 by the store's own
 * ordering rather than by a padding rule living in a comment.
 * @module
 */

import { StoreError } from '@harness/kernel'

import { SEG, awaited } from './idb.js'

/** @typedef {import('@harness/core').SegmentStore} SegmentStore */

/**
 * Above every segment index this build will ever write, and below any string —
 * IndexedDB sorts numbers before strings, so this closes the range for one
 * stream without reaching into the next.
 */
const ABOVE_ANY_INDEX = Number.MAX_VALUE

/** @param {IDBDatabase} db @returns {SegmentStore} */
export function idbSegments(db) {
  const store = (/** @type {IDBTransactionMode} */ mode) => db.transaction(SEG, mode).objectStore(SEG)
  return {
    async put(stream, index, text) {
      await awaited(store('readwrite').put(text, [stream, index]), 'put', `${stream}/${index}`)
    },
    async range(stream, from = 0) {
      const bounds = IDBKeyRange.bound([stream, from], [stream, ABOVE_ANY_INDEX])
      const request = store('readonly').openCursor(bounds)
      return await collect(request, stream)
    },
    async delete(stream, index) {
      await awaited(store('readwrite').delete([stream, index]), 'delete', `${stream}/${index}`)
    },
  }
}

/**
 * One cursor walk, in ONE transaction. `getAll` would read the same range in
 * one transaction too and would hold every record in memory twice — the cursor
 * hands them over one at a time and the transaction stays open across the walk,
 * which is exactly the property being claimed.
 * @param {IDBRequest<IDBCursorWithValue|null>} request @param {string} stream
 * @returns {Promise<Array<{index: number, text: string}>>}
 */
function collect(request, stream) {
  /** @type {Array<{index: number, text: string}>} */
  const rows = []
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        resolve(rows)
        return
      }
      const key = /** @type {[string, number]} */ (/** @type {unknown} */ (cursor.key))
      const index = key[1]
      if (typeof cursor.value === 'string' && typeof index === 'number') rows.push({ index, text: cursor.value })
      cursor.continue()
    }
    request.onerror = () => reject(request.error ?? new Error(`the ${stream} segments could not be read`))
  })
}
