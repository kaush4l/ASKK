import { expect, test } from 'bun:test'
import { DIRECTIONS } from '../lib/appearance.js'
import { THEME_BOOT } from '../components/shell/theme-boot.js'

/* COMMENTS BLANKED, LENGTHS KEPT — the same reason `theme.test.js` does it: the
   prose above a rule names the selector the rule uses, so a search over raw
   text finds the sentence and reads whatever follows it by luck. */
const blank = (/** @type {string} */ css) =>
  css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))

const globals = blank(await Bun.file(new URL('../app/globals.css', import.meta.url)).text())
/** @type {string[]} the four, `''` excluded — that one IS `globals.css`. */
const SLUGS = DIRECTIONS.map((d) => d.slug).filter(Boolean)

/** One direction's stylesheet, comments blanked. */
async function sheet(/** @type {string} */ slug) {
  return blank(await Bun.file(new URL(`../styles/directions/${slug}.css`, import.meta.url)).text())
}

/** Every custom property a body of declarations declares. */
function declared(/** @type {string} */ css) {
  return new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]))
}

/** The declarations of the rule whose selector list contains `needle`. */
function block(/** @type {string} */ css, /** @type {string} */ needle) {
  const at = css.indexOf(needle)
  expect(at).toBeGreaterThan(-1)
  const open = css.indexOf('{', at)
  return css.slice(open, css.indexOf('}', open))
}

/**
 * A DIRECTION SWAPS THE WHOLE PALETTE OR IT IS NOT A DIRECTION.
 *
 * This is the gate the four exist behind, and it is executable because the
 * failure it catches is the single most common way a dark design breaks when it
 * is inverted: `--hairline` is white at low alpha, a light direction re-points
 * the ink and the surfaces and forgets it, and every border on the page is
 * invisible. Nothing about that is visible in a diff — the file looks complete
 * because everything IN it is right.
 *
 * The list is not written here. It is read out of `globals.css`, so a token
 * added to the shipped palette fails four files until each answers it (I17).
 */
test('every direction declares every palette token the shipped page declares', async () => {
  // THE LIGHT ROOM IS THE DEFINITION OF "THE PALETTE", and it is the right one
  // rather than a list kept here: it is exactly what a room swap re-points, so
  // whatever a room may change a direction must answer for as well. The dark
  // block shares its selector with `:root` and declares the type ramp, the
  // space steps and the motion curves too — which a direction MAY change and is
  // not obliged to.
  const palette = declared(block(globals, '\n[data-theme="light"] {'))
  expect(palette.size).toBeGreaterThan(20)
  for (const slug of SLUGS) {
    const has = declared(await sheet(slug))
    const missing = [...palette].filter((token) => !has.has(token))
    expect({ slug, missing }).toEqual({ slug, missing: [] })
  }
})

/**
 * …AND SAYS WHICH LIGHT IT IS, so form controls, scrollbars and the browser's
 * own defaults agree with the palette above them.
 */
test('every direction states its own color-scheme', async () => {
  for (const slug of SLUGS) expect(await sheet(slug)).toContain('color-scheme:')
})

/**
 * NO DIRECTION REACHES OUTSIDE ITS OWN BRACKET.
 *
 * A direction is allowed to carry rules — that is how it answers "feel" and not
 * only "look" — but an unprefixed selector in one of these files is a rule that
 * applies to every direction and to the shipped page, from a file whose name
 * says it does not. The Rust harness had a Python script for exactly this; here
 * it is a test, which is the same claim in a place the gate already runs.
 */
test('every selector in a direction stylesheet is prefixed with its own attribute', async () => {
  for (const slug of SLUGS) {
    const css = await sheet(slug)
    const selectors = [...css.matchAll(/(^|})\s*([^{}]+)\{/g)].flatMap((m) => (m[2] ?? '').split(','))
    const loose = selectors.map((one) => one.trim()).filter((one) => one && !one.startsWith(`:root[data-direction="${slug}"]`))
    expect({ slug, loose }).toEqual({ slug, loose: [] })
  }
})

/**
 * …AND THE LIST, THE FILES AND THE PRE-PAINT SCRIPT ARE ONE SET.
 *
 * Three places have to agree for a direction to exist: `DIRECTIONS` (what the
 * picker offers), the stylesheet (what it looks like), and `THEME_BOOT` (what
 * is stamped before the first frame). Two out of three is a direction a person
 * can choose that paints nothing, or one that flashes the shipped page on every
 * reload — both silent.
 */
test('the picker, the stylesheets and the boot script offer the same four', async () => {
  const files = [...new Bun.Glob('*.css').scanSync(new URL('../styles/directions/', import.meta.url).pathname)]
  const named = new Set(files.map((f) => f.replace('.css', '')))
  // Compared as SETS and not as sorted lists, because order is not the claim
  // and `check-viewmodel.js` refuses a sort in this tree anyway.
  expect([...SLUGS].filter((slug) => !named.has(slug))).toEqual([])
  expect([...named].filter((name) => !SLUGS.includes(name))).toEqual([])
  for (const slug of SLUGS) expect(THEME_BOOT).toContain(JSON.stringify(slug))
  expect(THEME_BOOT).toContain('data-direction')
  expect(THEME_BOOT).toContain('data-theme')
})

/**
 * THE SHIPPED PAGE IS ON THE LIST, FIRST, AND IT IS THE DEFAULT. A round that
 * offers four directions and drops the fifth is not offering a choice.
 */
test('the page as it ships is the first entry and has no stylesheet of its own', () => {
  expect(DIRECTIONS[0]?.slug).toBe('')
  expect(DIRECTIONS.filter((d) => d.slug === '')).toHaveLength(1)
  for (const one of DIRECTIONS) expect(one.what.length).toBeGreaterThan(20)
})
