/**
 * BOOT: the App, assembled. Replay the log through its registered projections,
 * install the modules through the one install path, and hand back something a
 * seam request can be served from.
 *
 * IT TAKES THE PORTS AND DOES NOT BUILD THEM. A composition root decides what
 * this build can actually do — which store, which model endpoint, whether there
 * is a workspace at all — and boot's job is to refuse to invent any of it. The
 * capability list is the second half of that (I6): a build states what it
 * offers or it does not start.
 *
 * THE BUILT-INS GO IN THROUGH `install`, the same door an authored module takes
 * (I9), and each install is a fact. That is two facts per boot and not one per
 * fact of history: the registry cannot ride in the log because a handler is a
 * function, so the fold is memory-only and boot re-registers.
 * @module
 */

import { ENTRY_AGENT } from '@harness/kernel'
import { loadAgents } from '@harness/agent'

import { AUTHORED } from './agents.js'
import { agents, agentsManifest } from './agents.js'
import { board, boardManifest } from './board.js'
import { chat, chatManifest } from './chat.js'
import { createApp, install } from './app.js'
import { dashboard, dashboardManifest } from './dashboard.js'
import { debug, debugManifest } from './debug.js'
import { files, filesManifest } from './files.js'
import { bootLog, freshLog } from './log/index.js'
import { processes, processesManifest } from './processes.js'
import { projections } from './reducers.js'
import { ARTIFACT_TOOLS, artifactTools } from './shelf.js'
import { localTools } from './locals.js'
import { skillTools } from './skills.js'
import { settings, settingsManifest } from './settings.js'
import { space, spaceManifest } from './space.js'
import { terminal, terminalManifest } from './terminal.js'
import { tools, toolsManifest } from './tools.js'

/** @typedef {import('@harness/kernel').CapabilityId} CapabilityId */
/** @typedef {import('@harness/kernel').Ports} Ports */
/** @typedef {import('./app.js').App} App */
/** @typedef {import('./app.js').ToolRun} ToolRun */
/** @typedef {import('./log/index.js').SegmentStore} SegmentStore */

/** Every module this build serves, with the logic each route reaches. */
const MODULES = [
  { manifest: dashboardManifest, handler: dashboard },
  { manifest: chatManifest, handler: chat },
  { manifest: boardManifest, handler: board },
  { manifest: agentsManifest, handler: agents },
  { manifest: toolsManifest, handler: tools },
  { manifest: spaceManifest, handler: space },
  { manifest: filesManifest, handler: files },
  { manifest: terminalManifest, handler: terminal },
  { manifest: processesManifest, handler: processes },
  { manifest: debugManifest, handler: debug },
  { manifest: settingsManifest, handler: settings },
]

/**
 * @typedef {{
 *   ports: Ports,
 *   available: CapabilityId[],
 *   segments: SegmentStore,
 *   me?: string,
 *   tools?: Record<string, ToolRun>,
 *   agent?: import('@harness/agent').AgentState,
 *   roster?: import('./app.js').Roster,
 *   briefs?: Record<string, string>,
 *   settings?: import('./app.js').SettingsFace,
 *   skills?: readonly import('./skills.js').Skill[],
 * }} Assembly
 */

/**
 * Read the history back and put the modules on it. Two range reads however long
 * the history is (I20) — `bootLog` owns that, and this owns what is registered
 * before the first fact is folded.
 * @param {Assembly} parts @returns {Promise<App>}
 */
export async function boot(parts) {
  const me = parts.me ?? ENTRY_AGENT
  const log = await bootLog(parts.segments, { clock: parts.ports.clock, reducers: projections(me), stream: me })
  return installed(createApp(parts.ports, parts.available, assembled(parts, log, me)), parts)
}

/**
 * The same App with nothing behind it — a first run, or a test that does not
 * care what happened yesterday. Separate from `boot` rather than a flag on it,
 * because "there is no history" and "the history is empty" are the same App and
 * two different claims about the store.
 * @param {Assembly} parts @returns {App}
 */
