"use client"

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react"

import { engineRegistry } from "@/backend/runtime/registry"

const noopSubscribe = () => () => {}
const nullSnapshot = () => null

// Registry state ({ agents, status, engines, activeId, ... }).
// The first caller starts the registry: agents load and engines initialize.
export function useEngines() {
  useEffect(() => {
    engineRegistry.start()
  }, [])
  return useSyncExternalStore(
    engineRegistry.subscribe,
    engineRegistry.getSnapshot,
    engineRegistry.getSnapshot
  )
}

// One engine's { status, messages, error }, or null when there is no engine.
export function useEngineState(engine) {
  return useSyncExternalStore(
    engine?.subscribe ?? noopSubscribe,
    engine?.getSnapshot ?? nullSnapshot,
    engine?.getSnapshot ?? nullSnapshot
  )
}

// Every engine's state, in the order of `engines` (dashboard views that
// read them all). The array is new only when one of the snapshots changed.
export function useEngineStates(engines) {
  const cache = useRef({ engines: null, states: [] })
  const subscribe = useCallback(
    (listener) => {
      const offs = engines.map((engine) => engine.subscribe(listener))
      return () => offs.forEach((off) => off())
    },
    [engines]
  )
  const getSnapshot = () => {
    const states = engines.map((engine) => engine.getSnapshot())
    const last = cache.current
    if (last.engines === engines && states.every((state, i) => state === last.states[i])) return last.states
    cache.current = { engines, states }
    return states
  }
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
