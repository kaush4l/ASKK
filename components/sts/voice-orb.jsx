"use client"

import * as React from "react"

// The live orb: one canvas, redrawn every frame from the pipeline's level and
// spectrum (never through React state). Each phase has its colour and motion:
//   idle          a dim, slow breath
//   listening     a calm ring of rays that follows the room's sound
//   hearing       the spectrum as rays around a swelling core
//   armed         the same in magenta: the wake word was heard
//   transcribing  a sweeping dotted ring
//   working       orbiting arcs (the lead is working)
//   speaking      ripples out of the core, sized by the voice

export const PHASE_COLORS = {
  idle: [148, 148, 160],
  listening: [96, 180, 255],
  hearing: [64, 224, 255],
  armed: [232, 121, 249],
  transcribing: [170, 140, 255],
  working: [255, 186, 74],
  speaking: [74, 222, 150],
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)
const rgba = (c, a) => `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${a})`

export function VoiceOrb({ model, phase, className }) {
  const canvasRef = React.useRef(null)
  const phaseRef = React.useRef(phase)

  React.useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  React.useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext("2d")
    let raf = 0
    let width = 0
    let height = 0
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const box = canvas.getBoundingClientRect()
      width = box.width
      height = box.height
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()

    const bins = new Uint8Array(128)
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    let color = PHASE_COLORS.idle
    let level = 0
    let ripples = []
    let lastRipple = 0

    const draw = (now) => {
      raf = requestAnimationFrame(draw)
      const p = phaseRef.current
      color = mix(color, PHASE_COLORS[p] ?? PHASE_COLORS.idle, 0.08)
      const raw = model?.level() ?? 0
      level += (raw - level) * (raw > level ? 0.45 : 0.12)
      const t = now / 1000
      const cx = width / 2
      const cy = height / 2
      const base = Math.min(width, height) * 0.2
      ctx.clearRect(0, 0, width, height)

      // Glow.
      const breath = p === "idle" && !reduced ? 0.04 * Math.sin(t * 1.2) : 0
      const core = base * (1 + level * 0.35 + breath)
      const glow = ctx.createRadialGradient(cx, cy, core * 0.2, cx, cy, core * 2.6)
      glow.addColorStop(0, rgba(color, p === "idle" ? 0.22 : 0.42))
      glow.addColorStop(0.45, rgba(color, 0.1 + level * 0.12))
      glow.addColorStop(1, rgba(color, 0))
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(cx, cy, core * 2.6, 0, Math.PI * 2)
      ctx.fill()

      // Spectrum rays (the mic).
      if ((p === "hearing" || p === "listening" || p === "armed") && model?.spectrum(bins)) {
        const rays = 72
        ctx.lineCap = "round"
        ctx.lineWidth = Math.max(1.5, core * 0.035)
        for (let i = 0; i < rays; i++) {
          const bin = bins[Math.floor((i < rays / 2 ? i : rays - i) * 0.9) + 2] / 255
          const angle = (i / rays) * Math.PI * 2 - Math.PI / 2 + (reduced ? 0 : t * 0.15)
          const inner = core * 1.18
          const length = core * (0.05 + bin * (p === "listening" ? 0.45 : 0.9))
          ctx.strokeStyle = rgba(color, 0.35 + bin * 0.6)
          ctx.beginPath()
          ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner)
          ctx.lineTo(cx + Math.cos(angle) * (inner + length), cy + Math.sin(angle) * (inner + length))
          ctx.stroke()
        }
      }

      // Orbiting arcs (working).
      if (p === "working") {
        ctx.lineWidth = Math.max(2, core * 0.05)
        ctx.lineCap = "round"
        for (let i = 0; i < 3; i++) {
          const r = core * (1.3 + i * 0.22)
          const start = (reduced ? 0 : t * (0.9 - i * 0.25) * (i % 2 ? -1 : 1)) + (i * Math.PI * 2) / 3
          ctx.strokeStyle = rgba(color, 0.75 - i * 0.18)
          ctx.beginPath()
          ctx.arc(cx, cy, r, start, start + Math.PI * (0.55 - i * 0.1))
          ctx.stroke()
        }
      }

      // Sweeping dotted ring (transcribing).
      if (p === "transcribing") {
        const dots = 40
        for (let i = 0; i < dots; i++) {
          const angle = (i / dots) * Math.PI * 2
          const behind = (((angle - t * 4) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
          ctx.fillStyle = rgba(color, 0.15 + 0.85 * Math.max(0, 1 - behind / 2))
          ctx.beginPath()
          ctx.arc(cx + Math.cos(angle) * core * 1.35, cy + Math.sin(angle) * core * 1.35, Math.max(1.5, core * 0.03), 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // Ripples (speaking).
      if (p === "speaking" && !reduced && now - lastRipple > 260 - level * 140) {
        lastRipple = now
        ripples.push({ born: now, strength: 0.3 + level * 0.7 })
      }
      ripples = ripples.filter((r) => now - r.born < 1600)
      for (const r of ripples) {
        const age = (now - r.born) / 1600
        ctx.strokeStyle = rgba(color, (1 - age) * 0.55 * r.strength)
        ctx.lineWidth = Math.max(1, core * 0.04 * (1 - age))
        ctx.beginPath()
        ctx.arc(cx, cy, core * (1.05 + age * 1.6), 0, Math.PI * 2)
        ctx.stroke()
      }

      // Core.
      const fill = ctx.createRadialGradient(cx - core * 0.3, cy - core * 0.35, core * 0.1, cx, cy, core)
      fill.addColorStop(0, rgba(mix(color, [255, 255, 255], 0.55), 0.95))
      fill.addColorStop(0.6, rgba(color, 0.85))
      fill.addColorStop(1, rgba(mix(color, [0, 0, 0], 0.35), 0.9))
      ctx.fillStyle = fill
      ctx.beginPath()
      ctx.arc(cx, cy, core, 0, Math.PI * 2)
      ctx.fill()
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [model])

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />
}
