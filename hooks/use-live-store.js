"use client"

import { useEffect, useMemo, useSyncExternalStore } from "react"

const noSubscribe = () => () => {}
const noSnapshot = () => null

// A live store (LiveTree, TermActivity, TermView: start(), close(), subscribe, getSnapshot) made by `create` when the
// view needs it — `create` returns null for none — started with the view and closed after it; its snapshot, null
// without one. `deps` say when it is made again.
export function useLiveStore(create, deps) {
  const store = useMemo(create, deps)
  useEffect(() => {
    store?.start()
    return () => store?.close()
  }, [store])
  return useSyncExternalStore(store?.subscribe ?? noSubscribe, store?.getSnapshot ?? noSnapshot, noSnapshot)
}
