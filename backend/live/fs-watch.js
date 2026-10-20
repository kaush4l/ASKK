// The workspace's files as they change on disk: GET /__askk/fs/watch?path (companion/capabilities/files.js; SSE,
// debounced on the host: change {paths}) and a tree that re-reads fs/tree (workspace.js) on each change, so the
// files a terminal run writes show before the files twin's next refresh (an agent step). Tested (fs-watch.test.js).
//
//   watchFiles(path, onChange, {EventSource, onOpen, onError}) → close        onChange(paths)
//   const tree = new LiveTree(root, {read, watch, debounceMs}); tree.start(); tree.close()
//   tree.subscribe(fn), tree.getSnapshot() → {entries: [{path, dir}] | null, changed: [paths], version, live, error}
//     entries: the disk's tree while the watch is open, else null (the Files pane draws the twin's); version counts
//     changes, `changed` the paths of the last one (the editor re-reads the file it shows when its path is there)

import { withBase } from "@/backend/live/base-path"
import { detectHost } from "@/backend/live/host"
import { whileVisible } from "@/backend/live/visible"
import { flattenTree } from "@/backend/live/workbench"
import { workspace } from "@/backend/live/workspace"
import { LIMITS } from "@/lib/config"

// One SSE message → the changed paths ([] for a change without paths: re-read everything), or null.
export function watchEvent(type, data) {
  let body
  try {
    body = typeof data === "string" ? JSON.parse(data) : data
  } catch {
    return null
  }
  if (!body || typeof body !== "object") return null
  if (!(body.type === "change" || type === "change" || (body.type == null && Array.isArray(body.paths)))) return null // pings, other events
  return (Array.isArray(body.paths) ? body.paths : body.path ? [body.path] : []).filter((p) => typeof p === "string")
}

export function watchFiles(path, onChange, { EventSource: ES = globalThis.EventSource, onOpen = () => {}, onError = () => {} } = {}) {
  if (!ES) return () => {}
  const source = new ES(withBase(`/__askk/fs/watch?${new URLSearchParams({ path: path ?? "" })}`))
  const on = (type) => (message) => {
    const paths = watchEvent(type, message?.data)
    if (paths) onChange(paths)
  }
  source.onmessage = on("message")
  source.addEventListener?.("change", on("change"))
  source.onopen = () => onOpen()
  // closed for good (404: no fs/watch on this server) vs dropped (it reconnects)
  source.onerror = () => onError(source.readyState === 2)
  return () => source.close()
}

// The server's watch, unless this tab runs its own agent (browser mode: its files live in this browser, never on the
// server's disk — the files twin's tree is drawn, as on a server without fs/watch).
function watchHere(path, onChange, options = {}) {
  let close = null
  let done = false
  detectHost().then((host) => {
    if (done) return
    if (host?.mode === "browser") return options.onError?.(true)
    close = watchFiles(path, onChange, options)
  })
  return () => {
    done = true
    close?.()
  }
}

const readTree = async (root) => (await (await workspace())?.tree(root)) ?? null

export class LiveTree {
  #listeners = new Set()
  #close = null
  #timer = null
  #pending = new Set()
  #reading = false
  #state = { entries: null, changed: [], version: 0, live: false, error: null }

  #stop = null
  #gone = false // fs/watch refused (no route here): the twin's tree from now on

  constructor(root, { read = readTree, watch = watchHere, debounceMs = LIMITS.ui.workbench.treeRefreshMs, document: doc = globalThis.document } = {}) {
    this.root = String(root ?? "").replace(/^\/+|\/+$/g, "")
    this.read = read
    this.watch = watch
    this.debounceMs = debounceMs
    this.doc = doc
  }

  subscribe = (fn) => {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }

  getSnapshot = () => this.#state

  // Watch while the tab is visible (visible.js); visible again, the disk is read afresh.
  start() {
    if (this.#stop) return
    this.#stop = whileVisible(() => this.#open(), () => this.#shut(), this.doc)
  }

  close() {
    this.#stop?.()
    this.#stop = null
    this.#shut()
  }

  #open() {
    if (this.#close || this.#gone) return
    this.#close = this.watch(this.root, (paths) => this.change(paths), {
      onOpen: () => {
        this.#set({ live: true, error: null })
        this.change([]) // the disk now, then every change
      },
      // gone for good: the twin's tree again; dropped: kept until it reconnects
      onError: (closed) => {
        if (closed) this.#gone = true
        this.#set(closed ? { live: false, entries: null, error: "fs/watch is not available here." } : { live: false })
      },
    })
  }

  #shut() {
    this.#close?.()
    this.#close = null
    clearTimeout(this.#timer)
    this.#timer = null
    if (this.#state.live) this.#set({ live: false })
  }

  // Changes this close together re-read the tree once.
  change(paths) {
    for (const p of paths) this.#pending.add(p)
    if (!paths.length) this.#pending.add("")
    clearTimeout(this.#timer)
    this.#timer = setTimeout(() => this.refresh(), this.debounceMs)
  }

  async refresh() {
    if (this.#reading) return this.change([])
    this.#reading = true
    const changed = [...this.#pending].filter(Boolean)
    this.#pending.clear()
    try {
      const tree = await this.read(this.root)
      this.#set({ entries: tree ? flattenTree(this.root, tree.entries ?? []) : this.#state.entries, changed, version: this.#state.version + 1, error: null })
    } catch (error) {
      this.#set({ changed, version: this.#state.version + 1, error: error.message })
    } finally {
      this.#reading = false
    }
  }

  #set(patch) {
    this.#state = { ...this.#state, ...patch }
    for (const fn of this.#listeners) fn()
  }
}
