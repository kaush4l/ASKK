import { Artifact } from "../artifact/artifact.js"
import { hostError } from "./files.js"
import { clipAfter as clip } from "../util/text.js"

// Dev (2026-10-25 owner: "a goal based live dev artifact … the goal, a UI preview if present, a terminal status to
// control, ability to make changes … the artifact will initialize the current project to allow the dev desk to make
// changes"): the one project a dev desk changes, seen as one block — what the work is for (the holder's goal), the
// project (a git worktree on its own branch, made ready by dev.init), what changed since the checks last passed, the
// checks (each pass or fail with its last lines), the terminal sessions running, the page in the preview. It composes
// the holder's other artifacts — goal, files, terminal, preview, found by kind on the holder (one missing: a line less)
// — so nothing is kept twice: it owns only the project and its checks.
//
//   dev.init   {}       the project ready: host POST projects/init (a main.js worktree: git worktree add, its setup)
//   dev.check  {name?}  every check (or one) run in the holder's terminal main session, in the project: pass | fail
//   dev.status {}       git status of the project: its branch and the files changed
//   2026-10-25 owner ("we need a new restart command … If any changes break the application, we should be able to
//   roll back, capture this evidence and start from that point"; host capabilities/checkpoints.js and restart.js):
//   dev.checkpoint {why}   keep the project's tree as it is now (every file that differs from HEAD) — c<n>
//   dev.rollback {id, why} the tree back to checkpoint id (the tree before kept as a checkpoint: the evidence)
//   dev.health {}          ASKK itself: the server's desks and pages answer (a page that does not compile is a 500)
//   dev.restart {why}      ASKK itself: restart the server so kernel and server changes take effect — every check must
//                          pass first; a supervisor outside the server brings it back, and when it does not come up
//                          healthy rolls the tree back to the last good checkpoint and restarts on that. The run that
//                          asked ends with the server; the outcome (ok | rolled_back | failed, with its evidence) goes
//                          into the goal's ledger and the goal resumes two minutes later from it.
//   A good checkpoint is kept on its own each time every check passes (and, for ASKK itself, the health is ok).
//
// gate (soft): a holder of dev.check answers only when no file of the project changed since every check last passed.
// Config (main.js builtin.dev): {project: <projects/ name>, checks: {name: command}, preview: {command, url}}.
// State {project: {name, workspace, path, branch, ready, self (ASKK itself: main.js projects.<name>.self), setup, at}, checks: [{name, command, status: never | pass |
// fail, exit, ms, at, by, tail ≤ TAIL}], passed_at, git: {branch, files: [{path, code}] ≤ GIT_FILES, at} | null,
// preview, links: {goal, files, terminal, preview} (the ids it composes, for the view), revision}.

const KINDS = ["goal", "files", "terminal", "preview"]
const TAIL = 20
const GIT_FILES = 60
const CHECK_WAIT = 600 // s: a check's longest run
const PROMPT_LINES = 12 // a failed check's last lines in the prompt

// What a tab downloads when it opens this desk's stream (host projects/health snapshot: kernel-team snapshotSize).
const kb = (n) => `${Math.round((Number(n) || 0) / 1024)} KB`
// the goal artifact's KB is always named (goal-kb-exact: its size is a measured target), after the largest when not among them
export const snapshotLine = (x) => {
  const all = [...(x.states ?? []), ...(x.artifacts ?? [])].sort((a, b) => b.bytes - a.bytes)
  const top = all.slice(0, 4)
  const goal = (x.artifacts ?? []).find((t) => t.id === "goal")
  const tail = goal && !top.includes(goal) ? `; goal ${kb(goal.bytes)}` : ""
  return `SNAPSHOT ${kb(x.bytes)} a tab loads on open — states ${kb(x.parts?.states)}, artifacts ${kb(x.parts?.kernel)}, registry ${kb(x.parts?.registry)}, log ${kb(x.parts?.log)}; largest: ${top.map((t) => `${t.id} ${kb(t.bytes)}`).join(", ")}${tail}`
}