export function bootFresh(parts) {
  const me = parts.me ?? ENTRY_AGENT
  const log = freshLog(parts.segments, { clock: parts.ports.clock, reducers: projections(me), stream: me })
  return installed(createApp(parts.ports, parts.available, assembled(parts, log, me)), parts)
}

/**
 * WHAT THE APP IS BUILT FROM, once, for both doors.
 *
 * The briefs are SPREAD ONTO THE STATE here rather than adopted by a function
 * of their own: a wrapper whose whole body was one property assignment is the
 * ceremony this rewrite exists to remove, and the state is already being built
 * on this line.
 *
 * An agent AUTHORED IN THIS BROWSER is in the log, so the roster the pane reads
 * is the shipped files plus what replay found — which is what makes an agent a
 * person wrote survive a refresh without a second store beside the log.
 * @param {Assembly} parts @param {import('./log/index.js').Log} log @param {string} me
 */
function assembled(parts, log, me) {
  const shipped = parts.roster ?? { specs: [], refusals: [], paths: {} }
  const state = parts.agent
  return {
    log,
    me,
    // THE DOOR OUT OF THE SHELF IS ALWAYS OPEN. `read_result` is core's
    // because the thing that shelved the bytes has to be the thing that can
    // produce them again — a build could otherwise ship the spill without the
    // way back, and a receipt naming a handle nothing answers is worse than a
    // long result. A composition root may still override it by name.
    tools: { ...artifactTools(parts.ports), ...parts.tools },
    agent: state ? withShelfDoor(state, parts.briefs) : state,
    roster: withAuthored(shipped, log),
    settings: parts.settings,
  }
}

/**
 * BOTH HALVES OF THAT DOOR, OPEN TOGETHER. The runner above is installed
 * whatever the agent file said, so the DESCRIPTOR has to be installed too —
 * otherwise a `tools:` list, which is the whole allowlist, can shut a door the
 * receipt has already promised the model, and what it may call and what it is
 * told it may call stop being the same set (I13). The shipped `main` does
 * exactly that today, which is why this is code and not a paragraph (I17).
 * @param {import('@harness/agent').AgentState} state @param {Record<string,string>} [briefs]
 * @returns {import('@harness/agent').AgentState}
 */
function withShelfDoor(state, briefs) {
  const named = new Set(state.toolbox.map((t) => t.name))
  const toolbox = [...state.toolbox, ...ARTIFACT_TOOLS.filter((t) => !named.has(t.name))]
  return briefs ? { ...state, briefs, toolbox } : { ...state, toolbox }
}

/** @param {import('./app.js').Roster} shipped @param {import('./log/index.js').Log} log */
function withAuthored(shipped, log) {
  const authored = /** @type {Array<{name: string, path: string, text: string}>} */ (log.read(AUTHORED))
  if (authored.length === 0) return shipped
  // The authored files are re-read rather than trusted: a file that parsed when
  // it was written may not parse against a build that has since changed what a
  // key means, and a refusal beside the roster is how a person finds out.
  const read = loadAgents(authored)
  const paths = { ...shipped.paths }
  for (const one of authored) paths[one.name] = one.path
  const byName = new Map(shipped.specs.map((s) => [s.name, s]))
  for (const spec of read.specs) byName.set(spec.name, spec)
  return { specs: [...byName.values()], refusals: [...shipped.refusals, ...read.refusals], paths }
}

/**
 * The modules on the registry, and the runners that need the APP ITSELF behind
 * them. `localTools` closes over the App because the roster it reads changes
 * during a session — an agent authored in this browser installs at the turn
 * boundary — and a snapshot taken here would report a fleet one write out of
 * date. A composition root's own runner still wins: it named the tool last.
 * @param {App} app @param {Assembly} parts @returns {App}
 */
function installed(app, parts) {
  for (const module of MODULES) install(app, module.manifest, module.handler)
  app.tools = { ...localTools(app), ...skillTools(parts.skills ?? []), ...app.tools }
  return app
}
