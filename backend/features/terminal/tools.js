// term.*: programs in the workspace, on the host (companion/terminal.js,
// capability `term`) — only when the desk declares a terminal (desk.js
// `terminal: { programs }`). Sandboxed there: writes stay in the workspace,
// no keys in the environment, no shell syntax. Every run is also shown to the
// whole team in the terminal artifact (the last 5 runs and the background
// processes).
//
//   term.run    one command to its end; output streams into the call's progress
//   term.start  a background process (a dev server) that keeps running
//   term.ps / term.logs / term.stop   check on it later, from any agent

import { withBase } from "@/backend/platform/base-path"
import { detectHost, hasCapability } from "@/backend/platform/host"

async function termFetch(endpoint, { body, params, signal } = {}) {
  const host = await detectHost()
  if (!hasCapability(host, "term")) throw new Error("No terminal here: the desk declares none, or ASKK is not running locally.")
  const query = params ? `?${new URLSearchParams(params)}` : ""
  try {
    return await fetch(withBase(`/__askk/${endpoint}${query}`), {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error("The ASKK companion is not reachable.")
  }
}

export async function termRequest(endpoint, options = {}) {
  const response = await termFetch(endpoint, options)
  const data = await response.json().catch(() => null)
  if (!response.ok || !data) throw new Error(data?.error ?? `Terminal request failed (${response.status}).`)
  return data
}

const runHead = (r) =>
  `$ ${r.command}  (in ${r.cwd}) → exit ${r.exit} · ${(r.ms / 1000).toFixed(1)} s${r.timedOut ? ` · ${r.timedOut}` : ""}${r.stopped ? " · stopped" : ""}${r.truncated ? " · output cut to its end" : ""}`

// The host streams NDJSON (start, out…, result); each chunk of output goes to
// the call's progress as it prints, the final string is the same as before.
async function termRun(inputs, { engine, signal, progress } = {}) {
  const response = await termFetch("term/run", {
    body: { command: inputs.command, cwd: inputs.cwd ?? ".", timeout: inputs.timeout, agent: engine?.name ?? null, stream: true },
    signal,
  })
  if (!response.ok || !response.headers.get("content-type")?.includes("ndjson")) {
    const data = await response.json().catch(() => null)
    if (!response.ok || !data) throw new Error(data?.error ?? `Terminal request failed (${response.status}).`)
    return `${runHead(data)}\n${data.output || "(no output)"}`
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let result = null
  const onLine = (line) => {
    if (!line.trim()) return
    let event
    try {
      event = JSON.parse(line)
    } catch {
      return
    }
    if (event.type === "start") progress?.({ data: { runId: event.id, command: event.command, cwd: event.cwd } })
    else if (event.type === "out") progress?.({ append: event.text })
    else if (event.type === "result") result = event
    else if (event.type === "error") throw new Error(event.error)
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nl
    while ((nl = buffer.indexOf("\n")) >= 0) {
      onLine(buffer.slice(0, nl))
      buffer = buffer.slice(nl + 1)
    }
  }
  onLine(buffer + decoder.decode())
  if (!result) throw new Error("The terminal run ended without a result.")
  progress?.({ data: { runId: result.id, exit: result.exit } })
  return `${runHead(result)}\n${result.output || "(no output)"}`
}

const procLine = (p) =>
  `${p.id} · ${p.name} · ${p.status}${p.status === "exited" ? ` (exit ${p.exit}${p.reason ? `, ${p.reason}` : ""})` : ""} · pid ${p.pid} · $ ${p.command} (in ${p.cwd})${p.urls?.length ? ` · ${p.urls.join(" ")}` : ""}`

async function termStart(inputs, { engine, signal, progress } = {}) {
  const p = await termRequest("term/start", {
    body: { command: inputs.command, cwd: inputs.cwd ?? ".", name: inputs.name, port: inputs.port, agent: engine?.name ?? null },
    signal,
  })
  progress?.({ data: { procId: p.id, urls: p.urls, status: p.status } })
  const note =
    p.status === "running"
      ? `Running in the background. Check it with term.logs {"id": "${p.id}"}; stop it with term.stop when done.${p.urls.length ? "" : " No URL printed yet."}`
      : "It already exited: read the output, fix the cause, start it again."
  return `${procLine(p)}\n${note}\nFirst output:\n${p.output || "(none yet)"}`
}

async function termPs(_inputs, { signal } = {}) {
  const { procs } = await termRequest("term/ps", { signal })
  if (!procs.length) return "No background processes."
  return procs.map(procLine).join("\n")
}

async function termLogs(inputs, { signal } = {}) {
  const p = await termRequest("term/logs", { params: { id: inputs.id, tail: inputs.tail ?? 50 }, signal })
  return `${procLine(p)}\n${p.output || "(no output)"}`
}

async function termStop(inputs, { signal } = {}) {
  const p = await termRequest("term/stop", { body: { id: inputs.id }, signal })
  return procLine(p)
}

export const TERMINAL_TOOLS = {
  "term.run": {
    description:
      "Run a program in the workspace to its end and get its exit code and output (stdout+stderr, the end of it). One program with " +
      "arguments, or several joined by `&&`; `cd <dir>` inside the workspace works; `cwd` is a workspace folder. " +
      "No pipes, redirects, `;` or `$(…)`. Only this desk's programs (the terminal artifact lists them). " +
      "Writes outside the workspace are refused. Long-running servers go to term.start (term.run waits for the end and is stopped at the time limit).",
    inputs: {
      type: "object",
      properties: {
        command: { type: "string", minLength: 1, maxLength: 4000 },
        cwd: { type: "string", maxLength: 1024 },
        timeout: { type: "integer", minimum: 1, maximum: 1800, description: "seconds (the desk's limit caps it)" },
      },
      required: ["command"],
      additionalProperties: false,
    },
    effect: "write",
    approval: true,
    view: "terminal",
    streams: true,
    describe: ({ command, cwd }) => `Run in ${cwd ?? "the workspace"}: ${command.length > 120 ? `${command.slice(0, 120)}…` : command}`,
    run: termRun,
  },
  "term.start": {
    description:
      "Start a long-running program (a dev server) in the background and return at once (after ~3 s) with its id, pid, the " +
      "URLs it printed and its first output. ONE program, no `&&` (run setup with term.run first); same programs and sandbox as " +
      "term.run; `port` sets the PORT environment variable (pass it on the command line too if the server needs a flag). " +
      "It keeps running for the whole team until term.stop (or the desk's time limit); at most 4 at once.",
    inputs: {
      type: "object",
      properties: {
        command: { type: "string", minLength: 1, maxLength: 4000 },
        cwd: { type: "string", maxLength: 1024 },
        name: { type: "string", maxLength: 60, description: "a short label, e.g. api" },
        port: { type: "integer", minimum: 1024, maximum: 65535 },
      },
      required: ["command"],
      additionalProperties: false,
    },
    effect: "write",
    approval: true,
    view: "terminal",
    streams: false,
    describe: ({ command, cwd, port }) => `Start in the background in ${cwd ?? "the workspace"}${port ? ` (port ${port})` : ""}: ${command.length > 120 ? `${command.slice(0, 120)}…` : command}`,
    run: termStart,
  },
  "term.ps": {
    description: "List the background processes (term.start): id, name, running or exited (exit code), pid, command, URLs.",
    inputs: { type: "object", properties: {}, additionalProperties: false },
    effect: "read",
    approval: false,
    view: "terminal",
    run: termPs,
  },
  "term.logs": {
    description: "The latest output of a background process (term.start): its last `tail` lines (default 50) and its status.",
    inputs: {
      type: "object",
      properties: {
        id: { type: "string", minLength: 1, maxLength: 80 },
        tail: { type: "integer", minimum: 1, maximum: 1000 },
      },
      required: ["id"],
      additionalProperties: false,
    },
    effect: "read",
    approval: false,
    view: "terminal",
    run: termLogs,
  },
  "term.stop": {
    description: "Stop a background process (term.start) and what it spawned: SIGTERM, then SIGKILL after 5 s. Returns its exit status.",
    inputs: {
      type: "object",
      properties: { id: { type: "string", minLength: 1, maxLength: 80 } },
      required: ["id"],
      additionalProperties: false,
    },
    effect: "write",
    approval: true,
    view: "terminal",
    describe: ({ id }) => `Stop background process ${id}`,
    run: termStop,
  },
}
