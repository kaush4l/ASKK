import { Artifact } from "../artifact/artifact.js"
import { clip, oneLine } from "../util/text.js"

// Ask (2026-10-27 goal: "Context-aware questions are answered from the code, the live state and what the owner sees
// (file:line and UI element) without a run"): "what is this?" answered now, with no model call. The pointed element's
// artifact resolves through the kernel's class registry (classes.js) to its class file and the line its class starts;
// its state now is its brief (the latest only); the question's key terms are looked up in that file and the kernel
// README (≤ HITS file:line in all). Id `ask`, view and kind `ask`, keep `day`. State {question, element: {artifact,
// view} | null, answer, cites: [{file, line, text}], at, revision}: one answer, the next replaces it.
//
// The owner asks from the UI (team/call {target: "artifact", method: "what", args: [{question, element}]}); an agent
// through ask.what. Options (the tests inject them; the defaults go through ctx.host):
//   registry(id, ctx, ask) → {name, file, about, brief} | null   default: the holders' artifacts and kernelClasses()
//   read(file, ctx) → text                                       default: the host's fs/read under `root`
//   search(terms, texts, ctx) → [{file, line, text}]             default: the lines of the files read that hold a term

const HITS = 5
const QUESTION = 500
const ANSWER = 700
const README = "backend/kernel/README.md"
const ID = /^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)*$/
const STOP = new Set(["what", "this", "that", "these", "those", "does", "with", "from", "where", "which", "when", "have", "there", "about", "into", "here", "show", "shows", "mean", "means", "work", "works", "why", "how", "the", "and", "for", "are", "can", "you", "its"])

// The question's words worth looking up (≥ 3 chars, not a stop word), the element's class name first; ≤ 6.
export function keyTerms(question, first = []) {
  const words = String(question ?? "").toLowerCase().match(/[a-z_][a-z0-9_.-]{2,}/g) ?? []
  return [...new Set([...first.filter(Boolean).map((s) => String(s).toLowerCase()), ...words.filter((w) => !STOP.has(w))])].slice(0, 6)
}

// The lines that hold a term, in file order: [{file, line, text}] ≤ max.
export function grep(texts, terms, max = HITS) {
  const hits = []
  if (!terms.length) return hits
  for (const [file, text] of texts) {
    const lines = String(text ?? "").split("\n")
    for (let i = 0; i < lines.length && hits.length < max; i++) {
      const low = lines[i].toLowerCase()
      if (terms.some((t) => low.includes(t))) hits.push({ file, line: i + 1, text: clip(lines[i].trim(), 160) })
    }
  }
  return hits
}

export const citeOf = (c) => (c.line ? `${c.file}:${c.line}` : c.file)

function elementOf(raw) {
  if (raw == null || raw === "") return null
  const e = typeof raw === "string" ? { artifact: raw } : raw
  const artifact = String(e.artifact ?? e.id ?? "").trim()
  if (!ID.test(artifact)) throw new Error(`element.artifact: the pointed artifact's id (talk, goal, dev…), not "${clip(artifact, 40)}"`)
  return { artifact, view: e.view ? clip(oneLine(e.view), 40) : null }
}

async function hostRead(root, file, ctx) {
  if (!ctx.host) throw new Error("no host to read through")
  const path = root ? `${root}/${file}` : file
  const r = await ctx.host.get(`fs/read?path=${encodeURIComponent(path)}`, { signal: ctx.signal })
  return typeof r === "string" ? r : r?.text ?? r?.content ?? ""
}

// The desk's artifact of that id, among the asker's and every holder's, with its class's file from kernelClasses().
async function liveRegistry(id, ctx, ask) {
  const agents = [ctx.agent, ...ask.holders].filter(Boolean)
  const a = agents.flatMap((g) => g.artifacts ?? []).find((x) => x.id === id)
  if (!a) return null
  const { kernelClasses } = await import("../classes.js")
  const name = a.constructor.name
  const file = kernelClasses().kinds.find((k) => k.name === name)?.file ?? null
  return { name, file: file && !file.startsWith("backend/") ? `backend/kernel/${file}` : file, about: a.constructor.about ?? "", brief: a.brief?.() ?? "" }
}

export class Ask extends Artifact {
  static about = "\"what is this?\" answered now, no run: the pointed element's class file:line, its state now and the code lines the question names — the latest answer only"
  static commandType = "artifact"
  static commands = {
    what: { description: "answer \"what is this?\" now, with no run: the pointed artifact's class file:line, its state now and up to 5 code lines the question names — one answer, the next replaces it", input: { question: `at most ${QUESTION} chars ("what is this?")`, element: "the UI element pointed at: {artifact: its id, view?} or the id (optional)" } },
  }
  static owner = { what: "what" }
  static ownerCan = "ask what something is"

