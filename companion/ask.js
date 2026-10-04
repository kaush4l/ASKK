// ASKK headless: send one query to an agent, print the answer, exit. For
// scripts and cron jobs.
//
//   bun run ask -- "Summarize what changed in docs/ this week"
//   echo "query" | askk ask --root ~/code/app --yes --json
//
// The same agents, engines, skills and prompts as the app, run in this
// process: the host API answers in-process (no port is opened), so agents
// work on --root (default: the current folder) exactly as in local mode.
// Agents run concurrently on one thread here (not one Web Worker each); the
// inbox, quests and reports work the same. Memory lives for this run only:
// every job starts fresh.
//
// Changes to files need approval: declined unless --yes (or --read-only).
// The answer goes to stdout; progress to stderr (--quiet hides it).
// Exit codes: 0 answered, 1 failed, 2 usage, 124 timed out.

import { readFile } from "node:fs/promises"
import { resolve, sep } from "node:path"
import { parseArgs } from "node:util"

import { agentDirsFrom, createHostApi, modelsFromEnv, rootFrom } from "./host-api.js"

const USAGE = `Usage: askk ask [options] [query]      (query from stdin when omitted)

  --agent <name>     agent to ask (default: the first agent of the first --agents
                     folder, else the lead)
  --agents <dir>     a custom team folder (custom/<team>/: agents/ with index.json,
                     soul.md, <name>/agent.md, optional skills/ and mcp.json; data/
                     the workspace); repeatable; default ASKK_AGENTS.
                     Only these agents load, unless --with-public
  --with-public      with --agents: also load the public agents (lead, planner, critic)
  --root <dir>       workspace folder (default: the team's data/, else the current folder)
  --read-only        agents may read the workspace, never change it
  --yes              approve every change the agents ask for (default: decline)
  --model <key>      model connection to use (default: the one from .env)
  --models <file>    extra model connections, in the models.json format
                     (default model: ASKK_MODEL_* in .env, see .env.example)
  --timeout <sec>    stop after this many seconds (default: 1800)
  --json             print { ok, agent, answer, error, seconds } instead of the answer
  --quiet            no progress on stderr
  -h, --help`

const PORT = 7717
const ORIGIN = `http://localhost:${PORT}` // virtual: never listened on

function fail(message, code = 2) {
  process.stderr.write(`askk ask: ${message}\n`)
  process.exit(code)
}

// The app's public files: embedded in the compiled binary, else public/.
async function publicFile(embedded, pathname) {
  if (embedded) return embedded[pathname] ? Bun.file(embedded[pathname]) : null
  const base = resolve(import.meta.dir, "../public")
  const file = resolve(base, `.${pathname}`)
  if (!file.startsWith(base + sep)) return null
  const blob = Bun.file(file)
  return (await blob.exists()) ? blob : null
}

// Browser globals the app code expects: a page location, same-origin fetch
// (host API and public files answered in-process), localStorage (this run).
function installBrowserShims({ api, embedded }) {
  globalThis.location = new URL(`${ORIGIN}/`)
  const store = new Map()
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  }
  const realFetch = globalThis.fetch
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input), globalThis.location)
    if (url.origin !== ORIGIN) return realFetch(input instanceof Request ? input : url, init)
    if (url.pathname.startsWith("/__askk/")) {
      const headers = new Headers(init.headers)
      headers.set("host", url.host)
      headers.set("origin", ORIGIN) // same origin, as the page would send
      return api.handle(new Request(url, { ...init, headers }))
    }
    const file = await publicFile(embedded, url.pathname)
    return file ? new Response(file) : new Response("Not found", { status: 404 })
  }
}

async function loadModel({ embedded, key, extra }) {
  const shippedFile = await publicFile(embedded, "/models.json")
  const shipped = shippedFile ? JSON.parse(await shippedFile.text()) : {}
  const env = modelsFromEnv()
  const added = extra ? JSON.parse(await readFile(extra, "utf8")) : {}
  const models = { ...shipped.models, ...env.models, ...added.models }
  const chosen = key ?? added.default ?? env.default ?? shipped.default
  const entry = models[chosen]
  if (!chosen) fail("no model. Set ASKK_MODEL_BASE_URL and ASKK_MODEL_ID in .env (see .env.example), or pass --models <file>.")
  if (!entry) fail(`no model "${chosen}". Known: ${Object.keys(models).join(", ") || "none"}.`)
  return { key: chosen, ...entry, api_key: entry.api_key ?? process.env.ASKK_API_KEY ?? undefined }
}

async function readStdin() {
  if (process.stdin.isTTY) return ""
  let text = ""
  for await (const chunk of process.stdin) text += chunk
  return text
}

