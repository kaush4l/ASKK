import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'bun:test'

import { STATUSES, ok, problem } from '@harness/kernel'

import { Glyph, GLYPH_STATES } from '../components/ui/glyph.jsx'
import { NEEDS_YOU } from '../components/views/dashboard.jsx'
import { Work } from '../components/work/work.jsx'
import { renderable } from '../components/work/live-work.jsx'
import { chat } from '../fixtures/transcript.js'
import { dashboard } from '../fixtures/run.js'

const work = renderToStaticMarkup(createElement(Work, { roster: ok('dashboard', dashboard), transcript: ok('chat', chat) }))

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
  // …and the group really is LAST in the projection, so the slot is what did
  // it: an in-order map over `groups` would put this label after every other.
  expect(dashboard.groups.indexOf(/** @type {never} */ (needsYou))).toBe(dashboard.groups.length - 1)
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

/**
 * THE MAP IS TOTAL OVER THE VOCABULARY THE CORE CAN ACTUALLY SEND.
 *
 * It was not: the six keys read `working`, `starting` and `closed`, so
 * `thinking`, `calling` and `stopped` — three of the kernel's six — drew NO
 * MARK, and nothing failed, because `Glyph` renders nothing for a status it has
 * never heard of. That is the right behaviour for an unknown status and the
 * wrong outcome for a known one, and only a test that reads `STATUSES` can tell
 * the two apart. Widen the kernel's vocabulary and this fails here.
 */
test('every status the kernel can send draws a mark, and no two of them are alike', () => {
  for (const status of STATUSES) {
    expect(GLYPH_STATES).toContain(status)
    expect(renderToStaticMarkup(createElement(Glyph, { status }))).not.toBe('')
  }
  const marks = STATUSES.map((status) => renderToStaticMarkup(createElement(Glyph, { status })))
  expect(new Set(marks).size).toBe(STATUSES.length)
})

/**
 * A PANE THAT COULD NOT BE PROJECTED TAKES ONLY ITS OWN SLOT.
 *
 * A build that serves `/chat` and not `/` is a real state of this system, and
 * one 404 used to replace the whole screen — including the transcript that had
 * projected perfectly well. The screen COMPOSES panes; a failed one says so
 * where it sits and the rest of the screen still works.
 */
test('a roster that could not be projected does not take the transcript with it', () => {
  const refused = problem(404, 'Nothing here answers GET /.', { kind: 'no_route', id: '/' })
  const html = renderToStaticMarkup(createElement(Work, { roster: refused, transcript: ok('chat', chat) }))
  expect(html).toContain('Nothing here answers GET /.')
  expect(html).toContain(chat.composer.promptLabel)
  expect(html).toContain('Find out whether Firecrawl still answers without a key.')
})

/**
 * THE DISAGREEMENT IS ON THE SCREEN AND NOT A WHITE PAGE. The core projects a
 * transcript this interface cannot draw (`live-work.jsx`, `renderable`), and
 * the branch that says so is executed here — because the day the shapes agree,
 * this test failing is the signal that the bridge can go.
 */
test('a transcript in a shape this interface cannot draw becomes a stated failure', () => {
  const theirs = ok('chat', { agent: 'main', messages: [{ id: 'e1', kind: 'user', speaker: 'You', said: 'hello' }] })
  const said = renderable(theirs)
  expect(said.view).toBe('problem')
  expect(said.data.kind).toBe('projection_mismatch')

  // …AND A TRANSCRIPT WITH THE ROWS BUT NOT THE COMPOSER IS THE SAME FAILURE.
  // `Chat` hands `data.composer` straight to `Composer`, which reads a field off
  // it, so this shape is a TypeError during render — a blank document, since
  // nothing in this app is a boundary — and it is the likeliest intermediate of
  // the reconciliation this bridge is waiting on.
  const half = renderable(ok('chat', { ...chat, composer: undefined }))
  expect(half.data.kind).toBe('projection_mismatch')

  const ours = ok('chat', { ...chat })
  expect(renderable(ours)).toBe(ours)
})
