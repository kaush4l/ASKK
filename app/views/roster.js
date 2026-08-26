/** Roster — who is loaded, what each one is doing, and what it may call.
 *
 * The table is `core/state.js`'s snapshot, rendered. Nothing here decides a status:
 * the registry writes them as a turn begins and ends, and the runtime emits on every
 * write because a `working` that lasted 200ms is invisible to a poll.
 *
 * DESIGN §8: the six statuses must read apart **without colour**. Every row carries a
 * drawn mark — dashed, outlined, filled, half-filled, crossed, struck — the status
 * word itself, and a rule down its left edge; colour is the third carrier and never
 * the first. `idle` and `waiting` differ in who speaks next rather than in severity,
 * so the legend says that in words instead of leaving it to a hue.
 *
 * The two `core/` imports are friction, reported: the runtime projects the state
 * table, but nothing projects an agent's wiring, so the frontmatter is re-read here
 * with the core's own parser. Re-implementing that parse in a view would be the
 * interface computing what the core computes, which is worse.
 */

// The stylesheet rides in as a module import: bun folds it into the page's one
// <link> at build time, which is the only way a view that main.js loads with a
// dynamic import can bring its own CSS without editing app/index.html.
import "./roster.css"
import { parseAgentFile } from "../../core/frontmatter.js"
import { AGENTS_DIR, BUILTIN_DIR, CRITIC_AGENT, SUMMARIZER_AGENT, VERIFIER_AGENT } from "../../core/registry.js"

/** @typedef {import("../../core/state.js").AgentState} AgentState */
/** @typedef {{ subAgents: string[], calls: string[], meta: [string, string][], error: string }} Caps */

/** DESIGN §8, in the six sentences `core/state.js` documents them with. */
const STATUSES = [
  ["starting", "its worker exists, its agent is still being built"],
  ["idle", "loaded and doing nothing — nobody is waiting on it"],
  ["working", "inside a turn — inferring, running a tool, or summarising"],
  ["waiting", "it answered, and the next move is yours"],
  ["failed", "it did not load, or its last turn threw"],
  ["closed", "its worker is stopped"],
]
/** The three the registry attaches to everyone but themselves — nobody's tool. */
const REVIEWERS = [SUMMARIZER_AGENT, VERIFIER_AGENT, CRITIC_AGENT]

/** @param {string} tag @param {Record<string, string>} [attrs] @param {(Node | string)[]} [kids] @returns {HTMLElement} */
function el(tag, attrs = {}, kids = []) {
  const node = document.createElement(tag)
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value)
  node.append(...kids)
  return node
}

/** The clock the state table's `since` was written by; the host's would drift against a
 * page whose ports carry a different one. @returns {number} */
const now = () => (view?.runtime.ports.clock.now() ?? new Date()).getTime()
/** @param {number} ms @returns {string} */
function elapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`
}

/** @param {unknown} value @returns {string} */
const scalar = (value) =>
  Array.isArray(value) ? value.map(String).join(", ") : value !== null && typeof value === "object" ? JSON.stringify(value) : String(value)

/** @returns {HTMLElement} */
function legend() {
  return el("section", { class: "legend", "aria-label": "What each status means" },
    STATUSES.map(([status, meaning]) => el("div", { class: "legend-item" }, [
      el("span", { class: "mark", "data-status": status, "aria-hidden": "true" }),
      el("span", { class: "legend-word" }, [status]),
      el("span", { class: "legend-meaning" }, [meaning]),
    ])))
}

/** One agent's wiring, read back out of its own file. @param {any} fs @param {AgentState} row @param {Set<string>} loaded @returns {Promise<Caps>} */
async function readCaps(fs, row, loaded) {
  const path = `${row.builtin ? BUILTIN_DIR : AGENTS_DIR}/${row.name}/agent.md`
  /** @type {Caps} */ const caps = { subAgents: [], calls: [], meta: [], error: "" }
  try {
    const text = await fs.read(path)
    if (text === null) return { ...caps, error: `${path} is not there` }
    const { metadata } = parseAgentFile(text, path)
    const declared = Array.isArray(metadata.tools) ? metadata.tools.map(String) : []
    caps.subAgents = declared.filter((name) => loaded.has(name) && name !== row.name)
    caps.calls = declared.filter((name) => !caps.subAgents.includes(name))
    caps.meta = Object.entries(metadata).filter(([key]) => key !== "tools").map(([key, value]) => [key, scalar(value)])
  } catch (error) {
    caps.error = error instanceof Error ? error.message : String(error)
  }
  return caps
}
/** @param {string} label @param {string[]} names @param {string} empty @returns {HTMLElement} */
const group = (label, names, empty) =>
  el("div", { class: "cap" }, [
    el("h3", { class: "cap-label" }, [label]),
    names.length ? el("ul", { class: "cap-list" }, names.map((name) => el("li", { class: "bytes" }, [name]))) : el("p", { class: "cap-empty" }, [empty]),
  ])
/** @param {AgentState} row @param {Caps} caps @param {Set<string>} loaded @returns {HTMLElement} */
function capsPanel(row, caps, loaded) {
  const dir = row.builtin ? BUILTIN_DIR : AGENTS_DIR
  return el("div", { class: "caps" }, [
    ...(caps.error ? [el("p", { class: "caps-error", role: "alert" }, [caps.error])] : []),
    group("Sub-agents it may call", caps.subAgents, "None. It calls no other agent."),
    group("Tools it may call", caps.calls, "None declared in its tools list."),
    group("Attached to it by the registry", REVIEWERS.filter((name) => loaded.has(name) && name !== row.name), "None are loaded."),
    el("p", { class: "caps-note" }, [`Written in ${dir}/${row.name}/agent.md. A name in its tools list that is also a loaded agent becomes a sub-agent; every other name is looked up as a function or an MCP tool. The summarizer, the verifier and the critic are nobody's tool — the registry attaches them to every agent but themselves.`]),
    ...(caps.meta.length ? [el("dl", { class: "meta" }, caps.meta.flatMap(([key, value]) => [el("dt", { class: "bytes" }, [key]), el("dd", { class: "bytes" }, [value])]))] : []),
  ])
}

