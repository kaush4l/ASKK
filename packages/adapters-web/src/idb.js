/**
 * `StorePort` OVER INDEXEDDB — hand-rolled, no wrapper library. The whole of
 * an IndexedDB request in JavaScript is a five-line promisify; a dependency for
 * that would be a dependency for nothing.
 *
 * Three object stores in one database: `kv` (strings by key), `blob` (bytes by
 * path) and `seg` (log segments under a compound `[stream, index]` key). The
 * split is data, not DDL — prefixes are the namespace and they migrate in data.
 *
 * `replacePrefix` is ONE transaction, and that is the reason this file exists
 * at all rather than a Map: the old range is deleted and the new entries
 * written together, so a reader sees the whole old prefix or the whole new one
 * and never half of either.
 * @module
 */

import { StoreError } from '@harness/kernel'

/** @typedef {import('@harness/kernel').KvStore} KvStore */
/** @typedef {import('@harness/kernel').BlobStore} BlobStore */
/** @typedef {import('@harness/kernel').StorePort} StorePort */

export const KV = 'kv'
export const BLOB = 'blob'
export const SEG = 'seg'

/**
 * Open (creating the three stores on first run). The factory comes off
 * `globalThis`: a page has `window`, a sub-agent's Worker has
 * `WorkerGlobalScope` and no window at all — and a sub-agent whose store is a
 * Map loses its whole conversation on every reload.
 * @param {string} name @returns {Promise<IDBDatabase>}
 */
export function openDb(name) {
  const factory = /** @type {{indexedDB?: IDBFactory}} */ (globalThis).indexedDB
  if (!factory) {
    throw new StoreError('unavailable', 'This browser context has no IndexedDB, so nothing said here could be kept.')
  }
  return new Promise((resolve, reject) => {
    const open = factory.open(name, 1)
    open.onupgradeneeded = () => {
      const db = open.result
      for (const store of [KV, BLOB, SEG]) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store)
      }
    }
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(failure('open', name, open.error))
  })
}

/**
 * One IndexedDB request as a promise. Everything below is this, once.
 * @template T @param {IDBRequest<T>} request @param {string} what @param {string} key
 * @returns {Promise<T>}
 */
export function awaited(request, what, key) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(failure(what, key, request.error))
  })
}

/** @param {IDBDatabase} db @returns {KvStore} */
export function idbKv(db) {
  const read = () => db.transaction(KV, 'readonly').objectStore(KV)
  const write = () => db.transaction(KV, 'readwrite').objectStore(KV)
  return {
    async get(key) {
      const value = await awaited(read().get(key), 'get', key)
      if (value === undefined) return null
      if (typeof value !== 'string') {
        throw new StoreError('corrupt', `What is stored at ${key} is not text.`, { key })
      }
      return value
    },
    async put(key, value) {
      await awaited(write().put(value, key), 'put', key)
    },
    async delete(key) {
      await awaited(write().delete(key), 'delete', key)
    },
    async listPrefix(prefix) {
      const keys = await awaited(read().getAllKeys(prefixRange(prefix)), 'listPrefix', prefix)
      return keys.map(String)
    },
    /**
     * THE WHOLE PREFIX, SWAPPED INSIDE ONE TRANSACTION. Awaiting the LAST
     * request awaits the transaction: requests in one transaction complete in
     * the order they were made, so the delete has landed before the writes do
     * and a crash mid-write cannot leave half a prefix behind. An empty rewrite
     * has only the delete to wait on.
     */
    async replacePrefix(prefix, entries) {
      const store = write()
      /** @type {IDBRequest<undefined>|IDBRequest<IDBValidKey>} */
      let last = store.delete(prefixRange(prefix))
      for (const [key, value] of entries) last = store.put(value, key)
      await awaited(/** @type {IDBRequest<unknown>} */ (/** @type {unknown} */ (last)), 'replacePrefix', prefix)
    },
  }
}

/** @param {IDBDatabase} db @returns {BlobStore} */
export function idbBlob(db) {
  const store = (/** @type {IDBTransactionMode} */ mode) => db.transaction(BLOB, mode).objectStore(BLOB)
  return {
    async read(path) {
      const value = await awaited(store('readonly').get(path), 'read', path)
      if (value === undefined) return null
      if (!(value instanceof Uint8Array) && !(value instanceof ArrayBuffer)) {
        throw new StoreError('corrupt', `What is stored at ${path} is not bytes.`, { key: path })
      }
      return value instanceof ArrayBuffer ? new Uint8Array(value) : value
    },
    async write(path, bytes) {
      await awaited(store('readwrite').put(bytes, path), 'write', path)
    },
    async delete(path) {
      await awaited(store('readwrite').delete(path), 'delete', path)
    },
    async listPrefix(prefix) {
      const keys = await awaited(store('readonly').getAllKeys(prefixRange(prefix)), 'listPrefix', prefix)
      return keys.map(String)
    },
  }
}

/** Both halves behind one injection point. @param {IDBDatabase} db @returns {StorePort} */
export function idbStore(db) {
  return { kv: idbKv(db), blob: idbBlob(db) }
}

/**
 * Every key that starts with `prefix`. The upper bound is the prefix plus the
 * last code point there is, which is the standard trick and has the standard
 * hole: a key containing U+10FFFF itself would escape it. No key this build
 * writes contains one — they are all ASCII paths.
 */
export function prefixRange(/** @type {string} */ prefix) {
  return IDBKeyRange.bound(prefix, `${prefix}\u{10FFFF}`)
}

/**
 * A DOM exception as a typed failure. `QuotaExceededError` is separated because
 * it is the one a person can act on — everything else is the substrate saying
 * no, and the name it said it with is the detail.
 * @param {string} what @param {string} key @param {DOMException|null} error
 */
function failure(what, key, error) {
  const name = error?.name ?? 'unknown'
  if (name === 'QuotaExceededError') {
    return new StoreError('quota', 'This browser has no room left to store what was just said.', { key, detail: what })
  }
  return new StoreError('io', `Storage refused to ${what} ${key}.`, { key, detail: `${name}: ${error?.message ?? ''}` })
}
