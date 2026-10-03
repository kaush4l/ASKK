// Model catalogue: the model connections agents use, each under a key.
//
//   public/models.json            shipped connections (served publicly —
//                                 never put an API key here)
//   localStorage "askk.models"    connections added or edited in this browser
//
//   { "default": "local",
//     "models": { "local": { label, provider, base_url, api_key, id,
//                            context_length, max_tokens } } }
//
// Every agent uses the default model. An agent that needs a special one names
// its key in agent.md (`model: local-anthropic`). Browser entries override
// file entries with the same key; API keys live only in this browser.

import { withBase } from "@/backend/platform/base-path"

const FILE = withBase("/models.json")
const KEY = "askk.models"

export const MODEL_FIELDS = ["label", "provider", "base_url", "api_key", "id", "context_length", "max_tokens"]

export const PROVIDERS = {
  openai: "OpenAI-compatible",
  anthropic: "Anthropic-compatible",
}

const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
export const validKey = (value) =>
  typeof value === "string" && /^[a-z0-9][a-z0-9._-]*$/i.test(value) && !["__proto__", "constructor", "prototype"].includes(value)

// Known fields with a value; throws when the entry cannot be used.
export function cleanModel(model, key = "model") {
  if (!plain(model)) throw new Error(`Model "${key}" must be an object.`)
  const clean = Object.fromEntries(
    MODEL_FIELDS.filter((f) => model[f] !== undefined && model[f] !== null && model[f] !== "").map((f) => [f, model[f]])
  )
  if (!(clean.provider in PROVIDERS)) throw new Error(`Model "${key}" needs provider openai or anthropic.`)
  if (!clean.id) throw new Error(`Model "${key}" needs a model id.`)
  return clean
}

function catalogue(value) {
  return {
    default: validKey(value?.default) ? value.default : null,
    models: plain(value?.models) ? value.models : {},
  }
}

function readSaved() {
  try {
    return catalogue(JSON.parse(localStorage.getItem(KEY) ?? "{}"))
  } catch {
    return catalogue(null)
  }
}

function writeSaved(saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(saved))
  } catch (error) {
    throw new Error(`Could not save in this browser: ${error.message}`)
  }
}

const EMPTY = Object.freeze({ status: "idle", error: null, default: null, models: [] })

class ModelStore {
  #listeners = new Set()
  #file = catalogue(null)
  #state = EMPTY
  #loading = null

  getSnapshot = () => this.#state
  getServerSnapshot = () => EMPTY

  subscribe = (listener) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #set(patch) {
    this.#state = { ...this.#state, ...patch }
    for (const listener of this.#listeners) listener()
  }

  // Read models.json once; browser entries are layered on top.
  load() {
    this.#loading ??= (async () => {
      this.#set({ status: "loading" })
      try {
        const response = await fetch(new URL(FILE, window.location.origin))
        if (response.ok) this.#file = catalogue(await response.json())
        else if (response.status !== 404) throw new Error(`Cannot load models.json: HTTP ${response.status}`)
        this.#rebuild({ status: "ready", error: null })
      } catch (error) {
        this.#rebuild({ status: "ready", error: error.message })
      }
    })()
    return this.#loading
  }

  #rebuild(patch = {}) {
    const saved = readSaved()
    const models = []
    for (const [key, entry] of Object.entries({ ...this.#file.models, ...saved.models })) {
      if (!validKey(key)) continue
      try {
        const source = !(key in this.#file.models) ? "browser" : key in saved.models ? "edited" : "file"
        models.push({ key, source, ...cleanModel(entry, key) })
      } catch {
        // An unusable entry is skipped, not fatal.
      }
    }
    const keys = models.map((m) => m.key)
    const preferred = [saved.default, this.#file.default].find((k) => keys.includes(k))
    this.#set({ ...patch, models, default: preferred ?? keys[0] ?? null })
  }

  get(key) {
    return this.#state.models.find((m) => m.key === key) ?? null
  }

  // Add or replace a connection in this browser.
  save(key, model) {
    if (!validKey(key)) throw new Error("Key: letters, digits, dot, dash or underscore, starting with a letter or digit.")
    const saved = readSaved()
    saved.models[key] = cleanModel(model, key)
    writeSaved(saved)
    this.#rebuild()
  }

  // Delete a browser connection, or drop the browser edit of a file one.
  remove(key) {
    const saved = readSaved()
    delete saved.models[key]
    if (saved.default === key && !(key in this.#file.models)) saved.default = null
    writeSaved(saved)
    this.#rebuild()
  }

  setDefault(key) {
    if (!this.get(key)) throw new Error(`Unknown model "${key}".`)
    const saved = readSaved()
    saved.default = key
    writeSaved(saved)
    this.#rebuild()
  }
}

export const models = new ModelStore()

// The connection for a key, or the default when no key is given. null when
// the key (or a default) is not in the catalogue.
export function resolveModel(key = null) {
  return models.get(key ?? models.getSnapshot().default)
}

export function missingModelMessage(key = null) {
  return key
    ? `Unknown model "${key}". Add it to models.json or on the Settings page.`
    : "No default model. Add one on the Settings page."
}
