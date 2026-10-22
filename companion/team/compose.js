// Compose a desk from files (the standard, docs/standard.md): agents as folders, tools as files, desks mounted in
// desks, built on the kernel (backend/kernel buildDesk). Host side: it reads the disk (fs, Bun.YAML).
//
//   <desk>/main.js                     export default conventionDesk({ title, description })
//   <desk>/<lead>/<lead>.md            frontmatter + role; members as subfolders <lead>/<member>/<member>.md (agents: [a, b])
//   <desk>/<lead>/tools.js             the agent's own tools (defineTool, or an array): attached to it, names unique
//   <desk>/tools/<name>.js             export default defineTool({ name, description, input, view?, run })
//   <desk>/teams/<team>/<team>.md      a team template (members as subfolders): spawned at run time, never at start
//   legacy (2026-10-21: every desk made before; read unchanged): <desk>/agents/<lead>/agent.md, members' agent.md
//
//   readAgentFolder(folder, vars)      an agent's .md tree as plain definitions (+ desks: the desks mounted under it)
//   loadTools(dir)                     {name: Tool} from every dir/*.js, imported fresh
//   hostClient({port, desk, fetch?})   {get, post} on the host API (/__askk/), as that desk: tools reach the host
//                                      only through it (ctx.host)
//   MODELS, llmInfer(...)              the default model catalogue; infer(prompt, agent) through the host's local models
//   composeDesk({folder, …})           the kernel Desk: tool names resolved, desks mounted, built-in artifacts
//   conventionDesk({title, …})         what a convention desk's main.js default-exports
//
// 2026-10-17: the kernel's inbuilt kit (backend/kernel/builtin: web.search, web.read, agent.spawn, agent.dismiss; files,
// terminal, preview, plan) sits under every desk's own tools and artifact types — attach by name, the desk wins a
// clash — bound once per composed desk (one files / terminal / preview / plan for the whole tree, mounted desks
// included: they share its process, host and workspace), and handed to buildDesk so agent.spawn resolves names at run
// time.
// 2026-10-17 owner ("let the lead, when required, be able to create a sub team to focus on special critical
// observation and in control on a layer"): a desk's teams/<team>/agent.md folders are team templates — read and
// checked here like agents (an unknown key, tool, artifact or model fails the compose, naming the file), never built at
// start, handed to buildDesk as env.templates (spawn inputs: agent.spawn {template}) with env.models (the model names a
// spawn may ask for).

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs"
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path"

import { Artifact, buildDesk, builtinKit, Checklist, complete, defineTool, parsePhasesFile, parseWorkflowFiles, SPAWN_NAME, Tool } from "../../backend/kernel/index.js"
import { API_PREFIX, DESK_HEADER } from "../shared/config.js"
import { AGENT_FILE_NAMES, agentFile, deskLead } from "./layout.js"

const FRONT = /^---\n([\s\S]*?)\n---\n?/
const list = (v) => (v == null ? [] : [].concat(v))
const names = (v) => list(v).flatMap((x) => String(x).split(",")).map((x) => x.trim()).filter(Boolean) // "a, b" or [a, b]
export const DESK_NAME = /^[a-z][a-z0-9-]*$/ // a desk's folder name (mounts, desks/load)

// ---- agents ------------------------------------------------------------------------------------

// An agent's folder (+ one folder per member, nested): <name>/<name>.md — or agent.md, the legacy layout and a
// migration — frontmatter + role. {{key}} takes vars[key]. desks: the names of desks mounted under this agent (composeDesk
// mounts them from the desks' folder). A <name>.md agent is named after its folder (no name: the folder's); its
// tools.js (the agent's own tools) is loaded by composeDesk. FILE / TOOLS: the .md read and the tools.js beside it.
export const FILE = Symbol("file")
export const TOOLS = Symbol("tools.js")
export function readAgentFolder(folder, vars = {}) {
  const file = agentFile(folder)
  if (!file) {
    const why = AGENT_FILE_NAMES.has(basename(folder)) ? ` — an agent folder is never named ${basename(folder)} (its ${basename(folder)}.md sits beside its own .md)` : ""
    throw new Error(`no ${basename(folder)}.md (or agent.md) in ${folder}${why}`)
  }
  const text = readFileSync(file, "utf8")
  const m = text.match(FRONT)
  if (!m) throw new Error(`${file}: no frontmatter`)
  const fill = (s) => (typeof s === "string" ? s.replace(/\{\{(\w+)\}\}/g, (all, k) => (k in vars ? String(vars[k]) : all)) : s)
  let meta
  try {
    meta = Bun.YAML.parse(m[1]) ?? {}
  } catch (error) {
    throw new Error(`${file}: frontmatter is not YAML (${error.message})`)
  }
  const own = basename(file) !== "agent.md" // the standard: <name>/<name>.md
  if (own && meta.name == null) meta.name = basename(folder)
  for (const k of ["description", "goal", "title"]) meta[k] = fill(meta[k])
  if (meta.artifacts) meta.artifacts = JSON.parse(fill(JSON.stringify(meta.artifacts)))
  const def = { ...meta, role: fill(text.slice(m[0].length).trim()), folder }
  def[FILE] = file
  if (existsSync(join(folder, "tools.js"))) def[TOOLS] = join(folder, "tools.js")
  if (!def.name) throw new Error(`${file}: no name`)
  if (own && String(def.name) !== basename(folder)) throw new Error(`${file}: name ${def.name} — an agent is named after its folder (${basename(folder)}/${basename(folder)}.md)`)
  def.agents = list(meta.agents).map((sub) => readAgentFolder(join(folder, String(sub)), vars))
  def.desks = list(meta.desks)
  const bad = def.desks.filter((d) => typeof d !== "string" || !DESK_NAME.test(d))
  if (bad.length) throw new Error(`${file}: desks: ${bad.map((d) => JSON.stringify(d)).join(", ")} — each is a desk folder name (${DESK_NAME})`)
  return def
}

