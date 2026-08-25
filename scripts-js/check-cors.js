#!/usr/bin/env bun
/**
 * I17 applied to a third party. Every wrong answer about CORS is invisible from
 * documentation and obvious from one preflight: a vendor's docs can show a
 * `fetch` example while its `OPTIONS` returns 405, and another can imply CORS
 * while its preflight carries no `access-control-allow-origin` at all.
 *
 * A page served from the web can only call an endpoint that answers a preflight
 * from our origin. This probe asks each candidate directly and prints what came
 * back. It is NOT in `bun run gate`: a third party being down must never block a
 * deploy of unrelated work. Run it when the search story changes, and paste the
 * table into the ruling.
 *
 *   bun scripts-js/check-cors.js [origin]
 */

// `export {}` and nothing else: top-level await needs this file to be a module,
// and the probe deliberately exports no function — it is a thing you RUN and
// read, not a thing another script can quietly depend on.
export {}

const ORIGIN = process.argv[2] ?? 'https://kaush4l.github.io'

/** @type {Array<{name: string, url: string, method: string, headers: string[]}>} */
const CANDIDATES = [
  { name: 'firecrawl search (keyless)', url: 'https://api.firecrawl.dev/v2/search', method: 'POST', headers: ['content-type'] },
  { name: 'firecrawl scrape (keyless)', url: 'https://api.firecrawl.dev/v2/scrape', method: 'POST', headers: ['content-type'] },
  { name: 'wikipedia REST', url: 'https://en.wikipedia.org/api/rest_v1/page/summary/Agent', method: 'GET', headers: [] },
  { name: 'wikimedia search', url: 'https://en.wikipedia.org/w/api.php', method: 'GET', headers: [] },
  { name: 'hn algolia', url: 'https://hn.algolia.com/api/v1/search', method: 'GET', headers: [] },
  { name: 'openalex', url: 'https://api.openalex.org/works', method: 'GET', headers: [] },
  { name: 'crossref', url: 'https://api.crossref.org/works', method: 'GET', headers: [] },
  { name: 'tavily (BYOK)', url: 'https://api.tavily.com/search', method: 'POST', headers: ['content-type', 'authorization'] },
  { name: 'jina reader (keyless)', url: 'https://r.jina.ai/https://example.com', method: 'GET', headers: [] },
  { name: 'openrouter', url: 'https://openrouter.ai/api/v1/chat/completions', method: 'POST', headers: ['content-type', 'authorization'] },
]

/** What one candidate's preflight actually says. */
async function probe(/** @type {typeof CANDIDATES[number]} */ c) {
  /** @type {Record<string, string>} */
  const headers = { origin: ORIGIN, 'access-control-request-method': c.method }
  if (c.headers.length) headers['access-control-request-headers'] = c.headers.join(',')
  try {
    const res = await fetch(c.url, { method: 'OPTIONS', headers, signal: AbortSignal.timeout(12_000) })
    const allow = res.headers.get('access-control-allow-origin')
    const allowHeaders = res.headers.get('access-control-allow-headers') ?? ''
    const wanted = c.headers.every((h) => allowHeaders.toLowerCase().includes(h) || allowHeaders === '*')
    return {
      status: String(res.status),
      allow: allow ?? '—',
      usable: Boolean(allow) && (allow === '*' || allow === ORIGIN) && wanted,
    }
  } catch (err) {
    return { status: 'ERR', allow: err instanceof Error ? err.message.slice(0, 40) : '?', usable: false }
  }
}

const rows = await Promise.all(CANDIDATES.map(async (c) => ({ name: c.name, ...(await probe(c)) })))

const pad = (/** @type {string} */ s, /** @type {number} */ n) => s.padEnd(n).slice(0, n)
console.log(`preflight from ${ORIGIN}\n`)
console.log(pad('endpoint', 28), pad('status', 7), pad('allow-origin', 26), 'browser-callable')
for (const r of rows) {
  console.log(pad(r.name, 28), pad(r.status, 7), pad(r.allow, 26), r.usable ? 'YES' : 'no')
}
const usable = rows.filter((r) => r.usable).map((r) => r.name)
console.log(`\n${usable.length} of ${rows.length} answer a preflight from this origin: ${usable.join(', ') || 'none'}`)
