'use client'

import { useSyncExternalStore } from 'react'

import { agentFrom } from '@/lib/agent'

function subscribe(/** @type {() => void} */ onChange) {
  window.addEventListener('popstate', onChange)
  return () => window.removeEventListener('popstate', onChange)
}

/**
 * WHO THE SCREEN IS ABOUT, out of the address.
 *
 * `useSyncExternalStore` and not a `useEffect`, because the address is a store
 * this component does not own and the server snapshot is a different value from
 * the client one: it is `''` during the static export, since there is no
 * address at build time. Saying so is what stops React from hydrating the
 * exported HTML against a query string that only exists in the browser.
 *
 * READ ONLY, and it stays that way until there is a control that writes. The
 * picker lands in increment 2 and brings the writer with it; a `setAgent`
 * nothing can call is a path no person walks and a test that reads as coverage
 * for behaviour the product does not have.
 *
 * @returns {{agent: string, search: string, misrouted: string}}
 */
export function useAgent() {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => '')
  return {
    agent: agentFrom(search),
    search,
    // The address a person was moved OFF, put here by `app/not-found.jsx`.
    misrouted: new URLSearchParams(search).get('misrouted') ?? '',
  }
}
