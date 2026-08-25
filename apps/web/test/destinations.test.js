import { expect, test } from 'bun:test'

import { ALL, GALLERY, NAV, WORK, land, subjectOf } from '../lib/destinations.js'

/**
 * THE COUNT IS THE CLAIM. The predecessor's diagnosis was that seven equal
 * entries — two of them instruments for the person building the product — is a
 * map nobody can hold, and it spent a round folding them into three. A test
 * that cannot fail on the number would let the next round add an eighth back
 * one destination at a time.
 */
test('the map is three destinations, and the gallery is not one of them', () => {
  expect(NAV.map((d) => d.label)).toEqual(['Work', 'Agents', 'Setup'])
  expect(NAV).not.toContain(GALLERY)
  expect(ALL).toContain(GALLERY)
})

/**
 * …AND EVERY ADDRESS THE PRODUCT HAS EVER SHIPPED STILL LANDS SOMEWHERE REAL.
 * Six of these named a destination that no longer exists; a link already sent
 * must not reach a misroute note because the architecture changed underneath it.
 */
test('the names the run absorbed resolve to the screen that absorbed them', () => {
  for (const old of ['dashboard', 'chat', 'trace', 'debug', 'commands', 'workspace']) {
    const landing = land(`/${old}/`)
    expect(landing.kind).toBe('absorbed')
    expect(landing.to.label).toBe('Work')
  }
  expect(land('/settings/').to.label).toBe('Setup')
  expect(land('/tools/').to.label).toBe('Agents')
})

/** A REDIRECT AND A MISROUTE ARE DIFFERENT EVENTS, and the kind is what says so. */
test('an address nobody shipped is unknown, names itself, and still lands on Work', () => {
  const landing = land('/wharrgarbl/')
  expect(landing.kind).toBe('unknown')
  expect(landing.to.label).toBe('Work')
  expect(landing.kind === 'unknown' && landing.was).toBe('wharrgarbl')
})

test('a real destination is not accused of anything', () => {
  for (const to of ALL) expect(land(to.path).kind).toBe('here')
  expect(land('/').to.label).toBe('Work')
  // A bare load names nothing, so it mistook nothing.
  expect(land('').kind).toBe('here')
})

/**
 * THE DEPLOY IS SERVED UNDER A SUBPATH. Every address in this product arrives
 * with `/ASKK` on the front, and a resolver that forgot it would report every
 * real destination as a misroute on the only build that ships.
 */
test('the base path is stripped before the slug is read', () => {
  expect(land('/ASKK/agents/', '/ASKK').to.label).toBe('Agents')
  expect(land('/ASKK/', '/ASKK').to.label).toBe('Work')
  expect(land('/ASKK/trace/', '/ASKK').kind).toBe('absorbed')
  // …and only from the front: a destination that happens to repeat the name.
  expect(land('/ASKK/ASKK/', '/ASKK').kind).toBe('unknown')
})

/**
 * THE PLATE NAMES THE SUBJECT AND NEVER THE VIEW'S OWN NAME (DESIGN.md §1). A
 * mockup whose largest element is the name of the screen you are on is
 * rejected, and the one register this product allows itself is the place that
 * mistake would land.
 */
test('no destination puts its own label in the display register', () => {
  for (const to of ALL) {
    expect(subjectOf(to, 'scout')).not.toBe(to.label)
  }
  expect(subjectOf(WORK, 'scout')).toBe('scout')
})

/**
 * THE THIRD SLUG-KEYED REGISTRY IS GONE: the region's heading and note are
 * fields on the destination itself, so `tsc` is what now catches a destination
 * with no copy. What it cannot catch is copy that is PRESENT AND EMPTY, or one
 * screen wearing another's words — which is what the second registry actually
 * produced when it drifted.
 */
test('every destination says what its region is, in words nobody else uses', () => {
  for (const to of ALL) {
    expect(to.heading.length).toBeGreaterThan(0)
    expect(to.note.length).toBeGreaterThan(0)
  }
  expect(new Set(ALL.map((to) => to.heading)).size).toBe(ALL.length)
  expect(new Set(ALL.map((to) => to.note)).size).toBe(ALL.length)
})
