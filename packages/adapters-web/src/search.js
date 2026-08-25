/**
 * SEARCH THAT ANSWERS ON ARRIVAL, WITH NOTHING CONFIGURED.
 *
 * The predecessor shipped a `web_search` that needed a SearXNG instance typed
 * into Settings, and this project's own memory recorded a default one. Both
 * beliefs were MEASURED FALSE in the ruling: 60 of 76 public instances answer
 * 429 and two emit any `access-control-allow-origin`, and `r.jina.ai` keyless
 * is a hard 401 from consumer residential ISPs — exactly where a browser agent
 * lives. So the shipped default is Firecrawl's keyless `/v2/search`, verified
 * by `scripts-js/check-cors.js` from the real origin: 204 preflight,
 * `access-control-allow-origin: *`, and NO Authorization header.
 *
 * IT IS A LADDER AND NOT A CHOICE. A third party being down must not mean a
 * person's agent cannot look anything up, so a general search that fails falls
 * through to the vertical sources — encyclopedia, forum, papers — each of which
 * answers a different KIND of question and none of which needs a key. The
 * answer says WHICH RUNG replied, because "no results" and "the general index
 * was down and here is what the encyclopedia said" are different facts (I16).
 * @module
 */

import { NetError } from '@harness/kernel'

/** @typedef {import('@harness/kernel').NetPort} NetPort */
/** @typedef {{title: string, url: string, snippet: string}} Hit */
/** @typedef {{name: string, endpoint: string, request: (q: string) => import('@harness/kernel').BrokeredRequest, parse: (body: string) => Hit[]}} Rung */

/** Where each rung lives. The allowlist `bootBrowser` installs is built from exactly this. */
export const SEARCH_HOSTS = /** @type {const} */ ({
  firecrawl: 'https://api.firecrawl.dev',
  wikipedia: 'https://en.wikipedia.org',
  hn: 'https://hn.algolia.com',
  openalex: 'https://api.openalex.org',
  crossref: 'https://api.crossref.org',
  tavily: 'https://api.tavily.com',
})

/** The general index first, then the verticals in the order a person would try them. */
export const LADDER = /** @type {Rung[]} */ ([
  {
    name: 'firecrawl',
    endpoint: 'firecrawl',
    request: (q) => ({ method: 'POST', path: '/v2/search', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: q, limit: 8 }) }),
    parse: (body) => webOf(body).map((r) => hit(r.title, r.url, r.description)),
  },
  {
    name: 'wikipedia',
    endpoint: 'wikipedia',
    // THE REST API AND NOT `w/api.php`. The action API emits no
    // `access-control-allow-origin` at all, measured; the REST one does.
    request: (q) => ({ method: 'GET', path: `/api/rest_v1/page/summary/${encodeURIComponent(q.replace(/\s+/g, '_'))}` }),
    parse: (body) => {
      const said = read(body)
      const title = str(said.title)
      return title === '' ? [] : [hit(title, str(deep(said, ['content_urls', 'desktop', 'page'])), str(said.extract))]
    },
  },
  {
    name: 'hn',
    endpoint: 'hn',
    request: (q) => ({ method: 'GET', path: `/api/v1/search?query=${encodeURIComponent(q)}&hitsPerPage=8` }),
    parse: (body) => list(read(body).hits).map((h) => hit(str(h.title) || str(h.story_title), str(h.url) || `https://news.ycombinator.com/item?id=${str(h.objectID)}`, str(h.story_text))),
  },
  {
    name: 'openalex',
    endpoint: 'openalex',
    request: (q) => ({ method: 'GET', path: `/works?search=${encodeURIComponent(q)}&per-page=6` }),
    parse: (body) => list(read(body).results).map((w) => hit(str(w.display_name), str(w.doi) || str(w.id), `${str(w.publication_year)} · ${str(deep(w, ['primary_location', 'source', 'display_name']))}`)),
  },
  {
    name: 'crossref',
    endpoint: 'crossref',
    request: (q) => ({ method: 'GET', path: `/works?query=${encodeURIComponent(q)}&rows=6` }),
    parse: (body) => list(deep(read(body), ['message', 'items'])).map((w) => hit(list(w.title).map(String)[0] ?? '', str(w.URL), str(w.publisher))),
  },
])

/**
 * THE BYOK RUNG, tried FIRST when a key is present. It is not in `LADDER`
 * because the ladder is what this build offers with nothing configured, and
 * mixing a rung that needs a credential into it would make the keyless promise
 * conditional on reading the list carefully.
 * @type {Rung}
 */
