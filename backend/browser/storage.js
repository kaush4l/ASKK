// What a desk run in this tab keeps (2026-10-20 owner: the hosted version runs "a single long running agent" in the
// browser): one key-value store under a prefix — localStorage in a tab, a Map in a test. Values are JSON. Every access
// is guarded: a private window, cleared site data or a full quota gives back nothing and the agent goes on in memory.
//
//   browserStore(prefix?)  → {get(key, fallback), set(key, value) → ok, remove(key), keys(start) → [key], where}
//   memoryStore()          → the same over a Map (tests, a tab without storage)
//
// Keys the browser desk uses (backend/browser/team.js, host.js): model, fs:<path>, practice:<agent>, retros:<agent>,
// runs:<agent>, thread:<agent>, artifact:<id>, kept.

const ls = () => {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function browserStore(prefix = "askk.browser.") {
  const store = ls()
  if (!store) return memoryStore()
  return {
    where: "this browser (localStorage)",
    get(key, fallback = null) {
      try {
        const v = store.getItem(prefix + key)
        return v == null ? fallback : JSON.parse(v)
      } catch {
        return fallback
      }
    },
    set(key, value) {
      try {
        store.setItem(prefix + key, JSON.stringify(value))
        return true
      } catch {
        return false
      }
    },
    remove(key) {
      try {
        store.removeItem(prefix + key)
      } catch {}
    },
    keys(start = "") {
      const out = []
      try {
        for (let i = 0; i < store.length; i++) {
          const k = store.key(i)
          if (k?.startsWith(prefix + start)) out.push(k.slice(prefix.length))
        }
      } catch {}
      return out.sort()
    },
  }
}

export function memoryStore() {
  const map = new Map()
  return {
    where: "memory (gone when the tab closes)",
    get: (key, fallback = null) => (map.has(key) ? structuredClone(map.get(key)) : fallback),
    set: (key, value) => (map.set(key, structuredClone(value)), true),
    remove: (key) => void map.delete(key),
    keys: (start = "") => [...map.keys()].filter((k) => k.startsWith(start)).sort(),
  }
}
