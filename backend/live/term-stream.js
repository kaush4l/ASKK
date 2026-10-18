// One terminal session's live text in this tab: GET /__askk/term/stream?id (companion/capabilities/terminal.js; SSE:
// snapshot {session, lines}, then out {id, data} raw PTY chunks, session {session} when its urls change, exit {id,
// exit, status}, run {session} when a slot session takes its next command) folded into lines by term-lines.js. The
// Terminal pane (components/live/workbench/terminal-pane.jsx) opens one for the session it shows and closes it when it
// switches. A slot session (an agent's main or long one, 2026-10-17) runs command after command under one id: its
// stream stays open after an exit and goes on at the next `run`; any other session's ends with its exit. Tested with a
// fake EventSource (term-stream.test.js).
//
//   const view = new TermView(id, { EventSource })   view.start() / view.close()
//   view.subscribe(fn), view.getSnapshot() → { id, lines, dropped, status, exit, session, live, error }
//     live: the stream is open; error: it failed (no term route on this server, the session is gone) — the pane
//     then shows the twin's tail; session.urls: the localhost URLs it printed, kept current by session events
//   termEvent(type, data) → { type: snapshot | out | session | exit, … } | null   one SSE message, named or not
//   stopSession(id)   POST term/stop — the owner stops a session
//
// Every session's last lines, for the terminal's follow (backend/live/workbench.js noteOutput / followSession): GET
// term/list?tail=2 every termPollMs while the tab is visible (polled, not streamed: a tab keeps its few connections
// for its streams, visible.js). The terminal twin changes only when an agent refreshes it, so while the coder sat in
// terminal.wait for minutes the twin's r07 tail stood still and follow kept the finished r06 (2026-10-17).
//
//   const act = new TermActivity({ fetch, pollMs, idleMs })   act.start() / act.close()   act.poll() one read (tests)
//     every pollMs while a session runs, else every idleMs (a command that starts and ends between two reads is
//     still listed, ended)
//   act.subscribe(fn), act.getSnapshot() → { sessions: [{id, name, command, cwd, agent, slot, lease, runs, status,
//     exit, startedAt, endedAt, urls, tail}] | null, error }
//     a new snapshot only when a session's command, status, lease or last lines changed; sessions null until the first
//     answer and for good on a server with no term route (404): follow then reads the twin

import { withBase } from "@/backend/live/base-path"
import { LineView } from "@/backend/live/term-lines"
import { whileVisible } from "@/backend/live/visible"
import { LIMITS } from "@/lib/config"

const TYPES = new Set(["snapshot", "out", "session", "exit", "run"])

// The host may send `data: {type, …}` (the team stream's way) or named events (`event: out`): both read the same.
export function termEvent(type, data) {
  let body
  try {
    body = typeof data === "string" ? JSON.parse(data) : data
  } catch {
    return null
  }
  if (!body || typeof body !== "object") return null
  const t = TYPES.has(body.type) ? body.type : TYPES.has(type) ? type : null
  return t ? { ...body, type: t } : null
}

export class TermView {
  #listeners = new Set()
  #source = null
  #timer = null
  #stop = null
  #done = false // the session ended (or the stream was refused): nothing more to read
  #lines = new LineView()
  #state

  constructor(id, { EventSource: ES = globalThis.EventSource, notifyMs = LIMITS.ui.workbench.termNotifyMs, document: doc = globalThis.document } = {}) {
    this.id = id
    this.ES = ES
    this.notifyMs = notifyMs
    this.doc = doc
    this.#state = { id, lines: [], dropped: 0, status: null, exit: null, session: null, live: false, error: null }
  }

  subscribe = (fn) => {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }

  getSnapshot = () => this.#state

  // Open while the tab is visible (visible.js).
  start() {
    if (this.#stop || !this.ES || this.id == null) return
    this.#stop = whileVisible(() => this.#open(), () => this.#shut(), this.doc)
  }

  close() {
    this.#stop?.()
    this.#stop = null
    this.#shut()
  }

  #open() {
    if (this.#source || this.#done) return
    const source = new this.ES(withBase(`/__askk/term/stream?${new URLSearchParams({ id: String(this.id) })}`))
    this.#source = source
    const on = (type) => (message) => this.apply(termEvent(type, message?.data))
    source.onmessage = on("message")
    for (const type of TYPES) source.addEventListener?.(type, on(type))
    source.onopen = () => this.#set({ live: true, error: null })
    // A refused stream (404: no term route, unknown session) closes for good; a dropped one reconnects on its own and
    // starts again with a snapshot.
    source.onerror = () => {
      if (source.readyState !== 2) return this.#set({ live: false })
      this.#done = true
      this.#set({ live: false, error: "The terminal stream is not available here." })
    }
  }

  #shut() {
    this.#source?.close()
    this.#source = null
    clearTimeout(this.#timer)
    this.#timer = null
    if (this.#state.live) this.#set({ live: false })
  }

  // One parsed event (start() feeds them; tests call it directly).
  apply(e) {
    if (!e || (e.id != null && String(e.id) !== String(this.id) && e.type !== "snapshot")) return
    // 2026-10-17: the host sends the session's summary (no tail) when its urls change (a dev server came up); it
    // comes before the exit event, so it replaces the snapshot's fields as they are.
    if (e.type === "session") {
      if (!e.session || typeof e.session !== "object" || String(e.session.id) !== String(this.id)) return
      return this.#set({ session: { ...this.#state.session, ...e.session } })
    }
    // A slot session's next command: running again, its output goes on in the same lines.
    if (e.type === "run") {
      if (!e.session || typeof e.session !== "object" || String(e.session.id) !== String(this.id)) return
      this.#flush()
      return this.#set({ session: { ...this.#state.session, ...e.session }, status: e.session.status ?? "running", exit: null, live: true })
    }
    if (e.type === "snapshot") {
      const session = e.session ?? null
      this.#lines.reset(e.lines ?? session?.tail ?? [], typeof e.current === "string" ? e.current : null)
      const done = !!session?.status && session.status !== "running" && !session.slot
      this.#set({ session, status: session?.status ?? this.#state.status, exit: session?.exit ?? null, live: !done, error: null, ...this.#text() })
      // a finished session sends nothing more: closed, so EventSource does not fetch it again and again (a slot
      // session's next command comes on this stream: it stays open)
      if (done) this.#finish()
    } else if (e.type === "out") {
      this.#lines.write(e.data ?? "")
      this.#later()
    } else if (e.type === "exit") {
      this.#flush()
      const slot = !!this.#state.session?.slot
      this.#set({ status: e.status ?? "exited", exit: e.exit ?? null, live: slot })
      if (!slot) this.#finish()
    }
  }

  #finish() {
    this.#done = true
    this.close()
  }

  #text() {
    return { lines: this.#lines.text(), dropped: this.#lines.dropped }
  }

  // A burst of chunks repaints once per notifyMs.
  #later() {
    if (!(this.notifyMs > 0)) return this.#set(this.#text())
    this.#timer ??= setTimeout(() => this.#flush(), this.notifyMs)
  }