export async function main(argv, { embedded = null } = {}) {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        agent: { type: "string" },
        agents: { type: "string", multiple: true, default: [] },
        "with-public": { type: "boolean", default: false },
        root: { type: "string" },
        "read-only": { type: "boolean", default: false },
        yes: { type: "boolean", default: false },
        model: { type: "string" },
        models: { type: "string" },
        timeout: { type: "string", default: "1800" },
        json: { type: "boolean", default: false },
        quiet: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    })
  } catch (error) {
    fail(`${error.message}\n\n${USAGE}`)
  }
  const { values: opts, positionals } = parsed
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`)
    process.exit(0)
  }
  const query = (positionals.join(" ") || (await readStdin())).trim()
  if (!query) fail(`no query.\n\n${USAGE}`)
  const seconds = Number(opts.timeout)
  if (!(seconds > 0)) fail("--timeout must be a number of seconds.")

  const log = opts.quiet ? () => {} : (line) => process.stderr.write(`${line}\n`)
  let api
  try {
    const agentDirs = agentDirsFrom(opts.agents)
    opts.root = await rootFrom(opts.root, agentDirs)
    api = await createHostApi({ root: opts.root, readOnly: opts["read-only"], port: PORT, agentDirs, withPublic: opts["with-public"] })
  } catch (error) {
    fail(error.message)
  }
  installBrowserShims({ api, embedded })
  const model = await loadModel({ embedded, key: opts.model, extra: opts.models })

  // App code, after the shims (it reads location and fetch when it runs).
  const { loadAgents } = await import("@/backend/agents/definitions")
  const { createEngine } = await import("@/backend/engines")
  const { describeActivity } = await import("@/backend/core/activity")
  const { createSupervisor } = await import("@/backend/runtime/supervisor")

  const agents = await loadAgents()
  const chosen = opts.agent ? agents.find((a) => a.name === opts.agent) : agents[0]
  if (!chosen) fail(`no agent "${opts.agent}". Known: ${agents.map((a) => a.name).join(", ")}.`)

  // One engine per agent. Letters between inboxes are delivered async, as
  // across threads in the app.
  const engines = []
  const directory = (self) => ({
    describe: (name) => agents.find((a) => a.name === name)?.description,
    send: async (to, letter) => {
      const target = to.id
        ? engines.find((e) => e.id === to.id)
        : engines.find((e) => e.agent.name === to.name && e !== self)
      if (!target) throw new Error(`Agent ${to.name ?? to.id} is not running.`)
      if (letter.kind === "quest") log(`→ ${self.name} hands ${target.name} a quest`)
      if (letter.kind === "report") log(`← ${self.name} reports to ${target.name}${letter.ok ? "" : " (failed)"}`)
      setTimeout(() => target.deposit(letter).catch(() => {}), 0)
      return target.id
    },
  })

  // Progress on stderr, and the approval policy.
  function watch(engine) {
    let last = ""
    const answered = new Set()
    engine.subscribe(() => {
      const { activity, approvals } = engine.getSnapshot()
      const line = activity.phase === "idle" ? "" : `${engine.name}: ${describeActivity(activity)}`
      if (line && line !== last) log(line)
      last = line
      for (const approval of approvals) {
        if (answered.has(approval.id)) continue
        answered.add(approval.id)
        const call = `${approval.tool} ${JSON.stringify(approval.inputs).slice(0, 160)}`
        log(`${engine.name}: ${opts.yes ? "approved" : "declined (--yes allows changes)"} ${call}`)
        // After this update: the engine starts waiting once it has published the approval.
        queueMicrotask(() => engine.resolveApproval(approval.id, opts.yes))
      }
    })
  }

  for (const agent of agents) {
    const engine = createEngine({ agent, id: agent.name, getModel: () => model })
    engine.directory = directory(engine)
    engine.configure(agent) // agent tools read their descriptions from the directory
    watch(engine)
    engines.push(engine)
  }

  // Status checks on long-running quests, as in the app.
  createSupervisor({
    engines: () => engines,
    deliver: (id, letter) => {
      const owner = engines.find((e) => e.id === id)
      log(`… status of ${letter.from} (${letter.steps} steps) → ${owner?.name}`)
      owner?.deposit(letter).catch(() => {})
    },
  })

  const started = Date.now()
  log(
    `askk: asking ${chosen.name} · model ${model.key} · workspace ${resolve(opts.root)}` +
      `${opts["read-only"] ? " (read-only)" : opts.yes ? " (changes approved)" : " (changes declined)"}`
  )

  const timer = setTimeout(() => {
    for (const engine of engines) engine.stop()
    finish({ ok: false, error: `timed out after ${seconds}s` }, 124)
  }, seconds * 1000)

  function finish({ ok, answer = null, error = null }, code) {
    clearTimeout(timer)
    const elapsed = Math.round((Date.now() - started) / 100) / 10
    if (opts.json) process.stdout.write(`${JSON.stringify({ ok, agent: chosen.name, answer, error, seconds: elapsed })}\n`)
    else if (ok) process.stdout.write(`${answer}\n`)
    if (!ok) process.stderr.write(`askk: ${error}\n`) // even with --quiet
    process.exit(code)
  }

  try {
    const answer = await engines.find((e) => e.agent.name === chosen.name).ask(query)
    finish({ ok: true, answer }, 0)
  } catch (error) {
    finish({ ok: false, error: error.message }, 1)
  }
}

if (import.meta.main) await main(Bun.argv.slice(2))
