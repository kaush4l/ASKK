import { Outcome, Reason } from '../../core/Outcome.js'

/**
 * A promise wrapper over the parts of IndexedDB this app uses.
 *
 * IndexedDB is event-based and its requests fire exactly once, so each call is
 * wrapped individually rather than sharing a transaction — a transaction in
 * IndexedDB auto-closes as soon as control returns to the event loop, which
 * makes it unusable across an await.
 *
 * Nothing here throws. Every operation reports an `Outcome`, including the open
 * itself, so a browser that refuses storage is a condition the app handles and
 * not an exception on the way to a blank screen.
 */
export class IndexedDb {
  constructor(name, version, stores) {
    this.name = name
    this.version = version
    this.stores = stores
    this._db = null
    this._opening = null
  }

  async open() {
    if (this._db) return Outcome.ok(this._db)
    if (!this._opening) {
      this._opening = new Promise((resolve) => {
        if (typeof indexedDB === 'undefined') {
          resolve(
            Outcome.failed(Reason.UNAVAILABLE, 'IndexedDB is not available in this context', {
              hint: 'Conversations will be kept for this session only.',
            }),
          )
          return
        }
        let request
        try {
          request = indexedDB.open(this.name, this.version)
        } catch (err) {
          // Some browsers throw synchronously rather than firing onerror when
          // site data is blocked outright.
          resolve(
            Outcome.failed(
              Reason.UNAVAILABLE,
              `IndexedDB refused to open: ${err?.message ?? err}`,
              {
                hint: 'Conversations will be kept for this session only.',
              },
            ),
          )
          return
        }
        request.onupgradeneeded = () => {
          const db = request.result
          for (const store of this.stores) {
            if (!db.objectStoreNames.contains(store)) {
              db.createObjectStore(store, { keyPath: 'id' })
            }
          }
        }
        request.onsuccess = () => {
          this._db = request.result
          resolve(Outcome.ok(this._db))
        }
        request.onerror = () =>
          resolve(
            Outcome.failed(
              Reason.UNAVAILABLE,
              `IndexedDB could not be opened: ${request.error?.message ?? 'blocked'}`,
              { hint: 'Conversations will be kept for this session only.' },
            ),
          )
        request.onblocked = () =>
          resolve(
            Outcome.failed(Reason.UNAVAILABLE, 'IndexedDB is blocked by another open tab', {
              hint: 'Close other tabs of this app and reload.',
            }),
          )
      })
    }
    const opened = await this._opening
    // A failed open is not cached as permanent: the next call may succeed once
    // the blocking tab is closed.
    if (!opened.ok) this._opening = null
    return opened
  }

  async _run(store, mode, fn) {
    const opened = await this.open()
    if (!opened.ok) return opened

    return new Promise((resolve) => {
      let request
      try {
        const tx = opened.value.transaction(store, mode)
        request = fn(tx.objectStore(store))
      } catch (err) {
        resolve(
          Outcome.failed(
            Reason.UNAVAILABLE,
            `storage ${mode} on ${store} failed: ${err?.message ?? err}`,
          ),
        )
        return
      }
      request.onsuccess = () => resolve(Outcome.ok(request.result))
      request.onerror = () =>
        resolve(
          Outcome.failed(
            Reason.UNAVAILABLE,
            `storage ${mode} on ${store} failed: ${request.error?.message ?? 'unknown'}`,
            {
              hint:
                request.error?.name === 'QuotaExceededError'
                  ? 'This browser is out of storage for this site. Delete some conversations.'
                  : '',
            },
          ),
        )
    })
  }

  get(store, id) {
    return this._run(store, 'readonly', (s) => s.get(id))
  }

  getAll(store) {
    return this._run(store, 'readonly', (s) => s.getAll())
  }

  put(store, record) {
    return this._run(store, 'readwrite', (s) => s.put(record))
  }

  delete(store, id) {
    return this._run(store, 'readwrite', (s) => s.delete(id))
  }
}
