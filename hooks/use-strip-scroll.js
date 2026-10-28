"use client"

import { useEffect, useRef } from "react"

// A horizontal strip of tabs or chips keeps its active one in view, scrolled by hand (scrollIntoView would scroll the
// page too, and returns a Promise in newer browsers, which an effect must not return): put the refs on the strip and
// on the active child → [stripRef, activeRef].
export function useStripScroll(active) {
  const stripRef = useRef(null)
  const activeRef = useRef(null)
  useEffect(() => {
    const strip = stripRef.current
    const el = activeRef.current
    if (!strip || !el) return
    if (el.offsetLeft < strip.scrollLeft) strip.scrollLeft = el.offsetLeft
    else if (el.offsetLeft + el.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = el.offsetLeft + el.offsetWidth - strip.clientWidth
  }, [active])
  return [stripRef, activeRef]
}
