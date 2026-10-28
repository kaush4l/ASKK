import { Artifact } from "../artifact/artifact.js"
import { hostError, hostTry } from "./files.js"
import { clipAfter as clip } from "../util/text.js"

// Terminal: the desk's terminal sessions as an artifact (2026-10-17 owner: start a command and keep it running; the
// last 50 lines of each live session go into the holder's prompt). The sessions live in the host (term/*:
// companion/capabilities/terminal.js — a PTY under sandbox-exec, kept across steps and runs); this artifact starts,
// drives and shows them through ctx.host. One instance per desk (id "terminal"), listing every session of the desk;
// {type: terminal, id} makes another that lists only the sessions it started.
//
// Two sessions per holder (2026-10-17 owner: a new Live terminal tab per command buried the work): its main session,
// where terminal.run runs command after command (one at a time: runs called in one step take turns), and its long
// session, where terminal.start runs the one thing that keeps going (a dev server, a training run, a watcher) while
// the holder works in the main one — the next start replaces it (stopped first). Each is one host session (term/start
// `slot`: "main" | "long"; "<id>.main" | "<id>.long" for another instance) whose scrollback keeps every command under
// its `$` line; a run while the main session still runs an earlier command (one that outlasted its timeout) is
// refused with what to do.
//
// Commands: run (the main session, to its end; timeout s, default 120, ≤ 600), start (the long session, kept running,
// replacing what ran there), wait (until it exits, a new line holds `until` — literal text or a list, any one — or seconds
// pass), read, send (a line to its stdin), stop, list (every session, one line each, and the desk's programs).
// (id: a session id or name, "main" / "long" (the holder's own), "<agent>:main" / "<agent>:long" (another agent's);
//  none = this holder's newest running session)
//
// lease (2026-10-17: one GPU, one run at a time): a short name ("gpu") the session holds while it runs; the host refuses
// (409, its reason passed on) a second running session of the desk with the same lease.
// A command runs with the holder's name and its writes: lane (agent.md `writes:`; none = [] — it writes nothing in
// the workspace: the sandbox refuses). Commands are type dev: never answered from the run's data cache.
// Twin state: {sessions: [...twinOf] ≤ 12, newest first} — a slot session's fields are its current (or last) command's,
// `runs` the commands it ran, `tail` that command's lines. Prompt: every running session's header and last 50 lines; a
// finished one in one line.

const SESSIONS_MAX = 12
const TAIL = 50 // lines per session: the twin's tail and the prompt's
const TWIN_LINE = 1000 // a tail line's chars in the twin
const PROMPT_LINE = 300 // and in the prompt
const RUN_WAIT = 120 // terminal.run's default timeout (s)
const WAIT_MAX = 600 // the host's longest wait
const START_WAIT = 3 // terminal.start waits this long for an early exit or the first URL
const RESULT_CHARS = 12000
const REFRESH_MS = 1000
const SLOT = { run: "main", start: "long" } // the holder's session each command runs in
const SLOT_ID = /^(?:(.+):)?(main|long)$/ // "main", "long", "<agent>:main"
const LEASE = /^[a-z][a-z0-9-]{0,19}$/ // "gpu"

const list = (v) => (v == null || v === "" ? [] : Array.isArray(v) ? v : String(v).split(",")).map((x) => String(x).trim()).filter(Boolean)
const hostOf = (ctx) => {
  if (!ctx?.host?.get) throw new Error("no host here (ctx.host): the desk server runs the terminal")
  return ctx.host
}
const seconds = (v, fallback) => Math.min(WAIT_MAX, Math.max(1, Math.round(Number(v) || fallback)))
const ms = (s) => {
  const t = Date.parse(s.endedAt ?? "") - Date.parse(s.startedAt ?? "")
  return Number.isFinite(t) && t >= 0 ? t : null
}
const took = (t) => (t == null ? "" : t < 60_000 ? `${(t / 1000).toFixed(1)} s` : `${Math.floor(t / 60_000)}m${String(Math.round((t % 60_000) / 1000)).padStart(2, "0")}s`)

