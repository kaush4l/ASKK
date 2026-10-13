// BaseEngine's pure helpers (no engine state): context cap, step limits,
// tool usage lines, response text, clipping for the summarizer and the live
// activity. Moved out of core/base-engine.js unchanged.
import { LIMITS } from "@/lib/config"

// Every agent's context is capped (tokens): the model's window when smaller,
// else this. Also the window when the model's is unknown (the local CLIs), so
// auto-summarize always has a limit. agent.md `context_window` or
// ASKK_CONTEXT_CAP (.env, server and headless) overrides it.
const CONTEXT_CAP = LIMITS.context.capTokens

export function contextCap(agent) {
  const own = Number(agent?.context_window)
  if (own > 0) return own
  const env = Number(globalThis.process?.env?.ASKK_CONTEXT_CAP)
  return env > 0 ? env : CONTEXT_CAP
}
// Steps per letter (agent.md `max_steps`) and rounds of quests per origin
// (`max_rounds`): unlimited unless set. Long-running work is kept on track by
// status checks instead (runtime/supervisor.js → status letters to the lead).
export const limit = (value) => (Number(value) > 0 ? Number(value) : Infinity)
// "string", "string[]", … for one input schema.
const typeLabel = (schema) =>
  schema.type === "array" && schema.items?.type ? `${schema.items.type}[]` : (schema.type ?? "value")

// `name({"a": "<string>", "b?": …})` from a tool's input schema.
export function toolUsage(tool) {
  const properties = tool.inputs?.properties ?? {}
  const required = new Set(tool.inputs?.required ?? [])
  const args = Object.entries(properties).map(
    ([key, schema]) => `"${key}": <${typeLabel(schema)}${required.has(key) ? "" : ", optional"}>`
  )
  return `${tool.name}({${args.join(", ")}})`
}

// Plain text of a parsed response, for display and history.
export function responseText(parsed) {
  const value = parsed.response
  if (Array.isArray(value)) return value.join("\n")
  const text = (field) => (Array.isArray(field) ? field.join("\n") : String(field ?? ""))
  return text(value) || text(parsed.decision) || text(parsed.thinking) || text(parsed.observation)
}

const clip = (text, size) =>
  text.length <= size ? text : `${text.slice(0, size / 2)}\n[… clipped …]\n${text.slice(-size / 2)}`

// Shorten long entries proportionally so the summarizer's own prompt fits in
// the context window (leaving room for its instructions and reply).
export function fitLog(log, window) {
  const textOf = (m) => (m.role === "tool" ? (m.output ?? "") : (m.content ?? ""))
  const total = log.reduce((sum, m) => sum + textOf(m).length, 0)
  const budget = window ? window * LIMITS.metrics.charsPerToken * LIMITS.memory.summarizeInputRatio : Infinity // ~4 characters per token
  if (total <= budget) return log
  const share = budget / total
  return log.map((m) => {
    const size = Math.max(LIMITS.memory.summarizeMinEntryChars, Math.floor(textOf(m).length * share))
    return m.role === "tool" ? { ...m, output: clip(textOf(m), size) } : { ...m, content: clip(textOf(m), size) }
  })
}

const LIVE_INPUT_CHARS = LIMITS.engine.liveInputChars
export function clipInputs(inputs) {
  if (!inputs || typeof inputs !== "object") return inputs ?? null
  return Object.fromEntries(
    Object.entries(inputs).map(([key, value]) => [key, typeof value === "string" && value.length > LIVE_INPUT_CHARS ? `${value.slice(0, LIVE_INPUT_CHARS)}…` : value])
  )
}
// A long text as its start and a marker (letters that repeat what history already holds).
export const clipText = (text, max) => (text && text.length > max ? `${text.slice(0, max)}… (${text.length - max} more chars, in your history)` : text)
