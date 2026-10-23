// The local models, once per process (several desks' host APIs share one models/ folder and one model server), and the
// routes the dashboard's model panel and every engine read (registry.js says what a model folder holds).
//
//   GET  models                     { root, kinds: {stt | tts | image: {selected, models: [twin], catalog}}, presets }
//   POST models/select {kind, name}             the model used for that kind from now on (models/models.md)
//   POST models/set {kind, name, values}        option values, written into its model.md (null: back to the default)
//   POST models/add {kind, name}                a catalogue entry copied into models/<kind>/<name>/model.md
//   POST models/install {kind, name}            runs its `install` line (uv or brew only, never a shell) → the log
//   POST models/start {kind, name}              starts its server now (engine openai with `serve`), else answers ready
// The POSTs are the owner's: a desk's own request (x-askk-desk: its tools, its scripts) is refused by host-api.

import { loadModels, twinOf, findProgram } from "./registry.js"
import { httpError } from "../shared/http.js"

let shared = null
export function sharedModels({ log = () => {} } = {}) {
  shared ??= loadModels({ log })
  return shared
}

// --- servers (engine openai with `serve`) --------------------------------------------------------------------------------

const servers = new Map() // "<bin> <args>" → { proc, ready: Promise, url }
// a model server never outlives the desk server: launchd's restart is a SIGTERM, which never runs "exit" listeners by
// itself (2026-10-23: one was left running, holding its port and its weights in memory)
// SIGKILL: uvicorn (mlx-audio's server) may hang in its graceful shutdown on a SIGTERM and keep the port
const stopServers = () => {
  for (const s of servers.values()) s.proc?.kill(9)
}
process.on("exit", stopServers)
for (const [signal, code] of [["SIGTERM", 143], ["SIGINT", 130]])
  process.on(signal, () => {
    stopServers()
    // the only listener: the signal's own exit, which a listener otherwise cancels
    if (process.listenerCount(signal) === 1) process.exit(code)
  })

const reachable = async (url) => {
  try {
    const r = await fetch(`${url.replace(/\/$/, "")}/models`, { signal: AbortSignal.timeout(1500) })
    return r.status < 500
  } catch {
    return false
  }
}

// The model's server answering, started when it does not and `serve` says how (once per program and arguments; it stays
// up for the life of the desk server). Waits up to `waitMs` for it. Ours and still running: used as it is — a server busy
// with another request may miss the 1.5 s probe and is never killed for it (audit 20); one that exited is started again.
export async function ensureServer(model, { log = () => {}, waitMs = 120_000 } = {}) {
  const url = model.meta.url
  if (await reachable(url)) return url
  const serve = model.meta.serve
  if (!serve?.bin) throw httpError(503, `${model.title}: nothing answers at ${url}`)
  const key = [serve.bin, ...(serve.args ?? [])].join(" ")
  let s = servers.get(key)
  // a process killed by a signal has exitCode null and signalCode set (Bun)
  const alive = (p) => p.exitCode === null && !p.signalCode
  if (s && alive(s.proc)) return s.answered ? url : s.ready
  if (s?.answered) log(`models: ${key} exited (${s.proc.exitCode ?? s.proc.signalCode}) — starting it again`)
  const bin = findProgram(serve.bin)
  if (!bin) throw httpError(501, `${serve.bin} is not installed — ${model.install ?? "see its model.md"}`)
  const proc = Bun.spawn([bin, ...(serve.args ?? []).map(String)], { stdout: "ignore", stderr: "pipe", env: { ...process.env, PYTHONWARNINGS: "ignore" } })
  let tail = ""
  ;(async () => {
    const decoder = new TextDecoder()
    for await (const chunk of proc.stderr) tail = (tail + decoder.decode(chunk)).slice(-1500)
  })().catch(() => {})
  log(`models: starting ${key} for ${model.kind}/${model.name}`)
  const ready = (async () => {
    const until = Date.now() + waitMs
    while (Date.now() < until) {
      if (!alive(proc)) throw httpError(502, `${serve.bin} exited ${proc.exitCode ?? proc.signalCode}: ${tail.replace(/\s+/g, " ").slice(-400)}`)
      if (await reachable(url)) return url
      await Bun.sleep(1000)
    }
    proc.kill(9) // never left running beside the next try (audit 20)
    throw httpError(504, `${serve.bin} did not answer at ${url} within ${Math.round(waitMs / 1000)} s`)
  })()
  s = { proc, ready, url }
  servers.set(key, s)
  ready.then(() => ((s.answered = true), log(`models: ${key} answers at ${url}`))).catch((e) => (servers.delete(key), log(`models: ${key} failed: ${e.message}`)))
  return s.ready
}

