/**
 * THE DRIVING ADAPTER, and the only package in the tree where the browser is
 * allowed to exist. IndexedDB, OPFS, `fetch`, the clock and the randomness all
 * enter here and leave as ports; everything above this speaks the contracts in
 * `@harness/kernel` and knows nothing about a browser (I3).
 * @module
 */

// `bootBrowser` IS THE PAGE'S BOOT, and the name is the one docs/SEAM.md froze.
// `boot.js`'s own export of that name takes its delegation as an argument and
// is what a Worker calls; this alias is the page's, with one Worker per agent
// supplied. The two are one module apart on purpose — see `page.js` for the
// cycle that separation avoids.
export { bootPage as bootBrowser } from './page.js'
export { offered, PROFILE_KEY } from './boot.js'
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
