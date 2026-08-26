/** Schedule — run the agent on a goal, later and repeatedly.
 *
 * A job is an agent run, not a shell command. Scheduling one writes a line that
 * starts this project on the given goal and logs what it said — the goal being
 * the same sentence a person would type at the prompt, so a scheduled job wakes
 * with its whole toolkit and can browse, report, or schedule work of its own:
 *
 *     0 18 * * 1-5 cd /path && PATH=... python main.py 'check the build' \
 *         >> /path/agents/main/cron-build.log 2>&1 # agent-cron:build
 *
 * The marker comment is the whole safety story. A line without one was put
 * there by somebody else, so it is read, copied through untouched, and never
 * matched by a delete. A write replaces the whole file, so every edit here
 * means "read every line, change the one that is mine, write them all back" —
 * and if the read fails for any reason other than an empty crontab, nothing is
 * written at all. Rewriting a file we could not see is how other people's jobs
 * disappear.
 *
 * The crontab binary is not in here (PORT-MAP R8): the rules port, the backing store
 * does not. `ports.cron` is `readLines`/`writeLines`, and the adapters are
 * `core/ports/cron-host.js` (the real `crontab`), `cron-browser.js` (a `schedule.json`
 * and a ticker), and `cron-memory.js`, which is what the tests run on — which is what
 * the Python's `AGENT_CRONTAB` variable existed for.
 */

import { reason, tool } from "./tool-call.js"

/** @typedef {import("./ports.js").CronPort} CronPort */
/** @typedef {import("./ports.js").FsPort} FsPort */
/** @typedef {(name: string, goal: string) => string} Launch  builds one line's command */
/** @typedef {{ cron: CronPort, launch: Launch, fs: FsPort }} Deps */
/** @typedef {{ name: string, schedule: string, command: string, goal: string }} Job */

export const MARKER = "# agent-cron:"
const NAME_PATTERN = /^[A-Za-z0-9_-]+$/
const SHORTCUTS = ["@reboot", "@yearly", "@annually", "@monthly", "@weekly", "@daily", "@midnight", "@hourly"]

// The launch line's shape and the pattern that reads it back are one constant
// apart on purpose: move the entry point and the goal stops parsing.
const ENTRY_POINT = "main.py"

// A scheduled run is the main agent waking up, so its output belongs in that
// agent's folder. One file per job, and not log.txt: that is a transcript the
// engine parses back into turns, and this is a program's stdout.
const AGENT_DIR = "agents/main"

/** Where a job's output lands, workspace-relative: the redirect's target, and the one path both launch builders spell. @param {string} name @returns {string} */
const logPath = (name) => `${AGENT_DIR}/cron-${name}.log`

// Pulls the goal back out of a line we wrote: it is the argument after the entry
// point and before the redirect. We generate these, so the shape is known.
const GOAL_PATTERN = new RegExp(`${ENTRY_POINT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(.+?)\\s+>>`)

/** POSIX single-quoting — `shlex.quote`, which JS has none of. @param {string} value @returns {string} */
export function shellQuote(value) {
  const text = String(value)
  return text !== "" && /^[A-Za-z0-9@%+=:,./_-]+$/.test(text) ? text : `'${text.split("'").join(`'"'"'`)}'`
}

/** The first shell word of `text`, null on unbalanced quotes. Enough of `shlex.split` to
 * read back a line we wrote: our own quoting never emits a bare backslash, so nothing
 * here interprets one. @param {string} text @returns {string | null} */
function firstWord(text) {
  let word = "", quote = "", started = false
  for (const c of text) {
    if (quote) quote = c === quote ? "" : ((word += c), quote)
    else if (c === "'" || c === '"') (quote = c), (started = true)
    else if (/\s/.test(c)) { if (started) return word }
    else (word += c), (started = true)
  }
  return quote ? null : word
}

