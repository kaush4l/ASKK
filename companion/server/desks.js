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
import { findDeskServer, forgetDesk, loadDesk } from "../team/desk.js"
import { createKernelTeam } from "../team/kernel-team.js"
import { runReport, startKernelTelegram } from "../team/kernel-telegram.js"
import { ownerIdFrom } from "../shared/telegram-owner.js"
import { DESK_COOKIE, DESK_HEADER } from "../shared/config.js"
import { httpError } from "../shared/http.js"

export async function hostDesks({ folders, port, defaultDesk = null, readOnly = false, root = null, log = (line) => console.error(line) }) {
  const deskRoot = resolve(root ?? dirname(resolve(folders[0])))
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
    const asked = join(deskRoot, name)
    const real = realOf(asked)
    if (!real) throw httpError(404, `No desk "${name}": ${asked} does not exist.`)
    const folder = join(realOf(deskRoot), name)
    if (real !== folder) throw httpError(403, `Desk "${name}" is a link (${asked} → ${real}); a desk is a real folder in ${deskRoot}.`)
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
    return Response.json({ error: "Not found." }, { status: 404 })
  }

  function handleApi(request) {
    const path = new URL(request.url).pathname.slice(API_PREFIX.length)
    if (path === "desks" || path === "desks/select" || path === "desks/load") return desksEndpoint(request, path)
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
