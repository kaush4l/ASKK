// The studio view's model (components/views/studio.jsx), pure: the kernel's studio artifact (backend/kernel/builtin/
// studio.js: images on this Mac's open model, the prompt's versions, critiques, the pick, the owner's feedback) → what
// the view draws, and the owner's calls on it (team call target artifact).
//   studioCall(id, method, extra)  goal {goal, criteria} | generate {prompt, seed?, width?, height?, steps?, from?,
//                                  strength?} | feedback {image?, text} | pick {image} | stop {image}
//   lastCritique(image)            its newest critique, or null
//   bestImage(state)               the pick, else the best-scored finished image, else the newest finished one
//   lineage(state, id)             the image and the ones it was refined from, oldest first
//   progress(image)                0..1 while it runs, 1 done, 0 queued
//   imageUrl(image)                the PNG's address (the host's image/file), null until it is done

import { teamCall } from "./stream"

export const studioCall = (id, method, extra = {}) => teamCall("artifact", method, [{ id, ...extra }])

export const lastCritique = (image) => image?.critiques?.at(-1) ?? null

export function bestImage(state) {
  const images = state?.images ?? []
  const done = images.filter((i) => i.status === "done")
  if (state?.picked) {
    const p = images.find((i) => i.id === state.picked.image)
    if (p) return p
  }
  const scored = done.filter((i) => lastCritique(i)).sort((a, b) => lastCritique(b).score - lastCritique(a).score)
  return scored[0] ?? done[0] ?? images[0] ?? null
}

export function lineage(state, id) {
  const byId = new Map((state?.images ?? []).map((i) => [i.id, i]))
  const out = []
  let at = byId.get(id)
  while (at && out.length < 20) {
    out.unshift(at)
    at = at.from ? byId.get(at.from) : null
  }
  return out
}

export const progress = (image) => (image?.status === "done" ? 1 : image?.status === "running" && image.steps ? Math.min(1, (image.step ?? 0) / image.steps) : 0)

export const imageUrl = (image) => (image?.status === "done" ? (image.url ?? `/__askk/image/file?id=${encodeURIComponent(image.id)}`) : null)

// ---- marks (2026-10-23 owner: "have interface for the user to mark, zoom or request additional changes") ----
// A mark is a box on the image as fractions of its size {x, y, w, h} with a note; the view draws them, the owner's
// feedback carries them, and a canvas turns them into the marked image (for the agent's eyes) and a mask (white = repaint).

const unit = (v) => Math.max(0, Math.min(1, v))
// the box between two points (fractions), at least a sliver
export function boxFrom(a, b) {
  const x = unit(Math.min(a.x, b.x))
  const y = unit(Math.min(a.y, b.y))
  return { x, y, w: unit(Math.max(a.x, b.x)) - x, h: unit(Math.max(a.y, b.y)) - y }
}
export const bigEnough = (box) => box.w >= 0.02 && box.h >= 0.02
// "top-right" … in words, for the feedback line
export const placeOf = (m) => `${m.y + m.h / 2 < 0.34 ? "top" : m.y + m.h / 2 > 0.66 ? "bottom" : "middle"}-${m.x + m.w / 2 < 0.34 ? "left" : m.x + m.w / 2 > 0.66 ? "right" : "center"}`
// the feedback text with each mark's note, for an owner who wrote none
export const marksText = (marks) => marks.map((m, i) => `${i + 1} (${placeOf(m)}): ${m.note || "change this"}`).join("; ")
export const ZOOMS = [1, 1.5, 2, 3, 4]
export const nextZoom = (z, dir) => ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(ZOOMS.reduce((a, b) => (Math.abs(b - z) < Math.abs(a - z) ? b : a))) + dir))]
// what the model can do with an image, from the studio's model twin
export const canEdit = (state, k) => !!state?.model?.accepts?.includes(k)
// the preset choices: the owner's goal adds auto (the agent compares and picks)
export const presetOptions = (state, { auto = false } = {}) => [...(auto ? [{ value: "auto", label: "Preset: let the agent choose" }] : []), { value: "none", label: "No preset" }, ...(state?.presets ?? []).map((p) => ({ value: p.name, label: `${p.title}${p.size ? ` · ${p.size}` : ""}`, hint: p.when }))]
