import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'bun:test'

import { Chat } from '../components/views/chat.jsx'
import { chat } from '../fixtures/transcript.js'

const motion = await Bun.file(new URL('../styles/motion.css', import.meta.url)).text()
const ui = await Bun.file(new URL('../components/ui/ui.module.css', import.meta.url)).text()

/**
 * A CLICK DURING A TRANSITION IS NOT LOST.
 *
 * The snapshot a view transition paints over the page is a real element, and it
 * swallows any press that lands on it for the length of the animation — so the
 * second click of a double-click on the nav goes nowhere. Nothing about the
 * snapshot is interactive, and this is the one line that says so.
 */
test('the view-transition snapshot takes no pointer', () => {
  expect(motion).toMatch(/::view-transition\s*\{[^}]*pointer-events:\s*none/)
  expect(motion).toMatch(/@view-transition\s*\{[^}]*navigation:\s*auto/)
})

/**
 * …AND THERE IS EXACTLY ONE ANIMATION, BOUND TO A FACT.
 *
 * The predecessor's design document claimed four state loops for a page that
 * ran one, and a critic reading it looked for motion that had never existed.
 * The number is the claim: one keyframe, and it is driven by `data-flying`,
 * which the core's own `status` decides — not by a component's mood. It is
 * declared in the same file that runs it, and that is not tidiness: a CSS
 * module rewrites the animation names it references, so the name has to be
 * local or the rule points at nothing.
 */
test('one keyframe, and the shimmer runs only while work is in flight', () => {
  const declared = [...motion.matchAll(/@keyframes\s+([\w-]+)/g), ...ui.matchAll(/@keyframes\s+([\w-]+)/g)]
  expect(declared.map((m) => m[1])).toEqual(['harness-sweep'])
  expect(ui).toMatch(/\[data-flying='true'\][^}]*animation:\s*harness-sweep 2s linear infinite/s)
})

/** AND NONE OF IT FOR SOMEBODY WHO ASKED FOR NONE OF IT. */
test('reduced motion turns the transition off where it lives', () => {
  const guard = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(motion)
  expect(guard?.[1]).toContain('::view-transition-group(*)')
  expect(guard?.[1]).toContain('animation: none !important')
})

/**
 * …AND THE MOTION IS ON THE PRODUCT, NOT ONLY IN THE GALLERY.
 *
 * For two increments the only thing wearing `data-flying` was a tool-call row,
 * and `GET /chat` projects no such row — it projects `messages`, which
 * `lib/chat.js` lifts to speech. So the product's one animation ran on exactly
 * one page: `/design-system/`. The transcript's own wait wears it now, and the
 * two states below are both ones the core really sends (`transcript.js`): a
 * turn being driven, and a turn a reload left with nothing driving it.
 */
test('a turn in flight shimmers, and one nothing is driving does not', () => {
  const drawn = (/** @type {string} */ status, /** @type {string} */ label) =>
    renderToStaticMarkup(createElement(Chat, {
      data: { ...chat, rows: [], waitingStatus: status, waitingLabel: label },
    }))
  expect(drawn('thinking', 'Working — this turn is running')).toContain('data-flying="true"')
  expect(drawn('stopped', 'That turn is not running any more')).toContain('data-flying="false"')
  // Nothing waiting draws no marker at all, rather than a still one.
  expect(drawn('idle', '')).not.toContain('data-flying')
})
