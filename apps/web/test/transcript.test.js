import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'bun:test'

import { Inspector } from '../components/ui/inspector.jsx'
import { Markdown } from '../components/ui/markdown.jsx'

/** @param {unknown} data */
function call(data) {
  return renderToStaticMarkup(createElement(Inspector, /** @type {never} */ ({ data })))
}

const base = { id: 'c1', row: 'call', name: 'read_page', argsLabel: 'url="x"' }

/**
 * ONE LINE WHILE IT RUNS, OPEN WHEN IT HAS SOMETHING TO READ.
 *
 * These are the two states a person actually watches, and getting them the same
 * way round is the whole reason the inspector exists: a running call that takes
 * a paragraph to say it has no answer yet pushes the transcript off the screen,
 * and a finished call that hides its output makes every result a press.
 */
test('a call in flight is one line; a call that finished opens itself', () => {
  const running = call({ ...base, status: 'calling', statusLabel: 'Running — 14s', resultLabel: '' })
  expect(running).not.toContain('<details')
  expect(running).toContain('data-flying="true"')

  const done = call({ ...base, status: 'ok', statusLabel: 'Finished in 0.8s', resultLabel: 'HTTP 200' })
  expect(done).toContain('<details')
  expect(done).toContain('open=""')
  expect(done).toContain('HTTP 200')

  // …and a failure opens too. A result nobody reads is worse when it is the
  // one explaining why the turn stopped.
  const failed = call({ ...base, status: 'failed', statusLabel: 'Refused', resultLabel: 'no allow-origin' })
  expect(failed).toContain('open=""')
  expect(failed).toContain('data-flying="false"')
})

/**
 * A REPLY IS A TREE, AND THAT IS WHAT MAKES IT SAFE.
 *
 * The core parses markdown into typed nodes and this renders one element per
 * node, so there is no point in the path where markup a model wrote becomes
 * markup the page runs. Not a sanitizer — a sanitizer is a list of what to
 * remove, and a list is a thing that can be short. This test executes the claim
 * on the exact payload the argument is about.
 */
test('markup inside a reply is text, whichever node kind carries it', () => {
  const attack = '<img src=x onerror=alert(1)>'
  const html = renderToStaticMarkup(createElement(Markdown, {
    blocks: [
      { kind: 'paragraph', spans: [{ kind: 'text', text: attack }] },
      { kind: 'code', langLabel: 'html', text: attack },
      { kind: 'bullets', items: [[{ kind: 'strong', text: attack }]] },
    ],
  }))
  expect(html).not.toContain('<img')
  expect(html).toContain('&lt;img')
  // …and the nodes really did become elements, rather than one escaped blob.
  expect(html).toContain('data-node="code"')
  expect(html).toContain('data-node="bullets"')
  expect(html).toContain('<strong')
})
