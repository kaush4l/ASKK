// REALM: main
/**
 * The React binding, and the **read** side only (§5.8 rule 3). Subscribe and
 * render; writing is `actions.ts`, which is a plain function call and not a
 * hook, because the Door's on-load probe fires before any surface has mounted.
 *
 * `useSyncExternalStore`'s third argument is the server snapshot. This build is
 * a static export, so React renders the tree once at build time with no worker
 * anywhere; the same starting view is the honest answer there, and omitting it
 * is a prerender crash rather than a fallback.
 */

import { useSyncExternalStore } from 'react'
import { snapshot, watch } from '@/client/store'
import type { EngineView } from '@/client/store'

export function useEngine(): EngineView {
  return useSyncExternalStore(watch, snapshot, snapshot)
}
