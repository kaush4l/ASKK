/**
 * THE DRIVING ADAPTER, and the only package in the tree where the browser is
 * allowed to exist. IndexedDB, OPFS, `fetch`, the clock and the randomness all
 * enter here and leave as ports; everything above this speaks the contracts in
 * `@harness/kernel` and knows nothing about a browser (I3).
 * @module
 */

export { bootBrowser, offered, PROFILE_KEY } from './boot.js'
export { adopted, authored, rosterNames } from './adopt.js'
export { browserWorkers, canDelegate, channelTo, startWorker } from './workers.js'
export { attach } from './attach.js'
export { saveEndpoint, saveSearchEndpoint, readEndpoints, resetEndpoints, useBroker } from './settings.js'
export { makeEndpoint } from './endpoint.js'
export { readCatalogue, layer, names, resolve, chatUrl, NO_CATALOGUE } from './catalogue.js'
export { fetchModel, TIMEOUT_SECS } from './model.js'
export { browserClock, browserRng, browserTimer, brokeredNet } from './ports.js'
export { openDb, idbKv, idbBlob, idbStore, prefixRange } from './idb.js'
export { idbSegments } from './segments.js'
export { openWorkspace, opfsWorkspace } from './opfs.js'
export { fetchText } from './assets.js'
export { fetchRoster, fetchBriefs } from './files.js'
export { CATALOGUE, toolRunners } from './toolset.js'
export { LADDER, TAVILY, SEARCH_HOSTS, searchTool } from './search.js'
export { settingsFace } from './face.js'
export { providerError, providerMessage, callFailed, globalFetch } from './wire.js'
export { frames, foldFrame, accumulate, streamed, completion } from './stream.js'

/** @typedef {import('./catalogue.js').Catalogue} Catalogue */
/** @typedef {import('./catalogue.js').Entry} Entry */
/** @typedef {import('./endpoint.js').Endpoint} Endpoint */
/** @typedef {import('./endpoint.js').Patch} Patch */
