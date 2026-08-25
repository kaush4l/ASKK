import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'bun:test'

import { STATUSES, ok, problem } from '@harness/kernel'

import { Glyph, GLYPH_STATES } from '../components/ui/glyph.jsx'
import { NEEDS_YOU } from '../components/views/dashboard.jsx'
import { Work } from '../components/work/work.jsx'
import { drawable } from '../lib/chat.js'
import { chat } from '../fixtures/transcript.js'
import { dashboard } from '../fixtures/run.js'
import { screen } from './doubles.js'

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
 * THE CORE'S TRANSCRIPT REACHES THE SCREEN, AND IT REACHES IT VERBATIM.
 *
 * `GET /chat` answers with `messages` whose `said` is a plain string; this pane
 * draws `rows` of typed blocks. `lib/chat.js` lifts one into the other, and
 * what is asserted here is that the lift CARRIES THE CHARACTERS and invents no
 * structure: one row in, one row out, the same text, no heading recovered from
 * a line that starts with a hash.
 */
test('a transcript the core worded is drawn, and nothing is parsed out of it', () => {
  const theirs = ok('chat', {
    agent: 'main',
    messages: [{ id: 'e1', kind: 'user', speaker: 'You', said: '# not a heading' }],
  })
  const drawn = drawable(theirs)
  expect(drawn.view).toBe('chat')
  const rows = /** @type {ReadonlyArray<import('../components/views/chat').Said>} */ (drawn.data.rows)
  expect(rows).toHaveLength(1)
  expect(rows[0]?.blocks).toEqual([{ kind: 'paragraph', spans: [{ kind: 'text', text: '# not a heading' }] }])
  expect(screen(drawn)).toContain('# not a heading')
  // …and the pane it produced really does put a box on the screen, which is
  // the whole of what a person needs to say the next thing.
  expect(screen(drawn)).toContain('<textarea')
})

/**
 * A TRANSCRIPT IN NEITHER SHAPE IS A STATED FAILURE AND NOT A WHITE PAGE. The
 * likeliest intermediate of the reconciliation is a half-migrated projection,
 * and `Chat` hands `data.composer` straight to `Composer`, which reads a field
 * off it — a TypeError during render, and nothing in this app is a boundary.
 */
test('a transcript in neither shape becomes a stated failure', () => {
  const neither = drawable(ok('chat', { agent: 'main' }))
  expect(neither.view).toBe('problem')
  expect(neither.data.kind).toBe('projection_mismatch')

  const half = drawable(ok('chat', { ...chat, composer: undefined }))
  expect(half.data.kind).toBe('projection_mismatch')

  // A transcript already in this pane's shape is handed back UNTOUCHED, so the
  // day the core sends blocks the bridge is a pass-through and can go.
  const ours = ok('chat', { ...chat })
  expect(drawable(ours)).toBe(ours)
})

/**
 * THE SCREEN RENDERS THE SHAPE THE CORE ACTUALLY SENDS — written out by hand,
 * in `packages/core/src/dashboard.js`'s own field names, rather than taken from
 * the fixture, so this fails if either side drifts.
 *
 * IT IS ALSO THE EPITAPH FOR `lib/roster.js`. For two increments `GET /`
 * answered with a FLAT `rows` list while this screen drew groups, and the band
 * read `data.groups.find(...)` off it, threw mid-render, and Next's default
 * boundary replaced the whole application with "This page couldn't load" — no
 * message, no console, nothing. A bridge stated that instead. The core groups
 * by state now, so the bridge is deleted and the sentence it held is
 * unreachable rather than guarded.
 */
test('the core’s own grouped dashboard renders the band, the glance and the fleet', () => {
  const roster = ok('dashboard', {
    tiles: { emptyNote: 'Nothing has happened on this page yet.', tiles: [{ id: 'agents', label: 'Agents', value: '2 agent files', note: 'Loaded in this browser.' }] },
    groups: [
      { id: 'waiting', label: 'Needs you — 1 agent', rows: [{ name: 'critic', status: 'waiting', statusLabel: 'Waiting on you', detail: 'Asked a question.' }] },
      { id: 'resting', label: 'Not running — 1 agent', rows: [{ name: 'main', status: 'idle', statusLabel: 'Idle', detail: 'No turn has ended here yet.' }] },
    ],
    rosterEmptyNote: 'No agents are loaded.',
    runningLabel: 'Nothing is running.',
  })
  const transcript = ok('chat', {
    agent: 'main', stageLabel: 'main · ready', emptyNote: 'Nothing has been said to main yet.',
    waitingLabel: '', waitingStatus: 'idle',
    messages: [{ id: 'e1', kind: 'user', speaker: 'You', said: 'does the endpoint answer?' }],
  })
  const html = renderToStaticMarkup(createElement(Work, { roster, transcript: drawable(transcript) }))
  expect(html).toContain('Needs you — 1 agent')
  expect(html).toContain('2 agent files')
  expect(html).toContain('Not running — 1 agent')
  expect(html).toContain('does the endpoint answer?')
  expect(html).toContain('<textarea')
  // The band is the SLOT and not a filter over the list: the waiting group is
  // rendered once, at the top, and never again among the rest of the fleet.
  expect(html.split('Needs you — 1 agent')).toHaveLength(2)
  expect(html.indexOf('Needs you — 1 agent')).toBeLessThan(html.indexOf('does the endpoint answer?'))
})
