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
import { boot } from '@harness/core'

import { authored, rosterNames } from './adopt.js'
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

/**
 * HOW THIS CONTEXT DELEGATES, INJECTED — and the injection is what keeps the
 * module graph acyclic. `workers.js` names `./agent-entry.js` in a `new URL`,
 * and that module boots an application: if the composition root reached
 * `workers.js` directly, the Worker's own graph would contain the spawner that
 * names it. `next build` did not fail on that cycle, it HUNG — measured going
 * from ten seconds to over six minutes with no output, which is the worst way
 * for a cycle to announce itself. `null` is a context that cannot delegate, and
 * a sub-agent is one BY CONSTRUCTION rather than by a list somebody maintains.
 * @typedef {(what: {me: string, basePath: string, roster: () => string[]})
 *   => Promise<import('@harness/kernel').AgentPort|null>} Delegation
 */

/** The delegation a context has when nobody gave it one. */
const noDelegation = async () => null

/** @typedef {import('@harness/kernel').CapabilityId} CapabilityId */
/** @typedef {import('@harness/core').App} App */

/** This origin's two databases: one agent's own history, and the space every agent shares. */
const DB = 'harness'
const SPACES_DB = 'harness-spaces'

/** Where the endpoint profile — the pick, the overrides, the keys — is kept. */
export const PROFILE_KEY = 'config/keys/model'

/**
 * Build the running application for THIS browser.
 *
 * `delegates` IS WHY A SUB-AGENT DOES NOT CALL THIS, and the reason is a
 * bundler's rather than a designer's — though the design agrees. `workers.js`
 * names `./agent-entry.js` in a `new URL`, and that module booted the page's
 * own composition root, which imports `workers.js`: a cycle the graph could not
 * close. `next build` did not fail on it, it HUNG — measured going from ten
 * seconds to over six minutes with no output, which is the worst way for a
 * cycle to announce itself. So the Worker entry composes the ports it needs
 * (`workerPorts`, below) and never reaches this function, and a sub-agent in
 * this build cannot delegate further — which was already true and is now true
 * BY CONSTRUCTION rather than by a capability list somebody has to maintain.
 * @param {{basePath?: string, agent?: string, delegation?: Delegation}} [opts]
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
  const agents = await (opts.delegation ?? noDelegation)({ me, basePath, roster: () => rosterNames(built) })
  const { ports, available } = await realPorts(db, endpoint, net, agents)
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
 * @param {import('@harness/kernel').AgentPort|null} agents the delegation this
 *   context was given, or `null` where it has none
 */
async function realPorts(db, endpoint, net, agents) {
  const workspace = await openWorkspace()
  const ports = {
    clock: browserClock(),
    rng: browserRng(),
    store: idbStore(db),
    model: fetchModel(endpoint),
    net: net.port,
    agents: agents ?? noAgents(),
    workspace: workspace ?? noWorkspace(),
    spaces: idbKv(await openDb(SPACES_DB)),
  }
  return { ports, available: offered(workspace !== null, agents !== null) }
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
