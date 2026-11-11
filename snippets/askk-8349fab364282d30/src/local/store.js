// The browser side of the tab's store (see store.rs): one IndexedDB database, one object
// store, a record per key (key → text). A batch of writes is one transaction: all or nothing.

const DB = "askk";
const KEYS = "keys";
let db = null;

function open() {
  if (!db) {
    db = new Promise((resolve, reject) => {
      const q = indexedDB.open(DB, 1);
      q.onupgradeneeded = () => q.result.createObjectStore(KEYS);
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
    });
  }
  return db;
}

function done(tx, value) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(value ? value() : undefined);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

/// Every key and its text, as JSON text of one object.
export async function load() {
  const tx = (await open()).transaction(KEYS);
  const names = tx.objectStore(KEYS).getAllKeys();
  const texts = tx.objectStore(KEYS).getAll();
  return done(tx, () => JSON.stringify(Object.fromEntries(names.result.map((k, i) => [k, texts.result[i]]))));
}

/// Write `puts` (JSON text of {key: text}) and delete `removes` (JSON text of [key]) together.
export async function write(puts, removes) {
  const tx = (await open()).transaction(KEYS, "readwrite");
  const keys = tx.objectStore(KEYS);
  for (const [k, text] of Object.entries(JSON.parse(puts))) keys.put(text, k);
  for (const k of JSON.parse(removes)) keys.delete(k);
  return done(tx);
}

/// Take this world for this tab, for as long as the tab lives. False: another tab holds it.
export function lock() {
  return new Promise(resolve => {
    navigator.locks.request("askk-store", { ifAvailable: true }, held => {
      resolve(!!held);
      // Never settles: the lock is released only when the tab goes away.
      return held ? new Promise(() => {}) : undefined;
    });
  });
}

/// Ask the browser not to evict this origin's data under storage pressure.
export async function persist() {
  return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false;
}

/// Delete every key, then load the page again (it seeds a fresh world).
export async function reset() {
  const tx = (await open()).transaction(KEYS, "readwrite");
  tx.objectStore(KEYS).clear();
  await done(tx);
  location.reload();
}
