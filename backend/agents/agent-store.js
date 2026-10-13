// Agent edits saved in this browser. The files in public/agents/ stay the
// source definitions; an edit stores only the editable fields, layered on top.
//
// localStorage "powerhouse.agent-edits":
//   { "lead": { description, response_format, tools, model, instructions } }

const KEY = "powerhouse.agent-edits"

const EDITABLE_FIELDS = ["description", "response_format", "tools", "model", "instructions"]

export function readAgentEdits() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "{}")
    return value && typeof value === "object" && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

// Throws when storage is unavailable, so the caller can show the failure.
export function writeAgentEdits(edits) {
  try {
    localStorage.setItem(KEY, JSON.stringify(edits))
  } catch (error) {
    throw new Error(`Could not save in this browser: ${error.message}`)
  }
}

export function pickEditable(agent) {
  return Object.fromEntries(EDITABLE_FIELDS.map((field) => [field, agent[field]]))
}
