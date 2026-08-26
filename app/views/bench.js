/** Bench — the four things that configure this page, edited where they live.
 *
 * Every one is a file in OPFS reached through the fs port, so the Bench shows what the
 * next worker will read. Three are the same shape — pick, edit, validate, write — so
 * they are one editor with two validators; the fourth is the schedule, read-only here
 * because a job is written by the agent's own cron tools. **An unparseable file is
 * never written**: the refusal names its line and the text stays in the box, because
 * the one thing a config editor may not do is discard what somebody typed. And a save
 * never claims more than it did — an agent already running keeps what it booted with.
 */

// The stylesheet rides in as a module import: bun folds it into the page's one
// <link> at build time, which is the only way a view that main.js loads with a
// dynamic import can bring its own CSS without editing app/index.html.
import "./bench.css"
import { el } from "../dom.js"
import { parseAgentFile } from "../../core/frontmatter.js"
import { MODELS_FILE } from "../../core/inference.js"
import { AGENTS_DIR, BUILTIN_DIR } from "../../core/registry.js"
import { SKILLS_DIR, SKILL_FILE } from "../../core/skills.js"
import { MISSED, schedulePanel } from "./schedule.js"

/** @typedef {import("../../core/ports.js").FsPort} FsPort */
/** @typedef {{ id: string, label: string, note: string, extra?: string, split: boolean, paths: (fs: FsPort) => Promise<string[]>, add?: (name: string) => { path: string, text: string } }} Panel */
/** @typedef {{ path: string, select: HTMLSelectElement, problem: HTMLElement, said: HTMLElement, areas: HTMLTextAreaElement[] }} Ui */

const CORS = "A browser can only reach a model server that sends CORS headers. Most local servers — llama.cpp, LM Studio, vLLM, omlx — do not until you start them with cross-origin access turned on, and the request is refused before it ever reaches your model: the page gets a network error with no body. If you point base_url at your own server and nothing happens, check that first."
const CACHED = "Saving rewrites the file. It does not re-point an agent that is already running: every worker reads this catalogue once, when it boots, and memoises it on top of that. Rebuild agents, at the top of this screen, is what makes a saved edit take."

/** Every `<dir>/<name>/<file>` under these directories. @param {FsPort} fs @param {string[]} dirs @param {string} file @returns {Promise<string[]>} */
async function folders(fs, dirs, file) {
  /** @type {string[]} */ const found = []
  for (const dir of dirs)
    for (const entry of await fs.list(dir)) {
      const name = entry.endsWith("/") ? entry.slice(0, -1) : ""
      if (name && (await fs.exists(`${dir}/${name}/${file}`))) found.push(`${dir}/${name}/${file}`)
    }
  return found
}
/** Both spellings `core/skills.js` accepts: a folder holding a SKILL.md, or a bare `<name>.md`. @param {FsPort} fs @returns {Promise<string[]>} */
async function skillPaths(fs) {
  const bare = (await fs.list(SKILLS_DIR)).filter((e) => e.endsWith(".md")).map((e) => `${SKILLS_DIR}/${e}`)
  return [...(await folders(fs, [SKILLS_DIR], SKILL_FILE)), ...bare]
}
/** @type {Panel[]} */
export const PANELS = [
  { id: "agents", label: "Agents", split: true, paths: (fs) => folders(fs, [AGENTS_DIR, BUILTIN_DIR], "agent.md"),
    note: "The frontmatter and the body are parsed separately, so they are edited separately: above is the configuration, below is the system instructions the model reads. Saving writes the file; the worker booted from the old text, so use Rebuild agents at the top of this screen to build it again from what is now on disk." },
  { id: "models", label: "Models", split: false, paths: async () => [MODELS_FILE], note: CORS, extra: CACHED },
  { id: "skills", label: "Skills", split: true, paths: skillPaths,
    note: "A skill is a SKILL.md with a name and a description in its frontmatter. The description is what the model reads when it decides whether to load the skill, so write it as when to use this rather than as what this is.",
    add: (name) => ({ path: `${SKILLS_DIR}/${name}/${SKILL_FILE}`, text: `---\nname: ${name}\ndescription: Use when …\n---\n` }) },
]

