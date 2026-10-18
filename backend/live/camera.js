// The canvas camera, pure: {x, y, z} maps a world point p to the screen at (p.x * z + x, p.y * z + y), screen
// points relative to the canvas's top-left corner. The canvas (components/canvas/) keeps one and moves it with
// these; nothing here touches the DOM.
//
//   zoomLevel(z): far (faces and names) < 0.55 ≤ mid (cards) < 1.4 ≤ near (the run inside each card)

export const MIN_Z = 0.2
export const MAX_Z = 3
export const MID_FROM = 0.55
export const NEAR_FROM = 1.4
export const NEAR_Z = 1.6 // a focused agent, when the viewport has room for its card
export const FIT_MAX_Z = 1 // Fit never zooms in past 100%
export const GLIDE_MS = 480

export const clampZ = (z) => Math.min(MAX_Z, Math.max(MIN_Z, Number.isFinite(z) ? z : 1))

export const zoomLevel = (z) => (z < MID_FROM ? "far" : z < NEAR_FROM ? "mid" : "near")

export const toWorld = (cam, p) => ({ x: (p.x - cam.x) / cam.z, y: (p.y - cam.y) / cam.z })
export const toScreen = (cam, p) => ({ x: p.x * cam.z + cam.x, y: p.y * cam.z + cam.y })

// Zoom by `factor` around a screen point: the world point under it stays under it.
export function zoomAt(cam, factor, point) {
  const z = clampZ(cam.z * factor)
  const w = toWorld(cam, point)
  return { x: point.x - w.x * z, y: point.y - w.y * z, z }
}

export const panBy = (cam, dx, dy) => ({ x: cam.x + dx, y: cam.y + dy, z: cam.z })

// A world rect centred in the viewport at zoom z.
export function focus(rect, viewport, z) {
  const zz = clampZ(z)
  return { x: viewport.w / 2 - (rect.x + rect.w / 2) * zz, y: viewport.h / 2 - (rect.y + rect.h / 2) * zz, z: zz }
}

// The whole of `bounds` in the viewport (with padding), centred, never past FIT_MAX_Z. `inset`: screen px along
// each edge that controls float over ({top, bottom}), kept clear too.
export function fit(bounds, viewport, padding = 32, { top = 0, bottom = 0 } = {}) {
  if (!bounds?.w || !bounds?.h || !viewport?.w || !viewport?.h) return { x: viewport?.w ? viewport.w / 2 : 0, y: viewport?.h ? viewport.h / 2 : 0, z: 1 }
  const area = { w: viewport.w, h: Math.max(1, viewport.h - top - bottom) }
  const z = Math.min(FIT_MAX_Z, (area.w - 2 * padding) / bounds.w, (area.h - 2 * padding) / bounds.h)
  const cam = focus(bounds, area, z)
  return { ...cam, y: cam.y + top }
}

// The zoom to look at one card up close: NEAR_Z, less when the viewport is small, never below near.
export function nearZoom(rect, viewport, padding = 16) {
  const room = Math.min((viewport.w - 2 * padding) / rect.w, (viewport.h - 2 * padding) / rect.h)
  return clampZ(Math.max(NEAR_FROM + 0.05, Math.min(NEAR_Z, room)))
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

// The camera `t` (0..1) of the way from `from` to `to`, eased: zoom changes evenly (geometric), the point at
// the viewport's centre moves in a straight line.
export function glide(from, to, t, viewport) {
  const e = ease(Math.min(1, Math.max(0, t)))
  if (e >= 1) return to
  const z = from.z * (to.z / from.z) ** e
  const centre = { x: viewport.w / 2, y: viewport.h / 2 }
  const a = toWorld(from, centre)
  const b = toWorld(to, centre)
  const c = { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e }
  return { x: centre.x - c.x * z, y: centre.y - c.y * z, z }
}
