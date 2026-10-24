// Local models (2026-10-23 owner: "We will have directory for the image, speech or other models we want to run locally …
// A helper will read and initialize as required … their parameters can be written in the md file that will be placed in
// the same folder … such that we change them and the state survives a restart"): one folder per model, one shape for
// every kind — the RealtimeSTT / RealtimeTTS idea of engines behind one pipeline, kept as configuration.
//
//   models/                         ASKK_MODELS moves it; git-ignored (local, never committed)
//     models.md                     the model chosen per kind (frontmatter `stt: apple`, `tts: say`, `image: …`)
//     <kind>/<name>/model.md        kind stt | tts | image: engine, how to run it, its options with defaults, `values:`
//     image/presets/<name>.md       image presets (size, steps, style …), applied by the studio's workflow
//     tts/styles/<name>.md          voice styles (2026-10-24 owner: "a change in narrative style where the background story,
//                                   the prelude story and the narrative story. With expressiveness … I will provide feedback
//                                   based on which the presets can be set"): frontmatter {title, about, use, model, voice?,
//                                   speed?, options?} — how a part of a script is voiced; the body — how to WRITE that part
//                                   (the writing guide the script writer follows); a [style: name] line in a script picks it
//
// A model.md's frontmatter:
//   kind, title, about, engine (apple | say | command | openai), install (a command line the owner runs), weights
//   (where they come from), default (seeded into a new models/ folder and used until the owner picks another), seed
//   (seeded beside the defaults, not chosen: 2026-10-24 owner — "For STT add parakeet and for TTS we should have the
//   kokoro, chatterbox and the defaults")
//   bin + args (+ inputs) or modes: {<mode>: {bin, args, inputs}} — engine command: a fixed program and argument list,
//     never a shell; `{name}` in an arg is filled from the call (audio, out, dir, text, prompt …) or an option's value;
//     `inputs: {name: flag}` adds `flag value` only when the call has that input (a list → flag v1 v2 …; "" = positional)
//   script (tts): how to write a script for it — plain prose or tags, what punctuation does, how emotion is carried, which
//     option steers the style (2026-10-24 owner: "Based on the TTS models capabilities, the model input format should be
//     hinted"); the audio artifact shows it to the agent that writes the script
//   stdin: text (engine command, tts): the text goes on stdin, never as an argument (a whole script)
//   split: paragraphs (tts): each paragraph its own call (a long one cut at sentence ends, ≤ split_chars, 300), joined
//     with a pause — for a model that loses its way on long input (Chatterbox skipped, repeated and invented lines)
//   lang_from_voice (engine command or openai, tts): the voice's first letter goes as lang_code (Kokoro's voices: a, b, e, f …)
//   url, model, key_env, serve: {bin, args} — engine openai: an OpenAI-compatible server (/v1/audio/transcriptions,
//     /v1/audio/speech), started by the helper when it does not answer and `serve` says how
//   output (stt command): stdout | json:<field> | file:<template>
//   progress (image): a regex whose (\d+)/(\d+) is the step bar
//   options: {name: {type: number | bool | choice | text, default, min?, max?, step?, choices?, flag?, about}}
//     `choices_from: apple-locales | say-voices` — the choices read from this Mac when the panel asks (the locales
//     Apple's recognizer supports, the installed `say` voices), never a list typed by hand
//     an option with `flag` goes on every call (bool: the flag alone when true; choice "none": left out)
//     engine openai: an option with `field` goes in every request under that name (Chatterbox's language as lang_code)
//   values: {name: value}  what the owner set in the panel — written back into this block, the rest of the file as it was
//
//   const models = loadModels({root})     → list(kind), get(kind, name), selected(kind), select, set, catalog(kind),
//                                            add(kind, name), presets(), ready(model), styles(), style(name),
//                                            setStyle(name, patch, why)

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { APP_ROOT } from "../shared/paths.js"
import { httpError } from "../shared/http.js"

