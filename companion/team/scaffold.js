// A desk written from a spec (2026-10-20 owner: "we want to give this desk create capable tool as a default agent. Now
// for any kind of desk setup, it should be simple enough to request it and the agent figuring out the good ways of
// creating the desk"). The kit's desk.create (backend/kernel/builtin/desks.js) posts a spec to the host's desks/create;
// this writes the desk in the standard's shape (docs/standard.md) — main.js (a convention desk with its init), agents/
// (the lead, its members as subfolders, each agent's practice.md: its first checklist, quality bar and instructions),
// teams/ (templates its lead may staff), tools/ (empty: the desk starts on the kit), README.md — checks that it composes,
// and only then puts it in place. Its memory (reports, practice, retros) goes to memory/<desk>/ when it runs.
//
// No code an agent wrote is ever written here: main.js comes from one template with the spec's values as JSON, and
// tool code an agent wants goes to proposed/tools/ (proposeTool) — the owner moves a file into tools/ to accept it.
//
//   scaffoldDesk({root, name, spec, by, update})  → {folder, written, check}; refused (400/409) before anything is
//                                                  written, or (422) when the draft does not compose — nothing left behind
//   checkDesk(folder, {name})                     → {name, lead, tree, tools, templates} (scripts/desk.js check's answer)
//   proposeTool({root, name, file, code, why, by}) → {path}
//
// spec: {title, description, request?, model?, max_steps?, folders?: [workspace folders init makes],
//        lead: AGENT, teams?: [AGENT (a template: its members too)]}
// AGENT: {name, description, role, goal?, title?, model?, max_steps?, writes?, reads?, board?, tools?, artifacts?,
//         practice?: {checklist?, quality?, instructions?}, members?: [AGENT]}

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"

import { renderPractice } from "../../backend/kernel/index.js"
import { composeDesk, DESK_NAME, forgetModules, MODELS, readDeskConfig } from "./compose.js"

export const CREATE_MARK = "// made by desk.create"
const AGENT_NAME = /^[a-z][a-z0-9-]{1,30}$/
const FOLDER = /^[a-z0-9][a-z0-9._-]{0,40}(\/[a-z0-9][a-z0-9._-]{0,40}){0,3}$/
const MAX_AGENTS = 24
const fail = (status, message) => Object.assign(new Error(message), { status })
// Text that goes in a // comment: one line, whatever line terminator it carried (2026-10-20 review: a title with \r or
// U+2028 ended main.js's first comment, and the rest ran as code when the draft was composed).
const oneLine = (v) => String(v ?? "").replace(/[\r\n\u2028\u2029]+/g, " ")
const stepsOk = (v) => v == null || (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 300)
// A desk folder that is the folder itself, not a link out of the desks folder (desks/load refuses links too).
const ownFolder = (root, name) => realpathSync(join(root, name)) === join(realpathSync(root), name)
// Desks being written now, in this process: a second create or update of one waits for none — it is refused.
const writing = new Set()
const yaml = (v) => JSON.stringify(v)
const lines = (v) => (v == null ? [] : Array.isArray(v) ? v : String(v).split("\n")).map((x) => String(x).replace(/^\s*[-*]\s+/, "").trim()).filter(Boolean)
const names = (v) => (v == null ? [] : Array.isArray(v) ? v : String(v).split(",")).map((x) => (typeof x === "string" ? x.trim() : x)).filter((x) => x !== "")

// One agent (and its members) checked: names, roles, the fields a desk's agent.md takes.
function checkAgent(a, where, seen) {
  if (!a || typeof a !== "object") throw fail(400, `${where}: an agent is {name, description, role, …}`)
  const name = String(a.name ?? "").trim()
  if (!AGENT_NAME.test(name)) throw fail(400, `${where}: name ${JSON.stringify(a.name ?? null)} — lowercase letters, digits and -, 2–31 chars, starting with a letter`)
  if (seen.has(name)) throw fail(400, `${where}: agent name ${name} twice (names are unique across a desk)`)
  seen.add(name)
  if (seen.size > MAX_AGENTS) throw fail(400, `at most ${MAX_AGENTS} agents in a desk: start small, the lead spawns helpers when it needs them`)
  if (!String(a.role ?? "").trim()) throw fail(400, `${where} (${name}): role is required — what it is for and how it works (its agent.md body)`)
  if (!String(a.description ?? "").trim()) throw fail(400, `${where} (${name}): description is required — one line: what it is for (its card, its line in its lead's TOOLS)`)
  if (a.desks != null) throw fail(400, `${where} (${name}): desks: a created desk mounts no other desk`)
  if (a.model != null && !Object.hasOwn(MODELS, String(a.model).trim())) throw fail(400, `${where} (${name}): model ${JSON.stringify(a.model)} — one of ${Object.keys(MODELS).join(", ")}`)
  if (!stepsOk(a.max_steps)) throw fail(400, `${where} (${name}): max_steps ${JSON.stringify(a.max_steps)} — a whole number from 1 to 300`)
  for (const [k, sub] of (a.members ?? []).entries()) checkAgent(sub, `${where}.members[${k}]`, seen)
  return name
}

