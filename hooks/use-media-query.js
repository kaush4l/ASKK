"use client"

import { useSyncExternalStore } from "react"

// Whether a media query matches, live. `server` is what the server render and the first client render say.
export function useMediaQuery(query, server = false) {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query)
      mql.addEventListener("change", onChange)
      return () => mql.removeEventListener("change", onChange)
    },
    () => window.matchMedia(query).matches,
    () => server
  )
}
