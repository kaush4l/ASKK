import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { View } from '../components/views/index.jsx'

/**
 * THE FROZEN PAIR, OVER A GIVEN THREE (docs/SEAM.md). A session is opened over
 * this instead of `@harness/adapters-web` because these tests run on the host,
 * where there is no IndexedDB for the real `bootBrowser` to open (I3) — and
 * `lib/session.js` now types itself against the real export, so what goes
 * through here is checked against the door the browser opens.
 *
 * The cast is why this lives in one place: no double READS the App — each
 * closes over its own log — so the object only has to carry the type the real
 * signature promises.
 * @param {ReturnType<import('@/lib/session').Wiring['attach']>} attached
 * @returns {import('@/lib/session').Wiring}
 */
export function wiring(attached) {
  return {
    bootBrowser: async () => /** @type {import('@harness/core').App} */ ({}),
    attach: () => attached,
  }
}

/** What one projection puts on the screen, through the same registry the product uses. */
export function screen(/** @type {import('@harness/kernel').Response} */ response) {
  return renderToStaticMarkup(createElement(View, { view: response.view, data: response.data }))
}