function agentMd(a, { lead = false } = {}) {
  const head = [`name: ${a.name}`, `description: ${yaml(String(a.description).trim())}`]
  if (a.title) head.push(`title: ${yaml(String(a.title))}`)
  if (a.goal) head.push(`goal: ${yaml(String(a.goal))}`)
  if (a.model) head.push(`model: ${String(a.model).trim()}`)
  if (a.max_steps != null) head.push(`max_steps: ${Number(a.max_steps)}`)
  if (a.writes != null) head.push(`writes: ${yaml(names(a.writes))}`)
  if (a.reads != null) head.push(`reads: ${yaml(names(a.reads))}`)
  if (a.board === false && !lead) head.push("board: false")
  head.push(`tools: ${yaml(names(a.tools))}`)
  head.push(`artifacts: ${yaml(names(a.artifacts))}`)
  if (a.members?.length) head.push(`agents: ${yaml(a.members.map((m) => m.name))}`)
  return `---\n${head.join("\n")}\n---\n${String(a.role).trim()}\n`
}

// Every file of the desk, by its path in the desk folder.
// compose: the import specifier of companion/team/compose.js from the desk folder ("../../companion/team/compose.js" for
// custom/<name>/).
export function deskFiles(name, spec, { by = null, at = new Date().toISOString(), compose = "../../companion/team/compose.js" } = {}) {
  const files = {}
  const put = (base, a, opts) => {
    files[`${base}/agent.md`] = agentMd(a, opts)
    const p = a.practice ?? {}
    const seed = { checklist: lines(p.checklist), quality: lines(p.quality), instructions: lines(p.instructions) }
    if (seed.checklist.length || seed.quality.length || seed.instructions.length) files[`${base}/practice.md`] = renderPractice(seed, a.name)
    for (const m of a.members ?? []) put(`${base}/${m.name}`, m)
  }
  put(`agents/${spec.lead.name}`, spec.lead, { lead: true })
  for (const t of spec.teams ?? []) put(`teams/${t.name}`, t)
  const folders = names(spec.folders)
  const request = String(spec.request ?? "").trim()
  files["main.js"] = [
    `${CREATE_MARK} (${oneLine(by ?? "an agent")}, ${oneLine(at.slice(0, 16))}): ${oneLine(spec.title ?? name)}`,
    "// A convention desk (docs/standard.md): agents/ (its lead and members, each agent's practice.md), teams/ (templates its",
    "// lead may staff), tools/ (its own: none yet — proposed/tools/ holds what an agent asked for; the owner moves one in),",
    `// init (below). Its memory — reports, each agent's practice and retros — is memory/${name}/. desk.create {update} rewrites`,
    "// this file and agents/ while this mark heads it; edit it by hand and remove the mark to keep it yours.",
    "",
    'import { mkdirSync } from "node:fs"',
    'import { join } from "node:path"',
    `import { conventionDesk } from ${JSON.stringify(compose)}`,
    "",
    `const FOLDERS = ${JSON.stringify(folders)}`,
    "",
    "export default conventionDesk({",
    `  title: ${JSON.stringify(String(spec.title ?? name))},`,
    `  description: ${JSON.stringify(String(spec.description ?? ""))},`,
    `  defaultModel: ${JSON.stringify(String(spec.model ?? "opus"))},`,
    ...(spec.max_steps != null ? [`  maxSteps: ${Number(spec.max_steps)},`] : []),
    "  // init: before its agents are built, every start — the workspace folders they work in.",
    "  init: async ({ dir }) => {",
    '    for (const folder of FOLDERS) mkdirSync(join(dir, "data", folder), { recursive: true })',
    "  },",
    "})",
    "",
  ].join("\n")
  const tree = (a, depth = 0) => [`${"  ".repeat(depth)}- ${a.name} — ${String(a.description).trim()}`, ...(a.members ?? []).flatMap((m) => tree(m, depth + 1))]
  files["README.md"] = [
    `# ${spec.title ?? name}`,
    "",
    String(spec.description ?? "").trim(),
    "",
    `Made by desk.create (${by ?? "an agent"}, ${at.slice(0, 10)})${request ? ` from the request: "${request.split("\n")[0].slice(0, 300)}"` : ""}.`,
    "",
    "## Agents",
    "",
    ...tree(spec.lead),
    ...((spec.teams ?? []).length ? ["", "## Team templates (agent.spawn {template})", "", ...spec.teams.flatMap((t) => tree(t))] : []),
    "",
    "## Run",
    "",
    "```bash",
    `bun run send -- --agents custom/${name} --wait "<what you want>"`,
    "```",
    "",
    `Load into the running server: POST /__askk/desks/load {"name": "${name}"} (the kit's desk.load). Check: bun scripts/desk.js check custom/${name}.`,
    `Memory: memory/${name}/ (reports/, practice/<agent>.md — the standing orders each agent improves —, retros/).`,
    "",
  ].join("\n")
  return files
}

