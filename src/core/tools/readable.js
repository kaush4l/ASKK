/**
 * HTML reduced to the text underneath it, without a parser.
 *
 * Written by hand because the obvious tool is not there. `DOMParser` is
 * `[Exposed=Window]`, and the backend worker is not a Window — MEASURED, in a
 * module worker in Chrome, rather than believed:
 *
 *     worker: { DOMParser: "undefined", document: "undefined",
 *               fetch: "function", TextDecoder: "function" }
 *     page:   { DOMParser: "function",  document: "object"   }
 *
 * (the probe and its output are in `docs/CORS-PROBE.md` §3). That is the worst
 * shape a mistake can take here: a DOM-based reduction passes every test run in
 * a page and is `undefined` in the realm that actually runs it. Nothing in this
 * file touches a DOM, and no dependency was added to replace one.
 *
 * What it is for. A modern page is a few hundred kilobytes of markup, script
 * and inline style; handing that to a model spends the context window on
 * nothing. This keeps the words and the structure that carries meaning —
 * headings, list items, paragraph breaks — and drops everything that only
 * matters to a browser.
 *
 * The one thing it goes out of its way to preserve is `<pre>`. This agent is
 * pointed at software, most of what it will read is documentation, and a code
 * sample whose newlines have been collapsed into one line is worse than no code
 * sample at all — it looks correct and is not.
 */

/**
 * Elements whose contents are for the machine, never for the reader.
 *
 * `title` is in the list because it is read separately and put at the front; a
 * document whose body opens with its own heading would otherwise show the title
 * twice, which is a small waste on one page and a standing one across a run.
 */
const DISCARDED =
  /<(script|style|noscript|svg|template|iframe|object|canvas|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi

/**
 * Where a `<pre>` block was taken out, so the rest can have its whitespace
 * squeezed without squeezing the one thing whose whitespace is the content. A
 * private-use code point rather than a control character: a control character
 * is what a linter and a terminal both object to, and this has to survive both.
 */
const SENTINEL = '\uE000'
const SPLICE = new RegExp(`${SENTINEL}(\\d+)${SENTINEL}`, 'g')

/** Elements that end the line they are on. Anything else is inline. */
const BLOCK =
  /<\/?(?:address|article|aside|blockquote|body|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hgroup|main|nav|ol|p|section|table|tbody|td|tfoot|th|thead|tr|ul)\b[^>]*>/gi

/**
 * The entities worth a table. Everything numeric is handled by rule, and the
 * long tail of named entities is rare enough in prose that leaving `&sigma;`
 * alone is better than shipping a 2,000-entry map into every bundle.
 */
const NAMED = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  times: '×',
  middot: '·',
  bull: '•',
}

/** `&amp;` and `&#8212;` and `&#x2014;`, and nothing that is not one of those. */
function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = Number.parseInt(
        body.slice(1).replace(/^x/i, ''),
        body[1] === 'x' || body[1] === 'X' ? 16 : 10,
      )
      // A code point outside the range is a malformed document, not a crash:
      // the original text is more informative than a replacement character.
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole
    }
    return NAMED[body.toLowerCase()] ?? whole
  })
}

/** Tags out, entities in, whitespace left exactly as it was. For `<pre>` only. */
function preformatted(html) {
  return decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/[ \t]+$/gm, '')
}

/**
 * Squeeze the whitespace a browser would have squeezed.
 *
 * Runs of blank lines become one blank line rather than none, because a
 * paragraph break is the only structure left after the tags are gone and it is
 * what tells a model where one idea stops.
 */
function tidy(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * @param {string} html
 * @returns {string} the readable text, with the document title as its first
 *   line when the document has one and the body does not already open with it.
 */
export function toReadableText(html) {
  const source = typeof html === 'string' ? html : ''

  const title = tidy(preformatted(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(source)?.[1] ?? ''))

  // Pulled out before anything else touches the string, and put back last:
  // every step below is destructive to whitespace, which is the whole point of
  // `<pre>`. The sentinel is a private-use code point, and any the document
  // already contained is stripped first, so a splice can never land in real text.
  const kept = []
  let body = source
    .replaceAll(SENTINEL, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!doctype[^>]*>/gi, '')
    .replace(DISCARDED, '\n')
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre\s*>/gi, (_whole, inner) => {
      kept.push(preformatted(inner))
      return `\n${SENTINEL}${kept.length - 1}${SENTINEL}\n`
    })

  body = body
    .replace(/<(?:br|hr)\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(BLOCK, '\n')
    // Everything left is inline, and inline elements introduce no whitespace in
    // a browser: `<b>hyper</b>text` is one word, and replacing the tag with a
    // space would break it into two.
    .replace(/<[^>]*>/g, '')

  const text = tidy(decodeEntities(body)).replace(SPLICE, (_whole, index) => kept[Number(index)])

  if (!title || text.startsWith(title)) return text
  return text ? `${title}\n\n${text}` : title
}