/** The goal inside a launch line, or empty if it is not one of ours. @param {string} command @returns {string} */
export function goalOf(command) {
  const match = GOAL_PATTERN.exec(command)
  // firstWord gives null on unbalanced quotes — hand back nothing rather than guess
  return (match && firstWord(match[1] ?? "")) || ""
}

/** Break up a line this module wrote. Anything else gives null — it belongs to somebody
 * else, and that is what keeps it out of every edit. @param {string} line @returns {Job | null} */
export function managed(line) {
  const at = line.indexOf(MARKER)
  if (at < 0) return null
  const fields = line.slice(0, at).split(/\s+/).filter(Boolean)
  const count = fields[0]?.startsWith("@") ? 1 : 5
  if (fields.length <= count) return null
  const command = fields.slice(count).join(" ")
  const name = line.slice(at + MARKER.length).trim()
  return { name, schedule: fields.slice(0, count).join(" "), command, goal: goalOf(command) }
}

/** The line a store with no shell writes: a page has no working directory and no PATH,
 * so it claims neither. @type {Launch} */
export function defaultLaunch(name, goal) {
  return `${ENTRY_POINT} ${shellQuote(goal)} >> ${shellQuote(logPath(name))} 2>&1`
}

/** The host's launch line: wake the agent on `goal` and record what it said.
 *
 * cron runs with almost no environment, so PATH is captured here rather than
 * inherited — without it the agent starts but every tool that shells out (npx
 * for the MCP servers, above all) fails at the moment nobody is watching. That
 * is why it lives in the *host* builder: the browser adapter has no shell to
 * lose a PATH to. The environment is an argument; the core may not read one.
 * @param {{ project: string, executable: string, path?: string, pathSeparator?: string }} env @returns {Launch} */
export function hostLaunchLine(env) {
  const separator = env.pathSeparator ?? ":"
  const seen = [...new Set((env.path ?? "").split(separator).filter(Boolean))]
  const head = `cd ${shellQuote(env.project)} && PATH=${shellQuote(seen.join(separator))} ${shellQuote(env.executable)}`
  const log = (/** @type {string} */ name) => shellQuote(`${env.project}/${logPath(name)}`)
  return (name, goal) => `${head} ${ENTRY_POINT} ${shellQuote(goal)} >> ${log(name)} 2>&1`
}

/** Empty when this is safe to put in the file, otherwise why it is not. @param {string} name @param {string} schedule @param {string} goal @returns {string} */
export function reasonNotToWrite(name, schedule, goal) {
  if (!NAME_PATTERN.test(name || "")) return "name must be letters, digits, dashes or underscores"
  for (const [label, value] of [["schedule", schedule], ["goal", goal]]) {
    const text = String(value ?? "")
    if (!text.trim()) return `${label} is required`
    // A newline would forge a second crontab entry; the marker would forge ownership.
    if (text.includes("\n") || text.includes(MARKER)) return `${label} must be one line and must not contain '${MARKER}'`
  }
  const fields = String(schedule).split(/\s+/).filter(Boolean)
  const first = fields[0] ?? ""
  if (first.startsWith("@") && (!SHORTCUTS.includes(first) || fields.length > 1)) return `'${first}' is not a cron shortcut; use one of: ${[...SHORTCUTS].sort().join(", ")}`
  if (!first.startsWith("@") && fields.length !== 5) return `schedule needs 5 fields — minute hour day month weekday — but got ${fields.length}`
  return ""
}

/** @param {Deps} d @returns {Promise<string>} */
export async function listCronJobs(d) {
  /** @type {Job[]} */ const jobs = []
  try { for (const line of await d.cron.readLines()) { const job = managed(line); if (job) jobs.push(job) } }
  catch (e) { return `Could not read the schedule: ${reason(e)}` }
  if (jobs.length === 0) return "No scheduled jobs."
  return jobs.map((job) => `${job.name}: ${job.schedule} — ${job.goal || job.command}`).join("\n")
}

