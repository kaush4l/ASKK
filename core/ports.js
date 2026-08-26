/** Ports — the environment, handed in rather than reached for (PHILOSOPHY S9, PORT-MAP R9).
 *
 * The Python original had a filesystem, a clock and threads for free. In a
 * browser none of those are free, and inventing them inside the core would
 * break the rule that the core is pure. So they arrive at construction, which
 * is the same principle the whole architecture rests on, applied to the
 * environment.
 *
 * This module declares the shape and nothing else. Adapters live beside it:
 * `core/ports/memory-fs.js` (tests), and later the OPFS and Bun ones.
 */

/**
 * A workspace filesystem. Paths are plain strings — `pathlib.Path` does not
 * survive the port, and a path is only ever a key here.
 *
 * @typedef {object} FsPort
 * @property {(path: string) => Promise<string | null>} read
 *   The file's text, or `null` for a miss. A miss is a normal state — a fresh
 *   project has no log and no space.json — so it is a value, never a throw.
 * @property {(path: string, text: string) => Promise<void>} write
 *   Replace the file's contents, creating parent directories.
 * @property {(path: string, text: string) => Promise<void>} append
 *   Add to the end, creating the file and its parents if absent.
 * @property {(path: string, text: string) => Promise<void>} replace
 *   Write the whole file at once, through a temporary beside it and then a
 *   rename. Replacing in place would leave the file truncated if anything
 *   failed mid-write; this way a reader sees the old file or the new one and
 *   never half of either. The log and space.json both depend on it.
 * @property {(path: string) => Promise<string[]>} list
 *   The immediate children, sorted by name, **directories marked with a
 *   trailing `/`**. A missing directory gives `[]`, because no skills is a
 *   normal state for a fresh project rather than an error. The marker exists
 *   because `skills.py` must tell `<name>/SKILL.md` from a bare `<name>.md`
 *   and this contract has no `stat`.
 * @property {(path: string) => Promise<void>} remove
 *   Delete a file, or a directory and everything under it. A missing path is
 *   not an error.
 * @property {(path: string) => Promise<boolean>} exists
 */

/**
 * Right now, and the zone it is expressed in.
 *
 * `zone()` is part of the contract because the prompt's `current time` fact is
 * `%Y-%m-%d %H:%M:%S %Z` — a `Date` alone cannot render `PDT`, and reading the
 * host's zone would be exactly the ambient environment this seam removes. The
 * golden prompts pin `2026-08-16 12:00:00 PDT`, which is only reproducible
 * because the zone arrives with the clock.
 *
 * @typedef {object} ClockPort
 * @property {() => Date} now
 * @property {() => string} zone  IANA name, e.g. `"America/Los_Angeles"`.
 */

/**
 * The transports' only way out. Same signature as the global, so a host or a
 * page can pass the global itself.
 * @typedef {(input: string | URL | Request, init?: RequestInit) => Promise<Response>} FetchPort
 */

/**
 * The subset of `Worker` this port depends on. Bun's `Worker` has extensions
 * browsers do not (`ref`, `unref`, `smol`, `"open"`/`"close"` events); using
 * any of them breaks the browser build, so the contract stops here.
 * @typedef {object} WorkerHandle
 * @property {(message: unknown) => void} postMessage
 * @property {(type: string, listener: (event: any) => void) => void} addEventListener
 * @property {(type: string, listener: (event: any) => void) => void} removeEventListener
 * @property {() => void} terminate
 */

/**
 * The registry's only way to make an agent: one worker per agent, which is the
 * browser's answer to a thread with its own event loop (PORT-MAP R3).
 * @typedef {(specifier: string, options?: { name?: string }) => WorkerHandle} SpawnWorkerPort
 */

/**
 * Run a program and wait for it. Host only — a page has no subprocesses, and
 * its absence is what removes the `claude` inference kind (PORT-MAP R5).
 * @typedef {object} SpawnResult
 * @property {number} code
 * @property {string} stdout
 * @property {string} stderr
 */
/**
 * @typedef {(command: string, args: string[], options?: { stdin?: string, timeout?: number }) => Promise<SpawnResult>} SpawnPort
 */

/**
 * The scheduled-jobs file, whole. `readLines` **throws** when a table exists
 * but cannot be read: the caller must not write in that case, because it would
 * replace jobs it never saw. "No table yet" is `[]`, not a throw (PORT-MAP R8).
 *
 * @typedef {object} CronPort
 * @property {() => Promise<string[]>} readLines
 * @property {(lines: string[]) => Promise<void>} writeLines
 */

/**
 * @typedef {object} Ports
 * @property {FsPort} fs
 * @property {ClockPort} clock
 * @property {FetchPort} fetch
 * @property {SpawnWorkerPort} spawnWorker
 * @property {SpawnPort} [spawn]  absent in the browser, on purpose
 * @property {CronPort} cron
 */

/** Marks a stub from {@link defaultPorts} so a capability check can be honest. */
const NOT_CONFIGURED = Symbol.for("harness.ports.notConfigured");

/**
 * Is this port member a real one, rather than a stub that will throw?
 *
 * Presence is not enough: `defaultPorts().spawn` exists but does nothing, and
 * `if (ports.spawn)` would register the `claude` kind and then fail at the
 * call. Ask this instead.
 *
 * @param {unknown} member
 * @returns {boolean}
 */
export function isConfigured(member) {
  if (member === undefined || member === null) return false;
  return /** @type {any} */ (member)[NOT_CONFIGURED] !== true;
}

/**
 * A function that reports the missing port instead of quietly doing nothing.
 * @param {string} name
 * @returns {(...args: unknown[]) => never}
 */
function missing(name) {
  const stub = () => {
    throw new Error(`no ${name} port configured`);
  };
  return Object.defineProperty(stub, NOT_CONFIGURED, { value: true });
}

/**
 * Ports that all fail loudly. This is the floor every real adapter is layered
 * over: a port nobody wired must announce itself at the call, because a silent
 * no-op filesystem loses a conversation and says nothing about it.
 *
 * @returns {Ports}
 */
export function defaultPorts() {
  return {
    fs: {
      read: missing("fs.read"),
      write: missing("fs.write"),
      append: missing("fs.append"),
      replace: missing("fs.replace"),
      list: missing("fs.list"),
      remove: missing("fs.remove"),
      exists: missing("fs.exists"),
    },
    clock: { now: missing("clock.now"), zone: missing("clock.zone") },
    fetch: missing("fetch"),
    spawnWorker: missing("spawnWorker"),
    spawn: missing("spawn"),
    cron: { readLines: missing("cron.readLines"), writeLines: missing("cron.writeLines") },
  };
}
