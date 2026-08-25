/**
 * THE AGENT FILES AND THE STAGE BRIEFS, FETCHED.
 *
 * A STATIC HOST CANNOT LIST A DIRECTORY, so `agents/index.json` IS the
 * directory listing and a folder missing from it is a folder the page never
 * asks for. That is a trap worth naming rather than a fact worth hiding: the
 * refusal below says the manifest named an agent whose file did not arrive,
 * which is the only way a person finds out they did step one and not step two.
 *
 * THE FILES ARE FETCHED AND NOT COMPILED IN, because a person may author an
 * agent in this browser and a build-time parse cannot see it — and because an
 * agent file edited and redeployed must reach a running page on a refresh, not
 * on a rebuild.
 * @module
 */

import { StoreError } from '@harness/kernel'
import { BRIEF_KEYS, briefPath, loadAgents, loadBriefs } from '@harness/agent'

import { fetchText } from './assets.js'

/** @typedef {import('@harness/core').Roster} Roster */

/**
 * Every shipped agent, read through the manifest.
 * @param {string} basePath
 * @returns {Promise<Roster>}
 */
export async function fetchRoster(basePath) {
  const manifest = await fetchText(basePath, 'agents/index.json')
  if (manifest instanceof StoreError) return oneRefusal('agents/index.json', manifest.message)
  const names = namesIn(manifest.text)
  if (typeof names === 'string') return oneRefusal('agents/index.json', names)
  /** @type {Array<{path: string, text: string}>} */
  const files = []
  /** @type {import('@harness/agent').Refusal[]} */
  const refusals = []
  for (const name of names) {
    const path = `agents/${name}/agent.md`
    const file = await fetchText(basePath, path)
    if (file instanceof StoreError) refusals.push({ path, key: 'name', message: `${path} is named in agents/index.json and did not arrive: ${file.message}` })
    else files.push({ path, text: file.text })
  }
  const read = loadAgents(files)
  const paths = Object.fromEntries(read.specs.map((spec) => [spec.name, pathFor(files, spec.name)]))
  return { specs: read.specs, refusals: [...refusals, ...read.refusals], paths }
}

/**
 * Every stage brief, or the ONE refusal that says which is missing. A stage
 * entered with no instruction looks exactly like one that ran, so a missing
 * brief is loud at both ends (`stages.js` refuses to resolve it too).
 * @param {string} basePath
 * @returns {Promise<{briefs: Record<string, string>, refusals: import('@harness/agent').Refusal[]}>}
 */
export async function fetchBriefs(basePath) {
  /** @type {Array<{key: string, text: string}>} */
  const files = []
  /** @type {import('@harness/agent').Refusal[]} */
  const refusals = []
  for (const key of BRIEF_KEYS) {
    const file = await fetchText(basePath, `stages/${key}.md`)
    if (file instanceof StoreError) refusals.push({ path: briefPath(key), key, message: file.message })
    else files.push({ key, text: file.text })
  }
  const read = loadBriefs(files)
  if ('refusal' in read) return { briefs: {}, refusals: [...refusals, read.refusal] }
  return { briefs: read.briefs, refusals }
}

/** @param {string} raw @returns {string[]|string} */
function namesIn(raw) {
  /** @type {unknown} */
  let said
  try {
    said = JSON.parse(raw)
  } catch {
    return 'agents/index.json is not readable JSON, so this build has no roster'
  }
  const names = /** @type {{agents?: unknown}} */ (said ?? {}).agents
  if (!Array.isArray(names)) return 'agents/index.json has no `agents` array, so nothing names which folders to fetch'
  return names.filter((n) => typeof n === 'string')
}

/** Which file a spec came from. The specs are sorted by name, so position cannot be used. */
function pathFor(/** @type {Array<{path: string, text: string}>} */ files, /** @type {string} */ name) {
  return files.find((f) => f.path.includes(`/${name}/`))?.path ?? ''
}

/** @param {string} path @param {string} message @returns {Roster} */
function oneRefusal(path, message) {
  return { specs: [], refusals: [{ path, key: '', message }], paths: {} }
}
