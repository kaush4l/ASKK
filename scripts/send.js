// Hand work to a desk at the right time, whether its server runs or not: the input for cron, scripts and any other
// source. The server is the desk's home.
//
//   bun run send -- --agents custom/<desk> [--agent <name>] [--from <source>] "text"
//   bun run send -- --agents custom/<desk> --start --unless-booked 90 "Start the day."
//   bun run send -- --agents custom/<desk> --wait [--timeout 1800] "What is the book now?"   (answer on stdout)
//
// 1. Server running (server.json in the desk's state folder, its pid alive): POST team/send — the agent (default:
//    the lead) runs the text after what it is doing now; every tab shows it live. With --wait: POST team/call ask
//    instead, and the answer is printed when the run ends (the old `askk ask`).
// 2. --start and no server: start it, wait until it answers (--start-wait seconds, default 300), then send as in 1.
//    The desks' process starts as launchd's askk.desks when it is installed (kickstart / bootstrap), else
//    `bun run dev -- --desks <its folder> --desk <it> --port <--port|1111>` detached, logging to
//    <folder>/server.log. One starter at a time (a lock).
// 3. Still no server: the text is booked as a wake due now in the desk's wake book (data/state/wakes.jsonl), and
//    the server runs it when it comes up (kernel-team's wake runner; later than 60 min it is marked missed).
// --unless-booked <minutes>: send nothing when the desk already booked a wake within that many minutes of now (a
// desk that books its own day); with --start the server is still started, so that wake runs.
// Exit: 0 sent (or skipped; with --wait: answered), 1 refused or failed, 2 usage, 3 no server (booked as a wake),
// 124 --wait timed out.
// Over HTTP from anything else (Origin must be the server's own):
//   curl -s -X POST http://localhost:<port>/__askk/team/send -H 'origin: http://localhost:<port>' \
//     -H 'content-type: application/json' -d '{"text": "Run the close.", "from": "cron"}'

import { closeSync, mkdirSync, openSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { parseArgs } from "node:util"

import { findDeskServer, loadDesk } from "../companion/team/desk.js"
import { DESK_OPTIONS, deskDirFrom } from "../companion/shared/args.js"
import { appendJsonl } from "../companion/shared/jsonl.js"
import { logLine as log, stamp } from "../companion/shared/time.js"
import { openWakes, wakesPath } from "../companion/shared/wakes.js"
import { API_PREFIX, DESKS_PORT, DESK_HEADER } from "../companion/shared/config.js"

const { values: args, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    ...DESK_OPTIONS,
    agent: { type: "string" },
    from: { type: "string", default: "send" },
    "unless-booked": { type: "string" },
    start: { type: "boolean", default: false },
    "start-wait": { type: "string", default: "300" },
    wait: { type: "boolean", default: false },
    timeout: { type: "string", default: "1800" },
    port: { type: "string" },
  },
})
const text = (positionals.join(" ").trim() || (!process.stdin.isTTY ? (await Bun.stdin.text()).trim() : ""))
const deskDir = deskDirFrom(args.agents)
const desk = deskDir ? await loadDesk(deskDir).catch((error) => (log(error.message), null)) : null
if (!text || !desk) {
  console.error('Usage: bun run send -- --agents custom/<desk> [--agent <name>] [--from <source>] [--start] [--unless-booked <min>] [--wait] "text"')
  process.exit(2)
}
const root = desk.workspace

const window = Number(args["unless-booked"])
const booked = await (async () => {
  const book = Bun.file(wakesPath(root))
  if (!(window > 0) || !(await book.exists())) return null
  const now = Date.now()
  return openWakes(await book.text()).find((w) => Math.abs(Date.parse(w.at) - now) <= window * 60000) ?? null
})()

let server = findDeskServer(desk)
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
const headers = { origin, "content-type": "application/json", ...(server.desk ? { [DESK_HEADER]: server.desk } : {}) }
const failed = (error) => ({ ok: false, status: 0, json: async () => ({ ok: false, error: { message: error.message, name: error.name } }) })

