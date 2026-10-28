// 2026-10-27 ask-point: what the owner points the Ask panel at. An artifact card's "Ask about this" (ArtifactBlock in
// components/views/artifact.jsx) calls pointAt(id); AskView reads the snapshot and fills its artifact field each time
// `at` moves, so the owner points at a card instead of typing its id. A page-wide store, for useSyncExternalStore.
let snap = { element: "", at: 0 }
const subs = new Set()

export function pointAt(id) {
  // `at` always moves, so pointing at the same card twice fills the field again
  snap = { element: String(id ?? ""), at: Math.max(Date.now(), snap.at + 1) }
  for (const f of subs) f()
}

export function subscribe(f) {
  subs.add(f)
  return () => subs.delete(f)
}

export function getSnapshot() {
  return snap
}
