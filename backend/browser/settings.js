// The model the browser desk calls (2026-10-20 owner: "the hosted version can use API calls to local host or OpenAI
// compatible endpoints in order to run a default chat system"): one OpenAI-compatible connection {base_url, api_key?,
// model}, kept in this browser (storage key `model`). The API key, when one is given, stays in this browser and goes only
// to that endpoint. A page served over https may call http://localhost (a local server) — the server must allow the
// page's origin (CORS): each preset says how.
//
//   PRESETS                         the usual endpoints, each {id, label, base_url, key?, note}
//   readConnection(store)           → {base_url, api_key, model, preset} | null
//   saveConnection(store, c)        → the connection saved (checked: baseUrlProblem, a model), or throws why not
//   baseUrlProblem(url)             → why this tab may not call it (plain http beyond the local network), or null
//   clearConnection(store)
//   fetchModels(c, {fetch?})        → [model id] from GET <base_url>/models (the kernel's listModels)
//   wantsBrowserAgent(store) / setBrowserAgent(store, on)   whether this tab runs its own agent (key `use`): on when a
//                                   model is saved; off by the owner's Stop. With a desk server on the same origin the
//                                   tab follows the server unless the owner switched to this browser (the header's menu).

import { listModels } from "../kernel/index.js"

export const PRESETS = [
  { id: "ollama", label: "Ollama on this computer", base_url: "http://localhost:11434/v1", note: "start it so a web page may call it: OLLAMA_ORIGINS=* ollama serve" },
  { id: "lmstudio", label: "LM Studio on this computer", base_url: "http://localhost:1234/v1", note: "Developer → Local Server: start it with CORS on" },
  { id: "llamacpp", label: "llama.cpp server on this computer", base_url: "http://localhost:8080/v1", note: "llama-server answers browsers by default" },
  { id: "openai", label: "OpenAI", base_url: "https://api.openai.com/v1", key: true, note: "an API key; it stays in this browser and goes only to api.openai.com" },
  { id: "openrouter", label: "OpenRouter", base_url: "https://openrouter.ai/api/v1", key: true, note: "an API key; it stays in this browser and goes only to openrouter.ai" },
  { id: "custom", label: "Another OpenAI-compatible endpoint", base_url: "", note: "its /v1 address; it must allow this page's origin (CORS)" },
]

// A base URL this tab may call: http(s); plain http only to this computer or the local network (an API key never
// crosses the internet in clear text). The reason it may not, else null.
const LOCAL_HOST = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|[a-z0-9-]+\.local)$/i
export function baseUrlProblem(url) {
  let parsed
  try {
    parsed = new URL(String(url ?? ""))
  } catch {
    return "base URL: a full address, e.g. http://localhost:11434/v1"
  }
  if (!/^https?:$/.test(parsed.protocol)) return "base URL: http or https"
  if (parsed.protocol === "http:" && !LOCAL_HOST.test(parsed.hostname)) return `base URL: https for ${parsed.hostname} (plain http only on this computer or the local network)`
  return null
}

// The saved connection, or null (none, or one this version would not save: a hand-edited or old value).
export function readConnection(store) {
  const c = store?.get("model", null)
  return c && typeof c === "object" && typeof c.base_url === "string" && typeof c.model === "string" && c.model && !baseUrlProblem(c.base_url) ? c : null
}

export const wantsBrowserAgent = (store) => store?.get("use", false) === true && !!readConnection(store)
export const setBrowserAgent = (store, on) => store?.set("use", !!on)

export function saveConnection(store, { base_url, api_key = "", model, preset = "custom" } = {}) {
  const url = String(base_url ?? "").trim().replace(/\/+$/, "")
  const problem = baseUrlProblem(url)
  if (problem) throw new Error(problem)
  const id = String(model ?? "").trim()
  if (!id) throw new Error("model: the model's id on that endpoint (Fetch models lists them)")
  const c = { base_url: url, api_key: String(api_key ?? "").trim(), model: id, preset }
  if (!store.set("model", c)) throw new Error("this browser would not keep the setting (storage blocked or full)")
  store.set("use", true)
  return c
}

export const clearConnection = (store) => store?.remove("model")

export async function fetchModels(c) {
  const models = await listModels({ provider: "openai", base_url: c.base_url, api_key: c.api_key || undefined })
  return (models ?? []).map((m) => m.id).filter(Boolean)
}