/** @param {AgentState} row @param {number} at @param {boolean} open @returns {HTMLElement} */
function rowFor(row, at, open) {
  const since = row.since instanceof Date ? row.since : new Date(row.since)
  const name = el("button", { type: "button", class: "name", "data-name": row.name, "aria-expanded": String(open), "aria-controls": `caps-${row.name}` },
    [el("span", { class: "bytes" }, [row.name]), el("span", { class: "chev", "aria-hidden": "true" })])
  return el("tr", { class: "row", "data-status": row.status }, [
    el("th", { scope: "row" }, [name]),
    el("td", { class: "origin" }, [row.builtin ? "built-in" : "project"]),
    el("td", { class: "status" }, [el("span", { class: "mark", "data-status": row.status, "aria-hidden": "true" }), el("span", { class: "status-word" }, [row.status])]),
    el("td", { class: "num bytes" }, [String(row.turns)]),
    el("td", { class: "num bytes", "data-since": String(since.getTime()) }, [elapsed(at - since.getTime())]),
    el("td", { class: "detail bytes" }, [row.detail || "—"]),
  ])
}

/** @type {{ host: HTMLElement, runtime: any, off: (() => void)[], timer: ReturnType<typeof setInterval> | 0, open: Set<string>, caps: Map<string, Caps> } | null} */
let view = null

/** Repaint the table. Few rows, and a diff would be a second model of the state table
 * living in the interface. @returns {void} */
function paint() {
  if (!view) return
  const rows = /** @type {AgentState[]} */ (view.runtime?.rows?.() ?? [])
  const loaded = new Set(rows.map((row) => row.name))
  const at = now()
  const count = view.host.querySelector(".count")
  if (count) count.textContent = rows.length ? `${rows.length} loaded — ${rows.map((row) => `${row.name} ${row.status}`).join(", ")}` : "none loaded yet"
  const body = view.host.querySelector("tbody.rows")
  if (!body) return
  body.replaceChildren(...rows.flatMap((row) => {
    const open = view?.open.has(row.name) ?? false
    const caps = view?.caps.get(row.name)
    const panel = el("tr", { class: "row-caps", id: `caps-${row.name}` },
      [el("td", { colspan: "6" }, [caps ? capsPanel(row, caps, loaded) : el("p", { class: "cap-empty" }, ["reading its agent file"])])])
    panel.hidden = !open
    return [rowFor(row, at, open), panel]
  }))
}

/** @param {string} name @returns {Promise<void>} */
async function toggle(name) {
  if (!view) return
  if (view.open.has(name)) view.open.delete(name)
  else view.open.add(name)
  paint()
  if (!view.open.has(name) || view.caps.has(name)) return
  /** @type {AgentState[]} */ const rows = view.runtime.rows()
  const row = rows.find((one) => one.name === name)
  if (!row) return
  view.caps.set(name, await readCaps(view.runtime.ports.fs, row, new Set(rows.map((one) => one.name))))
  paint()
}

/** Only the durations, once a second. Repainting the table under a reader's cursor to
 * advance a clock would close whatever they had open. @returns {void} */
function tick() {
  const at = now()
  for (const cell of view?.host.querySelectorAll("[data-since]") ?? []) cell.textContent = elapsed(at - Number(cell.getAttribute("data-since")))
}

/** @param {HTMLElement} host @param {unknown} runtimeIn @returns {Promise<void>} */
export async function mount(host, runtimeIn) {
  const runtime = /** @type {any} */ (runtimeIn)
  const head = el("tr", {}, ["Agent", "Origin", "Status", "Turns", "In status", "Detail"].map((label) => el("th", { scope: "col" }, [label])))
  const table = el("table", { class: "state" }, [el("thead", {}, [head]), el("tbody", { class: "rows" })])
  host.replaceChildren(
    el("header", { class: "head" }, [
      el("h1", {}, ["Roster"]),
      el("p", { class: "count", role: "status", "aria-live": "polite" }, ["none loaded yet"]),
      el("p", { class: "lede" }, ["One row per loaded agent, written by whichever worker changed something. Open a row for what that agent may call."]),
    ]),
    legend(), el("div", { class: "table-scroll" }, [table]),
  )
  view = { host, runtime, off: [], timer: 0, open: new Set(), caps: new Map() }
  table.addEventListener("click", (event) => {
    const button = /** @type {HTMLElement} */ (event.target).closest("button.name")
    if (button instanceof HTMLElement) void toggle(button.dataset.name ?? "")
  })
  view.off.push(runtime.on("state:change", paint))
  view.timer = setInterval(tick, 1000)
  paint()
  if (runtime.status === "cold") await runtime.start().catch(() => {})
  paint()
}

/** @returns {void} */
export function unmount() {
  for (const stop of view?.off ?? []) stop()
  if (view?.timer) clearInterval(view.timer)
  view = null
}
