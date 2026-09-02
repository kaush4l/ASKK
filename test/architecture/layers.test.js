import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The layer rule, executed instead of asserted.
 *
 * `ARCHITECTURE.md` says dependencies point inward only and that `app/` never
 * imports `backend/` or `core/`. For four waves it also said the realm ENFORCED
 * that — "a component cannot import a service … the import would fail at
 * runtime" — and that was false: `Kernel`, `Workspace` and every service are
 * ordinary modules that run perfectly well in a page. A component that imported
 * one would bypass the whole protocol and WORK, and lint, tests, build and smoke
 * would all stay green over it.
 *
 * A rule with no consequence is a convention, and this file is the consequence.
 * It is deliberately the crudest possible check — the text of the import lines —
 * because the thing it guards against is someone writing one.
 *
 * The other direction needs no test here: a worker file that reaches for the DOM
 * fails when the realm runs it, and `docs/GATE.md` measures which step notices.
 */
const APP = new URL('../../src/app', import.meta.url).pathname
const CLIENT = new URL('../../src/client', import.meta.url).pathname

/** Every `from '...'` specifier in a file, static and dynamic alike. */
function imports(text) {
  return [...text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((found) => found[1])
}

const filesIn = (dir) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(jsx?|tsx?)$/.test(entry.name))
    .map((entry) => join(dir, entry.name))

describe('dependencies point inward only', () => {
  test('nothing in app/ imports backend/ or core/', () => {
    const crossings = []
    for (const file of filesIn(APP)) {
      for (const specifier of imports(readFileSync(file, 'utf8'))) {
        // `protocol/` is allowed and is the point: it is the one module both
        // realms share, and a component reads event names off it rather than
        // spelling them a second time.
        if (/(^|\/)(backend|core)\//.test(specifier))
          crossings.push(`${file.slice(APP.length + 1)} imports ${specifier}`)
      }
    }
    expect(crossings).toEqual([])
  })

  /**
   * And the one seam allowed to know both realms exist. `client/` speaks the
   * wire and nothing else: a client that imported a service would be the page
   * holding the backend directly, with the transport left as decoration.
   */
  test('nothing in client/ imports backend/', () => {
    const crossings = []
    for (const file of filesIn(CLIENT)) {
      for (const specifier of imports(readFileSync(file, 'utf8'))) {
        if (/(^|\/)backend\//.test(specifier))
          crossings.push(`${file.slice(CLIENT.length + 1)} imports ${specifier}`)
      }
    }
    expect(crossings).toEqual([])
  })

  /**
   * The check has to be able to fail. A reader that matched nothing would pass
   * this suite for ever while the rule it stands for rotted, which is exactly
   * the failure the sentence in `ARCHITECTURE.md` had.
   */
  test('the reader catches a crossing when there is one', () => {
    const planted =
      "import { Kernel } from '../backend/Kernel.js'\nimport { useState } from 'react'\n"
    const found = imports(planted).filter((specifier) => /(^|\/)(backend|core)\//.test(specifier))
    expect(found).toEqual(['../backend/Kernel.js'])
  })
})