// ---- tools -------------------------------------------------------------------------------------

// Every cached module under a real folder (Bun keeps ES modules in require.cache too, by real path): the next import
// evaluates the file again, so a reload sees edits. Only keys under `realFolder` itself — never a link's target: a
// desk whose tools/ linked to the app's own code cleared compose.js and kernel-team.js (2026-10-16 critic).
export function forgetModules(realFolder) {
  const root = resolve(realFolder)
  for (const key of Object.keys(require.cache)) if (key === root || key.startsWith(root + sep)) delete require.cache[key]
}

// The real path of `path`, refused when `path` itself is a link (a desk's own files are real paths inside it; its
// parent folders may be links, e.g. /var on macOS).
export function ownPath(path, what = "a desk's file") {
  const full = resolve(path)
  const real = realpathSync(full)
  if (real !== join(realpathSync(dirname(full)), basename(full))) throw new Error(`${full} is a link (→ ${real}): ${what} is a real path inside the desk`)
  return real
}

const isTool = (t) => t instanceof Tool || (!!t && typeof t.name === "string" && typeof t.run === "function" && typeof t.twin === "function")

// One tools/*.js module, imported fresh: its default export, a Tool (defineTool) or an array of them, checked
// against defineTool's rules (a hand-made Tool too). A bad module throws an Error naming the file and the reason.
export async function loadToolFile(file) {
  const path = resolve(file)
  if (!existsSync(path)) throw new Error(`${path}: no such file`)
  forgetModules(ownPath(path, "a tools/*.js file"))
  let mod
  try {
    mod = await import(path)
  } catch (error) {
    throw new Error(`${path}: ${error.message}`)
  }
  const value = mod.default
  const tools = Array.isArray(value) ? value : value == null ? [] : [value]
  if (!tools.length) throw new Error(`${path}: no default export — export default defineTool({ name, description, input, run }) (or an array of them)`)
  tools.forEach((t, i) => {
    const where = Array.isArray(value) ? `default export [${i}]` : "default export"
    if (!isTool(t)) throw new Error(`${path}: the ${where} is not a Tool — wrap it: export default defineTool({ name, description, input, run })`)
    try {
      defineTool({ name: t.name, description: t.description, input: t.input, view: t.view, type: t.type, run: () => {} })
    } catch (error) {
      throw new Error(`${path}: ${error.message}`)
    }
  })
  return tools
}

// {name: Tool} from every dir/*.js (not *.test.js; helpers live in subfolders). A missing dir is no tools; a name
// defined twice throws naming both files.
// from: {name: file} filled as they load (composeDesk names both files when an agent's tools.js takes a desk tool's name).
export async function loadTools(dir, from = {}) {
  const out = {}
  if (!existsSync(dir)) return out
  const real = ownPath(dir, "a desk's tools/ folder")
  forgetModules(real) // helpers under tools/ come back fresh with the tools that import them
  // A linked tools/*.js is listed (and refused by loadToolFile), never skipped quietly.
  const files = readdirSync(real, { withFileTypes: true }).filter((d) => (d.isFile() || d.isSymbolicLink()) && d.name.endsWith(".js") && !d.name.endsWith(".test.js"))
  for (const d of files.sort((a, b) => a.name.localeCompare(b.name))) {
    const file = join(real, d.name)
    for (const tool of await loadToolFile(file)) {
      if (out[tool.name]) throw new Error(`${file}: tool ${tool.name} is defined in ${from[tool.name]} too`)
      out[tool.name] = tool
      from[tool.name] = file
    }
  }
  return out
}

// ---- the host ----------------------------------------------------------------------------------

// The host API (companion/server/host-api.js) as one desk: GET and POST on http://localhost:<port>/__askk/<path>,
// with the desk header; a POST carries the same-origin Origin and a JSON body (the host refuses writes without
// them). JSON answers parsed, else text; a non-2xx answer throws with its status and its first 200 chars.
export function hostClient({ port, desk = null, fetch: fetcher = globalThis.fetch } = {}) {
  const base = `http://localhost:${port}`
  async function request(method, path, body, { signal } = {}) {
    const headers = desk ? { [DESK_HEADER]: desk } : {}
    if (method === "POST") Object.assign(headers, { Origin: base, "Content-Type": "application/json" })
    const res = await fetcher(`${base}${API_PREFIX}${String(path).replace(/^\/+/, "")}`, { method, headers, signal, ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}) })
    const text = await res.text()
    if (!res.ok) throw Object.assign(new Error(`${method} ${path}: HTTP ${res.status} ${text.slice(0, 200)}`), { status: res.status })
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  // stream(path, body, {signal, onEvent}): a POST whose answer is NDJSON (llm/research) — each event to onEvent as it
  // comes; resolves with the last event.
  async function stream(path, body, { signal, onEvent = () => {} } = {}) {
    const res = await fetcher(`${base}${API_PREFIX}${String(path).replace(/^\/+/, "")}`, { method: "POST", headers: { ...(desk ? { [DESK_HEADER]: desk } : {}), Origin: base, "Content-Type": "application/json" }, signal, body: JSON.stringify(body ?? {}) })
    if (!res.ok) throw Object.assign(new Error(`POST ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`), { status: res.status })
    let last = null
    let buffer = ""
    const take = (line) => {
      if (!line.trim()) return
      let event
      try {
        event = JSON.parse(line)
      } catch {
        return
      }
      if (event?.type === "ping") return // keep-alive only
      last = event
      onEvent(event)
    }
    for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
      buffer += chunk
      let at
      while ((at = buffer.indexOf("\n")) >= 0) {
        take(buffer.slice(0, at))
        buffer = buffer.slice(at + 1)
      }
    }
    take(buffer)
    return last
  }
  return { base, desk, get: (path, opts) => request("GET", path, undefined, opts), post: (path, body, opts) => request("POST", path, body, opts), stream }
}

