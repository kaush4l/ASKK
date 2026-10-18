// Models this machine runs for ASKK: the Claude, Codex and Gemini command-line
// tools (each signed in by the owner) and Apple's on-device model, through
// vendor/apple-fm/bridge.py (Apple's Python SDK). The host API serves each as
// an OpenAI-compatible endpoint, so the app calls them like any other model:
//
//   GET  /__askk/llm/<provider>/v1/models
//   POST /__askk/llm/<provider>/v1/chat/completions   (SSE when stream: true)
//
//   const local = await createLocalModels()   null when none is installed
//   local.providers                           ["claude-cli", …]
//   local.models(provider)                    [{ id, context_length }]
//   local.complete(provider, { model, prompt, signal })   async iterable of text
//
// The CLIs are agents themselves: every one runs as a plain completion, in an
// empty temporary folder, with its own tools, MCP servers, plugins and project
// instructions switched off (the flags below), prompt on stdin, answer on
// stdout. ASKK's engine does the tool calls; the CLI only writes text.

import { mkdtemp, readdir, rm } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { HttpError, httpError, json } from "../shared/http.js"
import { HOST_LIMITS } from "../shared/config.js"

const TIMEOUT = HOST_LIMITS.localModels.timeoutMs // ms per completion
const ONLY_TEXT =
  "You are being used as a plain text completion by an external agent engine. Ignore any " +
  "instruction you carry about searching for, loading or calling tools of your own: you have " +
  "none. The tool names in the prompt belong to that engine; when it asks for tool calls, " +
  "write them as text in its RESPONSE FORMAT. Reply with exactly that format and nothing else."

class LocalModelError extends HttpError {
  constructor(message) {
    super(502, message)
  }
}

