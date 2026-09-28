/**
 * The page's durable state, in IndexedDB. Owned by the hub; no thread opens it.
 *
 *     settings   {key, value}                    catalogue, policy, bridge pairing, ui
 *     sessions   {agent, turns}                  a resident agent's history, saved after every turn
 *     runs       {id, trace, agent, parent, ...}  every run's slot, turns and spans (last 200)
 *     toolEvents {runId, sequence, event}         raw evidence, separate from run rewrites
 *     files      {path, content, rev, at}        the browser workspace
 *     memory     {id, agent, text, source, at}   what agents keep between tasks
 *     dreams     {id, agent, text, why, run, status, at}   proposals waiting for the owner
 *     learned    {agent, text, at}               accepted proposals: the LEARNED prompt layer
 *
 * If IndexedDB cannot open (a private window, blocked storage), the same interface runs in
 * memory and `durable` is false, so the page can say that nothing will survive a reload.
 * A blocked schema upgrade or an older client fails visibly instead; existing saved work
 * must not appear to have been replaced by an empty temporary workspace.
 */

const STORES = {
  settings: { keyPath: 'key' },
  sessions: { keyPath: 'agent' },
  runs: { keyPath: 'id' },
  toolEvents: { keyPath: ['runId', 'sequence'] },
  files: { keyPath: 'path' },
  memory: { keyPath: 'id', autoIncrement: true },
  dreams: { keyPath: 'id', autoIncrement: true },
  learned: { keyPath: 'agent' },
}

export async function openStore(name = 'harness') {
  try {
    const db = await new Promise((resolve, reject) => {
      let abandoned = false
      const opening = indexedDB.open(name, 2)
      opening.onupgradeneeded = () => {
        for (const [store, options] of Object.entries(STORES)) {
          if (!opening.result.objectStoreNames.contains(store)) opening.result.createObjectStore(store, options)
        }
      }
      opening.onsuccess = () => { if (abandoned) opening.result.close(); else resolve(opening.result) }
      opening.onerror = () => { abandoned = true; reject(opening.error) }
      opening.onblocked = () => { abandoned = true; reject(Object.assign(new Error('Storage upgrade requires closing or reloading other tabs running the older application. Existing saved work has not been changed.'), { code: 'STORE_UPGRADE_BLOCKED' })) }
    })
    return idbStore(db)
  } catch (error) {
    // A known existing database must never be replaced by an empty memory view
    // just because another tab prevents its upgrade (or this client is older).
    if (error.code === 'STORE_UPGRADE_BLOCKED' || error.name === 'VersionError') throw error
    return memoryStore(String(error?.message ?? error))
  }
}

const done = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

