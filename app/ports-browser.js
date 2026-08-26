/** The browser's half of S9 — the ports object a page can actually offer.
 *
 *     const ports = browserPorts()
 *
 * Nothing here is new machinery. Every adapter already exists in `core/ports/`
 * and is tested on the host; this file only decides which one fills each slot
 * when the environment is a tab, and says why the one missing member is
 * missing.
 *
 * `spawn` is absent, and its absence is load-bearing. A page has no
 * subprocesses, so `registerCliKind` is never called, so the `claude` inference
 * kind does not exist here and naming it in models.json is a load-time error
 * that says so (PORT-MAP R5). A stub that throws at the call would register the
 * kind and fail later, which is why `core/ports.js` has `isConfigured` at all —
 * the honest browser answer is to leave the key off the object entirely.
 */

import { cronBrowser } from "../core/ports/cron-browser.js";
import { opfsFs } from "../core/ports/opfs-fs.js";

/**
 * @typedef {import("../core/ports.js").Ports} Ports
 * @typedef {import("../core/ports.js").FsPort} FsPort
 * @typedef {import("../core/ports.js").ClockPort} ClockPort
 * @typedef {import("../core/ports.js").WorkerHandle} WorkerHandle
 * @typedef {ReturnType<typeof cronBrowser>} BrowserCron
 * @typedef {Ports & { cron: BrowserCron }} BrowserPorts
 */

/**
 * The file the worker host lands under in the build output.
 *
 * Measured (PORTING-GUIDE §1.6): `bun build --target=browser` does **not**
 * emit a worker from `new Worker(new URL("./w.js", import.meta.url).href)` —
 * the string comes out byte-identical and the file is never written. So the
 * worker host is a second build entrypoint, and the name the build gives it
 * has to be the name the spawner asks for. That agreement is this constant and
 * only this constant: the build script names it, the spawner resolves it, and
 * neither computes it from the other.
 */
export const WORKER_FILE = "worker.js";

/**
 * Where the worker lands, next to the page that spawned it.
 *
 * Resolved against the document rather than hardcoded so that the same bundle
 * opens from `file://`, from a dev server root, and from the `/ASKK/` subpath
 * the deploy uses, with no build-time substitution in this file.
 * @param {string} [base]
 * @returns {string}
 */
export function workerUrl(base = document.baseURI) {
  return new URL(WORKER_FILE, base).href;
}

/**
 * The real clock, with the zone the prompt's `## CONTEXT` block needs.
 *
 * A `Date` alone cannot render `PDT`, and reading the host's zone inside the
 * core would be exactly the ambient environment the ports seam removes — so it
 * is read once, here, at the edge.
 * @returns {ClockPort}
 */
export function browserClock() {
  return {
    now: () => new Date(),
    zone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

/**
 * One worker per agent — the browser's answer to a thread with its own event
 * loop (PORT-MAP R3). `type: "module"` is not optional here even though Bun
 * tolerates its absence, and nothing off Bun's `Worker` extensions is touched:
 * every one of them breaks in a browser.
 * @param {string} specifier
 * @param {{ name?: string }} [options]
 * @returns {WorkerHandle}
 */
export function spawnWorker(specifier, options = {}) {
  return new Worker(specifier, { type: "module", name: options.name });
}

/**
 * The ports object for a page.
 *
 * @param {object} [options]
 * @param {string} [options.root] a subdirectory of the origin's OPFS store
 * @param {FsPort} [options.fs] a substitute filesystem, for a test page
 * @param {ClockPort} [options.clock]
 * @param {string} [options.schedulePath]
 * @returns {BrowserPorts}
 */
export function browserPorts(options = {}) {
  const fs = options.fs ?? opfsFs({ root: options.root });
  const clock = options.clock ?? browserClock();
  return {
    fs,
    clock,
    // Bound to the global on purpose: an unbound `fetch` throws `Illegal
    // invocation` the moment it is called off a plain object.
    fetch: (input, init) => globalThis.fetch(input, init),
    spawnWorker,
    cron: cronBrowser({ fs, clock, path: options.schedulePath }),
  };
}
