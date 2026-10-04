// The skills catalogue: procedures kept out of the prompt until an agent
// needs them. Served as static files from public/skills/:
//
//   skills/
//     index.json          ["verification", ...]  (folders, in order)
//     <name>/SKILL.md     frontmatter (name, description) + Markdown body
//
// A static export cannot list a folder, so index.json names the skills.
// Private agent folders (--agents) may carry their own skills/ in the same
// layout, served by the local host; their skills join the catalogue (a
// private skill shadows a public one of the same name).
//
//   await listSkills()      [{ name, description }]  (cheap: the whole catalogue)
//   await loadSkill(name)   { name, description, body }
//
// Works on the main thread and in engine workers (plain fetch). Results are
// cached per thread; reloadSkills() drops the cache.

import { splitFrontmatter } from "@/backend/agents/frontmatter"
import { withBase } from "@/backend/platform/base-path"
import { detectHost } from "@/backend/platform/host"

const SKILLS_BASE = withBase("/skills/")
const SKILL_FILE = "SKILL.md"

const safeName = (value) => typeof value === "string" && /^[a-z0-9][a-z0-9._-]*$/i.test(value)

let catalogue = null // Promise<Map<name, { name, description, body }>>

async function read(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Cannot load ${url.pathname}: HTTP ${response.status}`)
  return response.text()
}

export function parseSkill(markdown, folder) {
  const { data, body } = splitFrontmatter(markdown)
  const name = data.name ?? folder
  if (!safeName(name)) throw new Error(`Skill ${folder}: invalid name.`)
  if (typeof data.description !== "string" || !data.description.trim()) {
    throw new Error(`Skill ${name} needs a description.`)
  }
  if (!body) throw new Error(`Skill ${name} has no instructions.`)
  return { name, description: data.description.trim(), body }
}

// One folder of skills; an absent index.json is an empty folder.
async function loadFolder(base, label) {
  const response = await fetch(new URL("index.json", base))
  if (response.status === 404) return []
  if (!response.ok) throw new Error(`Cannot load ${label}/index.json: HTTP ${response.status}`)
  const folders = await response.json()
  if (!Array.isArray(folders) || !folders.every(safeName) || new Set(folders).size !== folders.length) {
    throw new Error(`Invalid ${label}/index.json manifest.`)
  }
  const list = []
  for (const folder of folders) list.push(parseSkill(await read(new URL(`${folder}/${SKILL_FILE}`, base)), folder))
  return list
}

async function loadCatalogue() {
  const origin = globalThis.location.origin
  const host = await detectHost()
  const folders = [
    ...(host.sources ?? []).map(({ id, name }) => [new URL(withBase(`/__askk/sources/${id}/skills/`), origin), `${name}/skills`, true]),
    [new URL(SKILLS_BASE, origin), "skills", false],
  ]
  const skills = new Map()
  for (const [base, label, isPrivate] of folders) {
    for (const skill of await loadFolder(base, label)) {
      if (!skills.has(skill.name)) skills.set(skill.name, skill)
      else if (isPrivate) throw new Error(`Duplicate skill: ${skill.name}`)
    }
  }
  return skills
}

function skills() {
  catalogue ??= loadCatalogue().catch((error) => {
    catalogue = null // retry next time
    throw error
  })
  return catalogue
}

export async function listSkills() {
  return [...(await skills()).values()].map(({ name, description }) => ({ name, description }))
}

export async function loadSkill(name) {
  const skill = (await skills()).get(name)
  if (!skill) throw new Error(`No skill named "${name}".`)
  return skill
}

export function reloadSkills() {
  catalogue = null
}
