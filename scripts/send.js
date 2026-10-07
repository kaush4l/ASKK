// Hand work to a team at the right time, whether its server runs or not: the
// input for cron, scripts and any other source. The server is the team's home.
//
//   bun scripts/send.js --agents custom/<team> [--agent <name>] [--from <source>] "text"
//   bun scripts/send.js --agents custom/<desk> --start --unless-booked 90 "Run the morning."
//
// 1. Server running (server.json in the team's state folder, its pid alive):
//    POST team/send — the text lands in the agent's inbox (default: the lead),
//    worked after what it is doing now; the answer shows in every tab. A desk
//    hosted with others (--desks) is reached by its name (x-askk-desk).
// 2. --start and no server: start it, wait until it answers (--wait seconds,
//    default 300), then send as in 1. A desk starts the one process of every
//    desk: launchd's askk.desks when it is installed (kickstart / bootstrap),
//    else `bun run dev -- --desks <its folder> --desk <it> --port <--port|1111>`
//    detached, logging to <folder>/server.log. One starter at a time (a lock).
// 3. Still no server: the text is booked as a wake due now in the team's
//    state/wakes.jsonl, so the server runs it when it comes up (within the
//    wake book's 60 minutes; later it is marked missed, not replayed).
// --unless-booked <minutes>: send nothing when the team already booked a wake
// within that many minutes of now (a team that books its own day); with
// --start the server is still started, so that wake runs.
// Exit: 0 sent (or skipped), 1 refused, 3 no server (the text was booked as a wake).
// Over HTTP from anything else (Origin must be the server's own):
//   curl -s -X POST http://localhost:<port>/__askk/team/send -H 'origin: http://localhost:<port>' \
//     -H 'content-type: application/json' -d '{"text": "Run the close.", "from": "cron"}'

import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { parseArgs } from "node:util"

import { deskOfRoot, loadDesk } from "../companion/desk.js"
import { agentDirsFrom, rootFrom } from "../companion/host-api.js"
import { findTeamServer } from "../companion/team.js"
import { openWakes, wakesPath } from "../companion/wakes.js"

const stamp = () => new Date().toISOString()
const log = (line) => console.log(`${stamp()} ${line}`)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const { values: args, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    agents: { type: "string", multiple: true, default: [] },
    root: { type: "string" },
    agent: { type: "string" },
    from: { type: "string", default: "send" },
    "unless-booked": { type: "string" },
    start: { type: "boolean", default: false },
    wait: { type: "string", default: "300" },
    port: { type: "string" },
  },
})
const text = positionals.join(" ").trim()
if (!text) {
  console.error('Usage: bun scripts/send.js --agents custom/<team> [--agent <name>] [--from <source>] [--start] [--unless-booked <min>] "text"')
  process.exit(1)
}

const root = await rootFrom(args.root, agentDirsFrom(args.agents))
const deskDir = deskOfRoot(root)
const desk = deskDir ? await loadDesk(deskDir) : null

const window = Number(args["unless-booked"])
const booked = (() => {
  if (!(window > 0) || !existsSync(wakesPath(root))) return null
  const now = Date.now()
  return openWakes(readFileSync(wakesPath(root), "utf8")).find((w) => Math.abs(Date.parse(w.at) - now) <= window * 60000) ?? null
})()

let server = findTeamServer(root)
if (!server && args.start) server = await start()

if (booked) {
  log(`skipped: wake ${booked.id} at ${booked.at} is booked (${booked.reason})${server ? "" : "; no server is up to run it"}`)
  process.exit(0)
}
if (!server) {
  queue()
  process.exit(3)
}

const origin = `http://localhost:${server.port}`
const response = await fetch(`${origin}/__askk/team/send`, {
  method: "POST",
  headers: { origin, "content-type": "application/json", ...(server.desk ? { "x-askk-desk": server.desk } : {}) },
  body: JSON.stringify({ text, agent: args.agent ?? null, from: args.from }),
}).catch((error) => ({ ok: false, status: 0, json: async () => ({ ok: false, error: { message: error.message } }) }))
const result = await response.json().catch(() => ({ ok: false, error: { message: `HTTP ${response.status}` } }))
if (!result.ok) {
  log(`refused: ${result.error?.message ?? result.error ?? "unknown error"}`)
  process.exit(1)
}
log(`sent to ${result.value.agent}${server.desk ? ` of ${server.desk}` : ""} (${origin}): ${text.slice(0, 120)}`)