export const KINDS = ["stt", "tts", "image"]
export const ENGINES = { stt: ["apple", "command", "openai"], tts: ["say", "command", "openai"], image: ["command"] }
const NAME = /^[a-z0-9][a-z0-9._-]{0,47}$/
const CATALOG = join(import.meta.dir, "catalog")
export const modelsRoot = (env = process.env) => resolve(APP_ROOT, env.ASKK_MODELS || "models")

// --- the md file -----------------------------------------------------------------------------------------------------

export function splitMd(text) {
  const m = String(text).match(/^---\n([\s\S]*?)\n?---\n?([\s\S]*)$/)
  if (!m) return { meta: {}, body: String(text) }
  let meta
  try {
    meta = Bun.YAML.parse(m[1]) ?? {}
  } catch (error) {
    throw new Error(`frontmatter: ${error.message}`)
  }
  if (typeof meta !== "object" || Array.isArray(meta)) throw new Error("frontmatter: not a map")
  return { meta, body: m[2] }
}

// The `values:` block rewritten in place (it moves to the end of the frontmatter); every other line kept as written.
export function writeValues(text, values) {
  const m = String(text).match(/^---\n([\s\S]*?)\n---(\n?[\s\S]*)$/)
  const lines = m ? m[1].split("\n") : []
  const out = []
  for (let i = 0; i < lines.length; i++) {
    if (/^values:/.test(lines[i])) {
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) i++
      continue
    }
    out.push(lines[i])
  }
  while (out.length && !out.at(-1).trim()) out.pop()
  const keys = Object.keys(values)
  out.push(keys.length ? "values:" : "values: {}", ...keys.map((k) => `  ${k}: ${JSON.stringify(values[k])}`))
  return `---\n${out.join("\n")}\n---${m ? m[2] : `\n${text}`}`
}

// --- options -----------------------------------------------------------------------------------------------------------

const TYPES = new Set(["number", "bool", "choice", "text"])
export const CHOICE_SOURCES = new Set(["apple-locales", "say-voices"])

function checkOptions(options = {}) {
  if (typeof options !== "object" || Array.isArray(options)) throw new Error("options: a map of name → {type, default}")
  for (const [name, o] of Object.entries(options)) {
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(name)) throw new Error(`options.${name}: a lower-case name`)
    if (!o || !TYPES.has(o.type)) throw new Error(`options.${name}.type: one of ${[...TYPES].join(", ")}`)
    if (o.choices_from != null && !CHOICE_SOURCES.has(o.choices_from)) throw new Error(`options.${name}.choices_from: one of ${[...CHOICE_SOURCES].join(", ")}`)
    if (o.type === "choice" && !(Array.isArray(o.choices) && o.choices.length)) throw new Error(`options.${name}.choices: the list`)
    if (o.default != null) checkValue(o, o.default, name)
  }
  return options
}

// A value for one option, checked; a text value is never a flag of its own.
export function checkValue(o, v, name) {
  const bad = (why) => {
    throw httpError(400, `${name}: ${why}`)
  }
  if (o.type === "number") {
    const n = Number(v)
    if (v === "" || v == null || !Number.isFinite(n)) bad("a number")
    if (o.min != null && n < o.min) bad(`at least ${o.min}`)
    if (o.max != null && n > o.max) bad(`at most ${o.max}`)
    return n
  }
  if (o.type === "bool") {
    if (typeof v !== "boolean") bad("true or false")
    return v
  }
  if (o.type === "choice") {
    const hit = o.choices.find((c) => String(c) === String(v))
    if (hit === undefined) bad(`one of ${o.choices.join(", ")}`)
    return hit
  }
  const s = String(v ?? "")
  if (s.length > 200 || /[\n\r\0]/.test(s) || s.startsWith("-")) bad("one line, at most 200 chars, not starting with -")
  return s
}