export const TAVILY = {
  name: 'tavily',
  endpoint: 'tavily',
  request: (q) => ({ method: 'POST', path: '/search', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: q, max_results: 8 }) }),
  parse: (body) => list(read(body).results).map((r) => hit(str(r.title), str(r.url), str(r.content))),
}

/**
 * `web_search`, run. The credential is attached HERE, downstream of every grant
 * (I6): the agent names a tool, never an endpoint and never a key.
 * @param {{net: NetPort, keyFor: (entry: string) => string}} wired
 * @returns {(args: string, opts: {signal: AbortSignal}) => Promise<{ok: boolean, output: string}>}
 */
export function searchTool(wired) {
  return async (args, opts) => {
    const query = queryIn(args)
    if (query === '') return { ok: false, output: 'web_search needs a query: web_search({"query": "what you want to know"}).' }
    const key = wired.keyFor(TAVILY.name)
    const rungs = key === '' ? LADDER : [TAVILY, ...LADDER]
    /** @type {string[]} */
    const refused = []
    for (const rung of rungs) {
      const headers = /** @type {Record<string, string>} */ (rung === TAVILY ? { authorization: `Bearer ${key}` } : {})
      const found = await tryRung(wired.net, rung, query, headers, opts.signal)
      if (typeof found === 'string') refused.push(`${rung.name}: ${found}`)
      else if (found.length > 0) return { ok: true, output: rendered(rung.name, query, found, refused) }
      else refused.push(`${rung.name}: nothing matched`)
    }
    return { ok: false, output: `Nothing answered "${query}".\n${refused.join('\n')}` }
  }
}

/** One rung, tried. A string back is the reason it did not answer — never a throw, never an empty. */
async function tryRung(/** @type {NetPort} */ net, /** @type {Rung} */ rung, /** @type {string} */ query, /** @type {Record<string,string>} */ extra, /** @type {AbortSignal} */ signal) {
  try {
    const asked = rung.request(query)
    const response = await net.fetch(rung.endpoint, { ...asked, headers: { ...asked.headers, ...extra } }, { signal })
    if (response.status >= 400) return `answered ${response.status}`
    return rung.parse(response.body)
  } catch (cause) {
    return cause instanceof NetError ? cause.message : String(cause)
  }
}

/** @param {string} source @param {string} query @param {Hit[]} hits @param {string[]} refused */
function rendered(source, query, hits, refused) {
  const preface = refused.length === 0 ? '' : `${refused.join('; ')} — so this is ${source}'s answer instead.\n`
  const lines = hits.map((h, i) => `${i + 1}. ${h.title}${h.url === '' ? '' : ` — ${h.url}`}${h.snippet === '' ? '' : `\n   ${h.snippet}`}`)
  return `${preface}${source} answered "${query}" with ${hits.length === 1 ? '1 result' : `${hits.length} results`}:\n${lines.join('\n')}`
}

/** @param {string} title @param {string} url @param {string} snippet @returns {Hit} */
function hit(title, url, snippet) {
  return { title: title.trim(), url: url.trim(), snippet: snippet.replace(/\s+/g, ' ').trim().slice(0, 300) }
}

/** Firecrawl v2 nests its web results one level down, and answered `{data: []}` before it did. */
function webOf(/** @type {string} */ body) {
  const data = read(body).data
  const web = Array.isArray(data) ? data : deep(data, ['web'])
  return list(web)
}

/**
 * A third party's JSON body, parsed. `any` with the reason: five vendors' shapes
 * cross this line and each field is read through `str`/`list`/`deep`, which is
 * where the narrowing actually happens — typing the parse as `unknown` would put
 * a cast on every one of the twenty reads above and check nothing more.
 * @param {string} body @returns {Record<string, any>}
 */
function read(body) {
  try {
    const value = JSON.parse(body)
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

/** One nested field, or undefined. `any` for the same reason `read` gives. @param {unknown} value @param {string[]} path @returns {any} */
function deep(value, path) {
  return path.reduce((held, key) => (held && typeof held === 'object' ? /** @type {Record<string, unknown>} */ (held)[key] : undefined), value)
}

/** A vendor's array of objects, junk entries dropped. `any` for the same reason `read` gives. @param {unknown} value @returns {Array<Record<string, any>>} */
function list(value) {
  return Array.isArray(value) ? value.filter((v) => v && typeof v === 'object') : []
}

/** @param {unknown} value */
function str(value) {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
}

/** The query out of the call the model wrote. */
function queryIn(/** @type {string} */ args) {
  try {
    const said = /** @type {{query?: unknown}} */ (JSON.parse(args) ?? {})
    return typeof said.query === 'string' ? said.query.trim() : ''
  } catch {
    return ''
  }
}
