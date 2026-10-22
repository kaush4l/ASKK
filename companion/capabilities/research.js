// A bounded research call: the Claude CLI as an agent whose only tools are WebSearch and WebFetch, for a desk stage
// that reads the web and writes one document in one call (2026-10-21: the kernel's text-only completions made every
// fetch a whole ReAct step).
//
//   POST /__askk/llm/research {prompt, model?, max_turns?, seconds?, system?}   → NDJSON, one event per line:
//     {type: "start", model, max_turns, seconds}
//     {type: "tool", name: "WebSearch" | "WebFetch", query?, url?}      each search or page it reads, as it happens
//     {type: "note", text}                                               its words between tools (clipped)
//     {type: "result", text, turns, ms, cost_usd, sources: [{name, query?, url?}]}   or {type: "error", message}
//     {type: "ping"}                                                     keep-alive while it works
//
// Never Bash, files, MCP or a permission bypass: `--tools` lists only the two web tools, `--allowedTools` approves
// only them, `--permission-mode dontAsk` refuses anything else, `--strict-mcp-config` with no config, no settings or
// project instructions, an empty temporary folder, a scrubbed environment (no desk secrets). Bounded by turns and
// seconds; the request's signal (the caller stopped) kills it. What it reads is outside text: a desk tool built on
// it is `outside: true` (backend/kernel/tool/tool.js readsOutside).

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { HOST_LIMITS } from "../shared/config.js"
import { httpError, json } from "../shared/http.js"

const L = HOST_LIMITS.research
export const RESEARCH_TOOLS = ["WebSearch", "WebFetch"]
const SYSTEM =
  "You are one stage of a sequential pipeline run by an external engine. Your only tools are WebSearch and WebFetch. " +
  "Do the research the stage asks for, then reply with the stage's document only — no questions back, no offers, no " +
  "permission requests. If a value cannot be verified, say so in the document and go on."

const clamp = (v, lo, hi, d) => (v != null && v !== "" && Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d)
const clip = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

// The command line: only the web tools, bounded turns, no MCP, no settings.
export function researchArgv(bin, { model = "default", maxTurns = L.defaultTurns, system = "" } = {}) {
  return [
    bin, "-p", "--output-format", "stream-json", "--verbose",
    "--tools", RESEARCH_TOOLS.join(","), "--allowedTools", RESEARCH_TOOLS.join(","),
    "--permission-mode", "dontAsk", "--max-turns", String(maxTurns),
    "--strict-mcp-config", "--setting-sources", "",
    "--append-system-prompt", system ? `${SYSTEM}\n\n${system}` : SYSTEM,
    ...(model && model !== "default" ? ["--model", model] : []),
  ]
}

// The child's environment: what the CLI needs to run and sign in, nothing of the desk's .env.
export function researchEnv(env = process.env, bin = "") {
  const keep = {}
  for (const [k, v] of Object.entries(env)) if (/^(HOME|USER|LOGNAME|LANG|LC_[A-Z]+|TMPDIR|TERM|ANTHROPIC_[A-Z_]+|CLAUDE_CODE_[A-Z_]+)$/.test(k)) keep[k] = v
  keep.PATH = `${bin ? `${dirname(bin)}:` : ""}/usr/bin:/bin:/usr/sbin:/sbin`
  // A model id newer than the installed CLI's catalog must reach the API instead of exiting 1 (local-models.js).
  keep.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT = "1"
  return keep
}

// One stream-json line → the events a caller sees (none for lines it does not need).
export function researchEvents(line, { maxTurns } = {}) {
  let e
  try {
    e = JSON.parse(line)
  } catch {
    return []
  }
  if (e?.type === "assistant") {
    const out = []
    for (const c of e.message?.content ?? []) {
      if (c?.type === "tool_use" && RESEARCH_TOOLS.includes(c.name)) {
        out.push({ type: "tool", name: c.name, ...(c.input?.query ? { query: clip(c.input.query, L.inputChars) } : {}), ...(c.input?.url ? { url: clip(c.input.url, L.inputChars) } : {}) })
      } else if (c?.type === "text" && c.text?.trim()) out.push({ type: "note", text: clip(c.text, L.noteChars) })
    }
    return out
  }
  if (e?.type === "result") {
    const meta = { turns: e.num_turns ?? null, ms: e.duration_ms ?? null, cost_usd: e.total_cost_usd ?? null }
    if (e.subtype === "error_max_turns") return [{ type: "error", message: `ran out of turns (${maxTurns ?? "max"}) before writing its document — give the stage more max_turns or a narrower ask`, ...meta }]
    if (e.is_error || typeof e.result !== "string" || !e.result.trim()) return [{ type: "error", message: `claude: ${clip(e.result ?? e.subtype ?? "no answer", L.errorTailChars)}`, ...meta }]
    return [{ type: "result", text: e.result, ...meta }]
  }
  return []
}

