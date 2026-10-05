// The prompt template shared by every agent kind (Engine, SingleCallAgent).

// Element slots in the order they are sent. Empty elements are dropped; the
// rest are joined by a blank line. The complete prompt is sent every request.
//
// Ordered for prompt caching: what changes least comes first, so a provider
// can reuse the longest unchanged prefix.
//   soul, instructions, tools, response   fixed per definition
//   history                               grows between requests, fixed during one
//   artifacts                             re-read before every step (shared space, files)
//   context                               the current time, open quests: every call
//   request                               the request and the work done on it
const PROMPT_TEMPLATE = [
  "soul",
  "instructions",
  "tools",
  "response",
  "history",
  "artifacts",
  "context",
  "request",
]

// Slots after which the prompt so far is a stable prefix worth caching.
const CACHE_AFTER = new Set(["response", "history"])

// The prompt and its cache breakpoints (character offsets where a stable
// prefix ends), for providers with explicit caching (anthropic).
export function renderPrompt(values) {
  let text = ""
  const breaks = []
  for (const slot of PROMPT_TEMPLATE) {
    if (!values[slot]) continue
    text += (text ? "\n\n" : "") + values[slot]
    if (CACHE_AFTER.has(slot)) breaks.push(text.length)
  }
  return { text, breaks: [...new Set(breaks)].filter((at) => at < text.length) }
}

export function renderTemplate(values) {
  return renderPrompt(values).text
}

// Soul: who the agent is in every role (values, character). Never the job.
// See docs/soul-and-role.md.
export function formatSoul(text) {
  if (!text?.trim()) return ""
  return (
    `## WHO YOU ARE\n\n${text.trim()}\n\n` +
    "This holds in every role you take. YOUR ROLE, next, is the work you are doing now and how it is done."
  )
}

// Role: the hat for this work — what the work is, its rules, what has been
// learned about doing it well (the agent.md body).
export function formatRole(text) {
  if (!text?.trim()) return ""
  return `## YOUR ROLE\n\n${text.trim()}`
}

// `extra`: more context lines (e.g. the workspace an engine works on).
export function formatContext(extra = []) {
  const now = new Date()
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return [
    "## CONTEXT",
    `Current time: ${now.toString()} (${zone}); UTC ${now.toISOString()}. Use this clock for every time you write.`,
    ...extra,
  ].join("\n")
}

// The request, then the work already done on it this turn (`progress`, the
// steps and tool results so far), so the model continues instead of
// starting over.
export function formatRequest(input, progress = "") {
  const request = `## CURRENT REQUEST\n\n${input}`
  if (!progress) return request
  return (
    `${request}\n\n## WORK DONE ON THE CURRENT REQUEST\n\n${progress}\n\n` +
    "These are your own steps on the current request, and their results are current. " +
    "Do not repeat a call that already succeeded. Continue from the last result: call more tools " +
    "only for what is still missing, otherwise answer the current request. Earlier requests in the " +
    "conversation history are already answered.\n\n" +
    `Current request (again): ${input}`
  )
}