// ---- models ------------------------------------------------------------------------------------

// The default model catalogue (the shape of a desk's CONFIG.models): the Claude CLI through the host's local models.
export const MODELS = {
  opus: { key: "opus", label: "Opus 5.5", provider: "claude-cli", id: "claude-opus-5-5" },
  sonnet: { key: "sonnet", label: "Sonnet 5.5", provider: "claude-cli", id: "claude-sonnet-5-5" },
  haiku: { key: "haiku", label: "Haiku 5.5", provider: "claude-cli", id: "claude-haiku-5-5" },
}

// Local CLI providers run through the desk server's host API (same-origin POST); others through complete().
const LOCAL = new Set(["claude-cli", "codex-cli", "gemini-cli", "apple"])

// infer(prompt, agent): the agent's model from its own catalogue (a mounted desk's agents carry theirs as
// config.models), else `models`, else `fallback`. Local providers go through the host (hostClient: the one path).
export function llmInfer({ models, fallback, port, desk, onUsage }) {
  const host = hostClient({ port, desk })
  // options.images (2026-10-18: the preview's screenshots, Agent.collectImages): on the local wire as OpenAI image_url
  // parts (data: URLs only), else to the kernel's complete.
  return async (prompt, agent, { images = [] } = {}) => {
    const key = agent.config.model
    const model = agent.config.models?.[key] ?? models?.[key] ?? models?.[fallback]
    if (!model) throw new Error(`${agent.name}: no model`)
    const t0 = Date.now()
    let raw
    if (LOCAL.has(model.provider)) {
      const content = images.length ? [{ type: "text", text: prompt }, ...images.flatMap((i) => [{ type: "text", text: `(${i.caption || "screenshot"})` }, { type: "image_url", image_url: { url: `data:${i.media_type};base64,${i.data}` } }])] : prompt
      const body = { model: model.id, stream: false, messages: [{ role: "user", content }] }
      const out = await host.post(`llm/${model.provider}/v1/chat/completions`, body).catch((error) => {
        throw new Error(`${model.id}: ${error.message}`)
      })
      raw = out?.choices?.[0]?.message?.content ?? ""
    } else raw = (await complete({ model, prompt, images })).raw
    onUsage?.({ agent: agent.name, model: model.id, ms: Date.now() - t0, prompt_chars: prompt.length, reply_chars: raw.length, ...(images.length ? { images: images.length } : {}) })
    return raw
  }
}

// infer that tries the agent's model, then each fallback in order; every failure is a desk log line, so the owner
// sees which model answered.
function withFallbacks(infer, { defaultModel, fallbacks, log }) {
  return async (prompt, agent, options) => {
    const keys = [agent.config.model ?? defaultModel, ...(agent.config.fallbacks ?? fallbacks)].filter((k, i, all) => k && all.indexOf(k) === i)
    let last
    for (const [i, key] of keys.entries()) {
      try {
        return await infer(prompt, { name: agent.name, config: { ...agent.config, model: key } }, options)
      } catch (error) {
        last = error
        log(`model: ${agent.name}: ${key} failed (${String(error.message).slice(0, 120)})${keys[i + 1] ? ` — trying ${keys[i + 1]}` : ""}`)
      }
    }
    throw last
  }
}

// ---- built-in artifacts ------------------------------------------------------------------------

// The team an agent works in (the one it leads, else its team's): its artifacts sit on that team's card.
const teamOf = (agent) => agent.board?.team ?? (String(agent.teamPath ?? "").split("/").pop() || agent.name)
const slug = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "") || "report"
const REPORT_PROMPT = 2000 // a report's text in a prompt; whole in the twin and the file

// Report: an agent's latest written report, {title, text, at}. `<agent>.report.write` replaces it and, with the
// desk's memory folder, saves it as memory/reports/<YYYY-MM-DD>-<slug of title>.md (kept: one file per title a day).
export class Report extends Artifact {
  constructor({ id, owner = null, memory = null, clock = () => new Date() }) {
    super({ name: id, title: `${id.replace(/\.report$/, "")} report` })
    this.kind = "report"
    this.view = "text"
    this.keep = "always"
    this.owner = owner
    this.memory = memory
    this.clock = clock
    this.state = { title: null, text: null, at: null }
  }

  render() {
    const head = `your latest report: ${this.name}.write {title, text} replaces it${this.memory ? " and saves it to the desk's memory (reports/)" : ""}`
    if (!this.state.text) return `${head}\n(none yet)`
    const text = this.state.text.length > REPORT_PROMPT ? `${this.state.text.slice(0, REPORT_PROMPT)}… (${this.state.text.length} chars)` : this.state.text
    return `${head}\n## ${this.state.title} (${this.state.at})\n${text}`
  }

  brief() {
    return this.state.title ? `${this.state.title} · ${String(this.state.at).slice(0, 16).replace("T", " ")}` : "no report yet"
  }