/** Empty when this text may be written, otherwise why it may not — with the line it is on,
 * because `JSON.parse` reports a character position and a person counts lines.
 * @param {Panel} panel @param {string} path @param {string} text @returns {string} */
export function problemWith(panel, path, text) {
  try {
    if (panel.split) parseAgentFile(text, path)
    else JSON.parse(text)
    return ""
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const at = panel.split ? null : /position (\d+)/.exec(message)
    return at ? `line ${text.slice(0, Number(at[1])).split("\n").length}: ${message}` : message
  }
}

/** The two blocks a file is parsed as. No fence means it is all body, which is what the parser refuses on save. @param {string} text @returns {[string, string]} */
export function halves(text) {
  const fence = text.startsWith("---") ? text.slice(3).indexOf("\n---") : -1
  return fence === -1 ? ["", text] : [text.slice(3, fence + 3).replace(/^\n/, "").trimEnd(), text.slice(fence + 7).trimStart()]
}
/** Show one file. @param {Ui} ui @param {Panel} panel @param {FsPort} fs @param {string} want @returns {Promise<void>} */
async function openInto(ui, panel, fs, want) {
  ui.path = want
  ui.problem.textContent = want ? "" : "Nothing of this kind is in the workspace yet."
  ui.said.textContent = ""
  ui.select.value = want
  const text = want ? ((await fs.read(want)) ?? "") : ""
  const [head, body] = panel.split ? halves(text) : [text, ""]
  ui.areas.forEach((area, i) => { area.value = i === 0 ? head : body })
}
/** Write it back, or say why it was not written and change nothing. @param {Ui} ui @param {Panel} panel @param {FsPort} fs @returns {Promise<void>} */
async function saveFrom(ui, panel, fs) {
  if (!ui.path) return
  const [head, body] = ui.areas.map((area) => area.value)
  const text = panel.split ? `---\n${head}\n---\n\n${body ?? ""}\n` : head
  const refusal = problemWith(panel, ui.path, text)
  ui.said.textContent = ""
  ui.problem.textContent = refusal ? `Not saved — ${refusal}` : ""
  if (refusal) return
  await fs.write(ui.path, text)
  ui.said.textContent = `Saved ${ui.path}. Agents already running keep what they booted with; Rebuild agents builds them again.`
}
/** One editable kind of file: a picker, the boxes, the refusal, and Save.
 * @param {Panel} panel @param {FsPort} fs @returns {{ element: HTMLElement, refresh: (want?: string) => Promise<void> }} */
export function editor(panel, fs) {
  const labels = panel.split ? ["frontmatter", "body"] : [panel.label.toLowerCase()]
  const areas = labels.map((_, i) => /** @type {HTMLTextAreaElement} */ (el("textarea", { rows: panel.split && i === 0 ? "8" : "18", spellcheck: "false", wrap: "off" })))
  /** @type {Ui} */
  const ui = { path: "", areas, problem: el("p", { class: "problem", role: "alert" }),
    said: el("p", { class: "said", role: "status", "aria-live": "polite" }),
    select: /** @type {HTMLSelectElement} */ (el("select", { class: "picker" })) }
  const refresh = async (/** @type {string | undefined} */ want) => {
    const paths = await panel.paths(fs)
    ui.select.replaceChildren(...paths.map((one) => el("option", { value: one }, [one])))
    ui.select.disabled = paths.length < 2
    await openInto(ui, panel, fs, want && paths.includes(want) ? want : (paths[0] ?? ""))
  }
  const save = el("button", { type: "button", class: "save" }, ["Save"])
  save.addEventListener("click", () => void saveFrom(ui, panel, fs))
  ui.select.addEventListener("change", () => void openInto(ui, panel, fs, ui.select.value))
  const element = el("div", { class: "editor" }, [
    el("p", { class: "note" }, [panel.note]), ...(panel.extra ? [el("p", { class: "note note-warn" }, [panel.extra])] : []),
    el("div", { class: "bar" }, [el("label", { class: "picker-label" }, ["File", ui.select]), ...(panel.add ? [adder(panel, fs, refresh, ui.problem)] : [])]),
    ...labels.map((label, i) => el("label", { class: "field" }, [el("span", { class: "field-label" }, [label]), areas[i]])),
    ui.problem, el("div", { class: "bar" }, [save, ui.said]),
  ])
  return { element, refresh }
}
/** Make a new file of this kind, refusing a name the workspace already holds rather than
 * opening an editor over somebody's skill. @param {Panel} panel @param {FsPort} fs
 * @param {(want?: string) => Promise<void>} refresh @param {HTMLElement} problem @returns {HTMLElement} */