// A host session as the twin keeps it: the spec's fields (TWIN_FIELDS' defaults), its tail clipped.
const TWIN_FIELDS = { name: null, command: "", cwd: ".", agent: null, slot: null, lease: null, runs: 1, status: "running", exit: null, startedAt: null, endedAt: null }
const twinOf = (s, tail) => ({
  id: s.id,
  ...Object.fromEntries(Object.entries(TWIN_FIELDS).map(([k, fallback]) => [k, s[k] ?? fallback])),
  urls: [...(s.urls ?? [])],
  // why it ended (stopped by whom, the server killed, replaced by …): the prompt said it, the twin now too (2026-10-23)
  ...(s.reason ? { reason: clip(s.reason, 200) } : {}),
  ...(s.error ? { error: clip(s.error, 200) } : {}),
  ...(s.signal ? { signal: s.signal } : {}),
  tail: [...(tail ?? s.tail ?? [])].slice(-TAIL).map((l) => clip(l, TWIN_LINE)),
})

// One session in one line: "▶ term-… long [gpu] "train" (coder) running 3m02s · uv run train.py · cwd projects/x · http://…".
function headOf(s, now = Date.now()) {
  const running = s.status === "running"
  const t = running ? (Number.isFinite(Date.parse(s.startedAt ?? "")) ? now - Date.parse(s.startedAt) : null) : ms(s)
  const state = running ? `running ${took(t)}` : `${s.status}${s.exit != null ? ` exit ${s.exit}` : ""}${t != null ? ` in ${took(t)}` : ""}`
  const extra = [s.reason, s.error].filter(Boolean).map((x) => ` (${x})`).join("")
  const name = s.name && s.name !== s.command ? ` "${s.name}"` : ""
  return `${running ? "▶" : "■"} ${s.id}${s.slot ? ` ${s.slot}` : ""}${s.lease ? ` [${s.lease}]` : ""}${name}${s.agent ? ` (${s.agent})` : ""} ${state}${extra} · ${s.command} · cwd ${s.cwd ?? "."}${s.urls?.length ? ` · ${s.urls.join(" ")}` : ""}`
}
const linesOf = (lines, n = TAIL) => [...(lines ?? [])].slice(-n).map((l) => `  ${clip(l, PROMPT_LINE)}`)
// A lease from a call: none (null), or a short name the host locks while the session runs.
const leaseOf = (v) => {
  if (v == null || v === "") return null
  const lease = String(v).trim()
  if (!LEASE.test(lease)) throw new Error(`lease "${lease}": a short name — lowercase letters, digits and -, up to 20 chars, starting with a letter (e.g. gpu)`)
  return lease
}
const result = (text) => (text.length > RESULT_CHARS ? `${text.slice(0, 200)}\n… ${text.length - RESULT_CHARS} chars cut …\n${text.slice(-(RESULT_CHARS - 200))}` : text)

const SESSION_INPUT = 'a session id or name, "main" or "long" (yours), "<agent>:main" (another agent\'s); default: your newest running one'
const LEASE_INPUT = 'gpu for anything on the GPU: one running session of the desk holds a lease at a time, a second is refused (optional)'