  live() {
    return { view: "text", data: { text: this.state.text ? `# ${this.state.title}\n${this.state.text}` : "" } }
  }

  write({ title, text } = {}) {
    const t = String(title ?? "").trim()
    const body = String(text ?? "").trim()
    if (!t) throw new Error("title is required")
    if (!body) throw new Error("text is required")
    const now = this.clock()
    this.state = { title: t.slice(0, 200), text: body, at: now.toISOString() }
    this.changed()
    if (!this.memory) return `report "${this.state.title}" kept (no memory folder to save it in)`
    const dir = join(this.memory, "reports")
    mkdirSync(dir, { recursive: true })
    const name = `${now.toLocaleDateString("en-CA")}-${slug(t)}.md` // en-CA: YYYY-MM-DD, local day
    writeFileSync(join(dir, name), `# ${this.state.title}\n\n_${this.owner ?? ""} · ${this.name} · ${this.state.at}_\n\n${body}\n`)
    return `report "${this.state.title}" saved: reports/${name}`
  }

  commands() {
    return [new Tool({ name: `${this.name}.write`, description: "write your report (replaces the last one)", input: { title: "a short title", text: "the report, markdown" }, run: (input) => this.write(input) })]
  }
}

// practice's store (the kernel's Practice, 2026-10-20): the agent's standing orders in memory/<desk>/practice/<agent>.md,
// seeded from practice.md beside its agent.md (the owner's first version, config) until the agent's own exists; its
// retros appended to memory/<desk>/retros/<agent>.md. memoryOf() → the desk's memory folder (a mounted desk's own),
// read at each call. No memory folder: kept in the artifact only.
export function practiceStore(agent, memoryOf) {
  const memory = () => memoryOf?.() ?? null
  const fileOf = () => (memory() ? join(memory(), "practice", `${agent.name}.md`) : null)
  const mem = memory()
  return {
    where: mem ? `memory/${basename(mem)}/practice/${agent.name}.md` : null,
    read: () => {
      const file = fileOf()
      return file && existsSync(file) ? readFileSync(file, "utf8") : null
    },
    write: (text) => {
      const file = fileOf()
      if (!file) return
      mkdirSync(dirname(file), { recursive: true })
      const tmp = `${file}.${process.pid}.tmp`
      writeFileSync(tmp, text)
      renameSync(tmp, file)
    },
    seed: () => {
      const file = agent.config?.folder ? join(agent.config.folder, "practice.md") : null
      return file && existsSync(file) ? readFileSync(file, "utf8") : null
    },
    retro: (entry) => {
      if (!memory()) return
      const dir = join(memory(), "retros")
      mkdirSync(dir, { recursive: true })
      appendFileSync(join(dir, `${agent.name}.md`), `${entry}\n`)
    },
  }
}

// The built-in artifact types, by the name an agent.md uses (checklist: its own key; artifacts: [report]).
export const ARTIFACT_TYPES = {
  checklist: () => (agent, { items }) => Object.assign(new Checklist({ id: `${agent.name}.checklist`, title: `${agent.name} checklist`, items: list(items).map(String), owner: teamOf(agent) }), { keep: "run" }),
  report: ({ memory }) => (agent) => new Report({ id: `${agent.name}.report`, owner: teamOf(agent), memory }),
}

// ---- compose -----------------------------------------------------------------------------------

// The kit's workflow artifact for a desk (2026-10-22): its steps are <desk folder>/<id>/NN-<step>.md (read fresh at each
// run: an edit applies to the next one), its run files memory/<desk>/<id>/runs/… (none: kept in memory). plugins: the
// desk's own code steps, schemas, derive, checks (main.js `builtin.workflowPlugins(id)`), checked against the files.
export function workflowSource(root, memoryOf, plugins = () => ({})) {
  return (id) => {
    const dir = join(root, id)
    const known = () => {
      const p = plugins(id) ?? {}
      return { code: p.code ?? {}, schemas: p.schemas ?? {}, derive: p.derive ?? {}, checks: p.checks ?? {} }
    }
    const phases = join(root, "phases", `${id}.md`)
    const load = () => {
      // a phases file (2026-10-22): phases/<id>.md, one file, ## per phase (parsePhasesFile)
      if (existsSync(phases)) return parsePhasesFile(readFileSync(phases, "utf8"), { file: `phases/${id}.md`, known: known() })
      if (!existsSync(dir)) throw new Error(`${id}/: no workflow folder in the desk (NN-<step>.md files)`)
      const files = readdirSync(dir).filter((f) => f.endsWith(".md")).map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }))
      return parseWorkflowFiles(files, { known: known() })
    }
    const base = () => (memoryOf() ? join(memoryOf(), id) : null)
    const mem = new Map()
    const store = {
      write(rel, text) {
        const b = base()
        if (!b) return mem.set(rel, String(text)) && rel
        const f = isAbsolute(rel) ? rel : join(b, rel)
        mkdirSync(dirname(f), { recursive: true })
        writeFileSync(f, text)
        return f
      },
      read(where) {
        if (mem.has(where)) return mem.get(where)
        try {
          return readFileSync(where, "utf8")
        } catch {
          return null
        }
      },
    }
    return { load, store, folder: existsSync(phases) ? `phases/${id}.md` : `${id}/` }
  }
}