// --- one model ---------------------------------------------------------------------------------------------------------

export function readModel(kind, name, dir) {
  const file = join(dir, "model.md")
  const base = { kind, name, dir, file, ok: false, problem: null, meta: {}, options: {}, values: {}, accepts: [], modes: {} }
  try {
    const { meta, body } = splitMd(readFileSync(file, "utf8"))
    if (meta.kind && meta.kind !== kind) throw new Error(`kind: ${meta.kind}, but it sits in models/${kind}/`)
    if (!ENGINES[kind].includes(meta.engine)) throw new Error(`engine: one of ${ENGINES[kind].join(", ")}`)
    const options = checkOptions(meta.options ?? {})
    const values = {}
    for (const [k, v] of Object.entries(meta.values ?? {})) {
      if (!options[k]) continue // an option since removed: dropped on the next save
      try {
        values[k] = checkValue(options[k], v, k)
      } catch {}
    }
    const modes = meta.modes ?? (meta.bin ? { run: { bin: meta.bin, args: meta.args ?? [], inputs: meta.inputs ?? {} } } : {})
    for (const [m, spec] of Object.entries(modes)) {
      if (!spec?.bin || typeof spec.bin !== "string") throw new Error(`modes.${m}.bin: the program`)
      if (spec.args && !Array.isArray(spec.args)) throw new Error(`modes.${m}.args: a list`)
    }
    if (meta.engine === "command" && !Object.keys(modes).length) throw new Error("engine command: bin + args, or modes")
    if (meta.engine === "openai" && !/^https?:\/\/[^/]+/.test(meta.url ?? "")) throw new Error("engine openai: url (http://…/v1)")
    const accepts = [...new Set(Object.values(modes).flatMap((s) => Object.keys(s.inputs ?? {})))].filter((k) => k !== "out")
    return {
      ...base,
      ok: true,
      meta,
      title: meta.title ?? name,
      about: meta.about ?? body.trim().split("\n").find((l) => l.trim() && !l.startsWith("#"))?.trim() ?? "",
      body,
      engine: meta.engine,
      install: meta.install ?? null,
      weights: meta.weights ?? null,
      options,
      values,
      modes,
      accepts: meta.accepts ?? accepts,
    }
  } catch (error) {
    return { ...base, title: name, problem: error.message }
  }
}

// The option values in force: the owner's, else the defaults.
export const effective = (model) =>
  Object.fromEntries(
    Object.entries(model.options)
      .map(([k, o]) => [k, model.values[k] ?? o.default])
      .filter(([, v]) => v != null),
  )

// --- the registry ------------------------------------------------------------------------------------------------------

