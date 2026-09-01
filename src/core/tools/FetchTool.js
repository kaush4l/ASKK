import { Outcome } from '../Outcome.js'
import { Blocked, NO_HTTP } from './HttpPort.js'
import { toReadableText } from './readable.js'
import { Tool } from './Tool.js'

/** How much of a body to pull down at all. Past this it is bandwidth, not information. */
const BYTE_LIMIT = 512 * 1024

/** How much of it a model sees. Roughly two thousand tokens: a long answer, not a book. */
const TEXT_LIMIT = 8000

/** Long enough for a slow origin, short enough that a dead one does not hold the turn. */
const TIMEOUT = 20_000

const isJson = (type) => /\bjson\b/i.test(type)
const isHtml = (type) => /\bhtml\b|\bxml\b/i.test(type)

/**
 * What a document IS, for a server that never said what it is.
 *
 * A missing `content-type` is not exotic — an S3 object and a misconfigured
 * static host both do it — and the header test alone then sent raw markup,
 * script bodies and all, straight into the context window. Sniffing the first
 * bytes is what a browser does for the same reason.
 */
const looksLikeMarkup = (body) => /^\s*(?:<!doctype\s+html|<html|<\?xml|<rss\b|<feed\b)/i.test(body)

const count = (n) => n.toLocaleString('en-US')

/**
 * Read a URL.
 *
 * The request is the easy half. The RESPONSE is the design problem: a page is
 * a few hundred kilobytes of markup and script, and handing that to a model
 * spends the whole context window to answer nothing. So this caps what it
 * downloads, reduces HTML to the text underneath it, and says out loud when it
 * cut something — a silent truncation is how a model comes to confidently
 * summarise the first third of a document.
 *
 * The other half is failure, and here it is the common case rather than the
 * edge one. Most of the web does not send a CORS header, so most of the web
 * cannot be read from a page at all (C2). A browser reports that as
 * `TypeError: Failed to fetch` with no detail whatsoever — the same rejection
 * it gives for a host that does not exist. An agent told only "failed" will
 * retry the same address forever.
 *
 * So the port goes and establishes which, and this tool NAMES it: an origin
 * that refused a browser is a permanent property of that origin and the agent
 * should go somewhere else, while a host that did not answer might be worth one
 * more try. Those are different next moves, and the observation has to be
 * different for the agent to make them.
 */
export class FetchTool extends Tool {
  constructor({ http } = {}) {
    super({
      name: 'fetch',
      description:
        'Read a URL. Many sites do not permit a browser to read them — that is permanent, so use another source rather than retrying.',
      parameters: {
        url: {
          type: 'string',
          required: true,
          description: 'The full address, including https://.',
        },
      },
    })
    this.http = typeof http === 'function' ? http : NO_HTTP
  }

  async call({ url } = {}) {
    const asked = typeof url === 'string' ? url.trim() : ''
    if (!asked) return Outcome.ok('no url was given, so nothing was fetched')

    // Checked here, before the port: a malformed address is the model's
    // mistake, and telling it so costs no request and no time.
    const parsed = await Outcome.attempt(() => new URL(asked))
    if (!parsed.ok) {
      return Outcome.ok(`${asked} is not a URL. Write the whole address, including https://.`)
    }
    if (parsed.value.protocol !== 'https:' && parsed.value.protocol !== 'http:') {
      return Outcome.ok(`${asked} is not something a browser can fetch; only http and https are.`)
    }

    const got = await this.http({ url: asked, limit: BYTE_LIMIT, timeout: TIMEOUT })
    if (!got.ok) {
      return Outcome.ok(`nothing could be fetched: ${got.failure.message}`, got.notes)
    }

    const {
      status,
      contentType = '',
      text = '',
      bytes = 0,
      truncated,
      blocked,
      stopped = '',
      url: landed = '',
    } = got.value
    if (blocked === Blocked.REFUSED) {
      return Outcome.ok(
        `${asked} answered, but that origin did not permit a browser to read it — it sends no CORS header. This is a rule of the web and not a fault, and it will not change on a retry. Use search to find the same information on a site that allows it, or ask the user to paste the part they want.`,
        got.notes,
      )
    }
    if (blocked === Blocked.UNREACHABLE) {
      return Outcome.ok(
        `nothing answered at ${parsed.value.host}. Either the host does not exist or it is down; check the address before trying again.`,
        got.notes,
      )
    }
    if (blocked === Blocked.TIMEOUT) {
      return Outcome.ok(`${asked} did not answer within ${TIMEOUT / 1000} seconds.`, got.notes)
    }

    // JSON and plain text are already what a model reads best. Only markup is
    // reduced, and the observation says when it was, because the difference
    // matters if the agent is looking for something the reduction dropped.
    const reduced = contentType
      ? isHtml(contentType) && !isJson(contentType)
      : looksLikeMarkup(text)
    const body = (reduced ? toReadableText(text) : text).trim()

    // The address that answered, when it is not the address that was asked. A
    // redirect is how a page becomes a login wall or a regional edition, and an
    // agent that reads the answer under the URL it typed cannot see that happen.
    const marks = []
    if (reduced) marks.push('reduced from HTML')
    if (landed && landed !== asked) marks.push(`redirected to ${landed}`)
    const lines = [[status, ...marks].join(' · ')]
    if (!body) {
      lines.push('', '(the response had no readable content)')
    } else if (body.length > TEXT_LIMIT) {
      lines.push('', body.slice(0, TEXT_LIMIT))
      lines.push('', `[cut: ${count(TEXT_LIMIT)} of ${count(body.length)} characters shown]`)
    } else {
      lines.push('', body)
    }
    // Two different cuts, and they are not the same fact. This one says the
    // page itself was never fully downloaded, so what is missing is not
    // recoverable by asking for more of the text above.
    if (truncated) {
      lines.push(
        `[the download stopped at ${Math.round(bytes / 1024)} KB, so the page may be incomplete]`,
      )
    }
    // Third cut, and the only one that was not the tool's own decision. Said in
    // the observation rather than in a note, because a note is not a channel
    // here — `Toolbox` prints one, but nothing downstream of a tool ever has.
    if (stopped) {
      lines.push(`[the connection broke part-way: ${stopped}. Above is what arrived.]`)
    }
    return Outcome.ok(lines.join('\n'), got.notes)
  }
}