// What a desk folder composes to, with a stub model and no host: nothing runs.
export async function checkDesk(folder, { name } = {}) {
  const config = await readDeskConfig(folder)
  const c = config.compose ?? {}
  const infer = async () => JSON.stringify({ thought: "check", calls: [], answer: "check only" })
  const desk = await composeDesk({ folder, name: name ?? config.name, infer, ...c })
  const tools = Object.fromEntries([...desk.agents().values()].map((a) => [a.name, [...a.tools.keys()]]))
  const team = (t, prefix = null) => {
    const n = prefix ? `${prefix}-${t.name}` : t.name
    return { name: n, tools: t.tools, artifacts: t.artifacts, members: (t.members ?? []).map((m) => team(m, n)) }
  }
  const templates = Object.fromEntries(Object.entries(desk.ctx.env.templates ?? {}).map(([k, t]) => [k, team(t)]))
  return { name: name ?? config.name ?? desk.lead.name, lead: desk.lead.name, tree: desk.twin().tree, tools, templates }
}

export async function scaffoldDesk({ root, name, spec, by = null, update = false, clock = () => new Date() }) {
  if (typeof name !== "string" || !DESK_NAME.test(name)) throw fail(400, `name: a desk's folder name (${DESK_NAME}), e.g. "research-desk"`)
  if (!spec || typeof spec !== "object") throw fail(400, "spec: {title, description, lead: {name, description, role, …}, teams?, folders?}")
  if (!spec.lead) throw fail(400, "spec.lead is required: the desk's lead agent {name, description, role, goal, tools, artifacts, practice, members?}")
  checkAgent(spec.lead, "lead", new Set())
  const teamNames = new Set()
  for (const [k, t] of (spec.teams ?? []).entries()) {
    if (teamNames.has(t?.name)) throw fail(400, `teams[${k}]: team ${t.name} twice`)
    teamNames.add(checkAgent(t, `teams[${k}]`, new Set()))
  }
  if (spec.model != null && !Object.hasOwn(MODELS, spec.model)) throw fail(400, `model ${spec.model}: one of ${Object.keys(MODELS).join(", ")}`)
  if (!stepsOk(spec.max_steps)) throw fail(400, `max_steps ${JSON.stringify(spec.max_steps)}: a whole number from 1 to 300`)
  for (const f of names(spec.folders)) if (!FOLDER.test(f)) throw fail(400, `folders: ${JSON.stringify(f)} — a workspace path of lowercase words (data/<it>), e.g. "notes" or "sources/raw"`)
  const folder = join(root, name)
  const main = join(folder, "main.js")
  if (existsSync(folder)) {
    if (!update) throw fail(409, `custom/${name}/ exists: pick another name, or update: true to rewrite a desk desk.create made`)
    if (!ownFolder(root, name)) throw fail(403, `custom/${name}/ is a link: never written through`)
    if (!existsSync(main) || !readFileSync(main, "utf8").startsWith(CREATE_MARK)) throw fail(409, `custom/${name}/ was not made by desk.create (or its owner removed the mark): it is the owner's — never rewritten here`)
  } else if (update) throw fail(404, `custom/${name}/ does not exist: create it (update: false)`)

  if (writing.has(name)) throw fail(409, `custom/${name}/ is being written by another desk.create now: try again when it is done`)
  writing.add(name)
  try {
    return await writeDesk({ root, name, spec, by, update, clock, folder })
  } finally {
    writing.delete(name)
  }
}

