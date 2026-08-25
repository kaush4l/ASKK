import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'bun:test'

import { Glyph, GLYPH_STATES } from '../components/ui/glyph.jsx'
import { NEEDS_YOU } from '../components/views/dashboard.jsx'
import { Work } from '../components/work/work.jsx'
import { chat } from '../fixtures/transcript.js'
import { dashboard } from '../fixtures/run.js'

const work = renderToStaticMarkup(createElement(Work, { roster: dashboard, transcript: chat }))

/** Where a substring first appears in the rendered Work screen, or -1. */
function at(/** @type {string} */ needle) {
  return work.indexOf(needle)
}

/**
 * WHICH ONE NEEDS ME IS ABOVE THE FOLD BY CONSTRUCTION, NOT BY SORT ORDER.
 *
 * The group that is waiting on a person is FIRST in the document however many
 * agents exist, because the layout gives it a slot only it can fill. Sorting
 * would have been the other fix and it is the wrong one — order is a fact the
 * log owns (I5) — so this asserts the position of the SLOT: the waiting group
 * precedes the transcript, and the transcript precedes the rest of the fleet.
 */
test('the group that needs a person is above the transcript, and the fleet is below it', () => {
  const needsYou = dashboard.groups.find((group) => group.id === NEEDS_YOU)
  expect(needsYou).toBeDefined()
  expect(at(needsYou?.label ?? '')).toBeGreaterThan(-1)
  expect(at(needsYou?.label ?? '')).toBeLessThan(at(chat.composer.promptLabel))
  expect(at(chat.composer.promptLabel)).toBeLessThan(at('At a glance'))
  // …and the group really is late in the projection, so the slot is what did it.
  expect(dashboard.groups.indexOf(/** @type {never} */ (needsYou))).toBe(0)
})

/**
 * THE ACT THE PRODUCT EXISTS FOR IS ON THE FIRST SCREEN. A previous round
 * shipped a Work screen whose text box was below four status panels; the
 * transcript and the thing you type into it come before the fleet's numbers.
 */
test('the transcript and the composer are on the Work screen, above the fleet', () => {
  expect(at(chat.composer.promptLabel)).toBeGreaterThan(-1)
  expect(at('Not running — 2 agents')).toBeGreaterThan(at(chat.composer.promptLabel))
})

/**
 * SHAPE CARRIES LIVENESS. Every state the roster can be in draws a DIFFERENT
 * outline, so a greyscale screenshot and a colourblind reader still separate a
 * failed agent from an idle one. Two states sharing a path is the defect this
 * replaced — one dot in six colours — and it would pass any test that only
 * counted marks.
 */
test('every status on the Work screen draws a shape, and no two shapes are alike', () => {
  const rendered = dashboard.groups.flatMap((group) => group.rows.map((row) => row.status))
  for (const status of rendered) expect(GLYPH_STATES).toContain(status)
  expect(new Set(rendered).size).toBe(6)

  // The MARK, not the path data: a disc and a ring are one outline filled two
  // ways, and it is the pair a reader tells apart, not the `d`.
  const marks = GLYPH_STATES.map((status) => renderToStaticMarkup(createElement(Glyph, { status })))
  expect(new Set(marks).size).toBe(GLYPH_STATES.length)
  for (const status of rendered) expect(work).toContain('data-status="' + status + '"')
})
