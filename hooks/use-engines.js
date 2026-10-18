"use client"

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react"

import { kernelDesk } from "@/backend/live/desk"
import { deskLog } from "@/backend/live/log"
import { registry } from "@/backend/live/registry"

const noopSubscribe = () => () => {}
const nullSnapshot = () => null

// The desk this tab follows ({ status, error, connected, agents, engines, requiredId, activeId }). The first caller
// starts the registry: it opens the desk server's team stream (backend/live/registry.js).
export function useEngines() {
  useEffect(() => {
    registry.start()
  }, [])
  return useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getServerSnapshot)
}

// One agent's state ({ status, activity, messages, … }), or null when there is no agent.
export function useEngineState(engine) {
  return useSyncExternalStore(
    engine?.subscribe ?? noopSubscribe,
    engine?.getSnapshot ?? nullSnapshot,
    engine?.getSnapshot ?? nullSnapshot
  )
}

// Every agent's state, in the order of `engines` (views that read them all). The array is new only when one of
// the snapshots changed.
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

// The desk's tree, boards and artifacts ({ title, tree, boards, artifacts }), or null before the first snapshot.
export function useDesk() {
  useEffect(() => {
    registry.start()
  }, [])
  return useSyncExternalStore(kernelDesk.subscribe, kernelDesk.getSnapshot, kernelDesk.getServerSnapshot)
}

// The desk's background log (watchers, schedule, wakes, Telegram), newest last.
export function useDeskLog() {
  useEffect(() => {
    registry.start()
  }, [])
  return useSyncExternalStore(deskLog.subscribe, deskLog.getSnapshot, deskLog.getServerSnapshot)
}
