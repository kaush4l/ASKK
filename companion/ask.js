// ASKK headless: send one query to an agent, print the answer, exit. For
// scripts and cron jobs.
//
//   bun run ask -- "Summarize what changed in docs/ this week"
//   echo "query" | askk ask --root ~/code/app --yes --json
//
// When a local server (dev, `askk`) runs this workspace's team, the query
// goes to that team instead (findTeamServer): the one team does the work and
// every open tab shows it live; approvals not given by --yes wait in the app.
// --local runs it here regardless.
//
// Otherwise the same agents, engines, skills and prompts as the app, run in this
// process: the host API answers in-process (no port is opened), so agents
// work on --root (default: the current folder) exactly as in local mode.
// Agents run concurrently on one thread here (not one Web Worker each); the
// inbox, quests and reports work the same. Memory, history and artifacts are
// the workspace's runtime files (team.js teamStorageDir, the same the server
// uses), so research carries from run to run. With --local while a server
// runs the team, memory is this run's only (one writer per runtime).
//
// Changes to files need approval: declined unless --yes (or --read-only).
// The answer goes to stdout; progress to stderr (--quiet hides it).
// Exit codes: 0 answered, 1 failed, 2 usage, 124 timed out.

import { readFile, realpath } from "node:fs/promises"
import { resolve } from "node:path"
import { parseArgs } from "node:util"

import { agentDirsFrom, createHostApi, modelsFromEnv, rootFrom } from "./host-api.js"
import { SHIM_PORT as PORT, installBrowserShims, publicFile } from "./shims.js"
import { findTeamServer, teamMemoryDir, teamStorageDir } from "./team.js"

const USAGE = `Usage: askk ask [options] [query]      (query from stdin when omitted)

  --agent <name>     agent to ask (default: the first agent of the first --agents
                     folder, else the lead)
  --agents <dir>     a custom team folder (custom/<team>/: agents/ with index.json,
                     soul.md, <name>/agent.md, optional skills/ and mcp.json; data/
                     the workspace); repeatable; default ASKK_AGENTS.
                     Only these agents load, unless --with-public
  --with-public      with --agents: also load the public agents (lead, searcher, humaniser)
  --root <dir>       workspace folder (default: the team's data/, else the current folder)
  --read-only        agents may read the workspace, never change it
  --yes              approve every change the agents ask for (default: decline)
  --model <key>      model connection to use (default: the one from .env)
  --models <file>    extra model connections, in the models.json format
                     (default model: ASKK_MODEL_* in .env, see .env.example)
  --timeout <sec>    stop after this many seconds (default: 1800)
  --json             print { ok, agent, answer, error, seconds } instead of the answer
  --quiet            no progress on stderr
  --local            run the team in this process even when a server runs it
  -h, --help`

function fail(message, code = 2) {
  process.stderr.write(`askk ask: ${message}\n`)
  process.exit(code)
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
  const backup = entry.fallback && entry.fallback !== chosen ? models[entry.fallback] : null
  return {
    key: chosen,
    ...entry,
    api_key: entry.api_key ?? process.env.ASKK_API_KEY ?? undefined,
    ...(backup ? { backup: { key: entry.fallback, ...backup } } : {}),
  }
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
        local: { type: "boolean", default: false },
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
    const running = findTeamServer(await realpath(opts.root))
    if (running && !(opts.local || opts.model || opts.models)) return await askTeam({ server: running, query, opts, seconds, log })
    opts.storageDir = running ? null : teamStorageDir(await realpath(opts.root))
    opts.filesDir = running ? null : teamMemoryDir(await realpath(opts.root))
    api = await createHostApi({ root: opts.root, readOnly: opts["read-only"], port: PORT, agentDirs, withPublic: opts["with-public"] })
  } catch (error) {
    fail(error.message)
  }
  installBrowserShims({ api, embedded, storageDir: opts.storageDir, filesDir: opts.filesDir })
  const model = await loadModel({ embedded, key: opts.model, extra: opts.models })

  // App code, after the shims (it reads location and fetch when it runs).
  const { loadAgents } = await import("@/backend/agents/definitions")
  const { createEngine } = await import("@/backend/engines")
  const { describeActivity } = await import("@/backend/core/activity")
  const { createSupervisor } = await import("@/backend/runtime/supervisor")
  const { createSpawner, spawnDirectory } = await import("@/backend/runtime/spawner")

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
    ...spawnDirectory(spawnHost, () => self), // sub-agents (the team artifact)
  })

  // Sub-agents created during the run (runtime/spawner.js), as in the app.
  const startEngine = (agent) => {
    const engine = createEngine({ agent, id: agent.name, getModel: () => model })
    engine.directory = directory(engine)
    engine.configure(agent) // agent tools read their descriptions from the directory
    watch(engine)
    engines.push(engine)
    return engine
  }
  const spawner = createSpawner({
    agents: () => agents,
    engines: () => engines,
    add: (agent, { restore = false } = {}) => {
      agents.push(agent)
      const engine = startEngine(agent)
      if (restore && opts.storageDir) engine.restore()
      log(`+ ${agent.spawned.by} created ${agent.name} (${agent.spawned.keep ? "kept" : "task agent"}; tools: ${agent.tools.join(", ") || "none"})`)
      return engine
    },
    remove: (engine) => {
      engine.dispose()
      engines.splice(engines.indexOf(engine), 1)
      agents.splice(agents.findIndex((a) => a.name === engine.agent.name), 1)
      log(`- ${engine.name} ended`)
    },
    replace: (agent) => {
      agents.splice(agents.findIndex((a) => a.name === agent.name), 1, agent)
      engines.find((e) => e.agent.name === agent.name)?.reconfigure(agent)
      log(`~ ${agent.name} ${agent.spawned.keep ? "kept" : "a task agent again"}`)
    },
  })
  const spawnHost = {
    spawn: (caller, spec) => spawner.spawn(caller, spec),
    kill: (caller, name, reason) => spawner.kill(caller, name, reason),
    keep: (caller, name, keep) => spawner.keep(caller, name, keep),
    roster: (caller) => spawner.roster(caller),
  }

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

  // Kept sub-agents (saved by an earlier run or the server) join the team.
  if (opts.storageDir) agents.push(...spawner.saved())
  for (const agent of [...agents]) {
    const engine = startEngine(agent)
    if (agent.spawned) spawner.adopt(engine)
  }

  // Each agent's saved memory from earlier runs (runtime files).
  if (opts.storageDir) await Promise.all(engines.map((engine) => engine.restore()))
  log(`askk: memory ${opts.storageDir ? `kept in ${opts.storageDir}` : "for this run only (a server runs this team)"}`)

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