/** @param {Deps} d @param {string} name @param {string} schedule @param {string} goal @returns {Promise<string>} */
export async function createCronJob(d, name, schedule, goal) {
  const refusal = reasonNotToWrite(name, schedule, goal)
  if (refusal) return `Not scheduled: ${refusal}`
  try {
    const lines = await d.cron.readLines()
    if (lines.some((line) => managed(line)?.name === name)) return `A job named '${name}' already exists. Use update_cron_job to change it.`
    // The line ends `>> agents/main/cron-<name>.log 2>&1`, and a redirect into a directory that
    // does not exist fails at the moment nobody is watching. Appending nothing makes the file and
    // its parents. Here rather than in the cron adapter, because this is the only place that knows
    // where the redirect points, and `writeLines` also runs for update and for delete.
    await d.fs.append(logPath(name), "")
    await d.cron.writeLines([...lines, `${schedule} ${d.launch(name, goal)} ${MARKER}${name}`])
  } catch (e) { return `Could not schedule '${name}': ${reason(e)}` }
  return `Scheduled '${name}': ${schedule} — the agent will run on '${goal}'.`
}

/** @param {Deps} d @param {string} name @param {string} schedule @param {string} goal @returns {Promise<string>} */
export async function updateCronJob(d, name, schedule, goal) {
  if (!String(schedule).trim() && !String(goal).trim()) return "Nothing to change: give a new schedule, a new goal, or both."
  let newSchedule = "", newGoal = ""
  try {
    const lines = await d.cron.readLines()
    const index = lines.findIndex((line) => managed(line)?.name === name)
    const current = index < 0 ? null : managed(lines[index] ?? "")
    if (!current) return `No job named '${name}'. Use list_cron_jobs to see what is scheduled.`
    newSchedule = String(schedule).trim() || current.schedule
    newGoal = String(goal).trim() || current.goal
    const refusal = reasonNotToWrite(name, newSchedule, newGoal)
    if (refusal) return `Not changed: ${refusal}`
    // Keep whatever the line already ran when the goal is not ours to rewrite.
    const command = current.goal || goal ? d.launch(name, newGoal) : current.command
    lines[index] = `${newSchedule} ${command} ${MARKER}${name}`
    await d.cron.writeLines(lines)
  } catch (e) { return `Could not change '${name}': ${reason(e)}` }
  return `Updated '${name}': ${newSchedule} — the agent will run on '${newGoal}'.`
}

/** @param {Deps} d @param {string} name @returns {Promise<string>} */
export async function deleteCronJob(d, name) {
  try {
    const lines = await d.cron.readLines()
    const kept = lines.filter((line) => managed(line)?.name !== name)
    if (kept.length === lines.length) return `No job named '${name}'. Use list_cron_jobs to see what is scheduled.`
    await d.cron.writeLines(kept)
  } catch (e) { return `Could not remove '${name}': ${reason(e)}` }
  return `Removed '${name}'.`
}

/** The four tools, in the model's vocabulary: the names stay the Python's snake_case because
 * agent.md files list them by name, and the descriptions are its docstrings. @param {Deps} d @returns {ReturnType<typeof tool>[]} */
export function cronTools(d) {
  const args = '{"name": "<name>", "schedule": "<schedule>", "goal": "<goal>"}'
  return [
    tool("list_cron_jobs", "List the scheduled agent runs, each with its timing and the goal it runs on.", "{}", () => listCronJobs(d)),
    tool("create_cron_job", "Schedule the agent to run on a goal repeatedly. Schedule is 5 cron fields, e.g. '30 9 * * 1-5'.", args, (a) => createCronJob(d, a.name, a.schedule, a.goal)),
    tool("update_cron_job", "Change a scheduled job's timing, its goal, or both. Leave one blank to keep it as it is.", args, (a) => updateCronJob(d, a.name, a.schedule ?? "", a.goal ?? "")),
    tool("delete_cron_job", "Remove one scheduled job by name. Only jobs scheduled through these tools can be removed.", '{"name": "<name>"}', (a) => deleteCronJob(d, a.name)),
  ]
}
