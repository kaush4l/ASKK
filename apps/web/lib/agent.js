/**
 * WHICH AGENT A SCREEN IS ABOUT, and it rides in the query string (SEAM.md).
 *
 * The Rust build carried it as a second hash segment — `#/work/researcher` —
 * because a Wasm bundle served from one URL had nowhere else to put it. The
 * reason it was in the address at all survives verbatim, and it is the whole
 * point of this file: pick `researcher`, reload, and the predecessor's strip
 * had silently gone back to `main` while the address bar still said the view.
 * Two adjacent selections on one screen persisting by two different rules, and
 * a link copied out of the address bar showed the next person a different agent
 * than the one on the sender's screen.
 *
 * A path segment would need `generateStaticParams` over a set that is not known
 * at build time — a person may author an agent in the browser. A query string
 * needs no route to exist.
 *
 * Pure: `location` never appears here, so this is testable on the host and the
 * hook beside it (`components/shell/use-agent.js`) owns the browser half.
 */

/** Who the page talks to when the address does not say. */
export const DEFAULT_AGENT = 'main'

/** The one key. Named here so the reader and the writer cannot disagree. */
const KEY = 'agent'

/**
 * WHO the address says the screen is about. Absent, empty, or a value that is
 * not a plausible agent name all mean the same thing: the entry agent.
 *
 * The name is FILTERED rather than trusted because it is about to be rendered
 * and sent across the seam as `x-agent`. Whether the name is on the roster is
 * the core's answer, not this file's (I5) — this only refuses what could never
 * be a name.
 * @param {string} search `location.search`, leading `?` optional
 */
export function agentFrom(search) {
  const raw = new URLSearchParams(search).get(KEY) ?? ''
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(raw) ? raw : DEFAULT_AGENT
}

/**
 * The query string a link to `agent` carries, `?` included, or empty.
 *
 * The default agent is written as ABSENCE. `?agent=main` and no query at all
 * are the same screen, and two addresses for one screen is what makes a Back
 * press ambiguous — the predecessor's `route.rs` spent its longest comment on
 * exactly this and solved it with `replaceState`. Not writing it is simpler.
 * @param {string} agent
 */
export function searchFor(agent) {
  if (agent === DEFAULT_AGENT) return ''
  return '?' + new URLSearchParams({ [KEY]: agent })
}