if (args.wait) {
  // The run's answer: POST team/call ask, held open until the agent answers (or --timeout).
  const seconds = Number(args.timeout) || 1800
  const response = await fetch(`${origin}${API_PREFIX}team/call`, {
    method: "POST",
    headers,
    body: JSON.stringify({ target: args.agent ?? null, method: "ask", args: [text, { from: args.from }] }),
    signal: AbortSignal.timeout(seconds * 1000),
  }).catch(failed)
  const result = await response.json().catch((error) => ({ ok: false, error: { message: error.message, name: error.name } }))
  if (result.error?.name === "TimeoutError") {
    log(`timed out after ${seconds} s (the run goes on on the server)`)
    process.exit(124)
  }
  if (!result.ok) {
    log(`failed: ${result.error?.message ?? "unknown error"}`)
    process.exit(1)
  }
  console.log(typeof result.value === "string" ? result.value : JSON.stringify(result.value, null, 2))
  process.exit(0)
}

const response = await fetch(`${origin}${API_PREFIX}team/send`, {
  method: "POST",
  headers,
  body: JSON.stringify({ text, agent: args.agent ?? null, from: args.from }),
}).catch(failed)
const result = await response.json().catch(() => ({ ok: false, error: { message: `HTTP ${response.status}` } }))
if (!result.ok) {
  log(`refused: ${result.error?.message ?? result.error ?? "unknown error"}`)
  process.exit(1)
}
log(`sent to ${result.value.agent}${server.desk ? ` of ${server.desk}` : ""} (${origin}): ${text.slice(0, 120)}`)

// Start the desk's server and wait for it to answer; null when it does not.
async function start() {
  const desks = dirname(desk.folder)
  const lockPath = join(desks, ".start.lock")
  const lockFile = Bun.file(lockPath)
  let lock = null
  try {
    if ((await lockFile.exists()) && Date.now() - lockFile.lastModified > 10 * 60000) await lockFile.delete() // a starter that died
    lock = openSync(lockPath, "wx")
  } catch {
    log("another sender is starting the server; waiting for it")
  }
  try {
    if (lock !== null && !findDeskServer(desk)) await launch(desks)
    const until = Date.now() + Number(args["start-wait"]) * 1000
    while (Date.now() < until) {
      const found = findDeskServer(desk)
      if (found && (await answers(found))) {
        log(`server up for ${desk.name} on :${found.port} (pid ${found.pid})`)
        return found
      }
      await Bun.sleep(2000)
    }
    log(`server for ${desk.name} did not come up within ${args["start-wait"]} s`)
    return null
  } finally {
    if (lock !== null) {
      closeSync(lock)
      await lockFile.delete().catch(() => {})
    }
  }
}

// launchd's askk.desks when installed (it keeps the server running), else one detached `bun run dev` of every
// desk in the folder.
async function launch(desks) {
  const uid = process.getuid()
  const label = "askk.desks"
  const plist = join(homedir(), "Library/LaunchAgents", `${label}.plist`)
  const launchctl = (...argv) => Bun.spawnSync(["/bin/launchctl", ...argv], { stdout: "pipe", stderr: "pipe" })
  const plistFile = Bun.file(plist)
  if (process.platform === "darwin" && (await plistFile.exists()) && servesDesks(await plistFile.text(), desks)) {
    const loaded = launchctl("print", `gui/${uid}/${label}`).exitCode === 0
    const done = loaded ? launchctl("kickstart", `gui/${uid}/${label}`) : launchctl("bootstrap", `gui/${uid}`, plist)
    if (done.exitCode === 0) return log(`started ${label} (launchd ${loaded ? "kickstart" : "bootstrap"})`)
    log(`launchd ${label}: ${done.stderr.toString().trim() || `exit ${done.exitCode}`}; starting it directly`)
  }
  const port = String(args.port ?? DESKS_PORT)
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
    const r = await fetch(`http://localhost:${found.port}${API_PREFIX}whoami`, { headers: found.desk ? { [DESK_HEADER]: found.desk } : {}, signal: AbortSignal.timeout(5000) })
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
  appendJsonl(path, row)
  log(`no server for ${desk.name}; booked as wake ${row.id} (runs when the server starts within 60 min): ${text.slice(0, 120)}`)
}
