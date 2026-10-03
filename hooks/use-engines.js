"use client"

import { useEffect, useSyncExternalStore } from "react"

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
