// Hosting desks: every desk of a folder (or one desk) in one process on one port, each with its own team
// (companion/team/kernel-team.js: the kernel's agents, schedule, wake book, background work), host API, tool
// servers and integrations. Shared by scripts/dev.js (with Next dev) and companion/server/server.js (the compiled
// companion, with the built app).
//
//   const desks = await hostDesks({ folders, port, defaultDesk, readOnly, root? })
//   desks.handleApi(request)    a /__askk/ request → its desk's host API (desks, desks/select, desks/load answered here)
//   desks.announce()            each desk's state/server.json (scripts find the server by it)
//   desks.startTelegram()       each desk's Telegram bridge, where its integration listens here
//   desks.load(name)            hosts <root>/<name>/ now, or reloads it (POST desks/load)
//
// A request reaches a desk by the x-askk-desk header (scripts, cron: server.json names it) or the askk_desk
// cookie (the header's desk switcher), else the default desk. root: the folder the desks live in (default: the
// parent of the first hosted folder, e.g. custom/), where desks/load finds a desk by its folder name.

import { existsSync, mkdirSync, realpathSync } from "node:fs"
import { realpath } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

import { API_PREFIX, createHostApi } from "./host-api.js"
import { DESK_NAME, forgetModules } from "../team/compose.js"
import { CORE_DESKS, findDeskServer, forgetDesk, loadDesk } from "../team/desk.js"
import { checkDesk, proposeTool, scaffoldDesk } from "../team/scaffold.js"
import { createKernelTeam } from "../team/kernel-team.js"
import { runReport, startKernelTelegram } from "../team/kernel-telegram.js"
import { ownerIdFrom } from "../shared/telegram-owner.js"
import { DESK_COOKIE, DESK_HEADER } from "../shared/config.js"
import { httpError } from "../shared/http.js"