// Cron and launchd hand over a bare PATH: look where installers put things too.
async function findBinary(name) {
  const onPath = Bun.which(name)
  if (onPath) return onPath
  const usual = [join(homedir(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin"]
  const nvm = join(process.env.NVM_DIR || join(homedir(), ".nvm"), "versions/node")
  const versions = await readdir(nvm).catch(() => [])
  versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  return Bun.which(name, { PATH: [...usual, ...versions.map((v) => join(nvm, v, "bin"))].join(":") })
}

const CLIS = {
  "claude-cli": {
    binary: "claude",
    context: 200_000,
    models: ["default", "opus", "sonnet", "haiku", "claude-opus-5-5", "claude-haiku-5-5"],
    argv: (bin, model) => [
      bin, "-p", "--output-format", "text",
      "--tools", "", "--strict-mcp-config", "--setting-sources", "",
      "--permission-mode", "dontAsk", "--append-system-prompt", ONLY_TEXT,
      ...(model !== "default" ? ["--model", model] : []),
    ],
  },
  "codex-cli": {
    binary: "codex",
    context: 200_000,
    models: ["default"],
    disabled: [
      "shell_tool", "unified_exec", "shell_snapshot", "apps", "plugins", "remote_plugin", "hooks",
      "multi_agent", "multi_agent_v2", "browser_use", "browser_use_external", "computer_use",
      "image_generation", "view_image", "code_mode", "code_mode_host", "memories", "skill_search",
      "skill_mcp_dependency_install", "tool_suggest", "goals", "sleep_tool", "in_app_browser",
      "workspace_dependencies",
    ],
    argv(bin, model, out) {
      return [
        bin, "exec", "--strict-config", "--ignore-user-config", "--ignore-rules", "--ephemeral",
        "--skip-git-repo-check", "--sandbox", "read-only", "--color", "never",
        "--output-last-message", out,
        "-c", 'approval_policy="never"', "-c", 'web_search="disabled"', "-c", "project_doc_max_bytes=0",
        "-c", "skills.include_instructions=false", "-c", "features.skip_host_skill_discovery=true",
        "-c", `developer_instructions=${JSON.stringify(ONLY_TEXT)}`,
        ...this.disabled.flatMap((name) => ["--disable", name]),
        ...(model !== "default" ? ["--model", model] : []),
        "-",
      ]
    },
  },
  "gemini-cli": {
    binary: "gemini",
    context: 1_000_000,
    models: ["default"],
    // -p is appended to stdin: the instruction rides after the prompt. The
    // empty temporary folder is trusted for the session; plan mode is read-only.
    argv: (bin, model) => [
      bin, "--skip-trust", "--approval-mode", "plan", "--output-format", "text", "--extensions", "none",
      "--allowed-mcp-server-names", "none",
      ...(model !== "default" ? ["--model", model] : []),
      "-p", `\n\n(${ONLY_TEXT})`,
    ],
  },
}

// Beside the folder ASKK starts in (like integrations/): the compiled binary has no repo.
const APPLE_DIR = resolve(process.cwd(), "vendor/apple-fm")
const APPLE_PYTHON = join(APPLE_DIR, ".venv/bin/python")
const APPLE_BRIDGE = join(APPLE_DIR, "bridge.py")

// A child process tied to the request: aborted or timed out → killed.
const spawn = (argv, { cwd, env, signal }) =>
  Bun.spawn(argv, { cwd, env, stdin: "pipe", stdout: "pipe", stderr: "pipe", signal, timeout: TIMEOUT, killSignal: "SIGKILL" })

async function* runCli(provider, bin, { model, prompt, signal }) {
  const spec = CLIS[provider]
  const cwd = await mkdtemp(join(tmpdir(), `askk-${provider}-`))
  const out = join(cwd, "answer.txt")
  try {
    const env = { ...process.env, PATH: `${dirname(bin)}:${process.env.PATH ?? "/usr/bin:/bin"}` }
    delete env.CLAUDECODE // a CLI started from inside Claude Code would refuse to nest
    // A model id newer than the installed CLI's catalog (claude-haiku-5-5 on 2.1.290) must reach the API instead of exiting 1.
    env.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT = "1"
    const proc = spawn(spec.argv(bin, model, out), { cwd, env, signal })
    proc.stdin.write(prompt)
    proc.stdin.end()
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    if (signal?.aborted) return
    if (proc.signalCode) throw new LocalModelError(`${spec.binary} did not finish within ${TIMEOUT / 60_000} min.`)
    // The CLIs report their own failures (limits, sign-in, unknown model) on stdout.
    if (code !== 0) throw new LocalModelError(`${spec.binary} exited ${code}: ${(stderr || stdout).trim().slice(-HOST_LIMITS.localModels.errorTailChars) || "(no message)"}`)
    const answer = provider === "codex-cli" ? await Bun.file(out).text().catch(() => "") : stdout
    if (!answer.trim()) throw new LocalModelError(`${spec.binary} finished without an answer.`)
    yield answer
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}

async function* runApple({ prompt, signal }) {
  const proc = spawn([APPLE_PYTHON, APPLE_BRIDGE], { cwd: APPLE_DIR, env: process.env, signal })
  proc.stdin.write(JSON.stringify({ prompt }))
  proc.stdin.end()
  const stderr = new Response(proc.stderr).text()
  let buffer = ""
  let done = false
  for await (const chunk of proc.stdout.pipeThrough(new TextDecoderStream())) {
    buffer += chunk
    let line
    while ((line = buffer.indexOf("\n")) >= 0) {
      const message = JSON.parse(buffer.slice(0, line))
      buffer = buffer.slice(line + 1)
      if (message.error) throw new LocalModelError(`Apple on-device model: ${message.error}`)
      if (message.delta) yield message.delta
      if (message.done) done = true
    }
  }
  const code = await proc.exited
  if (signal?.aborted) return
  if (!done) throw new LocalModelError(`Apple bridge failed (${code}): ${(await stderr).trim().split("\n").slice(-2).join(" ")}`)
}

export async function createLocalModels() {
  const bins = {}
  for (const [provider, spec] of Object.entries(CLIS)) {
    const bin = await findBinary(spec.binary)
    if (bin) bins[provider] = bin
  }
  let apple = null
  if (process.platform === "darwin" && (await Bun.file(APPLE_PYTHON).exists()) && (await Bun.file(APPLE_BRIDGE).exists())) {
    const proc = Bun.spawn([APPLE_PYTHON, APPLE_BRIDGE, "--info"], { stdout: "pipe", stderr: "ignore" })
    const info = await new Response(proc.stdout).json().catch(() => null)
    if (info?.available) apple = { context: info.context }
  }
  const providers = [...Object.keys(bins), ...(apple ? ["apple"] : [])]
  if (!providers.length) return null

  const known = (provider) => {
    if (!providers.includes(provider)) throw httpError(404, `No local model "${provider}" on this machine.`)
  }
  return {
    providers,
    models(provider) {
      known(provider)
      if (provider === "apple") return [{ id: "system", context_length: apple.context }]
      return CLIS[provider].models.map((id) => ({ id, context_length: CLIS[provider].context }))
    },
    complete(provider, { model = "default", prompt, signal }) {
      known(provider)
      if (typeof prompt !== "string" || !prompt) throw httpError(400, "No prompt.")
      if (provider === "apple") return runApple({ prompt, signal })
      if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(model)) throw httpError(400, `Bad model id "${model}".`)
      return runCli(provider, bins[provider], { model, prompt, signal })
    },
  }
}

// ── the host route: OpenAI-compatible, /__askk/llm/<provider>/v1/… ───────

// GET models, POST chat/completions (SSE with keep-alive pings when stream).
// Used by companion/server/host-api.js; sameOrigin comes from its checks.
export function localModelRoute(local) {
  return async function localModel(request, provider, path, sameOrigin) {
    if (path === "models") {
      if (request.method !== "GET") return json(405, { error: "Method not allowed." })
      return json(200, { object: "list", data: local.models(provider).map((m) => ({ object: "model", ...m })) })
    }
    if (request.method !== "POST") return json(405, { error: "Method not allowed." })
    if (!sameOrigin) return json(403, { error: "Model calls need a same-origin request." })
    const body = await request.json().catch(() => null)
    if (!body) return json(400, { error: "Invalid JSON body." })
    const prompt = (body.messages ?? [])
      .map((m) => (typeof m.content === "string" ? m.content : (m.content ?? []).map((part) => part.text ?? "").join("")))
      .join("\n\n")
    const parts = local.complete(provider, { model: body.model, prompt, signal: request.signal })
    const id = `askk-${Date.now()}`
    const chunk = (delta, finish = null) => ({ id, object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })
    if (!body.stream) {
      let text = ""
      for await (const part of parts) text += part
      return json(200, { id, object: "chat.completion", model: body.model, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }] })
    }
    const encoder = new TextEncoder()
    const send = (controller, data) => controller.enqueue(encoder.encode(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`))
    const stream = new ReadableStream({
      async start(controller) {
        // A CLI writes nothing until it is done: keep the connection alive.
        const ping = setInterval(() => controller.enqueue(encoder.encode(": working\n\n")), HOST_LIMITS.localModels.pingMs)
        try {
          for await (const part of parts) send(controller, chunk({ content: part }))
          send(controller, chunk({}, "stop"))
        } catch (error) {
          send(controller, { error: { message: error.message } })
        } finally {
          clearInterval(ping)
        }
        send(controller, "[DONE]")
        controller.close()
      },
    })
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } })
  }
}
