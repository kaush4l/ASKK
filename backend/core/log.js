// An engine's messages as log lines: the prompt's history and progress
// sections (BaseEngine.formatLog), and the status digests the supervisor
// sends to a quest's owner (runtime/supervisor.js). Pure: works on any
// thread, from a live engine or from its state snapshot.

function line(m) {
  if (m.role === "tool") return `[TOOL]: ${m.content}`
  if (m.role === "summary") return `[SUMMARY OF EARLIER CONVERSATION]: ${m.content}`
  if (m.action === "tool") return `[ASSISTANT]: [action=tool] ${m.content}`
  if (m.role === "user" && m.guidance) return `[GUIDANCE FROM ${m.from.toUpperCase()}]: ${m.content}`
  if (m.role === "user" && m.from) {
    const kind = m.reports ? "REPORTS" : m.status ? "STATUS" : "QUEST"
    return `[${kind} FROM ${m.from.toUpperCase()}]: ${m.content}`
  }
  return `[${m.role.toUpperCase()}]: ${m.content}`
}

const clip = (text, size) => (text.length > size ? `${text.slice(0, size)}…` : text)

// Numbered log lines (no heading).
export function formatLog(messages) {
  return messages
    .filter((m) => !m.error && m.content)
    .map((m, i) => `${i + 1}. ${line(m)}`)
    .join("\n")
}

// A compact log of recent work: each line clipped, the newest lines kept
// within `total` characters.
export function digest(messages, { each = 400, total = 6000 } = {}) {
  const lines = messages.filter((m) => m.content || m.error).map((m) => clip(m.error ? `[ERROR]: ${m.error}` : line(m), each))
  const kept = []
  let size = 0
  for (const text of lines.reverse()) {
    if (size + text.length > total) break
    kept.unshift(text)
    size += text.length + 1
  }
  const dropped = lines.length - kept.length
  return `${dropped ? `(${dropped} earlier lines not shown)\n` : ""}${kept.join("\n")}`
}
