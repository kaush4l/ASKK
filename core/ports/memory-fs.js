/** The in-memory filesystem every test runs on, and the frozen clock.
 *
 * Files live in a `Map` keyed by normalized path; directories are implied by
 * the keys, so there is nothing to create. What this adapter is careful about
 * is the one guarantee the core actually leans on — `replace` is atomic — and
 * it makes that guarantee *observable*: a failed replace leaves the old
 * content readable, which is the whole reason the Python wrote through a
 * temporary.
 */

/**
 * @typedef {import("../ports.js").FsPort} FsPort
 * @typedef {import("../ports.js").ClockPort} ClockPort
 */

/**
 * A hook that turns one operation into a failure, so a test can prove what
 * survives it. Return an Error to fail, or null to proceed.
 * @typedef {(op: string, path: string) => (Error | null | undefined)} FaultHook
 */

/**
 * @typedef {object} Store
 * @property {Map<string, string>} files
 * @property {(op: string, path: string) => void} check throws when the fault hook says so
 */

/**
 * Collapse `.` segments and duplicate or trailing slashes, so `a/b`,
 * `./a/b` and `a//b/` are one key.
 * @param {string} path
 * @returns {string}
 */
function normalize(path) {
  const parts = [];
  for (const part of String(path).split("/")) {
    if (part === "" || part === ".") continue;
    parts.push(part);
  }
  return parts.join("/");
}

/**
 * Every key that sits directly or indirectly under `dir`.
 * @param {Store} store @param {string} dir @returns {string[]}
 */
function under(store, dir) {
  if (dir === "") return [...store.files.keys()];
  const prefix = `${dir}/`;
  return [...store.files.keys()].filter((key) => key.startsWith(prefix));
}

/**
 * Write the whole file through a temporary beside it, then swap.
 * @param {Store} store @param {string} key @param {string} text
 */
function replaceIn(store, key, text) {
  const temporary = `${key}.tmp`;
  store.check("write-temp", temporary);
  store.files.set(temporary, text);
  try {
    store.check("rename", key);
  } catch (error) {
    // The temporary is the only casualty: whatever was at `key` is still
    // there, whole, which is the guarantee the caller bought.
    store.files.delete(temporary);
    throw error;
  }
  store.files.set(key, text);
  store.files.delete(temporary);
}

/**
 * The immediate children, directories marked.
 * @param {Store} store @param {string} dir @returns {string[]}
 */
function listIn(store, dir) {
  const prefix = dir === "" ? "" : `${dir}/`;
  /** @type {Map<string, boolean>} */
  const children = new Map();
  for (const key of under(store, dir)) {
    const rest = key.slice(prefix.length);
    const cut = rest.indexOf("/");
    if (cut === -1) children.set(rest, false);
    else children.set(rest.slice(0, cut), true);
  }
  // Sorted on the bare name, then marked: the Python sorted `Path` objects,
  // where `a` precedes `a.md`, and appending the marker first would invert
  // that pair.
  return [...children.keys()].sort().map((name) => (children.get(name) ? `${name}/` : name));
}

/**
 * An in-memory `FsPort`.
 *
 * @param {object} [options]
 * @param {Record<string, string>} [options.files] seed contents, by path
 * @param {FaultHook} [options.fault] fail chosen operations, to test recovery
 * @returns {FsPort & { dump(): Record<string, string> }}
 */
export function memoryFs(options = {}) {
  /** @type {Store} */
  const store = {
    files: new Map(),
    check(op, path) {
      const failure = options.fault?.(op, path);
      if (failure) throw failure;
    },
  };
  for (const [path, text] of Object.entries(options.files ?? {})) {
    store.files.set(normalize(path), text);
  }
  return makeFs(store);
}

/**
 * @param {Store} store
 * @returns {FsPort & { dump(): Record<string, string> }}
 */
function makeFs(store) {
  const at = /** @param {string} op @param {string} path */ (op, path) => {
    const key = normalize(path);
    store.check(op, key);
    return key;
  };
  return {
    async read(path) {
      const key = at("read", path);
      return store.files.has(key) ? /** @type {string} */ (store.files.get(key)) : null;
    },
    async write(path, text) {
      store.files.set(at("write", path), text);
    },
    async append(path, text) {
      const key = at("append", path);
      store.files.set(key, (store.files.get(key) ?? "") + text);
    },
    async replace(path, text) {
      replaceIn(store, normalize(path), text);
    },
    async list(path) {
      return listIn(store, at("list", path));
    },
    async remove(path) {
      const key = at("remove", path);
      store.files.delete(key);
      for (const child of under(store, key)) store.files.delete(child);
    },
    async exists(path) {
      const key = at("exists", path);
      return store.files.has(key) || under(store, key).length > 0;
    },
    /** Everything held, for a test that wants to look. */
    dump() {
      return Object.fromEntries([...store.files.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
    },
  };
}

/**
 * A clock that does not move. Every prompt test needs one: `ContextBlock` is
 * the one component that must never be cached, so a live clock would make the
 * golden prompts uncomparable.
 *
 * It cannot, however, produce the goldens' context block on its own. Those pin
 * `2026-08-16 12:00:00 PDT` beside `day: Saturday`, and 2026-08-16 is a Sunday
 * — the Python fixture hardcoded both strings rather than deriving the
 * weekday, so the pair was never checked against a calendar. Parity tests must
 * pin the two context facts the way `test_core.py` did, not compute them.
 *
 * @param {string} isoString e.g. `"2026-08-16T12:00:00-07:00"`
 * @param {string} [zone] IANA name; Pacific, because that is what the goldens pin
 * @returns {ClockPort}
 */
export function fixedClock(isoString, zone = "America/Los_Angeles") {
  const instant = new Date(isoString);
  if (Number.isNaN(instant.getTime())) {
    throw new Error(`fixedClock: '${isoString}' is not a date`);
  }
  // A fresh Date each call, so a caller cannot mutate the frozen one.
  return { now: () => new Date(instant.getTime()), zone: () => zone };
}
