/**
 * In-memory `StorePort`. The default substrate for every host test (I3): no
 * IndexedDB, no browser, no network, and the same contract the real adapter
 * implements — including `replacePrefix` being atomic, which here is free.
 * @module
 */

/** @typedef {import('@harness/kernel').KvStore} KvStore */
/** @typedef {import('@harness/kernel').BlobStore} BlobStore */
/** @typedef {import('@harness/kernel').StorePort} StorePort */

/**
 * A key/value store backed by a Map. `fail` makes a named key throw, which is
 * how a quota failure gets a test — the predecessor could only assert that
 * storage errors surface, never that they do.
 * @param {{fail?: (key: string) => Error|null}} [opts]
 * @returns {KvStore & {map: Map<string, string>}}
 */
export function memoryKv(opts = {}) {
  const map = new Map()
  const check = (/** @type {string} */ key) => {
    const err = opts.fail?.(key)
    if (err) throw err
  }
  return {
    map,
    async get(key) {
      return map.get(key) ?? null
    },
    async put(key, value) {
      check(key)
      map.set(key, value)
    },
    async delete(key) {
      map.delete(key)
    },
    async listPrefix(prefix) {
      return [...map.keys()].filter((k) => k.startsWith(prefix)).sort()
    },
    async replacePrefix(prefix, entries) {
      for (const key of [...map.keys()]) if (key.startsWith(prefix)) map.delete(key)
      for (const [key, value] of entries) {
        check(key)
        map.set(key, value)
      }
    },
  }
}

/** A blob store backed by a Map. @returns {BlobStore & {map: Map<string, Uint8Array>}} */
export function memoryBlob() {
  const map = new Map()
  return {
    map,
    async read(path) {
      return map.get(path) ?? null
    },
    async write(path, bytes) {
      map.set(path, bytes)
    },
    async delete(path) {
      map.delete(path)
    },
    async listPrefix(prefix) {
      return [...map.keys()].filter((k) => k.startsWith(prefix)).sort()
    },
  }
}

/** Both stores behind one injection point. @returns {StorePort} */
export function memoryStore() {
  return { kv: memoryKv(), blob: memoryBlob() }
}
