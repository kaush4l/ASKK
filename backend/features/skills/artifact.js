// The skills artifact: what the agent knows how to do, one live view per
// engine.
//
// Rendered every step: the catalogue (name + one line on when each helps)
// and the full text of the skills this engine has loaded. Only the list of
// loaded skills is this engine's state; the skills themselves are shared
// (public/skills/, catalog.js).
//
//   skills.load({"names": ["verification", ...]})   add skills' text to the prompt
//   skills.unload({"names": ["verification"]})      drop them once the work is done
//
// agent.md `skillset: [a, b]` limits the catalogue (and what can be loaded) to
// those skills, so an agent's prompt lists only the procedures its job needs.

import { Artifact } from "@/backend/core/artifact"
import { Tool } from "@/backend/core/tool"
import { listSkills, loadSkill } from "@/backend/features/skills/catalog"

const MAX_LOADED = 6 // skills loaded at once
const MAX_SKILL_CHARS = 20000 // characters of one skill shown

export class SkillsArtifact extends Artifact {
  static type = "skills"
  static title = "SKILLS"

  catalogue = null // [{ name, description }] (latest refresh)
  catalogueError = null
  bodies = new Map() // loaded name -> body
  notes = [] // what changed on its own since the last step

  initialState() {
    return { loaded: [] } // skill names this engine has loaded, in the order loaded
  }

  async refresh() {
    try {
      const skillset = this.engine?.agent?.skillset
      const all = await listSkills()
      this.catalogue = Array.isArray(skillset) ? all.filter((s) => skillset.includes(s.name)) : all
      this.catalogueError = null
    } catch (error) {
      this.catalogueError = error.message
      return
    }
    const gone = []
    await Promise.all(
      this.state.loaded.map(async (name) => {
        try {
          this.bodies.set(name, (await loadSkill(name)).body)
        } catch {
          gone.push(name)
        }
      })
    )
    this.notes = gone.map((name) => `${name} was unloaded: it is no longer published.`)
    if (gone.length) this.setState({ loaded: this.state.loaded.filter((n) => !gone.includes(n)) })
  }

  render() {
    const lines = [
      `### ${this.constructor.title}`,
      "",
      "Procedures you can load before doing the kind of work they describe. " +
        'Load the ones that fit: skills.load({"names": ["<skill>", ...]}). Unload them when the work is done: skills.unload({"names": ["<skill>"]}).',
      "",
    ]
    for (const note of this.notes) lines.push(`Note: ${note}`)
    if (this.notes.length) lines.push("")

    lines.push("Available:")
    if (this.catalogueError) lines.push(`(unavailable: ${this.catalogueError})`)
    else if (!this.catalogue?.length) lines.push("(none published)")
    else {
      for (const { name, description } of this.catalogue) {
        lines.push(`- ${name}${this.state.loaded.includes(name) ? " [loaded]" : ""}: ${description}`)
      }
    }
    lines.push("")

    const loaded = this.state.loaded
    lines.push(`Loaded (${loaded.length} of ${MAX_LOADED}):${loaded.length ? "" : " none"}`)
    for (const name of loaded) {
      let body = this.bodies.get(name) ?? "(not loaded yet)"
      if (body.length > MAX_SKILL_CHARS) body = `${body.slice(0, MAX_SKILL_CHARS)}\n… (cut at ${MAX_SKILL_CHARS} characters)`
      lines.push("", `#### skill: ${name}`, body)
    }
    return lines.join("\n")
  }

  // Skill names from {"names": [...]} (a single string is accepted too).
  #names(names) {
    const list = typeof names === "string" ? [names] : names
    if (!Array.isArray(list) || !list.length || !list.every((n) => typeof n === "string" && n.trim())) {
      throw new Error('Expected {"names": ["skill-name", ...]}.')
    }
    return [...new Set(list.map((n) => n.trim()))]
  }

  // All or nothing: an unknown name or a full list loads none of them.
  async #load({ names }) {
    const wanted = this.#names(names)
    const skillset = this.engine?.agent?.skillset
    const outside = Array.isArray(skillset) ? wanted.filter((name) => !skillset.includes(name)) : []
    if (outside.length) throw new Error(`Not in your skillset: ${outside.join(", ")}. Yours: ${skillset.join(", ")}.`)
    const fresh = wanted.filter((name) => !this.state.loaded.includes(name))
    const already = wanted.filter((name) => this.state.loaded.includes(name))
    if (this.state.loaded.length + fresh.length > MAX_LOADED) {
      throw new Error(
        `At most ${MAX_LOADED} skills can be loaded; ${this.state.loaded.length} are loaded already. ` +
          "Unload ones that no longer help first."
      )
    }
    const skills = await Promise.all(fresh.map((name) => loadSkill(name)))
    for (const skill of skills) this.bodies.set(skill.name, skill.body)
    if (skills.length) this.setState({ loaded: [...this.state.loaded, ...skills.map((s) => s.name)] })
    const parts = []
    if (skills.length) parts.push(`Loaded ${skills.map((s) => s.name).join(", ")}. Their text is under Loaded in the SKILLS artifact.`)
    if (already.length) parts.push(`Already loaded: ${already.join(", ")}.`)
    return parts.join(" ")
  }

  async #unload({ names }) {
    const wanted = this.#names(names)
    const missing = wanted.filter((name) => !this.state.loaded.includes(name))
    if (missing.length) throw new Error(`Not loaded: ${missing.join(", ")}.`)
    for (const name of wanted) this.bodies.delete(name)
    this.setState({ loaded: this.state.loaded.filter((n) => !wanted.includes(n)) })
    return `Unloaded ${wanted.join(", ")}.`
  }

  commands() {
    const namesInput = {
      type: "object",
      properties: {
        names: { type: "array", items: { type: "string", minLength: 1, maxLength: 80 }, minItems: 1, maxItems: MAX_LOADED },
      },
      required: ["names"],
      additionalProperties: false,
    }
    return [
      new Tool({
        name: "skills.load",
        description:
          "Load one or more skills before doing the kind of work they describe: their full text appears under " +
          "Loaded in the SKILLS artifact until you unload them.",
        inputs: namesInput,
        run: (inputs) => this.#load(inputs),
      }),
      new Tool({
        name: "skills.unload",
        description: "Unload skills you no longer need, to keep the context small.",
        inputs: namesInput,
        run: (inputs) => this.#unload(inputs),
      }),
    ]
  }
}
