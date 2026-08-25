import { expect, test } from 'bun:test'

/* COMMENTS BLANKED FIRST, LENGTHS KEPT. This file's own subject is spelled in
   the prose above the rule that declares it — `[data-theme="dark"]` appears in
   the paragraph explaining why the selector is written that way — so a search
   over the raw text found the sentence and read the rule after it by luck. A
   test that passes by adjacency is a test that starts failing when somebody
   moves a comment. */
const css = (await Bun.file(new URL('../app/globals.css', import.meta.url)).text())
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
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

/**
 * …AND THE FIELD IS DECLARED IN BOTH, BECAUSE A TOKEN DOES NOT INHERIT ITS OWN
 * REFERENCES.
 *
 * `--ground-field` is composed out of four lobe tokens, and CSS substitutes
 * those `var()`s where the property is DECLARED — so the value that inherits
 * out of `:root` has the dark lobes already frozen into it, and re-pointing
 * `--lobe-key` under `[data-theme="light"]` moves nothing. That is invisible
 * while the room is stamped on the root and exactly wrong when it is stamped on
 * a DIV, which is what `/design-system/` does: the light room shipped the dark
 * room's key lobe and its black 0.55 vignette over a white ground, measured at
 * 1.07:1 by `scripts-js/check-contrast.js`.
 *
 * The fix is the second declaration, so this is the guard the second
 * declaration needs: the two must be the same field, character for character,
 * or the rooms are two different grounds and nobody finds out from the source.
 */
test('both rooms declare the same ground field', () => {
  const field = (/** @type {string} */ needle) =>
    /--ground-field:\s*([^;]+);/.exec(block(needle))?.[1]?.replace(/\s+/g, ' ').trim()
  const dark = field('[data-theme="dark"]')
  const light = field('[data-theme="light"]')
  expect(dark).toBeTruthy()
  expect(light).toBe(dark ?? '')
})
