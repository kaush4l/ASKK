/**
 * Built-in `web` — fetch a page and search, honest about what a browser can reach.
 *
 * A page can only read a site that answers CORS, and most sites do not (tree B measured 0 of 7).
 * So `web_fetch` tries the browser first and, when the host bridge is paired, falls back to
 * fetching from the owner's machine. Search needs the bridge, because no keyless search engine
 * answers a browser; without it the tool is not offered.
 *
 * Everything fetched is fenced as untrusted: a page is data, never instructions.
 */

const LIMIT = 12000

/** Readable text from HTML: scripts, styles and tags out, entities decoded, whitespace folded. */
export function _text(html) {
  return String(html)
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim()
}

const fence = (url, text) => {
  const cut = text.length > LIMIT ? `${text.slice(0, LIMIT)}\n… (cut at ${LIMIT} characters)` : text
  return `<untrusted source="${url}">\n${cut}\n</untrusted>`
}

export const web_fetch = {
  description: 'Fetch a web page and return its readable text. Uses the host bridge when the site blocks browsers.',
  parameters: { url: 'string' },
  risk: 'net',
  run: async ({ url }, ctx) => {
    try {
      const response = await fetch(url, { signal: ctx.signal })
      const body = await response.text()
      const type = response.headers.get('content-type') ?? ''
      return `HTTP ${response.status}\n${fence(url, type.includes('html') ? _text(body) : body)}`
    } catch (error) {
      if (!ctx.host) {
        return `the browser could not read ${url} (${error.message}); the site probably blocks cross-origin reads. Pairing the host bridge lets it be fetched from the machine.`
      }
      const { status, text } = await ctx.request('host', { endpoint: '/fetch', body: { url } })
      return `HTTP ${status} (via host)\n${fence(url, /<html/i.test(text) ? _text(text) : text)}`
    }
  },
}

export const web_search = {
  description: 'Search the web and return the top results as title, link and snippet.',
  parameters: { query: 'string' },
  requires: ['host'],
  risk: 'net',
  run: async ({ query }, ctx) => {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const { status, text } = await ctx.request('host', { endpoint: '/fetch', body: { url, headers: { 'user-agent': 'Mozilla/5.0 harness' } } })
    if (status !== 200) return `search answered HTTP ${status}`
    const results = []
    const pattern = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
    for (const match of text.matchAll(pattern)) {
      let link = match[1]
      const target = /uddg=([^&]+)/.exec(link)
      if (target) link = decodeURIComponent(target[1])
      results.push(`- ${_text(match[2])}\n  ${link}\n  ${_text(match[3])}`)
      if (results.length === 8) break
    }
    return results.length ? fence(`search: ${query}`, results.join('\n')) : 'no results'
  },
}
