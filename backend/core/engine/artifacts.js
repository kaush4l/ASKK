// Artifacts: their state, saved beside memory, refreshed before each step, live views.
// A part of BaseEngine (core/base-engine.js): its methods are mixed into
// BaseEngine.prototype, so `this` is the engine.

import { readFile, writeFile } from "@/backend/platform/storage"

export class ArtifactsPart {
  // ── artifacts ──────────────────────────────────────────────────────────

  // What artifacts say must still be done before a final answer (the
  // checklist): [{ id, text }]. Empty = the answer may stand.
  pendingChecks() {
    return (this.artifacts ?? []).flatMap((artifact) => artifact.pending?.() ?? [])
  }

  get _artifactsPath() {
    return `${this.memory.dir}/artifacts.json`
  }

  // Publish and save artifact state (agents/<engine>/artifacts.json).
  _artifactsChanged() {
    const artifacts = Object.fromEntries(this.artifacts.map((a) => [a.type, a.toJSON()]))
    this.update({ artifacts })
    this.publishLive()
    writeFile(this._artifactsPath, JSON.stringify(artifacts, null, 2)).catch((error) =>
      this.update({ memoryError: `Artifacts not saved: ${error.message}` })
    )
  }

  async _restoreArtifacts() {
    if (!this.artifacts.length) return
    const text = await readFile(this._artifactsPath)
    const saved = text ? JSON.parse(text) : {}
    for (const artifact of this.artifacts) {
      if (saved[artifact.type]) artifact.state = { ...artifact.initialState(), ...saved[artifact.type] }
    }
    this.update({ artifacts: Object.fromEntries(this.artifacts.map((a) => [a.type, a.toJSON()])) })
    this.refreshArtifacts().catch(() => {}) // their live views, before the first step
  }

  // Bring every artifact up to date with its source (before each render).
  async refreshArtifacts() {
    await Promise.all(this.artifacts.map((artifact) => artifact.refresh()))
    this.publishLive()
  }

  // Each artifact's UI snapshot (Artifact.live()) into state.live[type] =
  // { title, view, data, version, at }, only when it changed: an update
  // event for every view that follows the engine (Live follow).
  publishLive() {
    let changed = null
    for (const artifact of this.artifacts ?? []) {
      let snapshot = null
      try {
        snapshot = artifact.live()
      } catch {
        snapshot = null
      }
      if (!snapshot) continue
      const json = JSON.stringify(snapshot)
      if (this._liveSeen.get(artifact.type) === json) continue
      this._liveSeen.set(artifact.type, json)
      const before = this._state.live?.[artifact.type]
      changed ??= { ...(this._state.live ?? {}) }
      changed[artifact.type] = { title: artifact.constructor.title, ...snapshot, version: (before?.version ?? 0) + 1, at: new Date().toISOString() }
    }
    if (changed) this.update({ live: changed })
  }

  formatArtifacts() {
    const parts = this.artifacts.map((artifact) => artifact.render()).filter(Boolean)
    if (!parts.length) return ""
    return `## ARTIFACTS\n\nLive objects in their latest state (not a log of changes).\n\n${parts.join("\n\n")}`
  }
}
