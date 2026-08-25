'use client'

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import { BASE } from '@/lib/base'
import { openSession } from '@/lib/session'

/** @typedef {import('@/lib/session').Session} Session */
/** @typedef {import('@harness/kernel').Request} Request */

/**
 * ONE APPLICATION PER DOCUMENT, AND THE PROMISE IS WHAT MAKES IT ONE.
 *
 * `openSession` opens this browser's storage and replays its log, so two of
 * them is two applications appending to one store and disagreeing about what is
 * in it. It used to be called from the effect directly, which was one boot only
 * because exactly one component called the hook — Strict mode's double mount
 * already made two, and this increment puts a second pane on the Work screen.
 * Memoised here rather than in `lib/session.js` so a test still opens its own.
 * @type {Promise<Session>|null}
 */
let opening = null

/**
 * THE APPLICATION, ONCE PER DOCUMENT.
 *
 * `null` while it is coming up, and it is a THIRD state rather than a failure
 * with an optimistic default: a shell that renders "nothing is running" during
 * boot has asserted something it does not know, which is the defect the strip
 * of em-dashes was removed for.
 *
 * The effect is the only place boot can start — `openSession` reaches for the
 * browser and the static export has no browser.
 * @returns {Session|null}
 */
export function useSession() {
  const [session, setSession] = useState(/** @type {Session|null} */ (null))
  useEffect(() => {
    let live = true
    opening ??= openSession(BASE + '/')
    void opening.then((opened) => {
      if (live) setSession(opened)
    })
    // A component that unmounts before boot returns drops the hand-back rather
    // than setting state into a tree that is gone; the boot itself carries on,
    // because it is the document's and not this component's.
    return () => { live = false }
  }, [])
  return session
}

/**
 * ONE PROJECTION, RE-READ WHENEVER THE LOG HAS GROWN.
 *
 * The counter is what `useSyncExternalStore` compares, not the projection: a
 * projection is a fresh object every call, so returning one as the snapshot
 * would tell React the store changed on every render and never stop. The
 * projection is read AFTER the counter moves, which is the whole subscription
 * model the seam offers (docs/SEAM.md: `subscribe` is the only signal).
 *
 * Nothing is kept between reads. Navigating away and back re-reads the log, so
 * a turn in flight is still in flight — it was never in this component.
 * @param {Session} session must be `ready`; a failed one has no seam
 * @param {Request} request
 * @returns {import('@harness/kernel').Response}
 */
export function useProjection(session, request) {
  const version = useSyncExternalStore(session.subscribe, session.version, session.version)
  const address = request.method + ' ' + request.path + ' ' + (request.headers['x-agent'] ?? '')
  // `address` IS the request's identity: the object it arrived in is rebuilt
  // on every render, so it can never be the thing that is compared.
  return useMemo(() => session.read(request), [session, address, version])
}