export class Terminal extends Artifact {
  static about = "the holder's terminal sessions on the host (main: one command at a time; long: kept running), sandboxed to its lane"
  static commands = {
    run: { description: "run a command to its end in your main session (no shell: one program, or several joined by &&; cd moves inside the workspace; one at a time — one that keeps running belongs in start): its exit and last lines", input: { command: "e.g. uv run train.py --steps 100", cwd: "a workspace folder (optional)", timeout: `seconds to wait (default ${RUN_WAIT}, at most ${WAIT_MAX})`, lease: LEASE_INPUT }, run(i, c) { return this.#run(i, c) } },
    start: { description: "start a command in your long session and keep it running between your steps while you run commands in the main one (a dev server, a training run, a watcher; it replaces what ran there): its id, the URLs it prints", input: { command: "e.g. bun run dev", cwd: "a workspace folder (optional)", name: "a short name for it (optional)", lease: LEASE_INPUT }, run(i, c) { return this.#start(i, c) } },
    wait: { description: "wait on a running session: until it exits, a new line holds the until text, or seconds pass", input: { id: SESSION_INPUT, seconds: `at most ${WAIT_MAX} (default 30)`, until: 'literal text, a piece of a line it prints, e.g. val_bpb: (not a pattern); a list like ["ready on", "Error"] waits for any one (optional)' }, run(i, c) { return this.#wait(i, c) } },
    read: { description: "a session's last lines (its scrollback: each command under its $ line)", input: { id: SESSION_INPUT, lines: `how many (default ${TAIL})` }, run(i, c) { return this.#read(i, c) } },
    send: { description: "send a line to a running session's stdin", input: { id: SESSION_INPUT, text: "the line" }, run(i, c) { return this.#send(i, c) } },
    stop: { description: "stop a running session", input: { id: SESSION_INPUT }, run(i, c) { return this.#stop(i, c) } },
    list: { description: "every session in one line each, and the programs this desk runs", input: {}, run(i, c) { return this.#list(i, c) } },
  }
  // separate: another instance of the desk's terminal — it lists only the sessions it started.
  constructor({ id = "terminal", title, separate = false } = {}) {
    super({ name: id, title: title ?? (id === "terminal" ? "terminal — the desk's sessions" : `${id} — terminal`) })
    Object.assign(this, { kind: "terminal", view: "terminal", keep: "file" }) // sessions end with the server: never restored
    this.state = { sessions: [] }
    this.full = new Map() // id -> the host's last summary (reason, error: the prompt shows them)
    this.mine = separate ? new Set() : null
    this.pulled = 0
    this.pulling = null
    this.turns = new Map() // holder + slot -> its last command's promise (one command at a time per session)
  }

  // ---- state ----

  #set(sessions) {
    const next = { sessions: sessions.slice(0, SESSIONS_MAX) }
    if (JSON.stringify(next) === JSON.stringify(this.state)) return false
    this.state = next
    this.changed()
    return true
  }

  // The host's list (newest first) as the state.
  #take(sessions) {
    const shown = (sessions ?? []).filter((s) => s?.id && (!this.mine || this.mine.has(s.id)))
    for (const s of shown) this.full.set(s.id, s)
    for (const id of this.full.keys()) if (!shown.some((s) => s.id === id)) this.full.delete(id)
    this.#set(shown.map((s) => twinOf(s)))
  }

  // One session the host just answered with (tail: its lines when the answer carries them apart).
  #merge(s, tail) {
    if (!s?.id) return
    if (this.mine && !this.mine.has(s.id)) return
    const prev = this.state.sessions.find((x) => x.id === s.id)
    this.full.set(s.id, { ...(this.full.get(s.id) ?? {}), ...s })
    const twin = twinOf(s, tail ?? s.tail ?? prev?.tail)
    const rest = this.state.sessions.filter((x) => x.id !== s.id)
    const at = (x) => Date.parse(x.startedAt ?? "") || 0
    this.#set([twin, ...rest].sort((a, b) => at(b) - at(a)))
  }

  async refresh(agent) {
    if (this.pulling) return this.pulling
    if (Date.now() - this.pulled < REFRESH_MS) return
    this.pulling = this.#pull({ ...(agent?.context ?? {}), agent }).finally(() => (this.pulling = null))
    return this.pulling
  }

  async #pull(ctx) {
    const r = await hostTry("term/list", () => hostOf(ctx).get(`term/list?tail=${TAIL}`, { signal: ctx.signal }))
    this.pulled = Date.now()
    this.#take(r?.sessions)
  }

  // The holder's session in a slot ("main" | "long"); another instance's are "<id>.main" | "<id>.long".
  #slot(kind) {
    return this.name === "terminal" ? kind : `${this.name}.${kind}`
  }

  // The session a command means: an id or a name it knows, "main" / "long" (the holder's), "<agent>:main" (another
  // agent's), else (none given) this holder's newest running one. One it does not know is looked for in term/list.
  async #id(input, ctx) {
    const agent = ctx.agent
    const want = String(input?.id ?? input?.name ?? "").trim()
    const slot = SLOT_ID.exec(want)
    const find = () => {
      const all = this.state.sessions
      if (!want) {
        const running = all.filter((s) => s.status === "running")
        return (running.find((s) => s.agent === agent?.name) ?? running[0])?.id
      }
      const mine = slot && all.find((s) => s.agent === (slot[1] ?? agent?.name ?? null) && s.slot === this.#slot(slot[2]))
      return mine?.id ?? all.find((s) => s.id === want)?.id ?? all.find((s) => s.name === want)?.id
    }
    let id = find()
    if (!id && (!want || slot)) {
      await this.#pull(ctx).catch(() => {})
      id = find()
    }
    if (id) return id
    if (!want) throw new Error(`id: which session — none is running (${this.name}.list lists them)`)
    if (slot) throw new Error(`id: ${slot[1] ? `${slot[1]} has` : "you have"} no ${slot[2]} session yet (${this.name}.run opens the main one, ${this.name}.start the long one; ${this.name}.list lists them)`)
    return want // an id the host knows and this artifact never listed
  }

  // One command at a time per holder and slot: runs called in one step take turns in the main session.
  #turn(ctx, kind, fn) {
    const key = `${ctx.agent?.name ?? ""}\u0000${kind}`
    const next = (this.turns.get(key) ?? Promise.resolve()).then(() => {
      if (ctx.signal?.aborted) throw new Error("stopped before it ran")
      return fn()
    })
    const settled = next.catch(() => {})
    this.turns.set(key, settled)
    settled.then(() => this.turns.get(key) === settled && this.turns.delete(key))
    return next
  }

  async #call(method, path, body, ctx) {
    try {
      return method === "GET" ? await hostOf(ctx).get(path, { signal: ctx.signal }) : await hostOf(ctx).post(path, body, { signal: ctx.signal })
    } catch (e) {
      if (e?.name === "AbortError" || ctx.signal?.aborted) throw new Error("stopped (the session, if one started, keeps running: terminal.list)")
      throw Object.assign(new Error(`${path.split("?")[0]}: ${hostError(e)}`), { status: e?.status })
    }
  }

  // kind: run (the main session) | start (the long one, replacing what runs there).
  #started(ctx, input, wait, kind) {
    const command = String(input.command ?? "").trim()
    if (!command) throw new Error('command: one program and its arguments, or several joined by && (no shell: no pipes, redirects or ;)')
    const lease = leaseOf(input.lease)
    const agent = ctx.agent
    return this.#call("POST", "term/start", {
      command,
      ...(input.cwd != null && input.cwd !== "" ? { cwd: String(input.cwd) } : {}),
      ...(input.name ? { name: String(input.name) } : {}),
      ...(lease ? { lease } : {}),
      agent: agent?.name ?? null,
      writes: list(agent?.config?.writes), // the holder's lane; none = [] (it writes nothing)
      wait,
      slot: this.#slot(SLOT[kind]),
      ...(kind === "start" ? { replace: true } : {}),
    }, ctx)
  }

  // ---- commands ----

  async #run(input = {}, ctx = {}) {
    const wait = seconds(input.timeout, RUN_WAIT)
    return this.#turn(ctx, "run", async () => {
      let session
      try {
        ;({ session } = await this.#started(ctx, input, wait, "run"))
      } catch (e) {
        // a held lease is the host's own reason (who holds it, what to wait on); any other 409 is the busy main session
        if (e.status !== 409 || / is held by /.test(e.message)) throw e
        const busy = this.state.sessions.find((s) => s.agent === (ctx.agent?.name ?? null) && s.slot === this.#slot("main"))
        throw new Error(`your main session is still running ${busy?.command ? `"${busy.command}"` : "an earlier command"} — ${this.name}.wait {id: "main"} lets it finish, ${this.name}.stop {id: "main"} ends it; a command that keeps running belongs in ${this.name}.start (your long session)`)
      }
      this.mine?.add(session.id)
      this.#merge(session)
      const lines = linesOf(session.tail)
      if (session.status === "running") return result([headOf(session), `still running after ${wait} s — ${this.name}.wait {id: "main", seconds} for more, ${this.name}.read to look, ${this.name}.stop to end it (your main session runs nothing else until it ends)`, ...lines].join("\n"))
      return result([headOf(session), ...(lines.length ? lines : ["  (no output)"])].join("\n"))
    })
  }

  async #start(input = {}, ctx = {}) {
    return this.#turn(ctx, "start", async () => {
      const { session, replaced } = await this.#started(ctx, input, START_WAIT, "start")
      this.mine?.add(session.id)
      this.#merge(session)
      const lines = linesOf(session.tail, 20)
      const was = replaced ? `replaced: ${replaced.command} (${replaced.status} after ${took(ms(replaced)) || "a moment"})` : null
      const note = session.status === "running" ? `started in your long session; it keeps running — ${this.name}.wait {id: "long", until: "<text from a line it prints>"} waits for it, ${this.name}.read {id: "long"} reads it, ${this.name}.stop {id: "long"} ends it` : "it ended already"
      return result([headOf(session), was, note, ...lines].filter(Boolean).join("\n"))
    })
  }