// The agent.md keys composeDesk reads (readAgentFolder adds role and folder); any other key is a typo. writes / reads:
// the agent's files lanes (globs; reads: set = it reads only there — the critic's "outputs only"); board: false keeps
// it off its team's board (2026-10-17).
const KEYS = new Set(["name", "description", "title", "goal", "team", "model", "max_steps", "context_chars", "min_calls", "writes", "reads", "board", "tools", "agents", "desks", "checklist", "artifacts", "after", "role", "folder"])
// The keys an agent.md artifacts: entry for a kit type takes (a desk's own type may take more: its spec is handed over).
const KIT_KEYS = new Set(["type", "id", "commands", "gate", "reflect"]) // reflect: false — a practice without the run's retro item

// The one lead of a desk (layout.js deskLead): <desk>/<lead>/<lead>.md, or agents/<lead>/agent.md (legacy).
const leadFolder = (folder) => deskLead(folder).folder

// Drop undefined fields: the kernel's defaults (maxSteps 12, …) are spread under the spec.
const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))

// A desk's main.js answer, imported fresh: a convention desk's compose options are its `compose` field.
export async function readDeskConfig(folder) {
  if (!existsSync(join(folder, "main.js"))) throw new Error(`${folder}: no main.js — a desk is a folder with main.js, its lead (<lead>/<lead>.md) and tools/`)
  const real = ownPath(folder, "a desk folder")
  const entry = ownPath(join(real, "main.js"), "a desk's main.js")
  forgetModules(real)
  let create
  try {
    create = (await import(entry)).default
  } catch (error) {
    throw new Error(`${entry}: ${error.message}`)
  }
  if (typeof create !== "function") throw new Error(`${entry} must default-export a function (conventionDesk({...}))`)
  return (await create({ dir: folder, env: process.env })) ?? {}
}

// The artifact types of one desk: the kernel's kit (bound once per composed desk), the built-ins here (made with its
// memory folder), then its own — a later one wins a clash.
const artifactTypes = (memory, own = {}, kit = {}) => ({ ...kit, ...Object.fromEntries(Object.entries(ARTIFACT_TYPES).map(([k, make]) => [k, make({ memory })])), ...own })
const realOf = (p) => {
  try {
    return realpathSync(p)
  } catch {
    return null
  }
}

// A desk folder → its lead's agent spec for buildDesk. `o` is this desk's: its tool catalogue, artifact types,
// models, memory; `mounts`: the desk folder names from the outermost desk to this one (a cycle check); `owners`:
// agent name → the desk it belongs to (its ctx after the build).
async function deskSpec(folder, o, mounts) {
  const from = {}
  const own = await loadTools(join(folder, "tools"), from)
  for (const [name, file] of Object.entries(from)) o.toolFiles?.set(name, file) // tool names are unique across the desk
  o.owns?.set(resolve(folder), own) // composeDesk hands the outermost desk's catalogue to buildDesk (agent.spawn)
  const deskName = basename(folder)
  const lead = readAgentFolder(leadFolder(folder), o.vars)
  return specOf(lead, { ...o, own, deskName, mounts }, true)
}

