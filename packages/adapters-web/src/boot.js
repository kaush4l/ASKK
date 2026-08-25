/**
 * THE COMPOSITION ROOT: build the real ports, boot the core over the real
 * store, and STATE what this build can actually offer.
 *
 * `available` is filled in HONESTLY or the build does not start. It is the
 * second half of I6 and the correction of the defect this project keeps
 * finding: a capability descriptor that answers on behalf of an adapter nobody
 * has written is how `durable()` came to return `true` while the only shipping
 * implementation returned `false`. So `workspace` is granted only where this
 * browser actually has OPFS, and `agents` only where a Worker can actually be
 * started — a context without one keeps the refusal that names what is missing.
 * @module
 */

import { CAPABILITIES, ENTRY_AGENT, SEARCH_ENDPOINT, StoreError } from '@harness/kernel'
import { agentsOver } from '@harness/agent'
import { boot } from '@harness/core'

import { authored, rosterNames } from './adopt.js'
import { browserWorkers, canDelegate, startWorker } from './workers.js'
import { noAgents, noWorkspace } from './absent.js'
import { toolRunners } from './toolset.js'
import { SEARCH_HOSTS } from './search.js'
import { settingsFace } from './face.js'
import { fetchText } from './assets.js'
import { makeEndpoint } from './endpoint.js'
import { idbKv, idbStore, openDb } from './idb.js'
import { fetchModel } from './model.js'
import { browserClock, browserRng, brokeredNet } from './ports.js'
import { openWorkspace } from './opfs.js'
import { idbSegments } from './segments.js'
import { useBroker } from './settings.js'

/** @typedef {import('@harness/kernel').CapabilityId} CapabilityId */
/** @typedef {import('@harness/core').App} App */

/** This origin's two databases: one agent's own history, and the space every agent shares. */
const DB = 'harness'
const SPACES_DB = 'harness-spaces'

/** Where the endpoint profile — the pick, the overrides, the keys — is kept. */
export const PROFILE_KEY = 'config/keys/model'

/**
 * Build the running application for THIS browser.
 * @param {{basePath?: string, agent?: string}} [opts]
 * @returns {Promise<App>}
 */
export async function bootBrowser(opts = {}) {
  const basePath = opts.basePath ?? './'
  const me = opts.agent ?? ENTRY_AGENT
  // The settings face is built as an argument to `boot`, and its failures are
  // appended to the log `boot` returns. Nothing can fail before that line runs.
  /** @type {App|null} */
  let built = null
  const db = await openDb(DB)
  const kv = idbKv(db)
  const endpoint = makeEndpoint()
  const catalogue = await fetchText(basePath, 'models.json')
  if (!(catalogue instanceof StoreError)) endpoint.setCatalogue(catalogue.text)
  const stored = await kv.get(PROFILE_KEY)
  if (stored !== null) endpoint.loadProfile(stored)
  const net = addressBook(endpoint)
  useBroker({ endpoint, kv, key: PROFILE_KEY, net })
  const { ports, available } = await realPorts(db, endpoint, net, {
    me,
    roster: () => rosterNames(built),
    spawn: (agent) => startWorker(agent, basePath),
  })
  const app = await boot({
    ports,
    available,
    segments: idbSegments(db),
    me,
    tools: toolRunners(ports, { keyFor: endpoint.apiKeyFor }),
    ...await authored(basePath, me, available, endpoint),
    settings: settingsFace(endpoint, net, {
      persist: (json) => kv.put(PROFILE_KEY, json),
      onFailure: (message) => storeFailed(built, PROFILE_KEY, message, ports.clock.now()),
    }),
  })
  built = app
  if (catalogue instanceof StoreError) storeFailed(app, catalogue.key, catalogue.message, ports.clock.now())
  return app
}

/**
 * EVERY PORT THIS BROWSER ACTUALLY HAS, and the capability list that follows
 * FROM them rather than beside them. The two are returned together because the
 * one thing that must never drift apart is what a port can do and what the
 * build claims it can (I6): `workspace` is granted here only where OPFS
 * answered.
 * @param {IDBDatabase} db @param {ReturnType<typeof makeEndpoint>} endpoint
 * @param {ReturnType<typeof addressBook>} net
 * @param {Parameters<typeof browserWorkers>[0]} delegation
 */
async function realPorts(db, endpoint, net, delegation) {
  const workspace = await openWorkspace()
  // ONE WORKER PER AGENT, WHERE A WORKER CAN BE STARTED AT ALL. Where one
  // cannot, the honest refusal stays: an empty roster and a delegation that
  // names what is missing beats a port that hangs on a message nobody reads.
  const workers = canDelegate() ? browserWorkers(delegation) : null
  const ports = {
    clock: browserClock(),
    rng: browserRng(),
    store: idbStore(db),
    model: fetchModel(endpoint),
    net: net.port,
    agents: workers ? agentsOver(workers) : noAgents(),
    workspace: workspace ?? noWorkspace(),
    spaces: idbKv(await openDb(SPACES_DB)),
  }
  return { ports, available: offered(workspace !== null, workers !== null) }
}

/**
 * EVERYWHERE THIS BUILD MAY REACH, before anybody configures anything. The
 * ladder's keyless hosts are the shipped address book — verified callable from
 * the real origin by `scripts-js/check-cors.js` — and `search` stays the one
 * name a person can point somewhere else, absent from the list until they do.
 * @param {ReturnType<typeof makeEndpoint>} endpoint
 */
function addressBook(endpoint) {
  const net = brokeredNet()
  for (const [name, url] of Object.entries(SEARCH_HOSTS)) net.allow(name, url)
  net.allow(SEARCH_ENDPOINT, endpoint.search())
  return net
}

/**
 * SAY THAT A WRITE DID NOT LAND, as a fact and not as a silence — the deploy
 * that shipped no catalogue, and the profile save a full IndexedDB refused.
 * Without it the only sentence anyone ever sees is the model port's either/or —
 * "no catalogue, or the entry is not in it" — which names neither the address
 * nor the status, and boot succeeds either way (I16). The Setup pane's status
 * line already renders `store_failed`; this is what puts one there.
 * @param {App|null} app @param {string} key @param {string} message @param {number} at
 */
function storeFailed(app, key, message, at) {
  app?.log.append({ type: 'store_failed', key, message }, at)
}

/**
 * What this build offers, as a list rather than as a default. A capability
 * missing from it says so when it is reached for, and every one that is on it
 * has an adapter behind it that answered.
 * @param {boolean} files whether this browser gave us a real workspace
 * @param {boolean} delegates whether this context can start a Worker
 * @returns {CapabilityId[]}
 */
export function offered(files, delegates) {
  const withheld = [...(files ? [] : ['workspace']), ...(delegates ? [] : ['agents'])]
  return CAPABILITIES.filter((id) => !withheld.includes(id))
}