export function loadModels({ root = modelsRoot(), catalog = CATALOG, log = () => {}, which = Bun.which } = {}) {
  mkdirSync(root, { recursive: true })
  // a kind with no model yet: the catalogue's defaults (apple, say, qwen-image-2.1)
  const seeded = []
  for (const kind of KINDS) {
    mkdirSync(join(root, kind), { recursive: true })
    if (readdirSync(join(root, kind)).some((n) => existsSync(join(root, kind, n, "model.md")))) continue
    for (const entry of catalogList(catalog, kind).filter((c) => c.meta.default || c.meta.seed)) {
      copyIn(catalog, root, kind, entry.name)
      seeded.push(`${kind}/${entry.name}`)
    }
  }
  const presetDir = join(root, "image", "presets")
  if (!existsSync(presetDir)) {
    mkdirSync(presetDir, { recursive: true })
    for (const f of listMd(join(catalog, "image", "presets"))) writeFileSync(join(presetDir, f), readFileSync(join(catalog, "image", "presets", f)))
    seeded.push("image/presets")
  }
  // voice styles: the catalogue's, each one not here yet (an owner's edited file is never replaced)
  const styleDir = join(root, "tts", "styles")
  mkdirSync(styleDir, { recursive: true })
  for (const f of listMd(join(catalog, "tts", "styles")))
    if (!existsSync(join(styleDir, f))) {
      writeFileSync(join(styleDir, f), readFileSync(join(catalog, "tts", "styles", f)))
      seeded.push(`tts/styles/${f.replace(/\.md$/, "")}`)
    }
  if (seeded.length) log(`models: seeded ${seeded.join(", ")} into ${root}`)

  const selectionFile = join(root, "models.md")
  const readSelection = () => {
    try {
      return existsSync(selectionFile) ? splitMd(readFileSync(selectionFile, "utf8")).meta : {}
    } catch (error) {
      log(`models: ${selectionFile} unreadable (${error.message}) — the first model of each kind is used`)
      return {}
    }
  }
  const kindOf = (kind) => {
    if (!KINDS.includes(kind)) throw httpError(400, `kind: one of ${KINDS.join(", ")}`)
    return kind
  }
  const list = (kind) => {
    const dir = join(root, kindOf(kind))
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && NAME.test(d.name) && d.name !== "presets" && d.name !== "styles" && existsSync(join(dir, d.name, "model.md")))
      .map((d) => readModel(kind, d.name, join(dir, d.name)))
      .sort((a, b) => a.name.localeCompare(b.name))
  }
  const get = (kind, name) => {
    const m = list(kind).find((x) => x.name === name)
    if (!m) throw httpError(404, `no ${kind} model ${name} in ${join(root, kind)}`)
    return m
  }
  const selected = (kind) => {
    const all = list(kind)
    const want = readSelection()[kind]
    return all.find((m) => m.name === want && m.ok) ?? all.find((m) => m.ok && m.meta.default) ?? all.find((m) => m.ok) ?? null
  }
  // ready: its programs are installed (an openai model with no serve: checked when called)
  const ready = (m) => {
    if (!m.ok) return { ready: false, missing: [] }
    const bins = [...Object.values(m.modes).map((s) => s.bin), ...(m.meta.serve?.bin ? [m.meta.serve.bin] : [])]
    const missing = [...new Set(bins)].filter((b) => !findProgram(b, which, dirOf(m)))
    return { ready: !missing.length, missing }
  }

  return {
    root,
    list,
    get,
    selected,
    ready,
    program: (b) => findProgram(b, which),
    select(kind, name) {
      const m = get(kind, name)
      if (!m.ok) throw httpError(400, `${kind}/${name}: ${m.problem}`)
      const current = existsSync(selectionFile) ? readFileSync(selectionFile, "utf8") : `---\n---\n${SELECTION_BODY}`
      const { meta, body } = splitMd(current)
      const next = { ...meta, [kind]: name }
      atomic(selectionFile, `---\n${KINDS.filter((k) => next[k]).map((k) => `${k}: ${next[k]}`).join("\n")}\n---\n${body}`)
      log(`models: ${kind} → ${name}`)
      return m
    },
    // the owner's values for one model (null puts one back to its default)
    set(kind, name, patch = {}) {
      const m = get(kind, name)
      if (!m.ok) throw httpError(400, `${kind}/${name}: ${m.problem}`)
      const values = { ...m.values }
      for (const [k, v] of Object.entries(patch ?? {})) {
        if (!m.options[k]) throw httpError(400, `${k}: not an option of ${kind}/${name} (${Object.keys(m.options).join(", ") || "none"})`)
        if (v === null) delete values[k]
        else values[k] = checkValue(m.options[k], v, k)
      }
      atomic(m.file, writeValues(readFileSync(m.file, "utf8"), values))
      log(`models: ${kind}/${name} ${Object.keys(patch).map((k) => `${k}=${patch[k] ?? "default"}`).join(", ")}`)
      return get(kind, name)
    },
    catalog: (kind) =>
      catalogList(catalog, kindOf(kind)).map((c) => ({
        name: c.name,
        title: c.meta.title ?? c.name,
        about: c.meta.about ?? "",
        engine: c.meta.engine ?? null,
        install: c.meta.install ?? null,
        added: existsSync(join(root, kind, c.name, "model.md")),
      })),
    add(kind, name) {
      if (!catalogList(catalog, kindOf(kind)).some((c) => c.name === name)) throw httpError(404, `no ${kind} model ${name} in the catalogue`)
      if (existsSync(join(root, kind, name, "model.md"))) throw httpError(409, `${kind}/${name} is already in ${root}`)
      copyIn(catalog, root, kind, name)
      log(`models: added ${kind}/${name} from the catalogue`)
      return get(kind, name)
    },
    presets: () => listMd(presetDir).map((f) => readPreset(join(presetDir, f))),
    styles() {
      return listMd(styleDir).map((f) => readStyle(join(styleDir, f), (m) => this.get("tts", m)))
    },
    style(name) {
      const st = this.styles().find((x) => x.name === name)
      if (!st) throw httpError(400, `style: none named ${name} (${this.styles().map((x) => x.name).join(", ")})`)
      if (!st.ok) throw httpError(400, `style ${name}: ${st.problem}`)
      return st
    },
    // A style changed (the owner's feedback, given to the lead or in the panel): model, voice, speed, options, about, use,
    // writing — checked against the model; the file rewritten, its body's "## Changes" logging why.
    setStyle(name, patch = {}, why = "") {
      if (!NAME.test(String(name))) throw httpError(400, "name: lower-case letters, digits, - or _")
      const file = join(styleDir, `${name}.md`)
      const had = existsSync(file) ? splitMd(readFileSync(file, "utf8")) : { meta: {}, body: "" }
      const meta = { ...had.meta }
      for (const k of ["title", "about", "use", "model", "voice", "speed"]) if (patch[k] !== undefined) meta[k] = patch[k] === null || patch[k] === "" ? undefined : patch[k]
      if (patch.options !== undefined) meta.options = { ...(meta.options ?? {}), ...patch.options }
      if (meta.options) for (const [k, v] of Object.entries(meta.options)) if (v === null || v === "") delete meta.options[k]
      const model = this.get("tts", String(meta.model ?? ""))
      if (!model.ok) throw httpError(400, `model: ${model.problem}`)
      checkStyle(meta, model)
      let body = patch.writing != null ? String(patch.writing).trim() : (had.body.split(/\n## Changes\n/)[0] ?? "").trim()
      if (!body) throw httpError(400, "writing: how to write for this style (its guide)")
      const log = (had.body.split(/\n## Changes\n/)[1] ?? "").trim()
      const line = `- ${new Date().toISOString().slice(0, 10)}: ${Object.keys(patch).join(", ")}${why ? ` — ${String(why).replace(/\s+/g, " ").slice(0, 300)}` : ""}`
      body = `${body}\n\n## Changes\n${[log, line].filter(Boolean).join("\n")}\n`
      const keys = ["title", "about", "use", "model", "voice", "speed", "options"].filter((k) => meta[k] !== undefined)
      writeFileSync(file, `---\n${keys.map((k) => `${k}: ${JSON.stringify(meta[k])}`).join("\n")}\n---\n${body}`)
      return this.style(name)
    },
    preset(name) {
      const p = name ? this.presets().find((x) => x.name === name) : null
      if (name && !p?.ok) throw httpError(400, `preset: ${p?.problem ?? `none named ${name} (${this.presets().map((x) => x.name).join(", ")})`}`)
      return p
    },
  }
}

const SELECTION_BODY = "# Local models\n\nThe model chosen for each kind; the dashboard's model panel writes this file. Each model is a folder\n`<kind>/<name>/` with its `model.md`.\n"

// A model as the panel shows it.
export const twinOf = (m, ready = {}) => ({
  kind: m.kind,
  name: m.name,
  title: m.title,
  about: m.about ?? "",
  engine: m.engine ?? null,
  ok: m.ok,
  problem: m.problem,
  install: m.install ?? null,
  weights: m.weights ?? null,
  // tts: how to write for it (its `script:` hint — the agents shape a script to it, the panel shows it)
  script: m.meta?.script ? String(m.meta.script).trim() : null,
  accepts: m.accepts,
  modes: Object.keys(m.modes),
  options: m.options,
  values: m.values,
  file: m.file,
  ...ready,
})

// --- presets -------------------------------------------------------------------------------------------------------------

// A voice style's voice checked against its model: the voice one of its choices, each option one it has (checkValue).
function checkStyle(meta, model) {
  const voices = model.options?.voice?.choices
  if (meta.voice != null && voices && !voices.map(String).includes(String(meta.voice))) throw httpError(400, `voice: ${model.name} has ${voices.join(", ")}`)
  if (meta.voice != null && !voices && model.engine !== "say") throw httpError(400, `voice: ${model.name} has no voices to choose`)
  if (meta.speed != null && !(Number(meta.speed) >= 0.5 && Number(meta.speed) <= 2)) throw httpError(400, "speed: 0.5 to 2")
  for (const [k, v] of Object.entries(meta.options ?? {})) {
    if (!model.options[k]) throw httpError(400, `options.${k}: ${model.name} has ${Object.keys(model.options).join(", ") || "none"}`)
    checkValue(model.options[k], v, `options.${k}`)
  }
}

function readStyle(file, modelOf) {
  const name = file.split("/").at(-1).replace(/\.md$/, "")
  try {
    const { meta, body } = splitMd(readFileSync(file, "utf8"))
    const [writing, changes = ""] = body.split(/\n## Changes\n/)
    const st = { name, title: meta.title ?? name, about: meta.about ?? "", use: meta.use ?? "", model: meta.model ?? null, voice: meta.voice ?? null, speed: meta.speed ?? null, options: meta.options ?? {}, writing: writing.trim(), changes: changes.trim().split("\n").filter(Boolean).slice(-8), file, ok: true }
    const model = st.model ? modelOf(String(st.model)) : null
    if (!model?.ok) return { ...st, ok: false, problem: `model: ${model?.problem ?? "none named"}` }
    checkStyle(meta, model)
    return st
  } catch (error) {
    return { name, title: name, file, ok: false, problem: error.message }
  }
}

function readPreset(file) {
  const name = file.split("/").at(-1).replace(/\.md$/, "")
  try {
    const { meta, body } = splitMd(readFileSync(file, "utf8"))
    const p = { name, title: meta.title ?? name, when: meta.when ?? body.trim().split("\n")[0] ?? "", ok: true }
    for (const k of ["style", "negative", "width", "height", "steps", "guidance", "strength"]) if (meta[k] != null) p[k] = meta[k]
    if (p.style && !String(p.style).includes("{prompt}")) p.style = `{prompt}, ${p.style}`
    return p
  } catch (error) {
    return { name, title: name, ok: false, problem: error.message }
  }
}

// What a preset does to a call: size, steps, guidance, strength when the call has none; its style wraps the prompt; its
// negative joins the call's.
export function applyPreset(preset, input) {
  if (!preset) return input
  const out = { ...input, preset: preset.name }
  for (const k of ["width", "height", "steps", "guidance", "strength"]) if (out[k] == null && preset[k] != null) out[k] = preset[k]
  if (preset.style) out.prompt = preset.style.replace("{prompt}", input.prompt)
  if (preset.negative) out.negative = [input.negative, preset.negative].filter(Boolean).join(", ")
  return out
}

// the model's own folder (a wrapper's `./name` is found there)
export const dirOf = (m) => (m?.file ? dirname(m.file) : null)

// --- argv ----------------------------------------------------------------------------------------------------------------

// A command line from a mode: its args with `{name}` filled, its inputs present as `flag value…`, the options with a flag.
export function buildArgv(model, mode, call, { which = Bun.which } = {}) {
  const spec = model.modes[mode]
  if (!spec) throw httpError(400, `${model.kind}/${model.name} has no ${mode} mode (${Object.keys(model.modes).join(", ")})`)
  const bin = findProgram(spec.bin, which, dirOf(model))
  if (!bin) throw httpError(501, `${spec.bin} is not installed — ${model.install ?? "see its model.md"}`)
  const opts = effective(model)
  // a value is never read as a flag of its own (audit 20: a prompt or a spoken line starting with "-"): a filled argument
  // that would start with "-" gets a space in front; a flagged input goes as one "--flag=value" argument
  const fill = (s) => {
    const out = String(s).replace(/\{([a-z_]+)\}/g, (_, k) => {
      const v = call[k] ?? opts[k]
      if (v == null) throw httpError(400, `${model.name}: {${k}} has no value`)
      return String(v)
    })
    return out.startsWith("-") && !String(s).startsWith("-") ? ` ${out}` : out
  }
  const argv = [bin, ...(spec.args ?? []).map(fill)]
  for (const [k, flag] of Object.entries(spec.inputs ?? {})) {
    const v = call[k] ?? (model.options[k] && !model.options[k].flag ? opts[k] : undefined)
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue
    const values = Array.isArray(v) ? v.map(String) : [String(v)]
    if (values.some((x) => x.startsWith("-"))) {
      if (!flag || values.length > 1) throw httpError(400, `${k}: a value may not start with "-"`)
      argv.push(`${flag}=${values[0]}`)
      continue
    }
    if (flag) argv.push(flag)
    argv.push(...values)
  }
  for (const [k, o] of Object.entries(model.options)) {
    if (!o.flag) continue
    const v = opts[k]
    if (v == null || v === false || v === "none" || v === "") continue
    argv.push(o.flag)
    if (v !== true) argv.push(String(v))
  }
  return argv
}

// --- helpers ---------------------------------------------------------------------------------------------------------------

const listMd = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md")).sort() : [])
function catalogList(catalog, kind) {
  return listMd(join(catalog, kind)).map((f) => {
    const name = f.replace(/\.md$/, "")
    try {
      return { name, meta: splitMd(readFileSync(join(catalog, kind, f), "utf8")).meta }
    } catch {
      return { name, meta: {} }
    }
  })
}
function copyIn(catalog, root, kind, name) {
  mkdirSync(join(root, kind, name), { recursive: true })
  writeFileSync(join(root, kind, name, "model.md"), readFileSync(join(catalog, kind, `${name}.md`)))
}
function atomic(file, text) {
  writeFileSync(`${file}.tmp`, text)
  renameSync(`${file}.tmp`, file)
}
// a program by name: on PATH, else uv's ~/.local/bin or Homebrew's (launchd's PATH may have neither); a test's own
// `which` alone
// A program by name (PATH, ~/.local/bin, Homebrew), an absolute path, or — `./run.py` — a wrapper in the model's own folder
// (`dir`: models/<kind>/<name>/; 2026-10-24 owner: "if any wiring is required, we can write the wrapper"), which must be
// executable (chmod +x, with its #! line).
export function findProgram(name, which = Bun.which, dir = null) {
  if (name.startsWith("./")) {
    if (!dir) return null
    const path = join(dir, name.slice(2))
    // inside its folder only: never ../ out of it
    return !name.includes("..") && existsSync(path) && (statSync(path).mode & 0o111) !== 0 ? path : null
  }
  if (name.includes("/")) return existsSync(name) ? name : null
  if (which !== Bun.which) return which(name)
  const home = process.env.HOME ?? ""
  return which(name) ?? [join(home, ".local", "bin", name), `/opt/homebrew/bin/${name}`].find((p) => existsSync(p)) ?? null
}