// Start the team's server and wait for it to answer; null when it does not.
async function start() {
  if (!desk) {
    log(`no team server for ${root}, and only a desk (custom/<desk>/desk.js) can be started from here`)
    return null
  }
  const desks = dirname(desk.folder)
  const lockPath = join(desks, ".start.lock")
  let lock = null
  try {
    if (existsSync(lockPath) && Date.now() - statSync(lockPath).mtimeMs > 10 * 60000) unlinkSync(lockPath) // a starter that died
    lock = openSync(lockPath, "wx")
  } catch {
    log("another sender is starting the server; waiting for it")
  }
  try {
    if (lock !== null && !findTeamServer(root)) launch(desks)
    const until = Date.now() + Number(args.wait) * 1000
    while (Date.now() < until) {
      const found = findTeamServer(root)
      if (found && (await answers(found))) {
        log(`server up for ${desk.name} on :${found.port} (pid ${found.pid})`)
        return found
      }
      await sleep(2000)
    }
    log(`server for ${desk.name} did not come up within ${args.wait} s`)
    return null
  } finally {
    if (lock !== null) {
      closeSync(lock)
      try {
        unlinkSync(lockPath)
      } catch {}
    }
  }
}

// launchd's askk.desks when installed (it keeps the server running), else one
// detached `bun run dev` of every desk in the folder.
function launch(desks) {
  const uid = process.getuid()
  const label = "askk.desks"
  const plist = join(homedir(), "Library/LaunchAgents", `${label}.plist`)
  const launchctl = (...argv) => Bun.spawnSync(["/bin/launchctl", ...argv], { stdout: "pipe", stderr: "pipe" })
  if (process.platform === "darwin" && existsSync(plist) && servesDesks(readFileSync(plist, "utf8"), desks)) {
    const loaded = launchctl("print", `gui/${uid}/${label}`).exitCode === 0
    const done = loaded ? launchctl("kickstart", `gui/${uid}/${label}`) : launchctl("bootstrap", `gui/${uid}`, plist)
    if (done.exitCode === 0) return log(`started ${label} (launchd ${loaded ? "kickstart" : "bootstrap"})`)
    log(`launchd ${label}: ${done.stderr.toString().trim() || `exit ${done.exitCode}`}; starting it directly`)
  }
  const port = String(args.port ?? process.env.ASKK_DESKS_PORT ?? 1111)
  const out = join(desks, "server.log")
  mkdirSync(desks, { recursive: true })
  const fd = openSync(out, "a")
  const proc = Bun.spawn(["bun", "run", "dev", "--", "--desks", desks, "--desk", desk.name, "--port", port], {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, ASKK_SERVER_LOG: out },
    stdin: "ignore",
    stdout: fd,
    stderr: fd,
    detached: true,
  })
  proc.unref()
  log(`started bun run dev --desks ${basename(desks)} on :${port} (pid ${proc.pid}), log ${out}`)
}

// The plist runs `--desks <dir>` (from its WorkingDirectory) for this folder of desks.
function servesDesks(xml, desks) {
  const dir = /--desks<\/string>\s*<string>([^<]+)</.exec(xml)?.[1]
  const cwd = /<key>WorkingDirectory<\/key>\s*<string>([^<]+)</.exec(xml)?.[1] ?? "/"
  return Boolean(dir) && resolve(cwd, dir) === resolve(desks)
}

// The server listens (server.json is written on listen, but a pid can outlive its port).
async function answers(found) {
  try {
    const r = await fetch(`http://localhost:${found.port}/__askk/whoami`, { headers: found.desk ? { "x-askk-desk": found.desk } : {}, signal: AbortSignal.timeout(5000) })
    return r.ok
  } catch {
    return false
  }
}

// No server: book the text as a wake due now, so the server runs it when it starts.
function queue() {
  const path = wakesPath(root)
  const now = stamp()
  const row = { id: `send-${Date.now().toString(36)}`, at: now, booked_at: now, wait_minutes: 0, reason: `${args.from} (no server was running)`, message: text, ...(args.agent ? { agent: args.agent } : {}), by: args.from }
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${JSON.stringify(row)}\n`)
  log(`no team server for ${root}; booked as wake ${row.id} (runs when the server starts within 60 min): ${text.slice(0, 120)}`)
}
