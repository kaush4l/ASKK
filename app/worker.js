/** The worker's entry file — where the environment is assembled.
 *
 * `core/worker-host.js` carries the protocol and refuses to carry this: a core
 * that reached for the ports or for a module loader would stop being testable on
 * the host. So the two arguments `serve` needs are built here, on the one side
 * of the seam that is allowed to know it is in a browser.
 *
 * It is also a build entrypoint of its own, and that is not a preference. Bun
 * does not emit a worker from `new Worker(new URL("./w.js", import.meta.url))` —
 * the string comes out of the bundle byte-identical and the file is never
 * written (measured; PORTING-GUIDE §1.6). So `scripts/build.js` hands this file
 * to the bundler separately, and it lands under the name `WORKER_FILE` says it
 * does. Rename either one alone and every agent is a worker that 404s, which is
 * a page that renders and does nothing — the failure this project has actually
 * shipped before.
 */

import makeMainTools from "../agents/main/tools.js"
import { loadAgent } from "../core/agentfile.js"
import { defaultLaunch } from "../core/schedule.js"
import { agentObserver } from "../core/telemetry.js"
import { serve } from "../core/worker-host.js"
import { browserPorts } from "./ports-browser.js"

const ports = browserPorts()

/** The page's end of the wire — the assembled prompt, every phase entered, and
 * every batch of tool results. It is built here, on the one side of the seam
 * allowed to know it is in a browser, and handed to the engine below: the core
 * never reaches for `self`. */
const observer = agentObserver(self)

/** Report to the page rather than to a console nobody is looking at: a worker's
 * `console.warn` lands somewhere a user of the built page will never see. */
const log = {
  /** @param {string} m */ warning: (m) => post("warning", m),
  /** @param {string} m */ info: (m) => post("info", m),
  /** @param {string} m */ error: (m) => post("error", m),
}

/** @param {string} level @param {string} message */
function post(level, message) {
  self.postMessage({ type: "log", level, message })
}

/** The tool modules that ship *with* the page, already bound to its ports.
 *
 * A browser cannot `import()` a path inside OPFS — there is no URL for one — so
 * the filesystem is where an agent's `tools.js` is *recorded*, never where it is
 * executed. What executes is the copy the bundler put in this file, and it is
 * the same source: `app/seed.js` writes those very bytes down on first boot.
 *
 * This is also the only place a tool module can be handed the environment.
 * `loadTools` asks a module for `TOOLS`, a plain list; the cron tools need
 * `{ cron, fs, launch }` and an agent folder has no way to reach them. So the
 * agent folder exports a factory and this table calls it, here, where the ports
 * already exist. `defaultLaunch` is the launch line for a store with no shell,
 * which is what a page is.
 * @type {Map<string, () => Record<string, any>>} */
const BUNDLED = new Map([
  ["agents/main/tools.js", () => ({ TOOLS: makeMainTools({ cron: ports.cron, fs: ports.fs, launch: defaultLaunch }) })],
])

/** An agent's own tools are an ES module in its folder, which is the browser's
 * counterpart to the Python's `agents/<name>/tools.py`. One that ships with the
 * page comes from `BUNDLED`; anything else is fetched relative to the page,
 * because a module has to be *executed* and the filesystem port only hands back
 * text. A `tools.js` a user drops into OPFS is served by neither, and
 * PORT-MAP §3 records that rather than faking it.
 * @param {string} path @returns {Promise<Record<string, any>>} */
async function loadModule(path) {
  const bundled = BUNDLED.get(path)
  if (bundled) return bundled()
  return await import(/* @vite-ignore */ new URL(path, self.location.href).href)
}

/** The shape `serve` asks for, over the shape `agentfile.js` offers.
 *
 * `Agent` takes its observer at construction, and the construction is inside
 * `loadAgent` — a file this increment does not own and whose deps object has no
 * slot for one. So the observer is set on the engine the moment it exists, and
 * before anything has been asked of it: the first turn is the first thing that
 * can read it. When `loadAgent` grows a deps slot this becomes an option again.
 * @param {string} name @param {string} dir @param {string[]} agentNames */
async function load(name, dir, agentNames) {
  const engine = await loadAgent(name, { ports, log, loadModule, agentsDir: dir, agentNames, env: {} })
  engine.observer = observer
  return engine
}

serve(self, { loadAgent: load, log })