const RESTART_STATES = ["pending", "restarting", "rolling_back"]
const REFRESH_MS = 8000
const sibling = (agent, kind) => agent?.artifacts?.find((a) => a.kind === kind) ?? null
const hm = (iso) => String(iso ?? "").slice(11, 16)
const took = (ms) => (ms == null ? "" : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 60_000)} min`)

export class Dev extends Artifact {
  static about = "the project a dev desk changes: init, checks, git status, checkpoints, supervised restart with rollback"
  static options = { project: "the project name in main.js projects", checks: "{name: command | {command, cwd}}: the checks dev.check runs", preview: "{command, url}: the app the preview opens" }
  static commands = {
    init: { description: "make the project ready to change — once, before any other work on it (a fresh worktree on its own branch, its setup run)", input: {}, run(i, c) { return this.init(c) } },
    check: {
      description: "run the project's checks in your terminal, in the project — after every change; your answer waits while a change is unchecked",
      input() { return { name: `one check (optional): ${this.state.checks.map((c) => c.name).join(" | ") || "none configured"}` } },
      run(i, c) { return this.check(i, c) },
    },
    status: { description: "the project's git status: its branch and every file changed", input: {}, run(i, c) { return this.status(c) } },
    checkpoint: { description: "keep the project's tree as it is now (a point to roll back to) — a good one is kept on its own whenever every check passes", input: { why: "what this point is" }, run(i, c) { return this.checkpoint(i, c) } },
    rollback: { description: "put the project's tree back to a checkpoint (the tree now is kept as another: the evidence of what broke)", input: { id: "the checkpoint (c<n>)", why: "what broke" }, run(i, c) { return this.rollback(i, c) } },
    health: { description: "ASKK itself: does the live server answer — every desk hosted, the pages compile (/, /live, /compose)", input: {}, run(i, c) { return this.health(c) } },
    restart: { description: "ASKK itself: restart the live server so kernel and server changes take effect — only with every check passing; if it does not come back healthy, the tree is rolled back to the last good checkpoint and the server restarted on that. Your run ends with the server; the outcome is in the goal's ledger when the loop resumes", input: { why: "what changed that needs the restart" }, run(i, c) { return this.restart(i, c) } },
  }

  constructor({ id = "dev", project = null, checks = {}, preview = null, clock = () => new Date() } = {}) {
    super({ name: id, title: id === "dev" ? "dev — the project the desk changes" : `${id} — dev` })
    Object.assign(this, { kind: "dev", view: "dev", keep: "always", clock })
    // a check is a command, or {command, cwd} — cwd: a folder of the project it runs in (2026-10-25: bun test from the
    // root of ASKK itself lists custom/, which the sandbox never reads; from backend/ it runs)
    const list = Object.entries(checks ?? {}).map(([name, c]) => ({ name, command: String(c?.command ?? c), cwd: c?.cwd ? String(c.cwd).replace(/^\/+|\/+$/g, "") : null, status: "never", exit: null, ms: null, at: null, by: null, tail: [] }))
    this.state = { project: project ? { name: project, workspace: `projects/${project}`, ready: false } : null, checks: list, passed_at: null, git: null, preview, links: {}, checkpoints: [], restarts: [], noted: [], health: null, revision: 0 }
    this.poll = 5000 // a restart's outcome shows while a tab watches
    this.pulled = 0
  }

  restore(data) {
    if (!data || typeof data !== "object") return
    // the config names the checks; what each did last comes back while its command is the same
    const last = new Map((data.checks ?? []).map((c) => [c.name, c]))
    const checks = this.state.checks.map((c) => (last.get(c.name)?.command === c.command ? { ...c, ...last.get(c.name) } : c))
    const p = this.state.project
    this.state = { ...this.state, project: p && { ...p, ...data.project, name: p.name, workspace: p.workspace }, checks, passed_at: data.passed_at ?? null, git: data.git ?? null, checkpoints: data.checkpoints ?? [], restarts: data.restarts ?? [], noted: data.noted ?? [], health: data.health ?? null }
  }

  // The ids of what it composes, for the view (known once the holder holds them all).
  #link(agent) {
    const links = Object.fromEntries(KINDS.map((k) => [k, sibling(agent, k)?.id]).filter(([, v]) => v))
    if (JSON.stringify(links) !== JSON.stringify(this.state.links)) this.bump({ links })
  }
  attach(agent) {
    this.#link(agent)
  }
  onRunStart(agent) {
    this.#link(agent)
  }

  #project() {
    const p = this.state.project
    if (!p) throw new Error("no project: main.js builtin.dev.project names one of the desk's projects")
    return p
  }

  #ready() {
    const p = this.#project()
    if (!p.ready) throw new Error(`${p.workspace} is not ready: ${this.name}.init first`)
    return p
  }

  async init(ctx = {}) {
    const p = this.#project()
    let r
    try {
      r = await ctx.host.post("projects/init", { name: p.name }, { signal: ctx.signal })
    } catch (e) {
      throw new Error(`projects/init: ${hostError(e)}`)
    }
    this.bump({ project: { ...p, path: r.path, branch: r.branch, ready: true, self: r.self === true, setup: r.setup ?? p.setup ?? null, at: this.clock().toISOString() } })
    const setup = r.setup ? ` — ${r.setup.command}: exit ${r.setup.exit}${r.setup.exit ? `\n${r.setup.tail.join("\n")}` : ""}` : ""
    return `${p.workspace} ${r.created ? "made" : "ready"}: ${r.branch ? `branch ${r.branch}, ` : ""}${r.self ? "ASKK itself (the repository the live server runs), " : ""}${r.path}${setup}`
  }

  // A command in the holder's terminal main session, in the project → {exit, status, tail, ms}.
  async #run(command, ctx, timeout = CHECK_WAIT, cwd = null) {
    const term = sibling(ctx.agent, "terminal")
    if (!term) throw new Error(`${this.name} runs in your terminal: hold the terminal artifact too`)
    const t0 = Date.now()
    await term.commands().find((t) => t.name === `${term.name}.run`).run({ command, cwd: cwd && !cwd.split("/").includes("..") ? `${this.#project().workspace}/${cwd}` : this.#project().workspace, timeout }, ctx)
    const s = term.state.sessions.find((x) => x.agent === (ctx.agent?.name ?? null) && x.slot?.endsWith("main"))
    return { exit: s?.exit ?? null, status: s?.status ?? "unknown", tail: [...(s?.tail ?? [])].slice(-TAIL).map((l) => clip(l, 300)), ms: Date.now() - t0 }
  }

  async check({ name } = {}, ctx = {}) {
    this.#ready()
    const want = name ? this.state.checks.filter((c) => c.name === String(name).trim()) : this.state.checks
    if (!want.length) throw new Error(name ? `no check ${name} — ${this.state.checks.map((c) => c.name).join(", ")}` : "no checks configured (main.js builtin.dev.checks)")
    const lines = []
    for (const c of want) {
      const r = await this.#run(c.command, ctx, CHECK_WAIT, c.cwd)
      const status = r.exit === 0 ? "pass" : "fail"
      const done = { ...c, status, exit: r.exit, ms: r.ms, at: this.clock().toISOString(), by: ctx.agent?.name ?? null, tail: r.tail }
      this.state.checks = this.state.checks.map((x) => (x.name === c.name ? done : x))
      const why = r.exit != null ? ` exit ${r.exit}` : r.status === "running" ? ` — still running after ${CHECK_WAIT} s` : ""
      lines.push(`${status === "pass" ? "✓" : "✗"} ${c.name} (${c.command}${c.cwd ? ` in ${c.cwd}` : ""}) ${status}${why} in ${took(r.ms)}`, ...(status === "fail" ? r.tail.slice(-PROMPT_LINES).map((l) => `  ${l}`) : []))
    }
    const all = this.state.checks.every((c) => c.status === "pass")
    // every change before the oldest of the passing runs is checked
    this.bump({ checks: this.state.checks, passed_at: all ? this.state.checks.map((c) => c.at).sort()[0] : null })
    await this.status(ctx).catch(() => null)
    // every check passing (and ASKK itself answering): a good point to roll back to
    if (all && !name) {
      const h = this.state.project.self ? await this.#health(ctx).catch((e) => ({ ok: false, problems: [e.message] })) : null
      if (h) lines.push(h.ok ? `✓ health: every desk hosted, ${h.pages.map((p) => `${p.path} ${p.status} in ${p.ms} ms`).join(", ")}` : `✗ health: ${h.problems.join("; ")}`)
      if (!h || h.ok) {
        const c = await this.#post("projects/checkpoint", { why: "every check passed", kind: "good" }, ctx).catch(() => null)
        if (c?.checkpoint) lines.push(`good checkpoint ${c.checkpoint.id} kept (${c.checkpoint.files} files differ from HEAD)`)
      }
    }
    return [...lines, all ? "every check passes" : `failing: ${this.state.checks.filter((c) => c.status !== "pass").map((c) => c.name).join(", ")} — fix it, then ${this.name}.check again`].join("\n")
  }

  async status(ctx = {}) {
    const p = this.#ready()
    const r = await this.#run("git status --porcelain=v1 -b", ctx, 60)
    if (r.exit !== 0) throw new Error(`git status: exit ${r.exit}\n${r.tail.join("\n")}`)
    const rows = r.tail.filter((l) => /^(## |[ MADRCU?!]{2} )/.test(l))
    const branch = rows.find((l) => l.startsWith("## "))?.slice(3).split("...")[0] ?? null
    const files = rows.filter((l) => !l.startsWith("## ")).map((l) => ({ code: l.slice(0, 2).trim(), path: l.slice(3) })).slice(0, GIT_FILES)
    this.bump({ git: { branch, files, at: this.clock().toISOString() } })
    return `${p.workspace} on ${branch ?? "?"}: ${files.length ? files.map((f) => `${f.code} ${f.path}`).join(", ") : "no changes"}`
  }

  async #post(path, body, ctx) {
    try {
      return await ctx.host.post(path, { name: this.#ready().name, ...body, by: ctx.agent?.name ?? null }, { signal: ctx.signal })
    } catch (e) {
      throw new Error(`${path}: ${hostError(e)}`)
    }
  }

  async #health(ctx) {
    const h = await this.#post("projects/health", {}, ctx)
    this.bump({ health: { ok: h.ok, ms: h.ms ?? null, problems: h.problems ?? [], pages: h.pages ?? [], warm: h.warm ?? null, snapshot: h.snapshot ?? null, at: this.clock().toISOString() } })
    return h
  }

  async checkpoint({ why } = {}, ctx = {}) {
    const r = await this.#post("projects/checkpoint", { why: String(why ?? ""), kind: "mark" }, ctx)
    await this.#pull(ctx, true)
    return `checkpoint ${r.checkpoint.id}: ${r.checkpoint.files} files differ from HEAD, ${r.checkpoint.deleted} deleted — ${this.name}.rollback {id: "${r.checkpoint.id}"} brings the tree back here`
  }

  async rollback({ id, why } = {}, ctx = {}) {
    if (!id) throw new Error(`id: the checkpoint to go back to (${this.state.checkpoints.map((c) => c.id).join(", ") || "none yet"})`)
    const r = (await this.#post("projects/rollback", { id: String(id), why: String(why ?? "") }, ctx)).rollback
    await this.#pull(ctx, true)
    await this.status(ctx).catch(() => null)
    this.#ledger(ctx.agent, "decision", `rolled back to ${r.id}: ${why || "no reason given"} — the tree before is ${r.before}`, `${r.restored.length} restored, ${r.reverted.length} reverted, ${r.removed.length} removed`)
    return `back at ${r.id}: restored ${r.restored.join(", ") || "none"}; reverted to HEAD ${r.reverted.join(", ") || "none"}; removed ${r.removed.join(", ") || "none"} — the tree before is checkpoint ${r.before} (dev.rollback {id: "${r.before}"} returns to it). dev.check now.`
  }

  async health(ctx = {}) {
    if (!this.#ready().self) throw new Error(`${this.state.project.workspace} is not ASKK itself: check its own app (its preview, its checks)`)
    const h = await this.#health(ctx)
    const w = h.warm
    const warm = w?.pages?.length ? `warm at ${hm(w.at)}: ${w.pages.map((p) => `${p.path} ${p.status === 200 ? `${p.ms} ms` : `${p.status || p.error} in ${p.ms} ms`}`).join(" · ")}` : "warm: none"
    return `${h.ok ? `healthy: every desk hosted (${h.desks.join(", ")}), ${h.pages.map((p) => `${p.path} ${p.status} in ${took(p.ms)}`).join(", ")}` : `NOT healthy:\n${h.problems.map((p) => `  ${p}`).join("\n")}`}\n${warm}${h.snapshot ? `\n${snapshotLine(h.snapshot)}` : ""}`
  }

  async restart({ why } = {}, ctx = {}) {
    const p = this.#ready()
    if (!p.self) throw new Error(`${p.workspace} is not ASKK itself: restart its own app in your terminal`)
    if (!String(why ?? "").trim()) throw new Error("why: what changed that needs the restart (kernel or server code)")
    const failing = this.state.checks.filter((c) => c.status !== "pass")
    if (failing.length || this.unchecked(ctx.agent).length) throw new Error(`not with ${failing.length ? `${failing.map((c) => c.name).join(", ")} not passing` : "a change unchecked"}: ${this.name}.check first — a restart is for a tree whose checks pass`)
    // the health before it (the last dev.health, slimmed): the record keeps it beside the supervisor's after
    const h = this.state.health
    const r = (await this.#post("projects/restart", { why: String(why), before: h ? { ok: h.ok, ms: h.ms ?? null, at: h.at ?? null, problems: (h.problems ?? []).slice(0, 6) } : null }, ctx)).restart
    sibling(ctx.agent, "goal")?.soon?.(2)
    this.bump({ restarts: [this.#slim(r), ...this.state.restarts.filter((x) => x.id !== r.id)].slice(0, 6) })
    return `restart ${r.id} started (checkpoint ${r.pre} kept; rolls back to ${r.good ?? "nothing — no good checkpoint yet"} if the server does not come back healthy). The server goes down in a moment and this run ends with it: say nothing more. The outcome goes into the goal's ledger, and the loop resumes from it.`
  }

  #slim(r) {
    // the health before (posted with dev.restart) and after (the supervisor's; an older ok record's health is its after)
    const side = (h) => (h && typeof h.ok === "boolean" ? { ok: h.ok, ms: h.ms ?? null } : null)
    return { id: r.id, status: r.status, why: r.why, by: r.by, at: r.at, ended_at: r.ended_at ?? null, pre: r.pre, good: r.good, problems: (r.evidence?.problems ?? r.health?.problems ?? []).slice(0, 6), log: r.evidence?.log ? String(r.evidence.log).split("\n").filter((l) => /error|Error|failed|Cannot|SyntaxError/.test(l)).slice(-6) : [], rollback: r.rollback ? { id: r.rollback.id, before: r.rollback.before, restored: r.rollback.restored?.length ?? 0, reverted: r.rollback.reverted?.length ?? 0, removed: r.rollback.removed?.length ?? 0 } : null, note: r.note ?? null, before: side(r.before), after: side(r.after ?? (r.status === "ok" ? r.health : null)) }
  }

  // A line in the goal's ledger (the goal outlives every run and compaction: the loop starts again from it).
  #ledger(agent, kind, text, evidence) {
    const goal = sibling(agent, "goal")
    try {
      goal?.note?.({ kind, text, evidence }, this.name)
    } catch {}
  }

  // The checkpoints and restarts, read back (a restart's outcome is known only once the server is up again).
  async #pull(ctx, force = false) {
    const p = this.state.project
    if (!p?.ready || !ctx?.host || (!force && Date.now() - this.pulled < REFRESH_MS)) return
    this.pulled = Date.now()
    // what the project is comes from the host's registry, never only from a save (a desk reconfigured from a worktree
    // to ASKK itself kept the old path and branch, so its agents read "worktree, the owner merges" and could not restart)
    const reg = (await ctx.host.get("projects").catch(() => null))?.projects?.find((x) => x.name === p.name)
    if (reg && (reg.path !== p.path || !!reg.self !== !!p.self || (reg.branch ?? null) !== (p.branch ?? null))) this.bump({ project: { ...this.state.project, path: reg.path, self: reg.self === true, branch: reg.branch ?? null } })
    const cps = await ctx.host.get(`projects/checkpoints?name=${encodeURIComponent(p.name)}`).catch(() => null)
    const rs = this.state.project.self ? await ctx.host.get("projects/restarts").catch(() => null) : null
    const patch = {}
    if (cps?.checkpoints) patch.checkpoints = cps.checkpoints.slice(0, 8).map((c) => ({ id: c.id, kind: c.kind, at: c.at, why: c.why, files: c.files, by: c.by }))
    if (rs?.restarts) patch.restarts = rs.restarts.filter((r) => !r.project || r.project === p.name).slice(0, 6).map((r) => this.#slim(r))
    const noted = new Set(this.state.noted)
    for (const r of patch.restarts ?? []) {
      if (RESTART_STATES.includes(r.status) || noted.has(r.id)) continue
      noted.add(r.id)
      const by = ctx.agent ?? null
      if (r.status === "ok") this.#ledger(by, "fact", `restart ${r.id} came back healthy: ${r.why}`, `restart record ${r.id}`)
      else this.#ledger(by, "dead_end", `restart ${r.id} (${r.why}) broke the server: ${r.problems.join("; ").slice(0, 300) || r.note || "no detail"}${r.status === "rolled_back" ? ` — rolled back to ${r.good}; the broken tree is checkpoint ${r.rollback?.before}` : " — NOT rolled back: the owner must look"}`, [...r.problems, ...r.log].join(" | ").slice(0, 600) || r.status)
    }
    if (noted.size !== this.state.noted.length) patch.noted = [...noted].slice(-40)
    if (JSON.stringify(patch.checkpoints) !== JSON.stringify(this.state.checkpoints) || JSON.stringify(patch.restarts) !== JSON.stringify(this.state.restarts) || patch.noted) this.bump(patch)
  }

  async refresh(agent) {
    const host = agent?.context?.host
    if (host) await this.#pull({ host, agent })
  }

  // The project's files changed since every check last passed (the files artifact's record).
  unchecked(agent) {
    const p = this.state.project
    const files = sibling(agent, "files")
    if (!p || !files) return []
    return (files.state.modified ?? []).filter((m) => m.path.startsWith(`${p.workspace}/`) && (!this.state.passed_at || m.at > this.state.passed_at))
  }

  gate(agent) {
    if (!agent?.tools?.has(`${this.name}.check`)) return null
    const open = this.unchecked(agent)
    if (!open.length) return null
    return `${open.length} file${open.length > 1 ? "s" : ""} of the project changed since the checks last passed (${open.slice(-4).map((m) => m.path).join(", ")}): ${this.name}.check, fix what fails, then answer`
  }

  #safetyLines() {
    const s = this.state
    const good = s.checkpoints.find((c) => c.kind === "good")
    const r = s.restarts[0]
    return [
      s.project?.self && s.health ? `HEALTH ${s.health.ok ? `ok — ${s.health.pages.map((p) => `${p.path} ${p.ms} ms`).join(", ")}` : `NOT ok: ${s.health.problems.join("; ")}`} at ${hm(s.health.at)}` : null,
      s.project?.self && s.health?.snapshot ? snapshotLine(s.health.snapshot) : null,
      s.checkpoints.length ? `CHECKPOINTS ${good ? `last good ${good.id} ${hm(good.at)}` : "no good one yet (every check passing keeps one)"} · newest ${s.checkpoints.slice(0, 4).map((c) => `${c.id} ${c.kind}`).join(", ")}` : null,
      r ? `RESTART ${r.id} ${r.status}${r.ended_at ? ` ${hm(r.ended_at)}` : ""}: ${r.why}${r.status === "rolled_back" ? ` — broke (${r.problems.join("; ")}), rolled back to ${r.good}; the broken tree is ${r.rollback?.before}` : r.status === "failed" ? ` — FAILED: ${r.problems.join("; ") || r.note}` : ""}` : null,
    ].filter(Boolean)
  }

  brief() {
    const p = this.state.project
    if (!p) return "no project"
    const checks = this.state.checks.map((c) => `${c.name} ${c.status}`).join(" · ")
    const r = this.state.restarts[0]
    return [p.ready ? `${p.workspace}${p.branch ? ` @ ${p.branch}` : ""}` : "not initialized", checks || null, this.state.git ? `${this.state.git.files.length} changed` : null, r ? `restart ${r.id} ${r.status}` : null].filter(Boolean).join(" · ")
  }

  render(agent) {
    const p = this.state.project
    if (!p) return "no project configured (main.js builtin.dev.project)"
    const goal = sibling(agent, "goal")?.state
    const standing = goal?.goal && ["active", "paused"].includes(goal.status) ? goal.goal : null
    const frame = goal?.frames?.findLast((f) => f.agent === agent?.name && f.status === "working")
    const running = sibling(agent, "terminal")?.state?.sessions?.filter((s) => s.status === "running") ?? []
    const preview = sibling(agent, "preview")?.state
    const page = preview?.current?.kind === "page" ? preview.pages?.find((x) => x.id === preview.current.id) : null
    const open = this.unchecked(agent)
    const how = this.state.preview
    return [
      `PROJECT ${p.workspace}${!p.ready ? ` — NOT READY: ${this.name}.init before anything else` : p.self ? ` — ASKK itself, the repository the live server runs: a saved UI change is live at once (the page reloads); kernel and server code waits for the owner's restart; never commit, push or switch branch` : `${p.branch ? ` — branch ${p.branch}` : ""} (its own worktree: change it freely; the owner merges)`}`,
      standing ? `GOAL ${standing.text} · measure: ${standing.measure}${goal.next ? ` · next: ${clip(goal.next, 200)}` : ""}` : frame ? `GOAL ${frame.intent} · done when: ${frame.done}` : null,
      this.state.git ? `GIT ${this.state.git.branch ?? "?"} at ${hm(this.state.git.at)}: ${this.state.git.files.length ? this.state.git.files.slice(0, 20).map((f) => `${f.code} ${f.path}`).join(", ") : "clean"}` : null,
      open.length ? `UNCHECKED since the checks last passed: ${open.map((m) => m.path.slice(p.workspace.length + 1)).join(", ")}` : null,
      ...this.state.checks.flatMap((c) => [
        `CHECK ${c.name}: ${c.command}${c.cwd ? ` (in ${c.cwd})` : ""} — ${c.status === "never" ? "not run yet" : `${c.status}${c.exit != null ? ` exit ${c.exit}` : ""} ${hm(c.at)} by ${c.by} in ${took(c.ms)}`}`,
        ...(c.status === "fail" ? c.tail.slice(-PROMPT_LINES).map((l) => `  ${l}`) : []),
      ]),
      running.length ? `RUNNING ${running.map((s) => `${s.id} ${s.command}${s.urls?.length ? ` ${s.urls.join(" ")}` : ""}`).join(" · ")}` : null,
      ...this.#safetyLines(),
      page ? `PREVIEW ${page.url}${page.errors ? ` · ${page.errors} console errors` : ""}` : how ? `PREVIEW none open — ${how.command ? `terminal.start {command: "${how.command}", cwd: "${p.workspace}"}, then ` : ""}preview.open {url: "${how.url}"}` : null,
    ]
      .filter(Boolean)
      .join("\n")
  }
}
