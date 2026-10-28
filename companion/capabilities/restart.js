// Restart with rollback (2026-10-25 owner: "we need a new restart command. This is because, when the agent modifies
// files in the project, we want to make sure all the changes are made. If any changes break the application, we should
// be able to roll back, capture this evidence and start from that point"). A desk that changes ASKK itself (a project
// with main.js `self: true`) restarts the server it runs in, so a kernel or server change takes effect — and the server
// must come back healthy, or the tree goes back to the last good checkpoint and the server restarts on that.
//
// The restart cannot run inside the server it restarts: POST projects/restart writes a record and starts
// scripts/restart.js detached (its own session: launchd's kill of the server never reaches it), which:
//   1. kickstarts the launchd job (the server runs under launchd: XPC_SERVICE_NAME; otherwise refused),
//   2. waits for health (checkHealth: the host API lists every desk, the desk that asked among them, without an
//      error; each page in PAGES answers 200 — Next compiles a broken component into a 500),
//   3. healthy → status ok; not → evidence (what failed, the server log's tail), restore the good checkpoint
//      (checkpoints.js: the tree as it was, the broken one kept as `before`), kickstart again, wait → rolled_back, or
//      failed when even that does not come up.
// The record (memory/<desk>/restarts/r<n>.json) is what the desk reads back once it is up again (the dev artifact):
//   {id, at, by, why, desk, project, pre, good, before: {ok, ms, at, problems} | null (the desk's last health,
//    sanitized), status: pending | restarting | ok | rolling_back | rolled_back | failed,
//    health: {ok, problems, pages, ms}, evidence: {problems, pages, log}, rollback: {id, before, restored, reverted,
//    removed}, after, note, ended_at}
//
//   checkHealth({port, desk, pages, fetch}) → {ok, problems: [text], desks: [name], pages: [{path, status, ms}], ms}
//   superviseRestart(record, {kickstart, health, rollback, save, logTail, sleep}) → the record, ended
//   restartBook(dir) → {next, save, get, list}

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { attempt } from "../shared/safe.js"

export const PAGES = ["/", "/live", "/compose"]
// A health a desk posts with its restart (dev.restart: its last dev.health), kept as only what the record shows: ok,
// ms, at and up to 6 problems. Not a health: null.
export const sanitizeHealth = (h) =>
  h && typeof h === "object" && typeof h.ok === "boolean"
    ? { ok: h.ok, ms: Number.isFinite(h.ms) ? h.ms : null, at: typeof h.at === "string" ? h.at.slice(0, 40) : null, problems: (Array.isArray(h.problems) ? h.problems : []).slice(0, 6).map((p) => String(p).slice(0, 300)) }
    : null
const ID = /^r\d{1,6}$/
const iso = () => new Date().toISOString()

export async function checkHealth({ port, desk = null, pages = PAGES, fetch = globalThis.fetch, timeoutMs = 90_000 } = {}) {
  const t0 = Date.now()
  const problems = []
  const get = async (path) => {
    const t = Date.now()
    try {
      const r = await fetch(`http://localhost:${port}${path}`, { signal: AbortSignal.timeout(timeoutMs) })
      const json = r.headers.get("content-type")?.includes("json")
      return { path, status: r.status, ms: Date.now() - t, body: json ? await r.json().catch(() => null) : (await r.text().catch(() => "")).slice(0, 2000) }
    } catch (e) {
      return { path, status: 0, ms: Date.now() - t, error: e.message }
    }
  }
  const d = await get("/__askk/desks")
  const desks = Array.isArray(d.body?.desks) ? d.body.desks : []
  if (d.status !== 200) problems.push(`GET /__askk/desks: ${d.status || d.error}`)
  for (const x of desks) if (x.error) problems.push(`desk ${x.name}: ${x.error}`)
  if (desk && d.status === 200 && !desks.some((x) => x.name === desk)) problems.push(`desk ${desk} is not hosted`)
  const seen = []
  if (d.status === 200)
    for (const path of pages) {
      const p = await get(path)
      seen.push({ path, status: p.status, ms: p.ms })
      if (p.status !== 200) problems.push(`GET ${path}: ${p.status || p.error}${p.status >= 500 && typeof p.body === "string" ? ` — ${p.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300)}` : ""}`)
    }
  return { ok: !problems.length, problems, desks: desks.map((x) => x.name), pages: seen, ms: Date.now() - t0 }
}

