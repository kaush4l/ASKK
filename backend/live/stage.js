// The stage's twin on the UI (kernel builtin/stage.js, 2026-10-17 owner: "the lead shows me a rendering or a canvas
// to help me follow … interact with the agent and understand observations in visuals"): the page the desk put before
// the owner, the story over it (scenes) and the owner's questions — and the two ways it talks: with the page in the
// owner's frame (postMessage) and with the desk (team/call target artifact). Pure, so tested without a tab.
//
// The page contract (the desk's skill `stage` tells the agents the same):
//   UI → page    {askk: "scene", scene: {id, view, title, params}}   show that view; the frame's #<view> moves too
//   page → UI    {askk: "at", view, views?}                          the page shows `view` now (its views listed)
//                {askk: "ask", context, text?}                       the owner pointed at something to ask about
// Only messages from the frame's own window and origin count, and an "ask" only fills the ask box: the owner sends it.

import { teamCall } from "@/backend/live/stream"

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"])
const WORD = /^[a-z0-9][a-z0-9_-]{0,31}$/i
const CONTEXT_MAX = 1000 // chars of JSON, as the kernel keeps
const TEXT_MAX = 500

// The desk's stage artifact (view stage); `id` picks one when a desk keeps several.
export function stageOf(artifacts, id = null) {
  const all = Object.values(artifacts ?? {}).filter((a) => a?.view === "stage")
  return (id ? all.find((a) => a.id === id) : null) ?? all.find((a) => a.id === "stage") ?? all[0] ?? null
}

// Can this tab frame the page? A page on the desk's computer (loopback, a port), never this tab's own origin (the
// desk server: a framed page there would share its rights). Another device's tab cannot reach the desk's localhost.
export function frameCheck(url, here = null) {
  let u
  try {
    u = new URL(url)
  } catch {
    return { ok: false, reason: "the stage's page address is not a URL" }
  }
  if (!["http:", "https:"].includes(u.protocol) || !LOOPBACK.has(u.hostname) || !u.port) return { ok: false, reason: "the stage shows only pages on the desk's computer" }
  if (!here) return { ok: true }
  const h = new URL(here)
  if (h.origin === u.origin || (LOOPBACK.has(h.hostname) && h.port === u.port)) return { ok: false, reason: "the page is on the desk server's own port" }
  if (!LOOPBACK.has(h.hostname)) return { ok: false, remote: true, reason: `the page runs on the desk's computer (${u.host}); this tab is on ${h.host}` }
  return { ok: true }
}

// The frame's address for a scene: the page with #<view> (a page that ignores postMessage still moves).
export function frameSrc(url, scene = null) {
  if (!url) return null
  const base = String(url).split("#")[0]
  return scene?.view ? `${base}#${encodeURIComponent(scene.view)}` : base
}

export const sceneMessage = (scene) => ({ askk: "scene", scene: { id: scene.id, view: scene.view, title: scene.title, params: scene.params ?? null } })

// Plain data the page sent, clipped the way the kernel keeps it; null when it is not an object.
function plain(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  let text
  try {
    text = JSON.stringify(raw)
  } catch {
    return null
  }
  if (text.length > CONTEXT_MAX) return null
  return JSON.parse(text)
}

// A message from the page in the frame → {type: "at", view, views} | {type: "ask", context, text} | null. Only from the
// frame's window and the page's origin; anything else (another frame, an extension, a malformed message) is null.
export function bridgeMessage(event, { frame, origin }) {
  if (!event || !frame || event.source !== frame || !origin || event.origin !== origin) return null
  const d = event.data
  if (!d || typeof d !== "object") return null
  if (d.askk === "at") {
    const view = String(d.view ?? "")
    if (!WORD.test(view)) return null
    const views = Array.isArray(d.views) ? d.views.map(String).filter((v) => WORD.test(v)).slice(0, 32) : null
    return { type: "at", view, views }
  }
  if (d.askk === "ask") {
    const context = plain(d.context)
    const text = typeof d.text === "string" ? d.text.trim().slice(0, TEXT_MAX) : ""
    if (!context && !text) return null
    return { type: "ask", context, text }
  }
  return null
}

// "layer 2 · head 1 · step 800": what the owner pointed at, as a chip.
export function contextLine(context) {
  if (!context) return ""
  return Object.entries(context)
    .map(([k, v]) => `${k} ${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join(" · ")
}

// Where the owner's frame should be: following, the scene the agent took them to (stage.go / a reply); else theirs.
export function shownScene(state, { following, picked }) {
  const scenes = state?.scenes ?? []
  const id = following ? (state?.current ?? picked) : (picked ?? state?.current)
  return scenes.find((s) => s.id === id) ?? scenes[0] ?? null
}

// The scene next to `id` in the story (dir -1 or +1), or null at either end.
export function stepScene(state, id, dir) {
  const scenes = state?.scenes ?? []
  const i = scenes.findIndex((s) => s.id === id)
  return i < 0 ? null : (scenes[i + dir] ?? null)
}

// The questions asked on the stage, oldest first, each with its answer or open.
export function askThread(state) {
  return (state?.asks ?? []).map((a) => ({ ...a, open: !a.answer }))
}

// The owner's question to the desk: the kernel records it on the stage and hands it to its keeper (team/call target
// artifact → kernel-team: guidance while the keeper runs, else a run). → {ask, keeper, delivered: "guided" | "run"}.
export const askStage = (id, { text, scene = null, context = null }) => teamCall("artifact", "ask", [{ id, text, scene, context }])