// root: the local desks' folder (desks/load and desks/create work there; default custom/ beside the repo's desks/, else
// the first hosted folder's parent); core: the core desks' folder (desks/), where desks/load also finds a desk.
export async function hostDesks({ folders, port, defaultDesk = null, readOnly = false, root = null, core = CORE_DESKS, log = (line) => console.error(line) }) {
  const localFolder = folders.find((f) => resolve(dirname(resolve(f))) !== resolve(core))
  const deskRoot = resolve(root ?? (localFolder ? dirname(resolve(localFolder)) : join(dirname(resolve(core)), "custom")))
  mkdirSync(deskRoot, { recursive: true }) // desks/create writes here even before the first local desk
  const desks = await Promise.all(folders.map((folder) => loadDesk(folder)))
  // Integration listeners (Telegram, …): a desk listens for the integrations it names that no other hosted desk names
  // too — one listener per bot (a second poller gets 409s).
  const listens = (desk, all) => !!desk.integrations?.length && desk.integrations.every((name) => !all.some((d) => d !== desk && d.integrations?.includes(name)))
  const hosted = new Map() // desk name -> { desk, team, api, telegram? }

  // One desk served here: its team (agents, schedule, wakes, background work) and its host API on its workspace.
  async function host(desk, listen) {
    const deskLog = (line) => log(`${desk.name}: ${line}`)
    if (desk.integrations?.length && !listen) deskLog(`integrations ${desk.integrations.join(", ")}: not listened here, another desk names them too`)
    const team = await createKernelTeam({ desk, port, log: deskLog })
    try {
      mkdirSync(desk.workspace, { recursive: true }) // a desk an agent just wrote may have no data/ yet
      // hostPorts: every hosted desk's own port too (it runs alone there), never reached by a desk's terminal programs
      // or preview pages (2026-10-17, companion/capabilities/terminal.js and browser.js).
      const hostPorts = () => [...hosted.values()].map((e) => e.desk.port)
      const api = await createHostApi({ root: await realpath(desk.workspace), desk, team, port, readOnly, listen, hostPorts })
      return { desk, team, api }
    } catch (error) {
      team.terminate()
      throw error
    }
  }

  for (const desk of desks) {
    const running = findDeskServer(desk)
    if (running) throw new Error(`ASKK already runs desk ${desk.name}: http://localhost:${running.port}/ (pid ${running.pid}). Stop it first.`)
    hosted.set(desk.name, await host(desk, listens(desk, desks)))
  }
  // Desks being reloaded (desks/load): a request for one waits for it (503), never reaching another desk.
  const reloading = new Set()
  const known = (name) => hosted.has(name) || reloading.has(name)
  // The default desk, fixed at start; the first hosted one if it is gone (a reload that failed or renamed it).
  const preferred = hosted.has(defaultDesk) ? defaultDesk : [...hosted.keys()][0]
  const fallback = () => (known(preferred) ? preferred : [...hosted.keys()][0])

  // The desk a request is for: the x-askk-desk header, else the askk_desk cookie, else the default.
  const pick = (request) => {
    const name = request.headers.get(DESK_HEADER) ?? new Bun.CookieMap(request.headers.get("cookie") ?? "").get(DESK_COOKIE)
    return known(name) ? name : fallback()
  }
  const allowedHosts = () => new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`])
  const sameOriginJson = (request) => allowedHosts().has((request.headers.get("origin") ?? "").replace(/^http:\/\//, "")) && !!request.headers.get("content-type")?.startsWith("application/json") // host-api.js's rule

  // Asks one desk gave another with wait (desks/ask): id → {status, answer, error, …}, the newest 50.
  const asks = new Map()
  let askSeq = 0
  // Every desk-to-desk ask in the last ASK_WINDOW_MS ({by, to, at}): the loop guard's count.
  const askLog = []
  const ASK_BURST = 6
  const ASK_WINDOW_MS = 10 * 60_000

  // ---- desks/load: a desk hosted (or reloaded) without a restart ---------------------------------

  // One load at a time: two reloads of one desk never interleave.
  let queue = Promise.resolve()
  function load(name) {
    const next = queue.then(() => loadNow(name))
    queue = next.catch(() => {})
    return next
  }

  // Serve a desk's entry under its name (a reload keeps its place in the list): its server.json, its Telegram bridge
  // when the bridges run, a line in its log.
  function serve(entry, line) {
    hosted.set(entry.desk.name, entry)
    entry.team.announce(port, entry.desk.name)
    if (telegramOn) bridge(entry.desk.name, entry)
    entry.team.log(line)
  }
  // The desks hosted beside `entry`, plus `desk` (who listens for an integration).
  const beside = (entry, desk) => [...[...hosted.values()].filter((e) => e !== entry).map((e) => e.desk), desk]

  const realOf = (path) => {
    try {
      return realpathSync(path)
    } catch {
      return null
    }
  }
  // The desk's real folder: <root>/<name> itself, never a link — a link would load code from (and make data/ in) any
  // folder on the machine, and clear that folder's modules. Checked before anything is read or created.
  function deskFolderOf(name) {
    if (typeof name !== "string" || !DESK_NAME.test(name)) throw httpError(400, `name: a desk's folder name in ${deskRoot} (${DESK_NAME}).`)
    // A local desk, else a core one (desks/) of that name.
    const base = !existsSync(join(deskRoot, name)) && core && existsSync(join(core, name)) ? core : deskRoot
    const asked = join(base, name)
    const real = realOf(asked)
    if (!real) throw httpError(404, `No desk "${name}": ${asked} does not exist.`)
    const folder = join(realOf(base), name)
    if (real !== folder) throw httpError(403, `Desk "${name}" is a link (${asked} → ${real}); a desk is a real folder in ${base}.`)
    const main = join(folder, "main.js")
    if (!existsSync(main)) throw httpError(404, `No desk "${name}": ${main} does not exist.`)
    if (realOf(main) !== main) throw httpError(403, `Desk "${name}": main.js is a link; a desk's main.js is its own file.`)
    return folder
  }

  async function loadNow(name) {
    const folder = deskFolderOf(name)
    const previous = [...hosted.values()].find((e) => realOf(e.desk.folder) === folder) ?? null
    if (!previous) {
      forgetModules(folder) // a load that failed before left its modules cached
      forgetDesk(folder)
      try {
        const desk = await loadDesk(folder)
        const running = findDeskServer(desk)
        if (running && running.pid !== process.pid) throw httpError(409, `ASKK already runs desk ${desk.name} elsewhere: http://localhost:${running.port}/ (pid ${running.pid}).`)
        if (hosted.has(desk.name)) throw httpError(409, `A desk named "${desk.name}" is hosted already (${hosted.get(desk.name).desk.folder}).`)
        const entry = await host(desk, listens(desk, beside(null, desk)))
        serve(entry, `desk: loaded from ${folder} (${entry.team.agents.length} agents)`)
        return { name: desk.name, agents: entry.team.agents.length, reloaded: false }
      } catch (error) {
        forgetDesk(folder) // loadDesk keeps a failed load too
        throw error
      }
    }

    // A reload: only while idle. What the old desk runs stops (Telegram bridge, schedule, wakes, background work, tool
    // servers, listeners); its open streams end once the new one is served, so every tab reconnects to it.
    const old = previous.desk.name
    const work = previous.team.work()
    if (work.length) throw httpError(409, `Desk "${old}" is working (${work.map((w) => `${w.agent}: ${w.run}`).join("; ")}); stop it or wait, then load again.`)
    reloading.add(old)
    previous.telegram?.stop()
    previous.team.terminate()
    Promise.resolve(previous.api.close?.()).catch((error) => log(`${old}: desk: closing the previous version: ${error.message}`)) // its sessions end in the background
    forgetModules(folder) // main.js, its agents' and tools' modules (under the real folder only): imported fresh
    forgetDesk(folder)
    forgetDesk(previous.desk.folder) // hosted at start by the path it was given
    try {
      const desk = await loadDesk(folder)
      if (desk.name !== old && hosted.has(desk.name)) throw httpError(409, `A desk named "${desk.name}" is hosted already (${hosted.get(desk.name).desk.folder}).`)
      const entry = await host(desk, listens(desk, beside(previous, desk)))
      if (desk.name !== old) hosted.delete(old)
      serve(entry, `desk: reloaded from ${folder} (${entry.team.agents.length} agents)`)
      return { name: desk.name, agents: entry.team.agents.length, reloaded: true }
    } catch (error) {
      // A broken edit never leaves the desk gone: the version that ran comes back, and the answer says why.
      forgetDesk(folder)
      try {
        serve(await host(previous.desk, listens(previous.desk, beside(previous, previous.desk))), `desk: reload failed (${error.message}); the previous version runs again`)
      } catch (again) {
        hosted.delete(old)
        log(`${old}: desk: reload failed (${error.message}), and the previous version did not start again (${again.message})`)
      }
      throw error
    } finally {
      reloading.delete(old)
      previous.team.endStreams()
    }
  }

  // GET desks: { current, default, desks: [{ name, description, work }] } (work: what its team runs now); POST
  // desks/select { name }: sets the askk_desk cookie; POST desks/load { name }: hosts or reloads <root>/<name>/
  // → { name, agents, reloaded } (409 while it works). POSTs: same-origin JSON only, like the host API.
  async function desksEndpoint(request, path) {
    if (!allowedHosts().has(request.headers.get("host"))) return Response.json({ error: "Host capabilities answer on localhost only." }, { status: 421 })
    const list = () => [...hosted.values()].map(({ desk, team }) => ({ name: desk.name, description: desk.description, work: team.work() }))
    if (path === "desks" && request.method === "GET") return Response.json({ current: pick(request), default: fallback(), desks: list() })
    // desks/ask?id=: a waited ask's state (desk.ask polls it: a run can outlast any one request).
    if (path === "desks/ask" && request.method === "GET") {
      const run = asks.get(new URL(request.url).searchParams.get("id") ?? "")
      return run ? Response.json(run) : Response.json({ error: "No such ask (asks are kept while the server runs, the newest 50)." }, { status: 404 })
    }
    if (request.method !== "POST") return Response.json({ error: "Not found." }, { status: 404 })
    if (!sameOriginJson(request)) return Response.json({ error: path === "desks/load" ? "Desk loads need a same-origin JSON request." : "Desk switches need a same-origin JSON request." }, { status: 403 })
    let body
    try {
      body = JSON.parse((await request.text()) || "{}")
    } catch {
      return Response.json({ error: "Invalid JSON body." }, { status: 400 })
    }
    if (path === "desks/select") {
      const name = body?.name
      if (!hosted.has(name)) return Response.json({ error: `No desk "${name}".` }, { status: 404 })
      const cookie = new Bun.Cookie(DESK_COOKIE, name, { path: "/", sameSite: "strict", maxAge: 31536000 })
      return Response.json({ current: name }, { headers: { "set-cookie": cookie.serialize() } })
    }
    if (path === "desks/load") {
      if (readOnly) return Response.json({ error: "This server is read-only (--read-only): it loads no desks." }, { status: 403 })
      try {
        return Response.json(await load(body?.name))
      } catch (error) {
        return Response.json({ error: error.message }, { status: error.status ?? 500 })
      }
    }
    // 2026-10-20 owner ("for any kind of desk setup, it should be simple enough to request it and the agent figuring out
    // the good ways of creating the desk"): the kit's desk.* tools (backend/kernel/builtin/desks.js). desks/create
    // {name, spec, update?} writes a desk from a spec (companion/team/scaffold.js: config only, checked before it is
    // put in place); desks/check {name} composes one; desks/propose {name, file, code, why} keeps tool code an agent
    // wants under proposed/tools/ (never loaded); desks/ask {name, text, agent?, wait?} gives a hosted desk work (its lead,
    // or that agent) — wait: {id} at once, and GET desks/ask?id= says {status: running | done | failed, answer, error}
    // (2026-10-20: one request held for a whole run timed out); desks/read {name, path} reads a hosted desk's workspace
    // file, or lists a folder (its own host API's fs/read, fs/list: the same containment). by: the asking desk.
    const by = request.headers.get(DESK_HEADER) ?? "owner"
    const answer = async (fn) => {
      try {
        return Response.json(await fn())
      } catch (error) {
        return Response.json({ error: error.message }, { status: error.status ?? 500 })
      }
    }
    if (path === "desks/create" || path === "desks/propose") {
      if (readOnly) return Response.json({ error: "This server is read-only (--read-only): it writes no desks." }, { status: 403 })
      if (path === "desks/propose") return answer(() => proposeTool({ root: deskRoot, name: body?.name, file: body?.file, code: body?.code, why: body?.why, by }))
      return answer(async () => {
        const made = await scaffoldDesk({ root: deskRoot, name: body?.name, spec: body?.spec, update: body?.update === true, by })
        log(`desks: ${by} ${body?.update ? "updated" : "created"} desk ${body.name} (${made.written.length} files)`)
        return { name: body.name, folder: `custom/${body.name}`, written: made.written, check: made.check, hosted: hosted.has(body.name) }
      })
    }
    if (path === "desks/check") {
      // Composing imports the desk's main.js and tools: code runs, so a read-only server checks none.
      if (readOnly) return Response.json({ error: "This server is read-only (--read-only): it checks no desks (a check runs their code)." }, { status: 403 })
      return answer(() => checkDesk(deskFolderOf(body?.name), { name: body?.name }))
    }
    if (path === "desks/ask") {
      return answer(async () => {
        const entry = hosted.get(body?.name)
        if (!entry) throw httpError(404, `Desk "${body?.name}" is not hosted: desks/load it first.`)
        if (body?.name === by) throw httpError(400, "A desk asks another desk, not itself.")
        const text = String(body?.text ?? "").trim()
        if (!text) throw httpError(400, "text: the work for the desk.")
        const from = `desk:${by}`
        // No ask loops (2026-10-20 review): a desk waiting on this one is never asked back with a wait (both would wait
        // until max_minutes), and one desk asks another at most ASK_BURST times in ASK_WINDOW_MS (queued ping-pong).
        if (by !== "owner") {
          const now = Date.now()
          while (askLog.length && now - askLog[0].at > ASK_WINDOW_MS) askLog.shift()
          if (askLog.filter((a) => a.by === by && a.to === body.name).length >= ASK_BURST) throw httpError(429, `${by} asked ${body.name} ${ASK_BURST} times in ${ASK_WINDOW_MS / 60000} minutes: a loop? Read what it wrote (desk.read) or tell the owner.`)
          const waiting = [...asks.values()].find((a) => a.status === "running" && a.by === body.name && a.desk === by)
          if (body?.wait && waiting) throw httpError(409, `${body.name} is waiting on ${by}'s answer (${waiting.id}): answer it instead of asking back.`)
          askLog.push({ by, to: body.name, at: now })
        }
        if (!body?.wait) return entry.team.send({ text, agent: body?.agent ?? null, from })
        const id = `ask-${Date.now().toString(36)}-${++askSeq}`
        const run = { id, desk: body.name, agent: body?.agent ?? null, by, text: text.slice(0, 300), status: "running", answer: null, error: null, at: new Date().toISOString(), ended: null }
        asks.set(id, run)
        for (const old of [...asks.keys()].slice(0, Math.max(0, asks.size - 50))) asks.delete(old)
        entry.team
          .call({ target: body?.agent || null, method: "ask", args: [text, { from }] })
          .then((r) => Object.assign(run, r?.ok === false ? { status: "failed", error: r.error?.message ?? "failed" } : { status: "done", answer: r?.value ?? r }))
          .catch((error) => Object.assign(run, { status: "failed", error: error.message }))
          .finally(() => (run.ended = new Date().toISOString()))
        return { id, status: "running" }
      })
    }
    if (path === "desks/read") {
      return answer(async () => {
        const entry = hosted.get(body?.name)
        if (!entry) throw httpError(404, `Desk "${body?.name}" is not hosted.`)
        const at = String(body?.path ?? "")
        const get = (route) => entry.api.handle(new Request(`http://localhost:${port}${API_PREFIX}${route}?path=${encodeURIComponent(at)}`, { headers: { host: `localhost:${port}` } }))
        let res = await get("fs/read")
        if (res.status === 400) res = await get("fs/list") // a folder
        const out = await res.json().catch(() => null)
        if (!res.ok) throw httpError(res.status, out?.error ?? `HTTP ${res.status}`)
        return out
      })
    }
    return Response.json({ error: "Not found." }, { status: 404 })
  }

  function handleApi(request) {
    const path = new URL(request.url).pathname.slice(API_PREFIX.length)
    if (path === "desks" || path.startsWith("desks/")) return desksEndpoint(request, path)
    const name = pick(request)
    if (reloading.has(name) || !hosted.has(name)) return Response.json({ error: `Desk "${name}" is ${reloading.has(name) ? "reloading" : "not hosted"}; try again in a moment.` }, { status: 503 })
    return hosted.get(name).api.handle(request)
  }

  function announce() {
    for (const [name, { team }] of hosted) team.announce(port, name)
  }

  // A desk's Telegram (companion/team/kernel-telegram.js): the owner's own messages → its lead, answers back, with
  // no tab open; every run gets a live status message, edited in place. Its lines go to the desk's log, so the
  // Live page's desk log shows them. Runs not started from Telegram report there when the lead answers.
  let telegramOn = false
  function bridge(name, entry) {
    if (!entry.api.integrations?.listening.includes("telegram")) return
    const deskLog = (line) => entry.team.log(String(line).startsWith("telegram:") ? line : `telegram: ${line}`)
    startKernelTelegram({ team: entry.team, integrations: entry.api.integrations, stateDir: entry.desk.state, desk: name, owner: ownerIdFrom(process.env), log: deskLog })
      .then((telegram) => {
        entry.telegram = telegram
        entry.team.onLeadAnswer((run) => {
          const from = String(run.request?.from ?? "")
          if (from.startsWith("telegram")) return // answered in the chat already
          if (from.startsWith("watch")) return // the desk's own rescans, every few minutes: no report each
          telegram.notify(runReport({ desk: name, ...run })).catch(() => {})
        })
      })
      .catch((error) => deskLog(`bridge not started: ${error.message}`))
  }
  function startTelegram() {
    telegramOn = true
    for (const [name, entry] of hosted) bridge(name, entry)
  }

  return {
    hosted,
    root: deskRoot,
    get fallback() {
      return fallback()
    },
    // The default desk's state folder: its server.log when ASKK_SERVER_LOG names none.
    serverLog: process.env.ASKK_SERVER_LOG ?? join(hosted.get(fallback()).desk.state, "server.log"),
    handleApi,
    announce,
    startTelegram,
    load,
  }
}
