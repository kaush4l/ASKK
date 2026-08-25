'use client'

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import { BASE } from '@/lib/base'
import { openSession } from '@/lib/session'

/** @typedef {import('@/lib/session').Session} Session */
/** @typedef {import('@harness/kernel').Request} Request */

/**
 * THE APPLICATION, ONCE PER DOCUMENT.
 *
 * `null` while it is coming up, and it is a THIRD state rather than a failure
 * with an optimistic default: a shell that renders "nothing is running" during
 * boot has asserted something it does not know, which is the defect the strip
 * of em-dashes was removed for.
 *
 * The effect is the only place boot can happen — `openSession` reaches for the
 * browser and the static export has no browser — and it is why this hook exists
 * at all rather than a module-level promise.
 * @returns {Session|null}
 */
export function useSession() {
  const [session, setSession] = useState(/** @type {Session|null} */ (null))
  useEffect(() => {
    let live = true
    void openSession(BASE + '/').then((opened) => {
      if (live) setSession(opened)
    })
    // Strict mode mounts twice; the second boot wins and the first is dropped
    // rather than left to set state into an unmounted tree.
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
