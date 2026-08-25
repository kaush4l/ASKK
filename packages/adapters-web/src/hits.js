/**
 * SIX VENDORS' BODIES, ONE FIELD PER LINE.
 *
 * These lived inline in `LADDER` as 200-character expressions — `list`, `str`,
 * `deep` and a template literal nested inside a `.map` inside an arrow inside
 * an object literal — and the one thing a reader of that table came for, each
 * vendor's own field names, was the thing the nesting hid. The ladder is a
 * table of five rungs; this is what each rung reads.
 * @module
 */

/** @typedef {{title: string, url: string, snippet: string}} Hit */

/** Firecrawl v2 nests its web results one level down, and answered `{data: []}` before it did. */
export function firecrawlHits(/** @type {string} */ body) {
  const data = read(body).data
  return list(Array.isArray(data) ? data : deep(data, ['web'])).map((r) =>
    hit(str(r.title), str(r.url), str(r.description)))
}

/** A summary, which is one article or nothing — never a result list. */
export function wikipediaHits(/** @type {string} */ body) {
  const said = read(body)
  const title = str(said.title)
  if (title === '') return []
  return [hit(title, str(deep(said, ['content_urls', 'desktop', 'page'])), str(said.extract))]
}

/** Algolia's HN index: a comment hit carries `story_title` and no `url` of its own. */
export function hnHits(/** @type {string} */ body) {
  return list(read(body).hits).map((h) =>
    hit(
      str(h.title) || str(h.story_title),
      str(h.url) || `https://news.ycombinator.com/item?id=${str(h.objectID)}`,
      str(h.story_text),
    ))
}

/** OpenAlex works. The DOI is the citable link and `id` is the API's own URL. */
export function openAlexHits(/** @type {string} */ body) {
  return list(read(body).results).map((w) =>
    hit(
      str(w.display_name),
      str(w.doi) || str(w.id),
      `${str(w.publication_year)} · ${str(deep(w, ['primary_location', 'source', 'display_name']))}`,
    ))
}

/** Crossref works. `title` is an ARRAY here, and only its first entry is the work's. */
export function crossrefHits(/** @type {string} */ body) {
  return list(deep(read(body), ['message', 'items'])).map((w) =>
    hit(list(w.title).map(String)[0] ?? '', str(w.URL), str(w.publisher)))
}


/** Tavily's own shape: `content` is the snippet, and it is the only rung that carries a key. */
export function tavilyHits(/** @type {string} */ body) {
  return list(read(body).results).map((r) => hit(str(r.title), str(r.url), str(r.content)))
}

/** @param {string} title @param {string} url @param {string} snippet @returns {Hit} */
function hit(title, url, snippet) {
  return { title: title.trim(), url: url.trim(), snippet: snippet.replace(/\s+/g, ' ').trim().slice(0, 300) }
}

/**
 * A third party's JSON body, parsed. `any` with the reason: six vendors' shapes
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

