import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'bun:test'

import { ok } from '@harness/kernel'

import { KeyField } from '../components/ui/keyfield.jsx'
import { Settings } from '../components/views/settings.jsx'
import { View } from '../components/views/index.jsx'
import { agents, settings, tools } from '../fixtures/shape.js'
import { screen } from './doubles.js'

/**
 * AGENTS AND SETUP ARE WIRED, AND THESE ARE THE SHAPES THAT ARRIVE.
 *
 * Both screens said `Not wired to the seam yet` for five increments. The
 * fixtures they were designed against were the shapes the interface would have
 * PREFERRED — `entries`/`problems` on the roster, an `addressLabel` on an
 * endpoint — and none of them is what `packages/core` sends. So each projection
 * here is written out by hand in the core's own field names rather than taken
 * from the fixture, which is what makes this a check on the seam and not on
 * this repository's ability to copy an object.
 */

test('the roster the core projects renders every agent, its file and its model', () => {
  const html = screen(ok('agents', {
    rows: [{
      id: 'main', name: 'main', path: 'agents/main/agent.md', originLabel: 'shipped with this build',
      modelLabel: 'gemma-3-12b-it', toolsLabel: 'web_search, read_file', removable: false, isMe: true,
    }],
    refusals: [],
    emptyNote: '',
  }))
  for (const said of ['main', 'agents/main/agent.md', 'shipped with this build', 'gemma-3-12b-it', 'web_search, read_file']) {
    expect(html).toContain(said)
  }
})

/**
 * A FILE THAT WOULD NOT LOAD IS A ROW, KEYED BY WHAT IT IS ABOUT.
 *
 * `problem.id` exists because failures arrive in LISTS: two agents missing from
 * one manifest is two 404s with identical prose, so keying them on `kind` or on
 * the message reconciles one row over the other (docs/SEAM.md). Both refusals
 * below have the same kind and the same wording and differ only in the path.
 */
test('two agents that failed the same way are two rows, not one', () => {
  const same = { kind: 'unreadable_agent', message: 'The file could not be read.', detail: '404', repair: '' }
  const html = screen(ok('agents', {
    rows: [], emptyNote: 'No agent file loaded, so this build has nobody to talk to.',
    refusals: [{ ...same, id: 'agents/one/agent.md' }, { ...same, id: 'agents/two/agent.md' }],
  }))
  expect(html).toContain('agents/one/agent.md')
  expect(html).toContain('agents/two/agent.md')
  expect(html.split('data-kind="unreadable_agent"')).toHaveLength(3)
  // …and the roster above them says what an empty one means, rather than being
  // a blank box between two failures.
  expect(html).toContain('No agent file loaded, so this build has nobody to talk to.')
})

/**
 * A TOOL THAT WOULD NOT RUN SAYS SO WHERE IT IS LISTED. A tool offered to a
 * model in a build with nothing behind it costs the person the turn it takes to
 * find out — which is the whole argument for the third column (I6, I15).
 */
test('a tool that does not resolve is drawn as failed and says why', () => {
  const html = screen(ok('tools', { ...tools, resolvedLabel: '3 of 4 resolve in this build.' }))
  expect(html).toContain('data-status="failed"')
  expect(html).toContain('This build cannot use this device’s voice, so this tool is not offered to the model.')
  expect(html).toContain('3 of 4 resolve in this build.')
})

/**
 * THE CATALOGUE SAYS WHETHER A KEY IS SET AND NEVER WHAT IT IS.
 *
 * There is no path from the projection to a credential — `readEndpoints`
 * returns `hasKey`, a boolean, and no function in the broker returns a key at
 * all — so this asserts the property the screen is responsible for: the
 * rendered document carries the sentence and nothing that could be a secret.
 */
test('an entry with a key saved says so, and the key is nowhere in the document', () => {
  const html = screen(ok('settings', settings))
  expect(html).toContain('A key is saved for this entry.')
  expect(html).toContain('http://127.0.0.1:1234/v1')
  expect(html).not.toContain('apiKey=')
  expect(html).toMatch(/type="password"/)
  expect(html).not.toMatch(/<input[^>]*\bvalue=/)
})

/**
 * …AND EVERY CONTROL WITH NOTHING BEHIND IT SAYS WHY IT IS DISABLED.
 *
 * A disabled control whose reason is unstated is the dead switch this product
 * keeps deleting — a header offering `Hide workspace files` over a region that
 * was `display: none`. Two of them live on this screen and they are disabled
 * for two DIFFERENT reasons, which is why each carries its own sentence.
 */
test('the catalogue with nothing attached, and the key with nothing picked, each say so', () => {
  const loose = renderToStaticMarkup(createElement(Settings, { data: { ...settings, selected: '' } }))
  expect(loose).toContain('this catalogue is not attached to a running build')
  expect(loose).toContain('No entry is picked, so there is nothing for a key to belong to.')

  const attached = renderToStaticMarkup(createElement(Settings, {
    data: settings, onSelect: () => {}, onSaveKey: () => {},
  }))
  expect(attached).not.toContain('this catalogue is not attached to a running build')
  expect(attached).not.toContain('No entry is picked')
  // The entry in force is the one the credential door will write to, and the
  // press states that it is chosen rather than only tinting itself.
  expect(attached).toContain('aria-pressed="true"')
})

/** The one field in this product that is write-only, and it starts empty every time. */
test('the key field is never rendered holding a value', () => {
  const html = renderToStaticMarkup(createElement(KeyField, {
    note: settings.keyNote, disabledLabel: '', onSave: () => {},
  }))
  expect(html).toContain(settings.keyNote)
  expect(html).toMatch(/autocomplete="off"/i)
  expect(html).not.toMatch(/value=/)
})

/** Every agent the fixture carries is on the screen the gallery shows a critic. */
test('the agents fixture is what the gallery renders', () => {
  const html = renderToStaticMarkup(createElement(View, { view: 'agents', data: agents }))
  for (const row of agents.rows) expect(html).toContain(row.path)
})
