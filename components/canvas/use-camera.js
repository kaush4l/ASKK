"use client"

import * as React from "react"

import { GLIDE_MS, glide, panBy, zoomAt } from "@/backend/live/camera"
import { slopFor } from "@/components/canvas/tap"

// The canvas's camera on the screen: the viewport's size, the camera {x, y, z} (backend/live/camera.js does the
// math), and the owner's hands on it — wheel pans (a trackpad's two-finger scroll), ctrl/⌘ + wheel and a trackpad
// pinch zoom around the cursor, a drag pans (one finger too), two fingers pinch, + / − / arrows from the keyboard.
// Every hand move calls onManual (the page turns Follow off) and stops a glide in progress.

const KEY_STEP = 1.25 // + / − zoom factor
const PAN_STEP = 80 // arrow keys, screen px

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

// Capture a pointer so a drag goes on outside the canvas (a pointer the browser no longer knows is skipped).
const capture = (el, id) => {
  try {
    el.setPointerCapture?.(id)
  } catch {}
}

// A part of a card that scrolls on its own (data-canvas-scroll): a wheel it can still take scrolls it, and a
// finger on it scrolls it, instead of moving the camera.
const scrollerOf = (target) => target?.closest?.("[data-canvas-scroll]") ?? null
const canScroll = (el, dy) => (dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : dy < 0 ? el.scrollTop > 0 : false)

const editable = (el) => el?.closest?.("input, textarea, select, [contenteditable=''], [contenteditable='true']")