function adder(panel, fs, refresh, problem) {
  const input = /** @type {HTMLInputElement} */ (el("input", { type: "text", class: "new", placeholder: "new-skill-name" }))
  const button = el("button", { type: "button" }, ["Add"])
  button.addEventListener("click", () => void (async () => {
    const name = input.value.trim()
    const made = /^[A-Za-z0-9_-]+$/.test(name) ? panel.add?.(name) : null
    if (!made) return void (problem.textContent = "A name holds letters, digits, dashes and underscores, and cannot be empty.")
    if (await fs.exists(made.path)) return void (problem.textContent = `${made.path} already exists — pick it from the list to edit it.`)
    await fs.write(made.path, made.text)
    await refresh(made.path)
  })())
  return el("label", { class: "picker-label" }, ["New", input, button])
}

/** Rebuild every agent from what is on disk now — the one action on this screen
 * that is not a file write, and the only thing that makes a saved edit take
 * without a page reload. It says what it costs before it costs it: the
 * transcript belongs to the engine being closed, and closing it ends it.
 * @param {any} runtime @returns {HTMLElement} */
function rebuild(runtime) {
  const said = el("p", { class: "said", role: "status", "aria-live": "polite" })
  const button = /** @type {HTMLButtonElement} */ (el("button", { type: "button", class: "save" }, ["Rebuild agents"]))
  button.addEventListener("click", () => void (async () => {
    button.disabled = true
    said.textContent = "Rebuilding — this ends the current transcript."
    try {
      const names = await runtime.restart()
      said.textContent = `Rebuilt ${names.length} agent(s) from the workspace: ${names.join(", ")}.`
    } catch (error) {
      said.textContent = `Not rebuilt — ${error instanceof Error ? error.message : String(error)}. The old agents are gone; reload the page.`
    }
    button.disabled = false
  })())
  return el("div", { class: "bar" }, [button, said])
}

/** @type {(() => void)[]} */
let off = []
/** @param {HTMLElement} host @param {unknown} runtimeIn @returns {Promise<void>} */
export async function mount(host, runtimeIn) {
  const runtime = /** @type {any} */ (runtimeIn)
  MISSED.length = 0
  const editors = PANELS.map((panel) => editor(panel, runtime.ports.fs))
  const schedule = schedulePanel(runtime)
  const section = (/** @type {string} */ label, /** @type {HTMLElement} */ body) => el("section", { class: "panel" }, [el("h2", {}, [label]), body])
  host.replaceChildren(
    el("header", { class: "head" }, [el("h1", {}, ["Bench"]),
      el("p", { class: "lede" }, ["Every one of these is a file in the workspace, read by the next worker that boots. Nothing is written until it parses."]),
      rebuild(runtime)]),
    ...PANELS.map((panel, i) => section(panel.label, editors[i].element)), section("Schedule", schedule.element),
  )
  off.push(runtime.on("error", (/** @type {any} */ event) => {
    if (event?.kind !== "missed-job") return
    MISSED.push({ name: String(event.name), runs: Number(event.runs), since: String(event.since) })
    void schedule.refresh()
  }))
  for (const one of editors) await one.refresh("")
  if (runtime.status === "cold") await runtime.start().catch(() => {})
  await schedule.refresh()
}
/** @returns {void} */
export function unmount() {
  for (const stop of off) stop()
  off = []
}
