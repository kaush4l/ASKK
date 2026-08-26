/** Skills — folders of instructions the agent can choose to read.
 *
 *     const skills = await loadSkills(fs)   // every SKILL.md under skills/, sorted by name
 *     catalog(skills)                       // name + description lines — the menu
 *     loaded(select(skills, names))         // the chosen ones, full bodies
 *
 * A skill on disk is `skills/<name>/SKILL.md`: YAML frontmatter naming and
 * describing it, markdown body telling the model what to do — the same shape as
 * Claude Code skills, so a skill written for one can be dropped into the other.
 * Reference files may sit beside the SKILL.md; a skill simple enough to need no
 * folder may also be a bare `skills/<name>.md`.
 *
 * The two components built here are the two halves of progressive disclosure.
 * `catalog` renders only names and descriptions — one cheap line per skill, so
 * the selector phase can choose without paying for bodies it will not use.
 * `loaded` renders the chosen bodies in full, and from then on they ride along
 * in every phase. The model may also choose nothing: an empty selection is a
 * first-class outcome, and both components vanish from the prompt when empty.
 *
 * Loading never breaks the agent. A folder with no SKILL.md, unreadable YAML, a
 * missing name — each costs that one skill a warning and its place in the list,
 * never the startup. The skills folder is content, and content written by hand
 * will sometimes be wrong; the agent should lose the broken skill, not the run.
 */

import { LoadedSkills, SkillCatalog } from "./components.js";
import { parseAgentFile } from "./frontmatter.js";

/**
 * @typedef {import("./ports.js").FsPort} FsPort
 */

/**
 * Where a warning goes. The Python reached for `logging.getLogger(__name__)`;
 * a pure core owns no logger, so it arrives like everything else environmental
 * and defaults to silence.
 * @typedef {{ warn: (message: string) => void }} SkillLog
 */

/** @type {SkillLog} */
const NO_LOG = { warn: () => {} };

/** Relative to the workspace the fs port is rooted at — the port has no notion of a package directory. */
export const SKILLS_DIR = "skills";

export const SKILL_FILE = "SKILL.md";

/** One loaded skill: what it is called, when to use it, what it says. */
export class Skill {
  /**
   * @param {object} fields
   * @param {string} fields.name
   * @param {string} fields.description
   * @param {string} fields.body the full markdown after the frontmatter
   * @param {string[]} [fields.tools] toolbox names kept active while this skill is loaded
   * @param {string} fields.path where it came from — for logs, and for reference files beside it
   */
  constructor({ name, description, body, tools = [], path }) {
    /** @type {string} */
    this.name = name;
    /** @type {string} */
    this.description = description;
    /** @type {string} */
    this.body = body;
    /** @type {string[]} */
    this.tools = tools;
    /** @type {string} */
    this.path = path;
  }
}

/**
 * Every skill under `directory` (default `skills/`), sorted by name.
 *
 * Two spellings are accepted: `<dir>/<name>/SKILL.md` for a skill with a
 * folder of its own, and a bare `<dir>/<name>.md` for one without reference
 * files. A missing folder returns an empty list — no skills is a normal state
 * for a fresh project, not an error.
 *
 * @param {FsPort} fs
 * @param {string} [directory]
 * @param {SkillLog} [log]
 * @returns {Promise<Skill[]>}
 */
export async function loadSkills(fs, directory = SKILLS_DIR, log = NO_LOG) {
  /** @type {Skill[]} */
  const skills = [];
  // The fs port marks a directory child with a trailing slash, which is the
  // only thing standing in for `Path.is_dir()` — this contract has no `stat`.
  for (const entry of await fs.list(directory)) {
    const isDirectory = entry.endsWith("/");
    const name = isDirectory ? entry.slice(0, -1) : entry;
    const here = `${directory}/${name}`;
    let path = here;
    if (isDirectory) {
      path = `${here}/${SKILL_FILE}`;
      if (!(await fs.list(here)).includes(SKILL_FILE)) {
        log.warn(`Skipping skill folder ${here}: no ${SKILL_FILE} inside`);
        continue;
      }
    } else if (!name.endsWith(".md")) {
      continue; // stray files next to the skills are not skills
    }

    const skill = await readSkill(fs, path, log);
    if (skill) skills.push(skill);
  }

  return skills.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * One SKILL.md as a Skill, or null with a warning — never an exception.
 *
 * The frontmatter parser is the agent-file one: same fence rules, same
 * errors, one place where "YAML between two ---" is defined.
 *
 * @param {FsPort} fs
 * @param {string} path
 * @param {SkillLog} log
 * @returns {Promise<Skill | null>}
 */
async function readSkill(fs, path, log) {
  /** @type {{ metadata: Record<string, unknown>, body: string }} */
  let parsed;
  try {
    const text = await fs.read(path);
    // Python caught OSError and ValueError by name; across fs adapters there is
    // no such taxonomy here, and every failure to read or parse means the same
    // thing to the caller anyway — this one skill is gone, the load is not.
    if (text === null) throw new Error(`no such file: ${path}`);
    parsed = parseAgentFile(text, path);
  } catch (error) {
    log.warn(`Skipping skill ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }

  const name = String(parsed.metadata.name ?? "").trim();
  const description = String(parsed.metadata.description ?? "").trim();
  if (!name || !description) {
    log.warn(`Skipping skill ${path}: frontmatter needs 'name' and 'description'`);
    return null;
  }

  const declared = parsed.metadata.tools;
  const tools = Array.isArray(declared) ? declared.map((tool) => String(tool)) : [];
  return new Skill({ name, description, body: parsed.body, tools, path });
}

/**
 * The skills the model chose, in catalog order. Unknown names are logged and dropped.
 *
 * The names come from an LLM reply, so a misspelling is expected traffic —
 * it costs that one choice a warning, never the phase.
 *
 * @param {Skill[]} skills
 * @param {string[]} names
 * @param {SkillLog} [log]
 * @returns {Skill[]}
 */
export function select(skills, names, log = NO_LOG) {
  const known = new Set(skills.map((skill) => skill.name));
  const unknown = names.filter((name) => !known.has(name));
  if (unknown.length > 0) log.warn(`Dropping unknown skill name(s): ${unknown.join(", ")}`);
  const chosen = new Set(names.filter((name) => known.has(name)));
  return skills.filter((skill) => chosen.has(skill.name));
}

// ── the components ───────────────────────────────────────────────────────

/**
 * Names and descriptions only — what the selector phase gets to see.
 * @param {Skill[]} skills
 * @returns {SkillCatalog}
 */
export function catalog(skills) {
  return new SkillCatalog({ entries: skills.map((skill) => [skill.name, skill.description]) });
}

/**
 * The chosen skills in full, each under its own heading.
 * @param {Skill[]} skills
 * @returns {LoadedSkills}
 */
export function loaded(skills) {
  return new LoadedSkills({ bodies: skills.map((skill) => `### SKILL: ${skill.name}\n\n${skill.body.trim()}`) });
}