  #flush() {
    clearTimeout(this.#timer)
    this.#timer = null
    this.#set(this.#text())
  }

  #set(patch) {
    this.#state = { ...this.#state, ...patch }
    for (const fn of this.#listeners) fn()
  }
}

export class TermActivity {
  #listeners = new Set()
  #stop = null
  #timer = null
  #gen = 0 // each open() starts one poll loop; a closed loop's late answer is dropped
  #done = false // no term route here: nothing to poll
  #sig = null
  #state = { sessions: null, error: null }

  constructor({ fetch: f = globalThis.fetch?.bind(globalThis), pollMs = LIMITS.ui.workbench.termPollMs, idleMs = LIMITS.ui.workbench.termIdlePollMs, document: doc = globalThis.document } = {}) {
    this.fetch = f
    this.pollMs = pollMs
    this.idleMs = idleMs
    this.doc = doc
  }

  subscribe = (fn) => {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }

  getSnapshot = () => this.#state

  start() {
    if (this.#stop || !this.fetch) return
    this.#stop = whileVisible(() => this.#open(), () => this.#shut(), this.doc)
  }

  close() {
    this.#stop?.()
    this.#stop = null
    this.#shut()
  }

  #open() {
    if (this.#timer || this.#done) return
    const gen = ++this.#gen
    const tick = async () => {
      await this.poll(gen)
      const busy = this.#state.sessions?.some((x) => x.status === "running")
      if (gen === this.#gen && !this.#done) this.#timer = setTimeout(tick, busy ? this.pollMs : this.idleMs)
    }
    this.#timer = setTimeout(tick, 0)
  }

  #shut() {
    this.#gen++
    clearTimeout(this.#timer)
    this.#timer = null
  }

  // One read of term/list; `gen` (from the loop) drops an answer that comes back after the loop closed.
  async poll(gen = this.#gen) {
    let response = null
    try {
      response = await this.fetch(withBase("/__askk/term/list?tail=2"), { cache: "no-store" })
    } catch {}
    if (gen !== this.#gen) return
    if (response?.status === 404) {
      this.#done = true
      return this.#set({ sessions: null, error: "This server has no terminal." })
    }
    const body = response?.ok ? await response.json().catch(() => null) : null
    if (gen !== this.#gen) return
    // a failed read keeps the last list (the server may be restarting); the next tick tries again
    if (!Array.isArray(body?.sessions)) {
      if (!this.#state.error) this.#set({ error: "The terminal list could not be read." })
      return
    }
    const sessions = body.sessions
      .filter((s) => s?.id != null)
      .map(({ id, name, command, cwd, agent, slot, lease, runs, status, exit, startedAt, endedAt, urls, tail }) => ({
        id,
        name,
        command,
        cwd,
        agent,
        slot: slot ?? null,
        lease: lease ?? null, // 2026-10-17: the badge, on a session the twin has not listed or a slot's next command
        runs: runs ?? 1,
        status,
        exit: exit ?? null,
        startedAt,
        endedAt,
        urls: Array.isArray(urls) ? urls : [],
        tail: Array.isArray(tail) ? tail : [],
      }))
    const sig = sessions.map((s) => `${s.id}|${s.runs}|${s.status}|${s.exit}|${s.lease}|${s.tail.join("\n")}`).join("\u0000")
    if (sig === this.#sig && !this.#state.error) return
    this.#sig = sig
    this.#set({ sessions, error: null })
  }

  #set(patch) {
    this.#state = { ...this.#state, ...patch }
    for (const fn of this.#listeners) fn()
  }
}

// The owner stops a session (SIGTERM, then SIGKILL after a grace; companion/capabilities/terminal.js).
export async function stopSession(id) {
  const response = await fetch(withBase("/__askk/term/stop"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  }).catch(() => null)
  const body = await response?.json().catch(() => null)
  if (!response?.ok) throw new Error(body?.error ?? "The session could not be stopped.")
  return body
}
