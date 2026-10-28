// The owner's words, made into a clear request before a desk works on them (2026-10-24 owner: "a sanitize method for
// the input … an on-device model to call this sanitize method … The first user input can always go through sanitize …
// the input and the voice transcribe can both be sent through this step … any basic input can be enhanced. The voice
// input can be corrected"). One call to Apple's on-device model (local-models.js, provider apple: ~1 s, nothing leaves
// this Mac) rewrites what the owner typed, said or sent on Telegram: misheard words and typos fixed, the ask made
// explicit, every fact, name, number and link kept, nothing invented. The agent sees both — the rewrite and the owner's
// own words (kernel Agent.ask {original}) — and the UI shows what was changed.
//
//   const s = createSanitizer({ local, log })           local: createLocalModels() (null: every call skipped)
//   s.available                                          Apple's model is on this machine
//   await s.sanitize(text, { via, signal? })             via: typed | voice | telegram | guidance
//     → { text, original, changed, via, model, ms } or { text: original, original, changed: false, via, skipped }
//
// Never in the way: no model, a short or command-like message, code, a long paste, a timeout (SANITIZE.timeoutMs), an
// error or a reply that fails a guard (empty, an answer instead of a rewrite, much longer than the message, a number or
// a link of the message missing) → the owner's text as it was, with why (`skipped`). Voice guidance (via guidance) is
// only corrected, never expanded: a note for a run in progress keeps its size.

const SANITIZE = {
  timeoutMs: 12000,
  minChars: 12, // shorter: "yes", "stop", "go on" — nothing to improve
  maxChars: 4000, // the model's window is 8k tokens; a long paste is the owner's own document
  growth: 3, // a rewrite at most 3× the message (+ slack)
  slackChars: 500,
}

const ROLE = {
  typed: "typed by the owner",
  voice: "spoken by the owner and transcribed by speech recognition — expect misheard words, missing punctuation and names spelled by sound",
  telegram: "sent by the owner on Telegram from a phone — expect typos and shorthand",
  guidance: "spoken by the owner as a short note to a run already in progress, transcribed by speech recognition",
}

const RULES = [
  "Keep every fact, name, number, date, amount, link and file path exactly; keep the owner's intent, scope and tone.",
  "Fix spelling, grammar and misheard words.",
  "Make the request explicit and well structured: what to do, for whom, constraints and the result wanted — only what the message says or clearly implies.",
  "Never invent requirements, numbers, deadlines or details. Never answer the request, never refuse, never comment.",
  "Write it in the owner's voice, as the owner's request to the desk. Plain text, no preamble, no quotes around it.",
]

// No desk or goal text in it (2026-10-24, tried: the small model wove the desk's description into every rewrite).
const prompt = (text, via) =>
  [
    via === "guidance"
      ? "Correct the owner's short note between <message> and </message>. Fix misheard words, spelling and punctuation only. Add nothing; keep it as short as it is."
      : "Rewrite the owner's message between <message> and </message> as a clear request to an AI agent.",
    ...(via === "guidance" ? [RULES[0], RULES[3]] : RULES).map((r) => `- ${r}`),
    `\nThe message was ${ROLE[via] ?? ROLE.typed}.`,
    `<message>\n${text}\n</message>`,
    `\nReply with the ${via === "guidance" ? "corrected note" : "rewritten request"} only.`,
  ]
    .filter(Boolean)
    .join("\n")

// Why a message is left as it is (null: rewrite it).
export function skipReason(text, via = "typed") {
  const t = String(text ?? "").trim()
  if (t.length < SANITIZE.minChars || t.split(/\s+/).length < 3) return "short"
  if (t.length > SANITIZE.maxChars) return "long"
  if (/^\//.test(t)) return "command"
  if (/```/.test(t) || (via !== "voice" && /^\s*[{[]/.test(t))) return "code"
  return null
}

// What a rewrite must keep from the message: its numbers and links (a "1857" said as "eighteen fifty-seven" in a voice
// message is no number in it, so nothing to lose).
const numbers = (s) => (String(s).match(/\d+(?:[.,:]\d+)*/g) ?? []).map((n) => n.replace(/,/g, ""))
const links = (s) => String(s).match(/https?:\/\/\S+|(?:~|\.{1,2})?\/[\w.-]+\/[\w./-]+/g) ?? []
// The model echoing its own prompt back (the small model does, given a short note)
const ECHO = /<\/?message>|^the message (?:was|\()|names and terms the owner|^the desk:|request (?:for|to) an ai agent(?: desk)?:/im
const ANSWER = /^(i'?m sorry|sorry,|i can(no|')t|i am unable|as an ai|i'?m unable|here(?:'s| is) (?:a|the) (?:story|answer|response))/i

// The model's reply as the rewrite, else why not.
export function checkRewrite(original, reply) {
  let text = String(reply ?? "").trim()
  text = text.replace(/^(?:rewritten request|corrected note|request|rewrite)\s*:\s*/i, "").trim()
  if (ECHO.test(text)) return { problem: "echoed the prompt" }
  if (/^["“].*["”]$/s.test(text)) text = text.slice(1, -1).trim()
  if (!text) return { problem: "empty" }
  if (ANSWER.test(text)) return { problem: "answered instead of rewriting" }
  if (text.length > original.length * SANITIZE.growth + SANITIZE.slackChars) return { problem: "too long" }
  const lost = numbers(original).find((n) => !numbers(text).includes(n)) ?? links(original).find((l) => !text.includes(l.replace(/[.,;)]+$/, "")))
  if (lost) return { problem: `dropped "${lost}"` }
  return { text }
}

export function createSanitizer({ local = null, log = () => {} } = {}) {
  const available = !!local?.providers?.includes("apple")
  async function sanitize(text, { via = "typed", signal } = {}) {
    const original = String(text ?? "").trim()
    const left = (skipped) => ({ text: original, original, changed: false, via, skipped })
    if (!available) return left("no on-device model")
    const skip = skipReason(original, via)
    if (skip) return left(skip)
    const t0 = Date.now()
    const timeout = AbortSignal.timeout(SANITIZE.timeoutMs)
    const both = signal ? AbortSignal.any([signal, timeout]) : timeout
    let reply = ""
    try {
      for await (const part of local.complete("apple", { prompt: prompt(original, via), signal: both })) reply += part
    } catch (error) {
      const why = timeout.aborted ? "timed out" : signal?.aborted ? "stopped" : `model error: ${String(error.message).slice(0, 120)}`
      log(`sanitize: left as it was (${why})`)
      return left(why)
    }
    if (timeout.aborted) return left("timed out")
    const ms = Date.now() - t0
    const out = checkRewrite(original, reply)
    if (out.problem) {
      log(`sanitize: left as it was (${out.problem}, ${ms} ms)`)
      return { ...left(out.problem), ms }
    }
    const changed = out.text !== original
    log(`sanitize: ${via} ${changed ? "rewritten" : "unchanged"} by the on-device model (${ms} ms)`)
    return { text: out.text, original, changed, via, model: "apple", ms }
  }
  return { available, sanitize }
}