// --- the install line ------------------------------------------------------------------------------------------------------

// `uv tool install --python 3.13 "mlx-audio[stt]" --prerelease=allow` → argv, quotes respected; uv and brew only.
export function installArgv(line) {
  const argv = [...String(line ?? "").matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3])
  // installs only (audit 20: `uv run python -c …` passed): uv tool install, brew install
  const ok = (argv[0] === "uv" && argv[1] === "tool" && argv[2] === "install") || (argv[0] === "brew" && argv[1] === "install")
  if (!ok) throw httpError(400, `install: only "uv tool install" or "brew install" lines run from the panel (this one: ${argv.slice(0, 3).join(" ") || "none"}) — run it in a terminal`)
  // an argument list, never a shell: < > are version bounds here ("spacy>=3.8,<4"); ; & | ` $ are refused anyway
  if (argv.some((a) => /[;&|`$]/.test(a))) throw httpError(400, "install: a plain command line, no shell characters")
  return argv
}

const installing = new Map()
async function install(model, log) {
  if (!model.install) throw httpError(400, `${model.kind}/${model.name} has no install line`)
  const argv = installArgv(model.install)
  const bin = findProgram(argv[0])
  if (!bin) throw httpError(501, `${argv[0]} is not installed`)
  const key = model.install
  if (installing.has(key)) return { started: false, running: true }
  log(`models: installing for ${model.kind}/${model.name}: ${model.install}`)
  const proc = Bun.spawn([bin, ...argv.slice(1)], { stdout: "pipe", stderr: "pipe" })
  installing.set(key, proc)
  ;(async () => {
    const out = (await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])).join("\n")
    const code = await proc.exited
    installing.delete(key)
    log(`models: install ${code === 0 ? "done" : `failed (${code})`} for ${model.kind}/${model.name}${code === 0 ? "" : `: ${out.replace(/\s+/g, " ").slice(-300)}`}`)
  })()
  return { started: true }
}

// --- routes -------------------------------------------------------------------------------------------------------------------

export function modelRoutes(models, { log = () => {}, readOnly = false } = {}) {
  const twin = (m) => twinOf(m, { ...models.ready(m), installing: !!(m.install && installing.has(m.install)) })
  const view = () => ({
    root: models.root,
    kinds: Object.fromEntries(
      ["stt", "tts", "image"].map((kind) => [kind, { selected: models.selected(kind)?.name ?? null, models: models.list(kind).map(twin), catalog: models.catalog(kind) }]),
    ),
    presets: models.presets(),
  })
  const name = (b) => [String(b?.kind ?? ""), String(b?.name ?? "")]
  return {
    GET: { models: view },
    POST: readOnly
      ? {}
      : {
          "models/select": (b) => ({ model: twin(models.select(...name(b))) }),
          "models/set": (b) => ({ model: twin(models.set(...name(b), b?.values ?? {})) }),
          "models/add": (b) => ({ model: twin(models.add(...name(b))) }),
          "models/install": (b) => install(models.get(...name(b)), log),
          "models/start": async (b) => {
            const m = models.get(...name(b))
            if (m.engine !== "openai") return { ready: models.ready(m).ready }
            return { ready: true, url: await ensureServer(m, { log }) }
          },
        },
  }
}