  async #wait(input = {}, ctx = {}) {
    const id = await this.#id(input, ctx)
    const s = seconds(input.seconds, 30)
    // 2026-10-17: `until` is literal text (the host finds it with includes), or a list where any one is enough.
    const texts = (Array.isArray(input.until) ? input.until : [input.until]).filter((t) => t != null && t !== "").map(String)
    const until = !texts.length ? undefined : Array.isArray(input.until) ? texts : texts[0]
    const r = await this.#call("POST", "term/wait", { id, seconds: s, ...(until ? { until } : {}) }, ctx)
    this.#merge(r.session)
    // 2026-10-17: a dropped `until` (the host's `error`) or a wait cut short read "ended" while the session ran on.
    const what = r.error ? `until dropped: ${r.error}` : r.matched ? `matched: ${clip(r.line ?? "", PROMPT_LINE)}` : r.timedOut ? `still running after ${s} s${until ? ` (no line held ${texts.map((t) => JSON.stringify(t)).join(" or ")})` : ""}` : r.session?.status === "running" ? "still running (the wait returned early)" : "ended"
    return result([headOf(r.session), what, ...linesOf(r.session?.tail, r.matched ? 15 : TAIL)].join("\n"))
  }

  async #read(input = {}, ctx = {}) {
    const id = await this.#id(input, ctx)
    const n = Math.min(1000, Math.max(1, Math.round(Number(input.lines) || TAIL)))
    const r = await this.#call("GET", `term/read?id=${encodeURIComponent(id)}&lines=${n}`, null, ctx)
    // a slot session's scrollback holds its earlier commands: the twin keeps the current command's tail
    this.#merge(r.session, r.session?.slot ? undefined : r.lines)
    return result([headOf(r.session), ...(r.lines?.length ? linesOf(r.lines, n) : ["  (no output yet)"])].join("\n"))
  }

  async #send(input = {}, ctx = {}) {
    const id = await this.#id(input, ctx)
    if (input.text == null) throw new Error("text: the line to send to its stdin")
    const r = await this.#call("POST", "term/write", { id, text: String(input.text) }, ctx)
    this.#merge(r.session)
    return result([`sent to ${id}`, headOf(r.session), ...linesOf(r.session?.tail, 10)].join("\n"))
  }

  async #stop(input = {}, ctx = {}) {
    const id = await this.#id(input, ctx)
    const r = await this.#call("POST", "term/stop", { id }, ctx)
    this.#merge(r.session)
    return result([headOf(r.session), ...linesOf(r.session?.tail, 10)].join("\n"))
  }

  async #list(_input = {}, ctx = {}) {
    const r = await this.#call("GET", "term/list?tail=0", null, ctx)
    const sessions = (r?.sessions ?? []).filter((s) => !this.mine || this.mine.has(s.id))
    const policy = r?.policy
    const lines = sessions.map((s) => headOf(s))
    const programs = policy?.programs?.length ? `programs: ${policy.programs.join(" ")}${policy.missing?.length ? ` (missing toolchains: ${policy.missing.join(", ")})` : ""}` : null
    return [lines.length ? lines.join("\n") : "no sessions", programs].filter(Boolean).join("\n")
  }

  // ---- views ----

  brief() {
    const all = this.state.sessions
    const running = all.filter((s) => s.status === "running").length
    return all.length ? `${running} running · ${all.length - running} finished` : "no sessions yet"
  }

  render(agent) {
    const can = this.can(agent)
    const own = (c) => can.includes(`${this.name}.${c}`)
    const writes = list(agent?.config?.writes)
    const starts = own("run") || own("start")
    const slots = [
      own("run") ? `main — ${this.name}.run runs your commands there, one at a time` : null,
      own("start") ? `long — ${this.name}.start runs the one that keeps going there (a server, a training run, a watcher; the next start replaces it)` : null,
    ].filter(Boolean)
    const head = [
      `the desk's terminal: sessions keep running between your steps (a server, a training run)${can.length ? `: ${can.join(", ")}` : ""}`,
      slots.length ? `your two sessions: ${slots.join("; ")}${own("read") ? ` — ${this.name}.read {id: "main"${own("start") ? ' | "long"' : ""}} reads one` : ""}` : null,
      starts ? (writes.length ? `your commands write only: ${writes.join(", ")} (and a private temp folder)` : "your commands write nothing in the workspace: no writes: lane in your agent.md") : null,
    ].filter(Boolean)
    const all = this.state.sessions.map((s) => ({ ...(this.full.get(s.id) ?? {}), ...s }))
    if (!all.length) return [...head, "(no sessions yet)"].join("\n")
    const now = Date.now()
    const running = all.filter((s) => s.status === "running")
    const done = all.filter((s) => s.status !== "running")
    const out = [...head]
    if (running.length) out.push("RUNNING", ...running.flatMap((s) => [headOf(s, now), ...(s.tail?.length ? linesOf(s.tail) : ["  (no output yet)"])]))
    if (done.length) out.push("FINISHED", ...done.map((s) => headOf(s, now)))
    return out.join("\n")
  }
}
