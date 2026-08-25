'use client'

import { useCallback, useSyncExternalStore } from 'react'

import { agentFrom, searchWith } from '@/lib/agent'

/** The address changed without a navigation — this file's own writes. */
const CHANGED = 'harness:agentchange'

function subscribe(/** @type {() => void} */ onChange) {
  window.addEventListener('popstate', onChange)
  window.addEventListener(CHANGED, onChange)
  return () => {
    window.removeEventListener('popstate', onChange)
    window.removeEventListener(CHANGED, onChange)
  }
}

/**
 * WHO THE SCREEN IS ABOUT, out of the address and back into it.
 *
 * `useSyncExternalStore` and not a `useEffect`, because the address is a store
 * this component does not own and the server snapshot is a different value from
 * the client one: it is `''` during the static export, since there is no
 * address at build time. Saying so is what stops React from hydrating the
 * exported HTML against a query string that only exists in the browser.
 *
 * @returns {{agent: string, search: string, misrouted: string, setAgent: (name: string) => void}}
 */
export function useAgent() {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => '')
  const setAgent = useCallback(
    /** @param {string} name */ (name) => {
      // PUSH, not replace: choosing another agent is a move, and a person who
      // presses Back after it is undoing a selection they can see.
      window.history.pushState(null, '', window.location.pathname + searchWith(window.location.search, name))
      window.dispatchEvent(new Event(CHANGED))
    },
    [],
  )
  return {
    agent: agentFrom(search),
    search,
    // The address a person was moved OFF, put here by `app/not-found.jsx`.
    misrouted: new URLSearchParams(search).get('misrouted') ?? '',
    setAgent,
  }
}