async function specOf(def, o, lead = false) {
  const where = def[FILE] ?? `${def.folder}/agent.md`
  const unknown = Object.keys(def).filter((k) => !KEYS.has(k))
  if (unknown.length) throw new Error(`${where}: unknown key ${unknown.join(", ")} (keys: ${[...KEYS].filter((k) => k !== "role" && k !== "folder").join(", ")})`)
  const model = def.model ?? o.defaultModel
  if (o.models && model != null && !Object.hasOwn(o.models, model)) throw new Error(`${def.name}: unknown model ${model}; models: ${Object.keys(o.models).join(", ")}`)
  o.owners.set(def.name, o.deskName)

  // Its own tools.js (2026-10-21): attached to this agent, whatever its tools: lists; a name taken by another agent's
  // tools.js or the desk's tools/ is an Error naming both files.
  const mine = def[TOOLS] ? await loadToolFile(def[TOOLS]) : []
  for (const t of mine) {
    const other = o.toolFiles?.get(t.name)
    if (other) throw new Error(`${def[TOOLS]}: tool ${t.name} is defined in ${other} too (tool names are unique across a desk)`)
    o.toolFiles?.set(t.name, def[TOOLS])
  }
  const ownNames = new Set(mine.map((t) => t.name))
  const tools = list(def.tools).filter((name) => !ownNames.has(name)).map((name) => {
    if (typeof name !== "string") throw new Error(`${where}: tools are names (${JSON.stringify(name)})`)
    const tool = o.own[name] ?? o.tools[name]
    // A tool from another copy of the kernel module (not instanceof here) goes in as is, through a factory.
    if (tool) return tool instanceof Tool || typeof tool === "function" ? tool : () => tool
    const available = [...new Set([...Object.keys(o.own), ...Object.keys(o.tools)])].sort()
    throw new Error(`${def.name}: unknown tool ${name}; available: ${available.join(", ") || "none"} (its own tools.js, ${o.deskName}/tools/*.js, then the host's catalogue)`)
  })
  tools.unshift(...mine)
  const members = []
  for (const sub of def.agents) members.push({ type: "agent", ...(await specOf(sub, o)) })
  for (const name of def.desks) {
    if (o.mounts.includes(name)) throw new Error(`${def.name}: desks: ${[...o.mounts, name].join(" → ")} is a cycle`)
    const folder = join(o.deskRoot, name)
    let hasLead = false
    try {
      hasLead = !!deskLead(folder)
    } catch {}
    if (!existsSync(join(folder, "main.js")) || !hasLead) throw new Error(`${def.name}: desks: no desk ${name} (${folder} needs main.js and its lead: <lead>/<lead>.md)`)
    if (realOf(folder) !== join(realOf(o.deskRoot), name)) throw new Error(`${def.name}: desks: ${name} is a link (${folder} → ${realOf(folder)}); a mounted desk is a real folder beside this one`)
    // The mounted desk composes with its own main.js options (models, artifact types, tool catalogue) and memory.
    // maxSteps: its own, else the kernel's; fallbacks: its own (a desk without compose options keeps the parent's).
    const own = (await readDeskConfig(folder)).compose
    const c = own ?? {}
    const memory = o.memoryRoot ? join(o.memoryRoot, name) : null
    o.memories.set(name, memory)
    const mounted = { ...o, tools: { ...o.kitTools, ...(c.tools ?? {}) }, artifacts: artifactTypes(memory, c.artifacts, o.kit), models: c.models ?? o.models, defaultModel: c.defaultModel ?? o.defaultModel, maxSteps: c.maxSteps, fallbacks: own ? (c.fallbacks ?? []) : undefined, mounted: true }
    members.push({ type: "agent", ...(await deskSpec(folder, mounted, [...o.mounts, name])), desk: name })
  }

  const specs = [...(def.checklist ? [{ type: "checklist", items: def.checklist }] : []), ...list(def.artifacts).map((a) => (typeof a === "string" ? { type: a } : a))]
  for (const a of specs) if (!a?.type || !o.artifacts[a.type]) throw new Error(`${def.name}: unknown artifact ${a?.type ?? JSON.stringify(a)}; types: ${Object.keys(o.artifacts).sort().join(", ")}`)
  for (const a of specs) {
    const bad = o.artifacts[a.type] === o.kit?.[a.type] ? Object.keys(a).filter((k) => !KIT_KEYS.has(k)) : []
    if (bad.length) throw new Error(`${where}: artifacts: ${a.type} takes ${[...KIT_KEYS].join(", ")} (not ${bad.join(", ")})`)
    if (a.gate != null && typeof a.gate !== "boolean") throw new Error(`${where}: artifacts: ${a.type} gate is true or false`)
  }
  // Bound to this desk's catalogue (a mounted desk's types are its own), handed to the kernel as factories with how the
  // agent holds each: a commands subset ("read, wait" or [read, wait]), gated (the plan).
  const artifacts = specs.map((a) => ({ artifact: (agent) => o.artifacts[a.type](agent, a), commands: a.commands == null ? null : names(a.commands), gate: a.gate === true }))
  for (const k of ["writes", "reads"]) {
    const v = def[k]
    if (v != null && !(typeof v === "string" || (Array.isArray(v) && v.every((g) => typeof g === "string")))) throw new Error(`${where}: ${k}: globs (a list of workspace paths, e.g. ["projects/**"])`)
  }
  if (def.board != null && typeof def.board !== "boolean") throw new Error(`${where}: board: false keeps it off its team's board (true or false)`)

  return defined({
    name: def.name,
    role: def.role,
    description: def.description,
    title: def.title,
    goal: def.goal,
    team: def.team ?? (lead ? o.deskName : undefined), // a desk's lead leads the team named after the desk
    model: model ?? undefined,
    models: o.mounted ? o.models : undefined, // llmInfer reads a mounted desk's catalogue here
    fallbacks: o.mounted ? o.fallbacks : undefined, // and the conventionDesk infer its fallbacks
    maxSteps: def.max_steps ?? o.maxSteps,
    contextChars: def.context_chars, // 2026-10-22: the prompt budget in chars (compaction at 90%), else by the model
    minCalls: def.min_calls,
    writes: def.writes == null ? undefined : names(def.writes),
    reads: def.reads == null ? undefined : names(def.reads),
    board: def.board,
    folder: def.folder,
    after: def.after,
    artifacts,
    tools: [...tools, ...members],
  })
}

// ---- team templates ----------------------------------------------------------------------------

// The agent.md keys a template takes that agent.spawn cannot honour: refused with why, never ignored.
const NOT_IN_TEMPLATE = {
  desks: "a spawned team mounts no desk",
  checklist: "a spawned team plans on the desk's plan (artifacts: [plan])",
  min_calls: "agent.spawn does not set it",
  after: "agent.spawn does not order a team's members",
  team: "a spawned team's board is named after its lead (<name>.board)",
}
const MAX_STEPS = 300 // agent.spawn's bound (backend/kernel/builtin/spawn.js)

