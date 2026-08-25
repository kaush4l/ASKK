/**
 * THE COMPOSITION ROOT: build the real ports, boot the core over the real
 * store, and STATE what this build can actually offer.
 *
 * `available` is filled in HONESTLY or the build does not start. It is the
 * second half of I6 and the correction of the defect this project keeps
 * finding: a capability descriptor that answers on behalf of an adapter nobody
 * has written is how `durable()` came to return `true` while the only shipping
 * implementation returned `false`. So `workspace` is granted only where this
 * browser actually has OPFS, and `agents` is granted NOWHERE yet — delegation
 * is one Worker per agent and no Worker exists in this build, so no module is
 * told it may delegate.
 * @module
 */

import { CAPABILITIES, ENTRY_AGENT, SEARCH_ENDPOINT, StoreError } from '@harness/kernel'
import { adoptSpec, newAgentState } from '@harness/agent'
import { boot } from '@harness/core'

import { noAgents, noWorkspace } from './absent.js'
import { fetchRoster, fetchBriefs, fetchSkills } from './files.js'
import { CATALOGUE, toolRunners } from './toolset.js'
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
  const { ports, available } = await realPorts(db, endpoint, net)
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
 * EVERYTHING THIS BUILD READ OFF DISK: the agent files, the stage briefs and
 * the skills. All three are FETCHED and not compiled in, because a person may
 * author one in this browser and because a file edited and redeployed must
 * reach a running page on a refresh rather than on a rebuild.
 *
 * A skill that would not load is a refusal beside the agent files, because it
 * is the same failure — the manifest named a folder and the folder did not
 * answer — and the roster pane is where a person meets both.
 * @param {string} basePath @param {string} me
 * @param {import('@harness/kernel').CapabilityId[]} available
 * @param {ReturnType<typeof makeEndpoint>} endpoint
 */
async function authored(basePath, me, available, endpoint) {
  const roster = await fetchRoster(basePath)
  const briefed = await fetchBriefs(basePath)
  const skilled = await fetchSkills(basePath)
  return {
    agent: adopted(roster, me, available, endpoint),
    briefs: briefed.briefs,
    skills: skilled.skills,
    roster: { ...roster, refusals: [...roster.refusals, ...briefed.refusals, ...skilled.refusals] },
  }
}

/**
 * EVERY PORT THIS BROWSER ACTUALLY HAS, and the capability list that follows
 * FROM them rather than beside them. The two are returned together because the
 * one thing that must never drift apart is what a port can do and what the
 * build claims it can (I6): `workspace` is granted here only where OPFS
 * answered.
 * @param {IDBDatabase} db @param {ReturnType<typeof makeEndpoint>} endpoint
 * @param {ReturnType<typeof addressBook>} net
 */
async function realPorts(db, endpoint, net) {
  const workspace = await openWorkspace()
  const ports = {
    clock: browserClock(),
    rng: browserRng(),
    store: idbStore(db),
    model: fetchModel(endpoint),
    net: net.port,
    agents: noAgents(),
    workspace: workspace ?? noWorkspace(),
    spaces: idbKv(await openDb(SPACES_DB)),
  }
  return { ports, available: offered(workspace !== null) }
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
 * THE ENTRY AGENT, BUILT FROM ITS OWN FILE. A state adopted from no file is the
 * defect this replaces: the predecessor hardcoded `main`, so an agent file a
 * person edited changed the prompt and nothing else. `undefined` when the file
 * did not load — `createApp` then starts a blank agent, and the roster pane says
 * by name which file was missing rather than the page looking merely empty.
 * @param {import('@harness/core').Roster} roster @param {string} me
 * @param {import('@harness/kernel').CapabilityId[]} available
 * @param {ReturnType<typeof makeEndpoint>} endpoint
 */
function adopted(roster, me, available, endpoint) {
  const spec = roster.specs.find((s) => s.name === me)
  if (!spec) return undefined
  const env = { catalogue: CATALOGUE, offered: available, peers: roster.specs, card: endpoint.card(spec.model) }
  return adoptSpec(newAgentState(), spec, env).state
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
 * What this build offers, as a list rather than as a default. Two capabilities
 * are missing from it on purpose and each says so when it is reached for.
 * @param {boolean} files whether this browser gave us a real workspace
 * @returns {CapabilityId[]}
 */
export function offered(files) {
  const withheld = files ? ['agents'] : ['agents', 'workspace']
  return CAPABILITIES.filter((id) => !withheld.includes(id))
}
