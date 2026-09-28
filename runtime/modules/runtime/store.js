/**
 * The page's durable state, in IndexedDB. Owned by the hub; no thread opens it.
 *
 *     settings   {key, value}                    catalogue, policy, bridge pairing, ui
 *     sessions   {agent, turns}                  a resident agent's history, saved after every turn
 *     runs       {id, trace, agent, parent, ...}  every run's slot, turns and spans (last 200)
 *     files      {path, content, rev, at}        the browser workspace
 *     memory     {id, agent, text, source, at}   what agents keep between tasks
 *     dreams     {id, agent, text, why, run, status, at}   proposals waiting for the owner
 *     learned    {agent, text, at}               accepted proposals: the LEARNED prompt layer
 *
 * If IndexedDB cannot open (a private window, blocked storage), the same interface runs in
 * memory and `durable` is false, so the page can say that nothing will survive a reload.
 */

const STORES = {
  settings: { keyPath: 'key' },
  sessions: { keyPath: 'agent' },
  runs: { keyPath: 'id' },
  files: { keyPath: 'path' },
  memory: { keyPath: 'id', autoIncrement: true },
  dreams: { keyPath: 'id', autoIncrement: true },
  learned: { keyPath: 'agent' },
}

export async function openStore(name = 'harness') {
  try {
    const db = await new Promise((resolve, reject) => {
      const opening = indexedDB.open(name, 1)
      opening.onupgradeneeded = () => {
        for (const [store, options] of Object.entries(STORES)) {
          if (!opening.result.objectStoreNames.contains(store)) opening.result.createObjectStore(store, options)
        }
      }
      opening.onsuccess = () => resolve(opening.result)
      opening.onerror = () => reject(opening.error)
      opening.onblocked = () => reject(new Error('the database is open in an older tab'))
    })
    return idbStore(db)
  } catch (error) {
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
  return {
    durable: true,
    why: '',
    get: (name, key) => done(store(name).get(key)),
    all: (name) => done(store(name).getAll()),
    put: (name, value) => mutate(name, store => store.put(value)),
    delete: (name, key) => mutate(name, store => store.delete(key)),
    clear: (name) => mutate(name, store => store.clear()),
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
