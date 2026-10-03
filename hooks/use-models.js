"use client"

import { useEffect, useSyncExternalStore } from "react"

import { models } from "@/backend/models/catalog"

// The model catalogue ({ status, default, models: [{ key, source, ...config }] }).
export function useModels() {
  useEffect(() => {
    models.load()
  }, [])
  return useSyncExternalStore(models.subscribe, models.getSnapshot, models.getServerSnapshot)
}