// One template folder (or a member of one) → the spawn input agent.spawn {template} takes (backend/kernel/builtin/
// spawn.js): {name, description?, title?, role, goal?, tools: [names], artifacts: [entries as written], writes?, reads?,
// model?, max_steps?, board?, members: [the same]}. Checked as specOf checks an agent, every error naming the file:
// tools from the desk's catalogue (its tools/, the host's, the kit), artifact types it knows (a kit type's keys and
// commands), a model from its models, lanes as globs. prefix: the name a member's is joined to ("<team>-<member>", as
// agent.spawn names it), which must pass SPAWN_NAME too; seen: the names of the whole template (one each).
function templateOf(def, o, prefix = null, seen = new Set()) {
  const where = def[FILE] ?? `${def.folder}/agent.md`
  if (def[TOOLS]) throw new Error(`${def[TOOLS]}: a team template takes its tools from the desk's catalogue (tools/, by name in tools:), not a tools.js`)
  const unknown = Object.keys(def).filter((k) => !KEYS.has(k))
  if (unknown.length) throw new Error(`${where}: unknown key ${unknown.join(", ")} (keys: ${[...KEYS].filter((k) => k !== "role" && k !== "folder" && !(k in NOT_IN_TEMPLATE)).join(", ")})`)
  for (const [k, why] of Object.entries(NOT_IN_TEMPLATE)) if (def[k] != null && !(Array.isArray(def[k]) && !def[k].length)) throw new Error(`${where}: ${k} is not for a team template (${why})`)
  const name = prefix ? `${prefix}-${def.name}` : String(def.name)
  if (!SPAWN_NAME.test(name)) throw new Error(`${where}: name ${name}${prefix ? ` (${prefix}-<its name>, as agent.spawn names a member)` : ""}: lowercase letters, digits and -, 2–31 chars, starting with a letter`)
  if (seen.has(name)) throw new Error(`${where}: ${name} twice in this template`)
  seen.add(name)
  if (!String(def.role ?? "").trim()) throw new Error(`${where}: no role — the body under the frontmatter says what it is for and how it works`)
  if (prefix && def.goal != null) throw new Error(`${where}: goal is the team's (its lead's .md); a member works toward it`)
  if (o.models && def.model != null && !Object.hasOwn(o.models, def.model)) throw new Error(`${where}: unknown model ${def.model}; models: ${Object.keys(o.models).join(", ")}`)
  if (def.max_steps != null && !(Number.isInteger(def.max_steps) && def.max_steps >= 1 && def.max_steps <= MAX_STEPS)) throw new Error(`${where}: max_steps: a whole number from 1 to ${MAX_STEPS}`)
  for (const k of ["writes", "reads"]) {
    const v = def[k]
    if (v != null && !(typeof v === "string" || (Array.isArray(v) && v.every((g) => typeof g === "string")))) throw new Error(`${where}: ${k}: globs (a list of workspace paths, e.g. ["projects/**"])`)
  }
  if (def.board != null && typeof def.board !== "boolean") throw new Error(`${where}: board: false keeps it off its team's board (true or false)`)

  const available = () => [...new Set([...Object.keys(o.own), ...Object.keys(o.tools)])].sort().join(", ") || "none"
  const tools = list(def.tools).map((t) => {
    if (typeof t !== "string") throw new Error(`${where}: tools are names (${JSON.stringify(t)})`)
    if (!Object.hasOwn(o.own, t) && !Object.hasOwn(o.tools, t)) throw new Error(`${where}: unknown tool ${t}; available: ${available()} (${o.deskName}/tools/*.js, then the host's catalogue)`)
    return t
  })
  const artifacts = list(def.artifacts)
  for (const a of artifacts) {
    const spec = typeof a === "string" ? { type: a } : a
    if (!spec?.type || !o.artifacts[spec.type]) throw new Error(`${where}: unknown artifact ${spec?.type ?? JSON.stringify(a)}; types: ${Object.keys(o.artifacts).sort().join(", ")}`)
    if (o.artifacts[spec.type] !== o.kit?.[spec.type]) continue // a desk's own type: its spec is handed over, checked when spawned
    const bad = Object.keys(spec).filter((k) => !KIT_KEYS.has(k))
    if (bad.length) throw new Error(`${where}: artifacts: ${spec.type} takes ${[...KIT_KEYS].join(", ")} (not ${bad.join(", ")})`)
    if (spec.gate != null && typeof spec.gate !== "boolean") throw new Error(`${where}: artifacts: ${spec.type} gate is true or false`)
    if (spec.commands == null) continue
    // The kit's instance (one per desk and id: the one a spawn will hold) names its commands.
    let x
    try {
      x = o.artifacts[spec.type]({ name }, spec)
    } catch (error) {
      throw new Error(`${where}: ${error.message}`)
    }
    const short = (t) => (t.name.startsWith(`${x.id}.`) ? t.name.slice(x.id.length + 1) : t.name)
    const has = x.commands().map(short)
    const missing = names(spec.commands).filter((c) => !has.includes(c.startsWith(`${x.id}.`) ? c.slice(x.id.length + 1) : c))
    if (missing.length) throw new Error(`${where}: ${x.id} has no command ${missing.join(", ")} (has ${has.join(", ") || "none"})`)
  }
  const members = def.agents.map((sub) => templateOf(sub, o, name, seen))
  return defined({
    name: String(def.name),
    description: def.description,
    title: def.title,
    role: String(def.role).trim(),
    goal: def.goal,
    tools,
    artifacts,
    writes: def.writes == null ? undefined : names(def.writes),
    reads: def.reads == null ? undefined : names(def.reads),
    model: def.model,
    max_steps: def.max_steps,
    board: def.board,
    members,
  })
}