async function writeDesk({ root, name, spec, by, update, clock, folder }) {
  const at = clock().toISOString()
  // From the real folder (main.js is imported by its real path: a /var → /private/var link would break the specifier).
  const compose = relative(join(realpathSync(root), name), join(realpathSync(import.meta.dir), "compose.js")).split("\\").join("/")
  const files = deskFiles(name, spec, { by, at, compose: compose.startsWith(".") ? compose : `./${compose}` })
  // The draft beside the desks (main.js imports ../../companion/…): composed before anything is put in place.
  const draftName = `.draft-${name}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
  const draft = join(root, draftName)
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(draft, path)), { recursive: true })
      writeFileSync(join(draft, path), text)
    }
    mkdirSync(join(draft, "tools"), { recursive: true })
    if (update && existsSync(join(folder, "tools"))) cpSync(join(folder, "tools"), join(draft, "tools"), { recursive: true })
    let check
    try {
      check = await checkDesk(draft, { name })
    } catch (error) {
      const real = realpathSync(root)
      throw fail(422, `the desk does not compose — nothing written: ${error.message.replaceAll(join(real, draftName), `custom/${name}`).replaceAll(draft, `custom/${name}`)}`)
    } finally {
      forgetModules(draft)
    }
    // In place: a new desk whole; an update rewrites main.js, README.md, agents/ and teams/ files (its state, data,
    // transcripts and tools stay; a kept helper's agent.md — its spawner's — stays too).
    if (update) {
      const walk = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : d.name === "agent.md" || d.name === "practice.md" ? [join(dir, d.name)] : [])) : [])
      const keptMd = (f) => {
        const md = f.replace(/practice\.md$/, "agent.md")
        return existsSync(md) && /^keep: desk$/m.test(readFileSync(md, "utf8").split("\n---")[0])
      }
      const going = [...walk(join(folder, "agents")), ...walk(join(folder, "teams"))].filter((f) => !keptMd(f))
      // An agent the new spec drops whose folder holds kept helpers: they would never be respawned (kernel-team reads
      // kept helpers under loaded agents only) — refused, nothing written.
      const staying = new Set(Object.keys(files).filter((p) => p.endsWith("/agent.md")).map((p) => dirname(join(folder, p))))
      for (const f of going.filter((g) => g.endsWith("agent.md") && !staying.has(dirname(g)))) {
        const kept = walk(dirname(f)).filter((k) => k !== f && k.endsWith("agent.md") && keptMd(k))
        if (kept.length) throw fail(409, `${relative(folder, dirname(f))} holds kept helpers (${kept.map((k) => relative(dirname(f), dirname(k))).join(", ")}): keep that agent in the spec, or dismiss them first — nothing written`)
      }
      for (const f of going) rmSync(f, { force: true })
    }
    for (const [path, text] of Object.entries(files)) {
      const to = join(folder, path)
      mkdirSync(dirname(to), { recursive: true })
      const tmp = `${to}.${process.pid}.tmp`
      writeFileSync(tmp, text)
      renameSync(tmp, to)
    }
    mkdirSync(join(folder, "tools"), { recursive: true })
    mkdirSync(join(folder, "data"), { recursive: true })
    return { folder, written: Object.keys(files).sort(), check }
  } finally {
    rmSync(draft, { recursive: true, force: true })
  }
}

// Tool code an agent wants for a desk: written to proposed/tools/<file>.js with why, never into tools/ (code under
// tools/ runs as the desk server once loaded: the owner accepts a proposal by moving it there).
export function proposeTool({ root, name, file, code, why, by = null, clock = () => new Date() }) {
  if (typeof name !== "string" || !DESK_NAME.test(name)) throw fail(400, "name: the desk's folder name")
  const folder = join(root, name)
  if (!existsSync(join(folder, "main.js"))) throw fail(404, `no desk custom/${name}/`)
  if (!ownFolder(root, name)) throw fail(403, `custom/${name}/ is a link: never written through`)
  const base = String(file ?? "").trim().replace(/\.js$/, "")
  if (!/^[a-z][a-z0-9-]{0,40}$/.test(base)) throw fail(400, `file: a tool file's name, e.g. "notes" (proposed/tools/notes.js)`)
  if (!String(code ?? "").trim()) throw fail(400, "code: the tool file (export default defineTool({...}), docs/standard.md)")
  if (!String(why ?? "").trim()) throw fail(400, "why: what the desk cannot do without it")
  const dir = join(folder, "proposed", "tools")
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${base}.js`)
  writeFileSync(path, `// proposed by ${oneLine(by ?? "an agent")} at ${clock().toISOString().slice(0, 16)} — not loaded: the owner moves it to tools/ to accept it.\n// why: ${oneLine(why).slice(0, 600)}\n${String(code)}\n`)
  return { path: `custom/${name}/proposed/tools/${base}.js` }
}
