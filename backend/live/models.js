// The local models as the model panel sees them (companion/models: models/<kind>/<name>/model.md): the list per kind,
// the one chosen, each one's options with the owner's values, and the owner's calls — choose, set an option (written
// into its model.md, so it survives a restart), add one from the catalogue, install it, start its server.
//   loadModels()                     GET models → {root, kinds: {stt | tts | image: {selected, models, catalog}}, presets}
//   modelCall(action, body)          POST models/<select | set | add | install | start>
//   optionRows(model)                [{name, type, value, def, changed, about, min, max, step, choices}]
//   statusOf(model)                  "ready" | "not installed: …" | its problem

import { withBase } from "@/backend/live/base-path"

const API = withBase("/__askk/")

async function json(response) {
  const data = await response.json().catch(() => null)
  if (!response.ok || !data) throw new Error(data?.error ?? `Host request failed (${response.status}).`)
  return data
}
export const loadModels = async () => json(await fetch(`${API}models`, { cache: "no-store" }))
export const modelCall = async (action, body) => json(await fetch(`${API}models/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }))
export const uploadImage = async (body) => json(await fetch(`${API}image/upload`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }))

export const KIND_LABEL = { stt: "Speech to text", tts: "Text to speech", image: "Image model" }

export function optionRows(model) {
  return Object.entries(model?.options ?? {}).map(([name, o]) => {
    const def = o.default ?? (o.type === "bool" ? false : o.type === "number" ? null : "")
    const has = model.values && name in model.values
    return { name, type: o.type, value: has ? model.values[name] : def, def, changed: has, about: o.about ?? "", min: o.min, max: o.max, step: o.step, choices: o.choices ?? null, flag: o.flag ?? null }
  })
}

export function statusOf(model) {
  if (!model) return "none"
  if (!model.ok) return model.problem
  if (model.installing) return "installing…"
  if (model.missing?.length) return `not installed: ${model.missing.join(", ")}`
  return "ready"
}