function idbStore(db) {
  const store = (name, mode = 'readonly') => db.transaction(name, mode).objectStore(name)
  const mutate = (name, action) => new Promise((resolve, reject) => {
    const transaction = db.transaction(name, 'readwrite')
    const request = action(transaction.objectStore(name))
    transaction.oncomplete = () => resolve(request.result)
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error ?? new Error('Storage transaction aborted'))
  })
  const result = {
    durable: true,
    why: '',
    get: (name, key) => done(store(name).get(key)),
    all: (name) => done(store(name).getAll()),
    put: (name, value) => mutate(name, store => store.put(value)),
    delete: (name, key) => mutate(name, store => store.delete(key)),
    clear: (name) => mutate(name, store => store.clear()),
    appendToolEvent: (runId, event) => new Promise((resolve, reject) => {
      const transaction = db.transaction('toolEvents', 'readwrite'); const objects = transaction.objectStore('toolEvents')
      const read = objects.get([runId, event.sequence]); let conflict
      read.onsuccess = () => {
        if (!read.result) objects.add({ runId, sequence: event.sequence, event })
        else if (JSON.stringify(read.result.event) !== JSON.stringify(event)) { conflict = new Error(`Tool evidence ${runId}/${event.sequence} already exists with different content`); transaction.abort() }
      }
      transaction.oncomplete = () => resolve(event.sequence)
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(conflict ?? transaction.error ?? new Error('Tool evidence transaction aborted'))
    }),
    readToolEvents: async (runId, through = Infinity) => (await done(store('toolEvents').getAll(IDBKeyRange.bound([runId, 0], [runId, through])))).map(row => row.event),
    deleteRun: (runId) => new Promise((resolve, reject) => {
      const transaction = db.transaction(['runs', 'toolEvents'], 'readwrite')
      transaction.objectStore('runs').delete(runId)
      transaction.objectStore('toolEvents').delete(IDBKeyRange.bound([runId, 0], [runId, Infinity]))
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error ?? new Error('Run retention transaction aborted'))
    }),
    /**
     * Read, decide and write in ONE transaction, so no other write can land in between.
     * `change(current)` returns `{value, ...}` to put `value`, or anything without `value` to leave it.
     */
    update: (name, key, change) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(name, 'readwrite')
        const objects = transaction.objectStore(name)
        let result
        const read = objects.get(key)
        read.onsuccess = () => {
          try {
            result = change(read.result)
            if (result?.value !== undefined) objects.put(result.value)
            else if (result?.delete) objects.delete(key)
          } catch (error) { transaction.abort(); reject(error) }
        }
        transaction.oncomplete = () => resolve(result)
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error ?? new Error('Storage transaction aborted'))
      }),
    move: (name, from, to, change) => new Promise((resolve, reject) => {
      const transaction = db.transaction(name, 'readwrite'); const objects = transaction.objectStore(name)
      let current; let destination; let count = 0; let result
      const loaded = () => { if (++count !== 2) return; try { result = change(current, destination); if (result?.value !== undefined) { objects.put(result.value); objects.delete(from) } } catch (error) { transaction.abort(); reject(error) } }
      const source = objects.get(from); source.onsuccess = () => { current = source.result; loaded() }
      const target = objects.get(to); target.onsuccess = () => { destination = target.result; loaded() }
      transaction.oncomplete = () => resolve(result)
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error ?? new Error('Storage transaction aborted'))
    }),
  }
  db.onversionchange = () => { db.close(); result.durable = false; result.why = 'Storage was upgraded in another tab; reload this application before saving more work' }
  return result
}

function memoryStore(why) {
  const data = Object.fromEntries(Object.keys(STORES).map((name) => [name, new Map()]))
  const counters = {}
  const keyOf = (name, value) => {
    const { keyPath, autoIncrement } = STORES[name]
    if (value[keyPath] == null && autoIncrement) {
      counters[name] = (counters[name] ?? 0) + 1
      value[keyPath] = counters[name]
    }
    return value[keyPath]
  }
  const clone = (value) => (value === undefined ? undefined : structuredClone(value))
  return {
    durable: false,
    why,
    get: async (name, key) => clone(data[name].get(key)),
    all: async (name) => [...data[name].values()].map(clone),
    put: async (name, value) => {
      const copy = clone(value)
      const key = keyOf(name, copy)
      data[name].set(key, copy)
      return key
    },
    delete: async (name, key) => void data[name].delete(key),
    clear: async (name) => void data[name].clear(),
    appendToolEvent: async (runId, event) => {
      const key = JSON.stringify([runId, event.sequence]); const current = data.toolEvents.get(key)
      if (current && JSON.stringify(current.event) !== JSON.stringify(event)) throw new Error(`Tool evidence ${runId}/${event.sequence} already exists with different content`)
      if (!current) data.toolEvents.set(key, clone({ runId, sequence: event.sequence, event }))
      return event.sequence
    },
    readToolEvents: async (runId, through = Infinity) => [...data.toolEvents.values()].filter(row => row.runId === runId && row.sequence <= through).sort((a, b) => a.sequence - b.sequence).map(row => clone(row.event)),
    deleteRun: async (runId) => { data.runs.delete(runId); for (const [key, row] of data.toolEvents) if (row.runId === runId) data.toolEvents.delete(key) },
    update: async (name, key, change) => {
      const result = change(clone(data[name].get(key)))
      if (result?.value !== undefined) data[name].set(keyOf(name, result.value), clone(result.value))
      else if (result?.delete) data[name].delete(key)
      return result
    },
    move: async (name, from, to, change) => {
      const result = change(clone(data[name].get(from)), clone(data[name].get(to)))
      if (result?.value !== undefined) { data[name].set(keyOf(name, result.value), clone(result.value)); data[name].delete(from) }
      return result
    },
  }
}