// ── the query on the running server's team ─────────────────────────────────

async function askTeam({ server, query, opts, seconds, log }) {
  const { describeActivity } = await import("@/backend/core/activity")
  const origin = `http://localhost:${server.port}`
  const headers = { origin, "content-type": "application/json", ...(server.desk ? { "x-askk-desk": server.desk } : {}) }
  // The server waits as long as this run may (--timeout), not its 30-minute default.
  const call = async (target, method, args = [], timeout = seconds * 1000) => {
    // `timeout: false`: Bun's fetch gives up after 5 minutes; an ask lasts the whole run.
    const response = await fetch(`${origin}/__askk/team/call`, { method: "POST", headers, body: JSON.stringify({ target, method, args, timeout }), timeout: false })
    const result = await response.json().catch(() => ({ ok: false, error: { message: `HTTP ${response.status}` } }))
    if (!result.ok) throw new Error(result.error?.message ?? "team call failed")
    return result.value
  }

  // The team's live state (as the tabs see it): progress lines, approvals.
  const stream = new AbortController()
  const response = await fetch(`${origin}/__askk/team/stream`, { headers: { origin, ...(server.desk ? { "x-askk-desk": server.desk } : {}) }, signal: stream.signal, timeout: false })
  if (!response.ok) fail(`the server on port ${server.port} has no team (HTTP ${response.status}); use --local.`, 1)
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  const states = {}
  let registry = null
  const last = {}
  const answered = new Set()
  const onState = (id) => {
    const engine = registry?.engines.find((e) => e.id === id)
    const { activity, approvals = [] } = states[id] ?? {}
    const line = !activity || activity.phase === "idle" ? "" : `${engine?.name ?? id}: ${describeActivity(activity)}`
    if (line && line !== last[id]) log(line)
    last[id] = line
    for (const approval of approvals) {
      if (answered.has(approval.id)) continue
      answered.add(approval.id)
      const what = `${approval.tool} ${JSON.stringify(approval.inputs).slice(0, 160)}`
      if (opts.yes) {
        log(`${engine?.name ?? id}: approved ${what}`)
        call(id, "resolveApproval", [approval.id, true]).catch(() => {})
      } else log(`${engine?.name ?? id}: waiting for the owner's approval in the app: ${what}`)
    }
  }
  let ready
  const snapshot = new Promise((resolve) => (ready = resolve))
  ;(async () => {
    let buffer = ""
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ done: true }))
      if (done) break
      buffer += value
      let end
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        const data = block.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n")
        if (!data) continue
        const event = JSON.parse(data)
        if (event.type === "snapshot") {
          registry = event.registry
          Object.assign(states, event.states)
          ready()
        } else if (event.type === "registry") registry = event.registry
        else if (event.type === "state") {
          const { messages, ...rest } = event.patch
          states[event.id] = { ...(states[event.id] ?? {}), ...rest }
          onState(event.id)
        }
      }
    }
  })()
  await snapshot
  if (registry.status !== "ready") fail(`the server's team is ${registry.status}${registry.error ? `: ${registry.error}` : ""}.`, 1)
  const engine = opts.agent
    ? registry.engines.find((e) => e.agent?.name === opts.agent || e.name === opts.agent)
    : registry.engines.find((e) => e.id === registry.requiredId) ?? registry.engines[0]
  if (!engine) fail(`no agent "${opts.agent}" on the server. Known: ${registry.engines.map((e) => e.name).join(", ")}.`)

  log(`askk: asking ${engine.name} on the running team (http://localhost:${server.port}/, pid ${server.pid}) · shown live in the app`)
  const started = Date.now()
  const finish = ({ ok, answer = null, error = null }, code) => {
    const elapsed = Math.round((Date.now() - started) / 100) / 10
    if (opts.json) process.stdout.write(`${JSON.stringify({ ok, agent: engine.name, answer, error, seconds: elapsed })}\n`)
    else if (ok) process.stdout.write(`${answer}\n`)
    if (!ok) process.stderr.write(`askk: ${error}\n`)
    stream.abort()
    process.exit(code)
  }
  const timer = setTimeout(() => {
    call(engine.id, "stop").catch(() => {})
    finish({ ok: false, error: `timed out after ${seconds}s` }, 124)
  }, seconds * 1000)
  try {
    const answer = await call(engine.id, "ask", [query])
    clearTimeout(timer)
    finish({ ok: true, answer }, 0)
  } catch (error) {
    clearTimeout(timer)
    finish({ ok: false, error: error.message }, 1)
  }
}

if (import.meta.main) await main(Bun.argv.slice(2))
