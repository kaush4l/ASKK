"use client"

import { useMemo } from "react"

import { kernelDesk } from "@/backend/live/desk"
import { deskLog } from "@/backend/live/log"
import { registry } from "@/backend/live/registry"
import { computed, sameItems, signal, useValue } from "@/backend/live/signal"

// Every hook is a subscription to one signal (backend/live/signal.js), narrowed by an optional `select`: a view
// re-renders only when what it selects changes. Subscribing to the registry starts it (it opens the team stream).
const NONE = signal(null, null)

// The desk this tab follows ({ status, error, connected, agents, engines (lead first), byName, requiredId, activeId }).
export const useEngines = (select, eq) => useValue(registry, select, eq)

// One agent's state ({ status, activity, messages, … }) or the part of it `select` picks; null when there is no agent.
export const useEngineState = (engine, select) => useValue(engine?.state ?? NONE, select)

// An agent by name: {engine, state} (null each until it is on the desk).
export function useAgent(name, select) {
  const engine = useEngines((r) => r.byName.get(name) ?? null)
  return { engine, state: useEngineState(engine, select) }
}

// The engines of these agents (those on the desk), in their order: the same array while they are the same.
export const useNamed = (names) => useEngines((r) => names.map((n) => r.byName.get(n)).filter(Boolean), sameItems)

// Every agent's state, in the order of `engines` (views that read them all): a new array only when one changed.
export function useEngineStates(engines, select) {
  const all = useMemo(() => computed(engines.map((e) => e.state), (...states) => states), [engines])
  return useValue(all, select)
}

// The desk's tree and artifacts ({ title, tree, artifacts, … }) or its part `select` picks; null before the snapshot.
export const useDesk = (select, eq) => useValue(kernelDesk, select, eq)

// One artifact's twin (null until it is on the desk): redrawn for its own patches only.
export const useArtifact = (id) => useDesk((d) => d?.artifacts?.[id] ?? null)

// The desk's background log (watchers, schedule, wakes, Telegram), newest last.
export const useDeskLog = () => useValue(deskLog)
