"use client"

import { useEffect, useState } from "react"

import { LIMITS } from "@/lib/config"

// The time now, re-read every `ms` while `on` (so "5 min ago" and a run's clock stay true).
export function useNow(ms = LIMITS.ui.home.clockTickMs, on = true) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    setNow(Date.now()) // on again: the clock is true at once, not a tick later
    const timer = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(timer)
  }, [ms, on])
  return now
}
