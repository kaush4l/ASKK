import { Outcome } from '../Outcome.js'
import { NO_HTTP } from './HttpPort.js'
import { Tool } from './Tool.js'

/**
 * The one keyless web-search endpoint that survived the probe.
 *
 * Chosen by measurement, not preference. Every alternative was tried from the
 * command line with an `Origin` header on 2026-09-01 and the full header blocks
 * are in `docs/CORS-PROBE.md`. The short version: DuckDuckGo's html and lite
 * endpoints answer 403, Mojeek answers 403, Qwant answers a captcha, Brave
 * requires a subscription token, public SearXNG instances answer 429 or HTML,
 * and `r.jina.ai` answers 401 to an anonymous consumer ISP. This one answers
 * 200 with `access-control-allow-origin: *` and no Authorization header, and
 * its POST preflight answers 204 with `access-control-allow-headers:
 * content-type`, so a browser may both send and read it.
 *
 * A default in `core/` rather than a setting because it is data, not a
 * capability — the same way an inference base URL is — and because a search
 * tool whose endpoint must be configured before it works is a search tool that
 * does not work. The constructor takes an override for the day this one starts
 * asking for a key, which is a question of when and not whether.
 *
 * Exported because it is a disclosure as well as a default: this is the one
 * address a user's queries leave for, and `composition.js` names it in a boot
 * note so the fact is somewhere other than this comment.
 */
export const SEARCH_ENDPOINT = 'https://api.firecrawl.dev/v1/search'

/** Enough to choose a page from, few enough that the list is not the answer. */
const RESULTS = 5

/** A snippet is a reason to open the link, not a substitute for opening it. */
const SNIPPET = 200

const TIMEOUT = 20_000

/** Its own body is small; the cap is only there so a broken endpoint cannot flood the turn. */
const BYTE_LIMIT = 256 * 1024

/**
 * Find a URL.
 *
 * That is the whole job, and the discipline is in what it refuses to do. Search
 * results are the easiest place in an agent to waste a context window: ten
 * results with full page extracts is a wall of text that costs more than the
 * page the agent actually wanted. So this returns five lines of title, URL and
 * one clipped sentence, and `fetch` is what reads the page that looked right.
 */
export class SearchTool extends Tool {
  constructor({ http, endpoint = SEARCH_ENDPOINT } = {}) {
    super({
      name: 'search',
      description: 'Search the web to find a page, then fetch that page for the detail.',
      parameters: {
        query: {
          type: 'string',
          required: true,
          description: 'What to look for, in the words a page about it would use.',
        },
      },
    })
    this.http = typeof http === 'function' ? http : NO_HTTP
    this.endpoint = endpoint
  }

  async call({ query } = {}) {
    const asked = typeof query === 'string' ? query.trim() : ''
    if (!asked) return Outcome.ok('no query was given, so nothing was searched for')

    const got = await this.http({
      url: this.endpoint,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: asked, limit: RESULTS }),
      limit: BYTE_LIMIT,
      timeout: TIMEOUT,
    })
    if (!got.ok)
      return Outcome.ok(`nothing could be searched for: ${got.failure.message}`, got.notes)

    const { status, text = '', blocked } = got.value
    if (blocked) {
      // The agent's next move is the same whichever of these it was — it cannot
      // search — so this says the one thing that changes what it should do
      // instead, rather than three variations on "no".
      return Outcome.ok(
        `the search service could not be reached (${blocked}), so nothing was searched for. Answer from what you already know and say that you could not check.`,
        got.notes,
      )
    }
    if (status !== 200) {
      return Outcome.ok(
        `the search service answered ${status}, so there are no results. It may be rate-limiting this browser; say you could not search rather than guessing what a search would have found.`,
        got.notes,
      )
    }

    const parsed = await Outcome.attempt(() => JSON.parse(text))
    if (!parsed.ok) {
      return Outcome.ok(
        `the search service answered 200 but not in JSON, so there are no results (${parsed.failure.message}).`,
        got.notes,
      )
    }

    const body = parsed.value
    // Two different answers that a single `: []` fallback flattened into one.
    // "The endpoint found nothing" is the agent's cue to try other words; "the
    // endpoint answered in a shape this does not read" is the cue to stop
    // searching and say so, and the day this endpoint changes its envelope is
    // the day the difference is the only thing standing between the agent and a
    // permanent, silent, confident zero.
    const hits = Array.isArray(body?.data) ? body.data : null
    if (!hits) {
      return Outcome.ok(
        'the search service answered 200 but not in the shape this tool reads, so there are no results. Say you could not search rather than guessing what a search would have found.',
        got.notes,
      )
    }
    if (!hits.length) {
      const why = typeof body?.error === 'string' ? `: ${body.error}` : ''
      return Outcome.ok(`no results for ${JSON.stringify(asked)}${why}`, got.notes)
    }

    const rows = hits.slice(0, RESULTS).map((hit, index) => {
      const title = clip(hit?.title, 120) || '(untitled)'
      const snippet = clip(hit?.description, SNIPPET)
      return `${index + 1}. ${title} — ${hit?.url ?? '(no url)'}${snippet ? `\n   ${snippet}` : ''}`
    })
    return Outcome.ok(rows.join('\n'), got.notes)
  }
}

/**
 * One line, at most `max` characters.
 *
 * The newlines matter: this endpoint returns markdown in its descriptions, and
 * a snippet containing a code fence would look like the model's own output when
 * it lands on the scratchpad.
 */
function clip(value, max) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  return text.length > max ? `${text.slice(0, max)}…` : text
}
