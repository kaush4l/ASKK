import { expect, test } from 'bun:test'

/**
 * DESIGN.md §10 IS A CHECKLIST A CRITIC RUNS BY EYE, AND FOUR OF ITS ITEMS ARE
 * ARITHMETIC. Those four are here, executed over the stylesheets that ship,
 * because a claim the gate cannot execute is not a verified claim (I17) — and
 * the predecessor's own §10 audit shipped three routes at a type ratio it was
 * supposed to have failed, for exactly this reason.
 *
 * What is NOT here is what needs a rendered pixel: contrast against the lit
 * lobe, 400% zoom, frame time. Those belong to a probe against the built page
 * and they are not claimed here rather than asserted weakly.
 */

const ROOT = new URL('../', import.meta.url)
const FILES = [
  'app/globals.css', 'styles/base.css', 'styles/motion.css',
  'components/shell/shell.module.css', 'components/ui/ui.module.css',
  'components/ui/meter.module.css', 'components/views/views.module.css',
  'components/views/problem.module.css', 'app/design-system/gallery.module.css',
  'components/work/work.module.css',
]

/** @type {Array<{name: string, text: string}>} */
const sheets = await Promise.all(FILES.map(async (name) => ({ name, text: await Bun.file(new URL(name, ROOT)).text() })))

/** The body of one rule, found by its EXACT selector — never a longer one that
 *  starts with the same characters, which is why the brace is part of the match. */
function ruleFor(/** @type {string} */ text, /** @type {string} */ selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp('(?:^|[}\n])\\s*' + escaped + '\\s*\\{([^}]*)\\}').exec(text)?.[1] ?? ''
}

/** Every declaration whose property matches, as `{file, property, value}`. */
function declarations(/** @type {RegExp} */ property) {
  return sheets.flatMap(({ name, text }) =>
    [...text.matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/g)]
      .filter((m) => property.test(m[1] ?? ''))
      .map((m) => ({ file: name, property: m[1] ?? '', value: (m[2] ?? '').trim() })))
}

/**
 * ≤6 FONT SIZES, AND THE RAMP IS THE ONLY PLACE THEY LIVE (§10 item 10).
 *
 * A literal in a `font-size` is a seventh size that no token names and no room
 * swaps, and it is how a ramp of six becomes a ramp of nine one careful
 * exception at a time. The one allowance is RELATIVE and deliberate: `code`
 * inside prose is set as a fraction of whatever it sits in, so it tracks the
 * six rather than adding a seventh.
 */
test('every font-size is one of the six tokens, or is relative to one', () => {
  const ramp = new Set(['--t-display', '--t-subhead', '--t-heading', '--t-body', '--t-label', '--t-caption'])
  for (const decl of declarations(/^font-size$/)) {
    const token = /^var\((--t-[a-z]+)\)$/.exec(decl.value)
    const relative = /^[\d.]+em$/.test(decl.value) || decl.value === 'inherit'
    expect(token ? ramp.has(token[1] ?? '') : relative).toBe(true)
  }
  const used = new Set(declarations(/^font-size$/).map((d) => d.value).filter((v) => v.startsWith('var(')))
  expect(used.size).toBeLessThanOrEqual(6)
})

/**
 * ≤8 SPACING VALUES (§10 item 10). Zero and `auto` are not spacing — they are
 * the absence of it and the centring of a block — and `--gutter` re-points one
 * of the eight rather than adding a ninth, which `app/globals.css` says in the
 * one place it is declared.
 */
test('every padding, margin and gap is a step on the scale', () => {
  const off = []
  for (const decl of declarations(/^(padding|margin|gap|row-gap|column-gap)(-block|-inline)?(-start|-end)?$/)) {
    for (const part of decl.value.split(/\s+/)) {
      if (part === '0' || part === 'auto' || /^var\(--(s-[1-8]|gutter)\)$/.test(part)) continue
      off.push(`${decl.file}: ${decl.property}: ${part}`)
    }
  }
  expect(off).toEqual([])
})

/**
 * EVERY TARGET CLEARS 44×44 (§10 item 8). The rule is checked at the CONTROL
 * classes rather than by measuring a render, because that is where the height
 * is actually decided: a nav entry at a label's size with two padding steps
 * measured 36px for four increments, and nothing said so.
 */
test('every control declares a target at least 2.75rem tall', () => {
  const controls = ['.navItem', '.sendButton', '.press', '.callHead', 'input.prompt']
  for (const selector of controls) {
    // A selector nobody declares yields '', which fails the match below — so a
    // control renamed out of existence fails here rather than passing vacuously.
    const body = sheets.map(({ text }) => ruleFor(text, selector)).find((found) => found !== '') ?? ''
    expect(body).toMatch(/min-(block-size|height):\s*2\.75rem/)
  }
})

/**
 * NO BODY TEXT ON A BLUR (§1's reject list, §10 item 5) — and the way this
 * design holds it is that there is no blur at all. The material is fills,
 * rules and one shadow, so the plain path and the glass path are the same
 * picture and the fallback cannot be a different product.
 */
test('nothing in this product puts a surface between text and a blur', () => {
  for (const { text } of sheets) expect(text).not.toContain('backdrop-filter')
})

/**
 * …AND YOU CAN TELL IN ONE SECOND WHICH PANEL IS ON TOP (§1's reject list).
 *
 * Three surfaces, one step apart, in a fixed order: the region a destination
 * fills, the panels standing on it, the rows inside those. They were all
 * `--surface-1` or `--surface-2` until this increment, separated by a hairline
 * at 0.15 alpha — a boundary you have to hunt for, which is the one thing §1
 * says to reject a mockup over outright.
 */
test('the region, a panel and a row are three different surfaces', () => {
  const fill = (/** @type {string} */ file, /** @type {string} */ selector) => {
    const text = sheets.find((sheet) => sheet.name === file)?.text ?? ''
    return /background:\s*var\((--surface-[123])\)/.exec(ruleFor(text, selector))?.[1]
  }
  const ladder = [
    fill('components/shell/shell.module.css', '.region'),
    fill('components/ui/ui.module.css', '.panel'),
    fill('components/views/views.module.css', '.row'),
  ]
  expect(ladder).toEqual(['--surface-1', '--surface-2', '--surface-3'])
})
