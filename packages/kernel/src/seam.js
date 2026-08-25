/**
 * THE SEAM (I4). All UI interaction goes through `handle(Request) -> Response`,
 * and nothing else crosses the boundary.
 *
 * **AMENDMENT TO THE RUST DESIGN, STATED.** The predecessor returned HTML
 * FRAGMENTS, because it was htmx with no server: the frontend had no logic with
 * which to repair anything, so the core had to ship finished markup. This build
 * renders with React, which means shipping markup from the core would put the
 * design system inside the state machine and make every visual change a core
 * change. So a `Response` now carries a NAMED, TYPED PROJECTION. The invariant
 * it protects is unchanged and is in fact stricter: the UI may render `data`
 * and may not compute it. A view that needs a number the core did not send is a
 * core bug, not a component bug.
 * @module
 */

/** @typedef {Record<string, string>} Headers */

/** @typedef {{method: string, path: string, headers: Headers, body: Record<string, string>}} Request */

/**
 * One projection: the view's NAME and the data that view renders. `view` is
 * closed by the registry — an unrouted name cannot be produced.
 * @typedef {{status: number, view: string, data: Record<string, unknown>}} Response
 */

/** A GET with no body — the shape most reads take. @returns {Request} */
export function get(/** @type {string} */ path, /** @type {Headers} */ headers = {}) {
  return { method: 'GET', path, headers, body: {} }
}

/** A POST carrying named fields. @returns {Request} */
export function post(
  /** @type {string} */ path,
  /** @type {Record<string, string>} */ body = {},
  /** @type {Headers} */ headers = {},
) {
  return { method: 'POST', path, headers, body }
}

/** Add one header without mutating the request. @returns {Request} */
export function withHeader(/** @type {Request} */ req, /** @type {string} */ name, /** @type {string} */ value) {
  return { ...req, headers: { ...req.headers, [name]: value } }
}

/** Which agent a request is addressed to, or '' for this process's own. */
export function addressee(/** @type {Request} */ req) {
  return req.headers['x-agent'] ?? ''
}

/** A successful projection. @returns {Response} */
export function ok(/** @type {string} */ view, /** @type {Record<string, unknown>} */ data) {
  return { status: 200, view, data }
}

/**
 * The one failure projection. Every error the seam can return has this shape,
 * so the UI has exactly one error component and cannot miss a case.
 * @param {number} status
 * @param {string} message one sentence a person can act on
 * @param {{kind?: string, detail?: string, repair?: string}} [extra]
 * @returns {Response}
 */
export function problem(status, message, extra = {}) {
  return {
    status,
    view: 'problem',
    data: {
      kind: extra.kind ?? 'unknown',
      message,
      detail: extra.detail ?? '',
      repair: extra.repair ?? '',
    },
  }
}

/** Whether a response is the failure projection. One test, not a status guess. */
export function isProblem(/** @type {Response} */ res) {
  return res.view === 'problem'
}