export function useCamera({ onManual, onKey } = {}) {
  const ref = React.useRef(null)
  const [viewport, setViewport] = React.useState({ w: 0, h: 0 })
  const viewportRef = React.useRef(viewport)
  const [cam, setCamState] = React.useState({ x: 0, y: 0, z: 1 })
  const camRef = React.useRef(cam)
  const glideFrame = React.useRef(0)
  const hands = React.useRef({ onManual, onKey })
  hands.current = { onManual, onKey }

  const set = React.useCallback((next) => {
    const value = typeof next === "function" ? next(camRef.current) : next
    camRef.current = value
    setCamState(value)
  }, [])

  const stopGlide = React.useCallback(() => cancelAnimationFrame(glideFrame.current), [])

  // Move the camera to `to`: a glide, or a jump when the owner prefers reduced motion.
  const glideTo = React.useCallback(
    (to) => {
      cancelAnimationFrame(glideFrame.current)
      const from = camRef.current
      const vp = viewportRef.current
      if (reducedMotion() || !vp.w) return set(to)
      const t0 = performance.now()
      const tick = (now) => {
        const t = (now - t0) / GLIDE_MS
        set(glide(from, to, t, vp))
        if (t < 1) glideFrame.current = requestAnimationFrame(tick)
      }
      glideFrame.current = requestAnimationFrame(tick)
    },
    [set]
  )

  // By hand: stop the glide, tell the page, move.
  const manual = React.useCallback(
    (next) => {
      cancelAnimationFrame(glideFrame.current)
      hands.current.onManual?.()
      set(next)
    },
    [set]
  )

  const zoomBy = React.useCallback(
    (factor) => {
      const vp = viewportRef.current
      manual((c) => zoomAt(c, factor, { x: vp.w / 2, y: vp.h / 2 }))
    },
    [manual]
  )

  // The viewport's size.
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      viewportRef.current = { w: r.width, h: r.height }
      setViewport(viewportRef.current)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Wheel, trackpad pinch (ctrl + wheel in Chromium and Firefox, gesture events in Safari), pointers.
  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const local = (e) => {
      const r = el.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }

    const onWheel = (e) => {
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1
      const scroller = !(e.ctrlKey || e.metaKey) && scrollerOf(e.target)
      if (scroller && canScroll(scroller, e.deltaY)) return // the card scrolls; at its end the canvas pans again
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        const d = Math.max(-100, Math.min(100, e.deltaY * unit))
        const at = local(e)
        manual((c) => zoomAt(c, Math.exp(-d * 0.006), at))
      } else {
        let dx = e.deltaX * unit
        let dy = e.deltaY * unit
        if (e.shiftKey && !dx) [dx, dy] = [dy, 0]
        manual((c) => panBy(c, -dx, -dy))
      }
    }

    let gestureScale = 1
    const onGestureStart = (e) => {
      e.preventDefault()
      gestureScale = 1
    }
    const onGestureChange = (e) => {
      e.preventDefault()
      const at = local(e)
      const factor = e.scale / gestureScale
      gestureScale = e.scale
      manual((c) => zoomAt(c, factor, at))
    }

    const pointers = new Map() // id → screen point
    let drag = null // { start, last, moved }
    let pinch = null // { dist, mid }
    let swallowClick = false
    const pinchOf = () => {
      const [a, b] = [...pointers.values()]
      return { dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
    }
    const onDown = (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return
      if (e.pointerType !== "mouse" && scrollerOf(e.target)) return // a finger scrolling a card
      if (pointers.size === 0) swallowClick = false
      const p = local(e)
      pointers.set(e.pointerId, p)
      if (pointers.size === 1) drag = { start: p, last: p, moved: false }
      else if (pointers.size === 2) {
        pinch = pinchOf()
        drag = null
        swallowClick = true
        for (const id of pointers.keys()) capture(el, id)
      }
    }
    const onMove = (e) => {
      if (!pointers.has(e.pointerId)) return
      const p = local(e)
      pointers.set(e.pointerId, p)
      if (pinch && pointers.size >= 2) {
        const next = pinchOf()
        const { dist, mid } = pinch
        pinch = next
        manual((c) => zoomAt(panBy(c, next.mid.x - mid.x, next.mid.y - mid.y), next.dist / dist, next.mid))
        return
      }
      if (!drag) return
      if (!drag.moved) {
        if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) < slopFor(e.pointerType)) return
        drag.moved = true
        swallowClick = true
        capture(el, e.pointerId)
      }
      const { last } = drag
      drag.last = p
      manual((c) => panBy(c, p.x - last.x, p.y - last.y))
    }
    const onUp = (e) => {
      if (!pointers.delete(e.pointerId)) return
      if (pointers.size < 2) pinch = null
      if (pointers.size === 1) {
        const [p] = pointers.values()
        drag = { start: p, last: p, moved: true } // the finger left on the glass goes on panning
      } else if (pointers.size === 0) {
        drag = null
        setTimeout(() => (swallowClick = false), 0) // the click this release makes comes first; later ones are real
      }
    }
    // A press that became a drag or a pinch is not a click on what it started on.
    const onClickCapture = (e) => {
      if (!swallowClick) return
      swallowClick = false
      e.stopPropagation()
      e.preventDefault()
    }

    const listeners = [
      ["wheel", onWheel, { passive: false }],
      ["gesturestart", onGestureStart],
      ["gesturechange", onGestureChange],
      ["pointerdown", onDown],
      ["pointermove", onMove],
      ["pointerup", onUp],
      ["pointercancel", onUp],
      ["click", onClickCapture, true],
    ]
    for (const [type, fn, options] of listeners) el.addEventListener(type, fn, options)
    return () => {
      for (const [type, fn, options] of listeners) el.removeEventListener(type, fn, options)
    }
  }, [manual])

  // Keyboard: + / − zoom, arrows pan; other keys (0: fit) go to the page. Not while typing, not with modifiers
  // (⌘ + stays the browser's zoom).
  React.useEffect(() => {
    const onKeyDown = (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || editable(e.target)) return
      const pan = { ArrowLeft: [PAN_STEP, 0], ArrowRight: [-PAN_STEP, 0], ArrowUp: [0, PAN_STEP], ArrowDown: [0, -PAN_STEP] }[e.key]
      if (e.key === "+" || e.key === "=") zoomBy(KEY_STEP)
      else if (e.key === "-" || e.key === "_") zoomBy(1 / KEY_STEP)
      else if (pan) manual((c) => panBy(c, pan[0], pan[1]))
      else if (!hands.current.onKey?.(e.key)) return
      e.preventDefault()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [manual, zoomBy])

  React.useEffect(() => stopGlide, [stopGlide])

  return { ref, cam, viewport, set, glideTo, zoomBy, stopGlide }
}
