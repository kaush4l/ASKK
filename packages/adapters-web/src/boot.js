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

import { CAPABILITIES, DelegateError, ENTRY_AGENT, SEARCH_ENDPOINT, StoreError, WorkspaceError } from '@harness/kernel'
import { adoptSpec, newAgentState } from '@harness/agent'
import { boot } from '@harness/core'

import { fetchRoster, fetchBriefs } from './files.js'
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
  const db = await openDb(DB)
  const kv = idbKv(db)
  const endpoint = makeEndpoint()
  const catalogue = await fetchText(basePath, 'models.json')
  if (!(catalogue instanceof StoreError)) endpoint.setCatalogue(catalogue.text)
  const stored = await kv.get(PROFILE_KEY)
  if (stored !== null) endpoint.loadProfile(stored)
  const net = addressBook(endpoint)
  useBroker({ endpoint, kv, key: PROFILE_KEY, net })
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
  const available = offered(workspace !== null)
  const roster = await fetchRoster(basePath)
  const briefed = await fetchBriefs(basePath)
  const app = await boot({
    ports,
    available,
    segments: idbSegments(db),
    me,
    tools: toolRunners(ports, { keyFor: endpoint.apiKeyFor }),
    agent: adopted(roster, me, available),
    briefs: briefed.briefs,
    roster: { ...roster, refusals: [...roster.refusals, ...briefed.refusals] },
    settings: settingsFace(endpoint, net, { persist: (json) => kv.put(PROFILE_KEY, json) }),
  })
  if (catalogue instanceof StoreError) noCatalogue(app, catalogue, ports.clock.now())
  return app
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
 */
function adopted(roster, me, available) {
  const spec = roster.specs.find((s) => s.name === me)
  if (!spec) return undefined
  return adoptSpec(newAgentState(), spec, { catalogue: CATALOGUE, offered: available, peers: roster.specs }).state
}

/**
 * SAY THAT THIS DEPLOY SHIPPED NO CATALOGUE, as a fact and not as a silence.
 * Without it the only sentence anyone ever sees is the model port's either/or —
 * "no catalogue, or the entry is not in it" — which names neither the address
 * nor the status, and boot succeeds either way (I16).
 * @param {App} app @param {StoreError} failure @param {number} at
 */
function noCatalogue(app, failure, at) {
  app.log.append({ type: 'store_failed', key: failure.key, message: failure.message }, at)
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

/**
 * Delegation, ABSENT AND SAYING SO. One Worker per agent is the next
 * increment; until it exists an empty roster is the honest answer and a
 * delegation names what is missing rather than hanging on a message nobody
 * will read.
 * @returns {import('@harness/kernel').AgentPort}
 */
function noAgents() {
  return {
    roster: () => [],
    async delegate(agent) {
      throw new DelegateError('unknown_agent', `There is no agent called "${agent}" here.`, {
        detail: 'this build runs one agent: delegation needs a Worker per agent and none is started yet',
      })
    },
  }
}

/**
 * The workspace a browser without OPFS has: none, stated. `durable()` is FALSE
 * here and true in the real one, and that difference is the whole of the empty
 * folder note — "nothing has been written here" and "a reload emptied this" are
 * different sentences and only the log plus this flag can tell them apart.
 * @returns {import('@harness/kernel').WorkspacePort}
 */
function noWorkspace() {
  const missing = () => new WorkspaceError('unavailable', 'This browser has no file storage this build can use.', {
    detail: 'the Origin Private File System is absent here, so nothing written would survive the tab',
  })
  return {
    durable: () => false,
    interrupt: () => 'There is nothing running to interrupt.',
    async exec() {
      throw missing()
    },
    async read() {
      throw missing()
    },
    async write() {
      throw missing()
    },
    async list() {
      throw missing()
    },
  }
}
