// Agent definitions are data, loaded at startup from public/agents/:
//
//   agents/
//     index.json          ["assistant", "researcher", ...]  (folders, in order)
//     soul.md             shared character every agent carries
//     <name>/agent.md     frontmatter definition + Markdown instructions
//     <name>/soul.md      optional per-agent soul (opt in with `soul: soul.md`)
//
// agent.md (askk style):
//   ---
//   name: researcher
//   description: ...
//   response_format: toon        (toon | json)
//   tools: [web.read, notes.read]
//   artifacts: [filesystem]      live objects rendered into the prompt
//                                (features/index.js); each brings its commands
//   model: local-anthropic       optional key in the model catalogue
//                                (models/catalog.js); omitted = the default model
//   ---
//   Instructions...
//
// The LocalAgents style (a fenced ```json definition first) is also accepted.

import { splitFrontmatter } from "@/backend/agents/frontmatter"
import { validKey } from "@/backend/models/catalog"
import { withBase } from "@/backend/platform/base-path"

const AGENTS_BASE = withBase("/agents/")
const RESPONSE_FORMATS = ["toon", "json"]

const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
const safeName = (value) =>
  typeof value === "string" &&
  /^[a-z][a-z0-9._-]*$/i.test(value) &&
  !["__proto__", "constructor", "prototype"].includes(value)

function splitDefinition(markdown) {
  const fenced = markdown.match(/^\s*```json\s*\n([\s\S]*?)\n```\s*\n?/)
  if (fenced) return { data: JSON.parse(fenced[1]), body: markdown.slice(fenced[0].length).trim() }
  return splitFrontmatter(markdown)
}

export function parseAgent(markdown) {
  const { data, body } = splitDefinition(markdown)
  return validateAgent({
    tools: [],
    artifacts: [],
    agents: [], // other agents this one may call as tools
    skills: {},
    strategy: "react",
    response_format: "toon",
    ...data,
    instructions: body,
  })
}

// Check a full definition (from a file or an edit). Returns it, or throws.
export function validateAgent(config) {
  if (
    !safeName(config.name) ||
    typeof config.description !== "string" ||
    !safeName(config.strategy) ||
    !Array.isArray(config.tools) ||
    !config.tools.every(safeName) ||
    !Array.isArray(config.artifacts ?? []) ||
    !(config.artifacts ?? []).every(safeName) ||
    !plain(config.skills) ||
    !Array.isArray(config.agents ?? []) ||
    !(config.agents ?? []).every((a) => safeName(a) && a !== config.name) ||
    !RESPONSE_FORMATS.includes(config.response_format) ||
    (config.soul !== undefined && typeof config.soul !== "string")
  ) {
    throw new Error(`Invalid agent definition${config.name ? `: ${config.name}` : ""}.`)
  }
  if (config.model != null && !validKey(config.model)) {
    throw new Error(`Agent ${config.name}: model must be a key from the model catalogue.`)
  }
  if (new Set(config.tools).size !== config.tools.length) {
    throw new Error(`Duplicate tool name in agent definition: ${config.name}.`)
  }
  if (typeof config.instructions !== "string" || !config.instructions.trim()) {
    throw new Error(`Agent ${config.name} needs instructions.`)
  }
  return { ...config, model: config.model ?? null, instructions: config.instructions.trim() }
}

export { RESPONSE_FORMATS }

async function read(url, { optional = false } = {}) {
  const response = await fetch(url)
  if (optional && response.status === 404) return null
  if (!response.ok) throw new Error(`Cannot load ${url.pathname}: HTTP ${response.status}`)
  return response.text()
}

// Load the shared soul and every agent in the manifest. Each agent gets its
// soul (own override or shared) and its skills' text.
export async function loadAgents() {
  const base = new URL(AGENTS_BASE, globalThis.location.origin)
  const folders = JSON.parse(await read(new URL("index.json", base)))
  if (!Array.isArray(folders) || !folders.every(safeName) || new Set(folders).size !== folders.length) {
    throw new Error("Invalid agents/index.json manifest.")
  }

  const sharedSoul = splitFrontmatter((await read(new URL("soul.md", base), { optional: true })) ?? "").body

  const agents = []
  for (const folder of folders) {
    const path = new URL(`${folder}/agent.md`, base)
    const agent = parseAgent(await read(path))
    if (agents.some((a) => a.name === agent.name)) throw new Error(`Duplicate agent: ${agent.name}`)

    // `soul: soul.md` in frontmatter opts into a per-agent soul; otherwise shared.
    const inside = (reference) => {
      const url = new URL(reference, path)
      if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
        throw new Error(`${reference} must be inside the agents folder.`)
      }
      return url
    }

    const soul = agent.soul ? splitFrontmatter(await read(inside(agent.soul))).body : sharedSoul

    const skills = {}
    for (const [name, reference] of Object.entries(agent.skills)) {
      skills[name] = (await read(inside(reference))).trim()
    }

    agents.push({ ...agent, folder, soul, skills })
  }
  return agents
}
