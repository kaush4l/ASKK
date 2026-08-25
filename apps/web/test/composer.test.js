import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'bun:test'

import { Composer } from '../components/ui/composer.jsx'
import { Ring } from '../components/ui/ring.jsx'
import { NEARLY_FULL } from '../app/design-system/specimens.jsx'
import { chat } from '../fixtures/transcript.js'

/** Every value of one attribute, in the order the document carries them. */
function attrs(/** @type {string} */ markup, /** @type {string} */ name) {
  return [...markup.matchAll(new RegExp(name + '="([^"]*)"', 'g'))].map((m) => m[1])
}

/**
 * THE ARCS ARE LAID END TO END, AND THAT IS THE WHOLE MECHANISM.
 *
 * Each part's dash is its share of the window and each offset is the negated
 * sum of the arcs before it. Drop the accumulation and all four arcs start at
 * twelve o'clock, so a ring 93% spent reads as 63% spent — a wrong number drawn
 * confidently, which the gate would otherwise pass because nothing here has a
 * word in it. The expected values are computed the same way the component
 * computes them so this compares geometry, not float formatting.
 */
test('a part is its own share long and starts where the parts before it ended', () => {
  const markup = renderToStaticMarkup(createElement(Ring, { cost: NEARLY_FULL }))
  let used = 0
  const dashes = []
  const offsets = []
  for (const part of NEARLY_FULL.parts) {
    dashes.push(`${part.fraction * 100} 100`)
    offsets.push(String(-used))
    used += part.fraction * 100
  }
  expect(attrs(markup, 'stroke-dasharray')).toEqual(dashes)
  expect(attrs(markup, 'stroke-dashoffset')).toEqual(offsets)
  expect(new Set(offsets).size).toBe(NEARLY_FULL.parts.length)
})

/**
 * A RING CANNOT BE MORE THAN FULL. Fractions summing past 1 wrap the circle a
 * second time and paint an over-full window as a nearly-empty one, silently —
 * so the bound is executed over both fixtures rather than written down in
 * `ring.jsx` and trusted (I16).
 */
test('the parts of a window never sum past the whole of it', () => {
  for (const cost of [chat.composer.cost, NEARLY_FULL]) {
    const sum = cost.parts.reduce((n, part) => n + part.fraction, 0)
    expect(sum).toBeLessThanOrEqual(1)
    expect(sum).toBeGreaterThan(0)
  }
})

/**
 * IT IS DISABLED, AND IT SAYS WHY — executed, because the next increment flips
 * `refusedLabel` to '' and that is the moment a box that stayed disabled, or one
 * that was never disabled, would both ship green. Two controls are refused: the
 * text box and the send button.
 */
test('a refusal disables the box and the button and is on screen; no refusal arms both', () => {
  const refused = renderToStaticMarkup(createElement(Composer, { data: chat.composer }))
  expect(attrs(refused, 'disabled').length).toBe(2)
  expect(refused).toContain(chat.composer.refusedLabel)

  const armed = renderToStaticMarkup(
    createElement(Composer, { data: { ...chat.composer, refusedLabel: '' } }),
  )
  expect(attrs(armed, 'disabled').length).toBe(0)
  expect(armed).not.toContain(chat.composer.refusedLabel)
})
