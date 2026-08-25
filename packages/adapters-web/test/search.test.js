/**
 * SEARCH ANSWERS WITH NOTHING CONFIGURED, and says which rung answered.
 *
 * The host cannot reach Firecrawl and must not try: `scripts-js/check-cors.js`
 * is where the third party is measured, on purpose and outside the gate, so a
 * vendor being down never blocks a deploy of unrelated work (I17). What is
 * executable here is everything else — that no configuration is consulted, that
 * a dead rung falls through rather than failing the call, and that a person is
 * told which source their answer came from.
 */
import { describe, expect, test } from 'bun:test'
import { NetError } from '@harness/kernel'

import { LADDER, SEARCH_HOSTS, TAVILY, searchTool } from '../src/search.js'
import { brokeredNet } from '../src/ports.js'

const FIRECRAWL = JSON.stringify({ success: true, data: { web: [{ title: 'Firecrawl search', url: 'https://firecrawl.dev/search', description: 'the keyless one' }] } })
const WIKI = JSON.stringify({ title: 'Agent', extract: 'An agent acts.', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Agent' } } })

/** A net that answers only the endpoints named, and refuses the rest the way the broker does. */
function net(/** @type {Record<string, {status: number, body: string}>} */ answers) {
  /** @type {Array<{endpoint: string, headers: Record<string, string>}>} */
  const asked = []
  return {
    asked,
    port: /** @type {import('@harness/kernel').NetPort} */ ({
      async fetch(endpoint, request) {
        asked.push({ endpoint, headers: request.headers ?? {} })
        const hit = answers[endpoint]
        if (!hit) throw new NetError('not_allowed', `nothing answers "${endpoint}" here`)
        return hit
      },
    }),
  }
}

const NO_KEY = { keyFor: () => '' }
const signal = { signal: new AbortController().signal }

describe('the shipped ladder', () => {
  test('answers a query with no key, no setting and no endpoint typed anywhere', async () => {
    const wired = net({ firecrawl: { status: 200, body: FIRECRAWL } })
    const run = searchTool({ net: wired.port, ...NO_KEY })
    const answer = await run('{"query":"does firecrawl need a key"}', signal)

    expect(answer.ok).toBe(true)
    expect(answer.output).toContain('firecrawl answered')
    expect(answer.output).toContain('https://firecrawl.dev/search')
    // NOTHING WAS CONSULTED. The only endpoint touched is the shipped default.
    expect(wired.asked.map((a) => a.endpoint)).toEqual(['firecrawl'])
  })

  test('falls through to the next rung when the general index is down, and says it did', async () => {
    const wired = net({ firecrawl: { status: 503, body: '' }, wikipedia: { status: 200, body: WIKI } })
    const run = searchTool({ net: wired.port, ...NO_KEY })
    const answer = await run('{"query":"Agent"}', signal)

    expect(answer.ok).toBe(true)
    expect(answer.output).toContain('firecrawl: answered 503')
    expect(answer.output).toContain("wikipedia's answer instead")
    expect(answer.output).toContain('An agent acts.')
  })

  test('a query nothing answers names every rung that was tried and what each said', async () => {
    const wired = net({})
    const run = searchTool({ net: wired.port, ...NO_KEY })
    const answer = await run('{"query":"nothing"}', signal)

    expect(answer.ok).toBe(false)
    for (const rung of LADDER) expect(answer.output).toContain(rung.name)
    expect(wired.asked).toHaveLength(LADDER.length)
  })

  test('a key promotes Tavily to the first rung, and the key never leaves this file', async () => {
    const wired = net({ tavily: { status: 200, body: JSON.stringify({ results: [{ title: 'T', url: 'https://t', content: 'c' }] }) } })
    const run = searchTool({ net: wired.port, keyFor: (entry) => (entry === TAVILY.name ? 'tvly-secret' : '') })
    const answer = await run('{"query":"anything"}', signal)

    expect(answer.ok).toBe(true)
    expect(wired.asked[0]?.endpoint).toBe('tavily')
    // ATTACHED DOWNSTREAM OF THE GRANT, on that one request and no other.
    expect(wired.asked[0]?.headers.authorization).toBe('Bearer tvly-secret')
  })

  test('a call with no query is a result the model can act on, not a thrown error', async () => {
    const run = searchTool({ net: net({}).port, ...NO_KEY })
    const answer = await run('{}', signal)
    expect(answer.ok).toBe(false)
    expect(answer.output).toContain('web_search({"query"')
  })
})

describe('the broker the ladder goes through', () => {
  test('carries a POST body now, because the shipped default puts the query in one', async () => {
    /** @type {RequestInit|undefined} */
    let sent
    const broker = brokeredNet({
      fetch: /** @type {typeof fetch} */ (async (/** @type {string} */ _url, /** @type {RequestInit} */ init) => {
        sent = init
        return new Response('{}', { status: 200 })
      }),
    })
    broker.allow('firecrawl', SEARCH_HOSTS.firecrawl)
    await broker.port.fetch('firecrawl', { method: 'POST', path: '/v2/search', body: '{"query":"x"}' })
    expect(sent?.body).toBe('{"query":"x"}')
  })

  test('still refuses a body on a GET, because fetch would drop it in silence', async () => {
    const broker = brokeredNet()
    broker.allow('hn', SEARCH_HOSTS.hn)
    const refused = await broker.port.fetch('hn', { method: 'GET', path: '/api/v1/search', body: 'x' }).catch((/** @type {Error} */ e) => e)
    expect(refused).toBeInstanceOf(NetError)
  })

  test('a name that is not on the list cannot be reached at all', async () => {
    const broker = brokeredNet()
    const refused = await broker.port.fetch('firecrawl', { method: 'POST', path: '/v2/search' }).catch((/** @type {Error} */ e) => e)
    expect(String(refused)).toContain('firecrawl')
  })
})