// Wait until healthy (up to `waitMs`): the server is down for a while, then compiling.
export async function waitHealthy(health, { waitMs = 180_000, everyMs = 3000, sleep = Bun.sleep, now = Date.now } = {}) {
  const until = now() + waitMs
  let last = null
  while (now() < until) {
    last = await health()
    if (last.ok) return last
    await sleep(everyMs)
  }
  return last ?? (await health())
}

export async function superviseRestart(record, { kickstart, health, rollback, save, logTail = () => "", sleep = Bun.sleep, wait = {} } = {}) {
  const r = { ...record }
  const step = (patch) => save(Object.assign(r, patch))
  await sleep(1500) // the route's answer goes out first
  step({ status: "restarting", restarted_at: iso() })
  const kicked = await kickstart()
  if (!kicked.ok) return step({ status: "failed", ended_at: iso(), evidence: { problems: [`kickstart: ${kicked.error}`], log: logTail() } })
  const first = await waitHealthy(health, { sleep, ...wait })
  if (first.ok) return step({ status: "ok", health: first, after: first, ended_at: iso() })
  const evidence = { problems: first.problems, pages: first.pages, log: logTail() }
  if (!r.good) return step({ status: "failed", health: first, evidence, ended_at: iso(), note: "no good checkpoint to roll back to" })
  step({ status: "rolling_back", health: first, evidence })
  let back
  try {
    back = await rollback(r.good)
  } catch (e) {
    return step({ status: "failed", ended_at: iso(), note: `rollback to ${r.good} failed: ${e.message}` })
  }
  step({ rollback: back })
  const again = await kickstart()
  const second = again.ok ? await waitHealthy(health, { sleep, ...wait }) : { ok: false, problems: [`kickstart: ${again.error}`] }
  return step({ status: second.ok ? "rolled_back" : "failed", after: second, ended_at: iso() })
}

// The records of one desk's restarts.
export function restartBook(dir) {
  const ids = () => (existsSync(dir) ? readdirSync(dir).map((f) => f.replace(/\.json$/, "")).filter((f) => ID.test(f)) : []).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
  const file = (id) => join(dir, `${id}.json`)
  const read = (id) => attempt(() => JSON.parse(readFileSync(file(id), "utf8")))
  return {
    next: () => `r${(ids().map((i) => Number(i.slice(1))).at(-1) ?? 0) + 1}`,
    file,
    save(record) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(file(record.id), JSON.stringify(record, null, 1))
      return record
    },
    get: (id) => (ID.test(String(id ?? "")) ? read(id) : null),
    list: (n = 20) => ids().reverse().slice(0, n).map(read).filter(Boolean),
  }
}

