import { expect, test } from 'bun:test'

const css = await Bun.file(new URL('../app/globals.css', import.meta.url)).text()
const layout = await Bun.file(new URL('../app/layout.jsx', import.meta.url)).text()

/** The declarations of the rule whose selector list contains `needle`. */
function block(/** @type {string} */ needle) {
  const at = css.indexOf(needle)
  expect(at).toBeGreaterThan(-1)
  const open = css.indexOf('{', at)
  return css.slice(open, css.indexOf('}', open))
}

/** The one value this test is about, out of a rule's declarations. */
function ground(/** @type {string} */ declarations) {
  const found = /--ground:\s*(#[0-9a-fA-F]{3,8})/.exec(declarations)
  expect(found).not.toBeNull()
  return found?.[1]
}

/**
 * THE ONE DUPLICATE SPELLING, AND THE THING THAT STOPS IT DRIFTING.
 *
 * `--ground` is a custom property, and a `<meta name="theme-color">` cannot
 * read one — the browser's own chrome has to be told the colour as a literal.
 * So the ground is written twice on purpose. What is NOT acceptable is that the
 * two can disagree: the page would paint one room and the phone's status bar
 * another, and nothing in the build would notice.
 *
 * This is the I16 item for this increment. A truth the system holds in a form a
 * machine can read must be checkable against the prose it shows, and checked.
 */
test('the themeColor literals are the ground colours globals.css declares', () => {
  const dark = ground(block('[data-theme="dark"]'))
  const light = ground(block('[data-theme="light"]'))
  expect(dark).not.toBe(light)

  const declared = [...layout.matchAll(/prefers-color-scheme:\s*(light|dark)\)'\s*,\s*color:\s*'(#[0-9a-fA-F]{3,8})'/g)]
  const said = Object.fromEntries(declared.map((m) => [m[1], m[2]]))
  expect(said).toEqual({ light, dark })
})

/**
 * …AND BOTH PALETTES ARE SELECTABLE ON ANY ELEMENT, not on `:root` alone.
 * `/design-system/` puts a whole palette on a specimen box so a critic reads
 * both rooms on one screen, and a `:root`-anchored selector would have made
 * that silently render the document's room twice.
 */
test('a palette is reachable by attribute, not only at the root', () => {
  expect(css).toContain('\n[data-theme="dark"] {')
  expect(css).toContain('\n[data-theme="light"] {')
})