// research.run(...) → async iterable of events (the result or an error last). spawn: injectable for tests.
export function createResearch({ bin, spawn = Bun.spawn, env = process.env } = {}) {
  if (!bin) return null
  return {
    async *run({ prompt, model = "default", max_turns, seconds, system = "", signal } = {}) {
      if (typeof prompt !== "string" || !prompt.trim()) throw httpError(400, "No prompt.")
      if (prompt.length > L.promptChars) throw httpError(413, `Prompt too long (${L.promptChars} characters max).`)
      if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(String(model))) throw httpError(400, `Bad model id "${model}".`)
      if (typeof system !== "string" || system.length > L.systemChars) throw httpError(400, `system: text up to ${L.systemChars} characters.`)
      const maxTurns = clamp(max_turns, 1, L.maxTurns, L.defaultTurns)
      const ms = clamp(seconds, L.minSeconds, L.maxSeconds, L.defaultSeconds) * 1000
      yield { type: "start", model, max_turns: maxTurns, seconds: ms / 1000 }
      const cwd = await mkdtemp(join(tmpdir(), "askk-research-"))
      const sources = []
      let last = null
      let proc = null
      try {
        proc = spawn(researchArgv(bin, { model, maxTurns, system }), { cwd, env: researchEnv(env, bin), stdin: "pipe", stdout: "pipe", stderr: "pipe", signal, timeout: ms, killSignal: "SIGKILL" })
        proc.stdin.write(prompt)
        proc.stdin.end()
        const stderr = new Response(proc.stderr).text()
        const take = function* (line) {
          for (const event of researchEvents(line, { maxTurns })) {
            if (event.type === "tool" && sources.length < L.sources) sources.push({ name: event.name, ...(event.query ? { query: event.query } : {}), ...(event.url ? { url: event.url } : {}) })
            if (event.type === "result" || event.type === "error") last = event
            else yield event
          }
        }
        let buffer = ""
        for await (const chunk of proc.stdout.pipeThrough(new TextDecoderStream())) {
          buffer += chunk
          let at
          while ((at = buffer.indexOf("\n")) >= 0) {
            yield* take(buffer.slice(0, at))
            buffer = buffer.slice(at + 1)
          }
        }
        yield* take(buffer)
        const code = await proc.exited
        if (signal?.aborted) return yield { type: "error", message: "stopped", sources }
        if (proc.signalCode && !last) return yield { type: "error", message: `did not finish within ${ms / 1000} s`, sources }
        if (last) return yield { ...last, sources }
        yield { type: "error", message: `claude exited ${code} without a result: ${clip(await stderr, L.errorTailChars) || "(no message)"}`, sources }
      } finally {
        // The caller went away mid-stream (cancel → return()): the CLI must not run on, spending the account.
        if (proc && proc.exitCode == null && proc.signalCode == null) proc.kill?.("SIGKILL")
        await rm(cwd, { recursive: true, force: true })
      }
    },
  }
}

// The host route: POST llm/research → NDJSON. sameOrigin comes from host-api's checks.
export function researchRoute(research) {
  return async function researchCall(request, sameOrigin) {
    if (request.method !== "POST") return json(405, { error: "Method not allowed." })
    if (!sameOrigin) return json(403, { error: "Research calls need a same-origin request." })
    if (!request.headers.get("content-type")?.startsWith("application/json")) return json(415, { error: "Send JSON." })
    if (Number(request.headers.get("content-length") ?? 0) > L.promptChars * 4 + 20000) return json(413, { error: "Too large." })
    const body = await request.json().catch(() => null)
    if (!body) return json(400, { error: "Invalid JSON body." })
    const events = research.run({ ...body, signal: request.signal })
    const first = await events.next() // a bad request fails here, as a plain HTTP error
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event) => {
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
          } catch {} // the caller went away: the signal stops the call
        }
        const ping = setInterval(() => send({ type: "ping" }), L.pingMs)
        try {
          if (!first.done) send(first.value)
          for await (const event of events) send(event)
        } catch (error) {
          send({ type: "error", message: error.message })
        } finally {
          clearInterval(ping)
        }
        try {
          controller.close()
        } catch {}
      },
      cancel() {
        events.return?.()
      },
    })
    return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } })
  }
}