// The host routes (host-api.js, a desk with projects): checkpoints of a git project, a rollback, the health of this
// server, and the restart of it for a project that is ASKK itself.
//   GET  projects/checkpoints?name=        { checkpoints }          newest first
//   GET  projects/restarts                 { restarts }             this desk's, newest first (≤ 20)
//   POST projects/checkpoint {name, why, kind?: good | mark, by?}  { checkpoint }
//   POST projects/rollback {name, id, why, by?}                    { rollback: {id, before, restored, reverted, removed} }
//   POST projects/health {name}                                    checkHealth of this server
//   POST projects/restart {name, why, by?, good?}                  { restart: the record } — 409 while another desk
//        works, or when the server is not launchd's; the supervisor (scripts/restart.js) runs detached
export function projectSafetyRoutes({ snapshotSize = null, projects, desk, port, serverWork = () => [], log = () => {}, env = process.env, spawn = null, appRoot, createCheckpoints }) {
  const book = restartBook(join(desk.memory, "restarts"))
  const entry = (name) => {
    const e = projects.list().find((p) => p.name === String(name ?? ""))
    if (!e || e.missing) throw Object.assign(new Error(`No project ${name}.`), { status: 404 })
    return e
  }
  const cps = (name) => createCheckpoints({ repo: entry(name).path, dir: join(desk.memory, "checkpoints", name) })
  const latestGood = (name) => cps(name).list().find((c) => c.kind === "good")?.id ?? null
  const label = env.XPC_SERVICE_NAME && !env.XPC_SERVICE_NAME.startsWith("0") ? env.XPC_SERVICE_NAME : null
  return {
    GET: {
      "projects/checkpoints": (params) => ({ checkpoints: cps(params.get("name")).list() }),
      "projects/restarts": () => ({ restarts: book.list() }),
    },
    POST: {
      "projects/checkpoint": ({ name, why, kind, by }) => {
        const c = cps(name).create({ why, by: by ?? null, kind: kind === "good" ? "good" : "mark" })
        log(`projects: checkpoint ${c.id} of ${name} (${c.kind}): ${c.files} files${c.why ? ` — ${c.why}` : ""}`)
        return { checkpoint: c }
      },
      "projects/rollback": ({ name, id, why, by }) => {
        const r = cps(name).restore(String(id ?? ""), { why, by: by ?? null })
        log(`projects: ${name} rolled back to ${r.id} (the tree before kept as ${r.before}): ${r.restored.length} restored, ${r.reverted.length} reverted, ${r.removed.length} removed${why ? ` — ${why}` : ""}`)
        return { rollback: r }
      },
      "projects/health": async ({ name }) => {
        if (!entry(name).self) throw Object.assign(new Error(`${name} is not ASKK itself: its health is its own app's.`), { status: 400 })
        // the last restart's warm pass and home import ranking (scripts/dev.js writes logs/warm.json and
        // logs/home-imports.json), each null when there is none
        const report = (file) => {
          try {
            return appRoot ? JSON.parse(readFileSync(join(appRoot, "logs", file), "utf8")) : null
          } catch {
            return null
          }
        }
        return { ...(await checkHealth({ port, desk: desk.name })), warm: report("warm.json"), imports: report("home-imports.json"), snapshot: attempt(() => snapshotSize?.()) ?? null }
      },
      "projects/restart": ({ name, why, by, good, before }) => {
        const e = entry(name)
        if (!e.self) throw Object.assign(new Error(`${name} is not ASKK itself: a restart restarts this server, for a project that is ASKK (main.js self: true).`), { status: 400 })
        if (!label) throw Object.assign(new Error("This server is not running under launchd: the owner restarts it."), { status: 409 })
        const busy = serverWork().filter((w) => w.desk !== desk.name && w.work?.length)
        if (busy.length) throw Object.assign(new Error(`Not now: ${busy.map((w) => `${w.desk} is working (${w.work.map((x) => x.agent).join(", ")})`).join("; ")} — a restart would end it. Try again when they are idle.`), { status: 409 })
        const target = good ? cps(name).get(String(good)).id : latestGood(name)
        const pre = cps(name).create({ why: `before restart: ${why ?? ""}`, by: by ?? null, kind: "restart" })
        const record = book.save({ id: book.next(), at: new Date().toISOString(), by: by ?? null, why: String(why ?? "").slice(0, 400), desk: desk.name, project: name, pre: pre.id, good: target, before: sanitizeHealth(before), status: "pending" })
        const out = Bun.file(book.file(record.id).replace(/\.json$/, ".log"))
        const args = ["scripts/restart.js", "--record", book.file(record.id), "--repo", e.path, "--checkpoints", join(desk.memory, "checkpoints", name), "--port", String(port), "--label", label, ...(env.ASKK_SERVER_LOG ? ["--log", env.ASKK_SERVER_LOG] : [])]
        ;(spawn ?? detached)(process.execPath, args, { cwd: appRoot, log: out.name })
        log(`projects: restart ${record.id} by ${record.by ?? "?"} — ${record.why || "no reason given"} (checkpoint ${pre.id}; rolls back to ${target ?? "nothing: no good checkpoint"} if it does not come up)`)
        return { restart: record }
      },
    },
  }
}

// A process in its own session (setsid): launchd's kill of the server's process group never reaches it.
async function detached(cmd, args, { cwd, log }) {
  const { spawn } = await import("node:child_process")
  const { openSync } = await import("node:fs")
  const fd = openSync(log, "a")
  spawn(cmd, args, { cwd, detached: true, stdio: ["ignore", fd, fd] }).unref()
}
