/**
 * SKILLS — instruction the model pulls in when it needs it, and not before.
 *
 * A skill is a named piece of reusable instruction: frontmatter saying what it
 * is FOR, and a body that is the instruction itself. The point is context
 * economy — the description is cheap and always visible through `list_skills`,
 * and the body costs nothing until `read_skill` puts it in the window.
 *
 * A SKILL RUNS NOTHING. Both tools are total functions of text this build
 * fetched at boot: no port, no capability, nothing a skill's author could make
 * happen. That is why they are here and not behind a capability — a build could
 * not be assembled without whatever `read_skill` needs, because it needs
 * nothing.
 *
 * THE FILES ARE FETCHED AND NOT COMPILED IN, which is the one thing the Rust
 * got wrong and said so: `include_str!` meant a skill edited and redeployed
 * needed a rebuild to reach a running page, and a skill authored in the browser
 * was unreachable forever. `adapters-web/files.js` reads them the same way it
 * reads an agent file, through the same manifest convention.
 * @module
 */

import { arg, tool, unquote } from '@harness/agent'

import { answered, nameArg } from './runner.js'

/** @typedef {import('./app.js').ToolRun} ToolRun */

/** @typedef {{name: string, description: string, body: string}} Skill */

/** I15, in the words the tool says when there is nothing to say. Never an empty list dressed as a result. */
export const NO_SKILLS = 'No skills are installed in this browser.'

/** The descriptors. Both say plainly that they run nothing, because a model that thinks `read_skill` might act will not spend a round on it. */
export const SKILL_DESCRIPTORS = [
  tool({
    name: 'list_skills',
    description: 'the skills installed in this browser: each one\'s name and what it is for. A skill is written instruction you can pull in when a job calls for it, and listing is cheap',
    args: [],
  }),
  tool({
    name: 'read_skill',
    description: 'read one skill\'s instruction into this conversation by name, then follow it for the rest of the turn. It runs nothing and changes nothing — the result is text',
    args: [arg('name', 'string', 'the skill, as list_skills spells it')],
  }),
]

/**
 * `skill.md` → a skill, or WHY NOT.
 *
 * Read here rather than by the agent-file reader, which refuses any key outside
 * an agent's own set: a skill declares two keys and is not an agent file, and
 * borrowing that reader would make the two files one vocabulary that has to
 * agree forever.
 *
 * A missing `description` is REFUSED and never defaulted: the description is
 * the whole basis on which a model decides to load a skill, and one that cannot
 * say what it is for cannot be chosen deliberately. An empty body is refused
 * for the blunter reason that there is no instruction to load.
 * @param {string} dir the folder, which names the skill unless the frontmatter does
 * @param {string} text
 * @returns {Skill|{problem: string}}
 */
export function parseSkill(dir, text) {
  const rest = text.startsWith('---') ? text.slice(3) : null
  if (rest === null) return { problem: `${dir} does not start with '---', so it has no frontmatter to say what it is for` }
  const end = rest.indexOf('\n---')
  if (end < 0) return { problem: `${dir} opens its frontmatter and never closes it with a '---' line` }
  const keys = fields(rest.slice(0, end))
  const name = (keys.name ?? '').trim() || dir
  const description = (keys.description ?? '').trim()
  const body = rest.slice(end + 4).replace(/^[^\n]*\n?/, '').trim()
  if (description === '') return { problem: `${dir} declares no description, so nothing can say what it is for` }
  if (body === '') return { problem: `${dir} has an empty body, so there is no instruction to load` }
  return { name, description, body }
}

/** The `key: value` lines of a frontmatter block. Anything else is ignored — a skill's frontmatter is two keys, and a third is a note to a person. @param {string} block @returns {Record<string, string>} */
function fields(block) {
  /** @type {Record<string, string>} */
  const keys = {}
  for (const line of block.split('\n')) {
    const at = line.indexOf(':')
    if (at > 0) keys[line.slice(0, at).trim()] = unquote(line.slice(at + 1))
  }
  return keys
}

/**
 * The runners, over the skills this build actually loaded.
 * @param {readonly Skill[]} skills @returns {Record<string, ToolRun>}
 */
export function skillTools(skills) {
  return {
    list_skills: answered('list_skills', async () => ({ ok: true, output: catalogue(skills) })),
    read_skill: answered('read_skill', async (args) => instruction(skills, nameArg(args, 'name'))),
  }
}

/** The catalogue: one line per skill, cheap enough to hold always. @param {readonly Skill[]} skills */
export function catalogue(skills) {
  if (skills.length === 0) return NO_SKILLS
  const lines = skills.map((s) => `${s.name}: ${s.description}`).join('\n')
  return `INSTALLED SKILLS\n\n${lines}\n\nRead one with read_skill({"name": "<skill>"}) when it applies to what you are doing, then follow it.`
}

/**
 * One skill's instruction, or a refusal naming what IS here — which is why
 * deleting a skill cannot break the agent that asks for it: the turn carries on
 * with a result it can read.
 * @param {readonly Skill[]} skills @param {string} asked
 */
export function instruction(skills, asked) {
  if (asked === '') return { ok: false, output: 'read_skill needs a name. Call it as read_skill({"name": "<skill>"}).' }
  const found = skills.find((s) => s.name === asked)
  if (found) return { ok: true, output: `SKILL ${found.name} — ${found.description}\n\n${found.body}` }
  if (skills.length === 0) return { ok: false, output: `No skill called "${asked}". ${NO_SKILLS}` }
  return { ok: false, output: `No skill called "${asked}". Installed: ${skills.map((s) => s.name).join(', ')}` }
}