  constructor({ id = "ask", title, clock = () => new Date(), root = "", registry = liveRegistry, read = null, search = null } = {}) {
    super({ name: id, title: title ?? (id === "ask" ? "ask — what is this?" : `${id} — ask`) })
    Object.assign(this, { kind: "ask", view: "ask", keep: "day" })
    this.clock = clock
    this.root = root // the host path the code is read under (compose.js binds it to the ASKK repo)
    this.registry = registry
    this.read = read ?? ((file, ctx) => hostRead(root, file, ctx))
    this.search = search ?? ((terms, texts) => grep(texts, terms))
    this.holders = new Set()
    this.host = null
    this.state = { question: null, element: null, answer: null, cites: [], at: null, revision: 0 }
  }

  attach(agent) {
    this.holders.add(agent)
  }

  detach(agent) {
    this.holders.delete(agent)
  }

  #known() {
    return [...new Set([...this.holders].flatMap((g) => (g.artifacts ?? []).map((a) => a.id)))]
  }

  // The owner's call comes without a ctx: it reads through the host an agent's call brought, else a holder's.
  #host(ctx) {
    if (ctx.host) this.host = ctx.host
    return ctx.host ?? this.host ?? [...this.holders].find((g) => g.context?.host)?.context.host ?? null
  }

  async what(input = {}, ctx = {}) {
    const question = oneLine(input.question ?? input.text ?? "")
    if (!question) throw new Error('question: what you ask ("what is this?")')
    if (question.length > QUESTION) throw new Error(`question: at most ${QUESTION} chars`)
    const element = elementOf(input.element)
    const c = { ...ctx, host: this.#host(ctx) }
    const found = element ? await this.registry(element.artifact, c, this) : null
    if (element && !found) throw new Error(`element: no artifact "${element.artifact}" on this desk (it holds ${this.#known().join(", ") || "none known"})`)
    // A read that fails is said in the answer ("could not read <file>: <reason>"), never taken for an empty file.
    const misses = []
    const readOr = async (file) => {
      if (!file) return ""
      try {
        return String((await this.read(file, c)) ?? "")
      } catch (error) {
        misses.push(`could not read ${file}: ${clip(oneLine(error?.message ?? String(error)), 120)}`)
        return ""
      }
    }
    const texts = []
    const cites = []
    if (found?.file) {
      const text = await readOr(found.file)
      if (text) texts.push([found.file, text])
      const at = text ? text.split("\n").findIndex((l) => l.includes(`class ${found.name} `)) : -1
      cites.push({ file: found.file, line: at >= 0 ? at + 1 : null, text: at >= 0 ? clip(text.split("\n")[at].trim(), 160) : `class ${found.name}` })
    }
    const readme = await readOr(README)
    if (readme) texts.push([README, readme])
    const terms = keyTerms(question, found ? [found.name] : [])
    const hits = (await this.search(terms, texts, c)).filter((h) => !cites.some((x) => x.file === h.file && x.line === h.line))
    cites.push(...hits.slice(0, HITS - cites.length))
    const what = found ? `${found.name} (${element.artifact}${element.view ? `, view ${element.view}` : ""})${found.about ? `: ${found.about}` : ""}. Now: ${found.brief || "no state yet"}. Its class: ${citeOf(cites[0])}.` : ""
    const code = hits.length ? `The code on ${terms.join(", ")}: ${hits.slice(0, HITS).map(citeOf).join(", ")}.` : `No line in ${texts.map(([f]) => f).join(", ") || "the code read"} holds ${terms.join(", ") || "its words"}.`
    const answer = clip([what, code, ...misses.map((m) => `${m}.`)].filter(Boolean).join(" "), ANSWER)
    this.bump({ question, element, answer, cites, at: this.clock().toISOString() })
    return `${answer}\n${cites.map((x) => `  ${citeOf(x)}: ${x.text}`).join("\n")}`
  }

  brief() {
    if (!this.state.answer) return "nothing asked yet"
    return `${clip(this.state.question, 40)} → ${clip(this.state.answer, 60)}`
  }

  render(agent) {
    const can = this.can(agent)
    const head = `"what is this?" answered now, no run${can.length ? `: ${can.join(", ")}` : ""}`
    if (!this.state.answer) return `${head}\nnothing asked yet`
    return `${head}\nQ: ${this.state.question}\nA: ${this.state.answer}`
  }
}