// A desk's teams/: {<team>: spawn input} from each teams/<team>/<team>.md (or agent.md; its members in subfolders, agents:
// [a, b]), named after its folder; {} without teams/. A folder there without one is an error (a template that never
// loads would be a team the lead cannot staff).
function readTemplates(folder, o) {
  const dir = join(folder, "teams")
  if (!existsSync(dir)) return {}
  const out = {}
  for (const d of readdirSync(dir, { withFileTypes: true }).filter((x) => x.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const at = join(dir, d.name)
    if (!agentFile(at)) throw new Error(`${at}: no ${d.name}.md — a team template is teams/<team>/<team>.md (members in subfolders)`)
    const def = readAgentFolder(at, o.vars)
    if (def.name !== d.name) throw new Error(`${def[FILE]}: name ${def.name} — a template is named after its folder (${d.name}): agent.spawn {template: "${d.name}"}`)
    out[d.name] = templateOf(def, o)
  }
  return out
}

// The desk in `folder` as a kernel Desk. deskRoot: where `desks:` mounts are found (default: the folder's parent,
// e.g. custom/). tools: {name: Tool | (agent) => Tool}, the host's catalogue after the desk's own tools/ (then the
// kernel's kit). artifacts: {type: (agent, spec) => Artifact} beside the built-ins. models: the catalogue an agent's
// `model:` must name. builtin: the kit's desk options (backend/kernel/builtin/index.js: clock, a files adapter).
// Every tool call gets ctx {host, desk, memory, log, ...context, agent, signal}. A mounted desk composes with its own
// main.js options; its agents' ctx says desk: <its name>, memory: <memory root>/<its name>, and keeps the parent's
// host and log (it runs in the parent's process and workspace). Its teams/ templates: desk.ctx.env.templates.
export async function composeDesk({ folder, deskRoot, name, port, infer, context = {}, tools = {}, artifacts = {}, vars = {}, models, defaultModel, maxSteps, builtin = {} } = {}) {
  if (!folder) throw new Error("composeDesk: folder is required")
  const root = resolve(folder)
  deskLead(root) // the lead's folder, or an Error that says what it found
  const deskName = name ?? basename(root)
  const ctx = { host: port ? hostClient({ port, desk: deskName }) : null, desk: deskName, memory: null, log: () => {}, ...context }
  const owners = new Map() // agent name → its desk folder name
  const memories = new Map() // mounted desk name → its memory folder
  // The kit, bound once for this composed desk (its shared files / terminal / preview / plan), under the desk's own.
  // practice: each agent's standing orders in its own desk's memory folder (a mounted desk's agents: that desk's).
  const kit = builtinKit({ memory: ctx.memory, practiceStore: (agent) => practiceStore(agent, () => memories.get(owners.get(agent.name)) ?? ctx.memory), workflowSource: workflowSource(root, () => ctx.memory, builtin.workflowPlugins), ...builtin })
  const owns = new Map() // desk folder → its tools/ catalogue
  const toolFiles = new Map() // tool name → the file that defines it (desks' tools/, agents' tools.js): one each
  const o = { deskRoot: resolve(deskRoot ?? dirname(root)), tools: { ...kit.tools, ...tools }, kitTools: kit.tools, kit: kit.artifacts, artifacts: artifactTypes(ctx.memory, artifacts, kit.artifacts), vars, models, defaultModel, maxSteps, owners, memories, owns, toolFiles, memoryRoot: ctx.memory ? dirname(ctx.memory) : null }
  const spec = await deskSpec(root, o, [basename(root)])
  // The outermost desk's teams/ (checked against its catalogue, as its lead's agents are): what agent.spawn {template}
  // builds at run time.
  const templates = readTemplates(root, { ...o, own: owns.get(root) ?? {}, deskName })
  // env.tools / env.artifacts: the names agent.spawn resolves at run time (the outermost desk's catalogue: its own
  // tools/, the host's, the kit; its artifact types, the kit's shared instances among them); env.templates its teams;
  // env.models the model names a spawn may ask for (none given: any).
  const desk = buildDesk(spec, { infer, context: ctx, tools: { ...o.tools, ...(owns.get(root) ?? {}) }, artifacts: o.artifacts, templates, models: models ? Object.keys(models) : undefined })
  for (const agent of desk.list) {
    const own = owners.get(agent.name)
    if (memories.has(own)) agent.context = { ...ctx, desk: own, memory: memories.get(own) }
  }
  return desk
}

// What a convention desk's main.js default-exports: the desk named after its folder, composed from its lead's folder
// and tools/ (composeDesk), its models the host's local CLIs with fallbacks. artifacts: the desk's own artifact types
// ({type: (agent, spec) => Artifact}; one named like a kit type replaces it — e.g. files: BUILTIN.artifacts.files({
// adapter}) for its own workspace adapter); tools: a catalogue after tools/ (then the kit); builtin: the kit's desk
// options (clock, the files tree's first root). start({infer}) takes a stub model (tests).
//   export default conventionDesk({ title: "My desk", description: "what it is for" })
// init (2026-10-20 owner: "Every desk will have the agents, any specific tools, an initialization method which will
// help us initialize any of the dependencies or write in a script and then return a desk object which will be run by
// the framework"): async ({dir, memory, log, host, port}) → awaited at every start before the agents are built — make
// folders, write a script into data/, check a dependency; a throw fails the start (desks/load keeps the old version).
export function conventionDesk({ name, title, description = "", port, models = MODELS, defaultModel = "opus", fallbacks = ["sonnet"], maxSteps, artifacts = {}, tools = {}, builtin, init } = {}) {
  return ({ dir }) => {
    const deskName = name ?? basename(dir)
    return defined({
      name: deskName,
      title: title ?? deskName,
      description,
      port,
      // Its compose options: a desk that mounts this one composes its subtree with them (and scripts/desk.js check).
      compose: defined({ models, defaultModel, fallbacks, maxSteps, artifacts, tools, builtin }),
      start: async ({ port: at = port, log = () => {}, memory = null, infer } = {}) => {
        if (typeof init === "function") await init({ dir, memory, log, host: at ? hostClient({ port: at, desk: deskName }) : null, port: at })
        infer ??= withFallbacks(llmInfer({ models, fallback: defaultModel, port: at, desk: deskName }), { defaultModel, fallbacks, log })
        const desk = await composeDesk({ folder: dir, name: deskName, port: at, infer, models, defaultModel, maxSteps, artifacts, tools, builtin, context: { host: hostClient({ port: at, desk: deskName }), memory, log } })
        return { desk }
      },
    })
  }
}
