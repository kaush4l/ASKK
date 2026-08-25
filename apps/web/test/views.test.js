import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'bun:test'

import { VIEWS, View } from '../components/views/index.jsx'
import { FIXTURES } from '../fixtures/index.js'

const seam = await Bun.file(new URL('../../../docs/SEAM.md', import.meta.url)).text()

/**
 * The View column of the frozen route table, plus `problem` — which the table
 * does not have a row for because it is what ANY route returns on failure, and
 * the document names it in its own section instead.
 */
function viewsTheSeamCanReturn() {
  const rows = [...seam.matchAll(/^\|\s*(?:GET|POST)\s*\|[^|]*\|\s*`([a-z]+)`\s*\|/gm)]
  expect(rows.length).toBeGreaterThan(20)
  const names = rows.flatMap((row) => (row[1] ? [row[1]] : []))
  return new Set([...names, 'problem'])
}

/**
 * THE CLAIM THIS INCREMENT IS MADE OF, EXECUTED. `docs/SEAM.md` is frozen and
 * the registry is a lookup table, so "every view name gets exactly one
 * component" is a set comparison rather than a habit. Add a row to the table
 * and this fails until the component exists; add a component for a state that
 * cannot happen and it fails the other way.
 */
test('the registry is exactly the set of views the seam can return', () => {
  const names = new Set(Object.keys(VIEWS))
  expect(names).toEqual(viewsTheSeamCanReturn())
})

/**
 * …AND EVERY ONE OF THEM CAN BE LOOKED AT BEFORE IT SHIPS. A component with no
 * fixture is a state nobody can reject without running an agent, which is how
 * the predecessor's gallery came to list six components that did not exist.
 */
test('every view has a fixture, and no fixture belongs to no view', () => {
  expect(new Set(Object.keys(FIXTURES))).toEqual(new Set(Object.keys(VIEWS)))
})

/**
 * A COMPONENT AND ITS PROJECTION AGREE, and this is what proves it: every view
 * is rendered against the fixture the gallery shows it with. A component that
 * reads a field its fixture does not carry throws here rather than on screen.
 */
test('every view renders its own fixture', () => {
  for (const name of Object.keys(VIEWS)) {
    const html = renderToStaticMarkup(createElement(View, { view: name, data: FIXTURES[name] }))
    expect(html.length).toBeGreaterThan(0)
    expect(html).not.toContain('no_such_view')
  }
})

/**
 * A VIEW THE TABLE DOES NOT LIST CANNOT BE PRODUCED — and if one ever is, the
 * page says which name arrived instead of rendering nothing. Silence is the
 * predecessor's defect in a new place: an address that named no view landed you
 * somewhere else and no word on the page mentioned it.
 */
test('an unknown view name renders the problem projection, naming the name', () => {
  const html = renderToStaticMarkup(createElement(View, { view: 'wharrgarbl', data: undefined }))
  expect(html).toContain('no_such_view')
  expect(html).toContain('wharrgarbl')
})

/**
 * I5, at the boundary the gate cannot see: `check-viewmodel.js` greps the
 * source, and this asserts the RENDERED page carries only what the projection
 * carried. The transcript fixture holds markup-looking text on purpose — a
 * model saying `<script>` into a chat is not an exotic case — and JSX escaping
 * it is the structural reason no sanitizer is needed.
 */
test('a projection that contains markup is rendered as text', () => {
  const said = '<script>alert(1)</script>'
  const data = { kind: 'x', message: said, detail: said, repair: '' }
  const html = renderToStaticMarkup(createElement(View, { view: 'problem', data }))
  expect(html).not.toContain('<script>')
  expect(html).toContain('&lt;script&gt;')
})
